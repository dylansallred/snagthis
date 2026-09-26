const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID, webcrypto } = require('node:crypto');

const extension = path.join(__dirname, '../apps/extension');
const clone = value => structuredClone(value);

function storage(initial = {}, quota = { bytes: Infinity }) {
  const values = clone(initial);
  return {
    values,
    setAccessLevel: async () => {},
    get: async keys => clone(keys == null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]))),
    set: async entries => {
      if (Buffer.byteLength(JSON.stringify({ ...values, ...entries })) > quota.bytes) throw new Error('Session storage quota bytes exceeded. Values were not stored.');
      Object.assign(values, clone(entries));
    },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}

// The shipped worker with Chrome's event and storage surface replaced.
function loadWorker({ tab = { id: 7, url: 'https://cinema.example/watch', title: 'Watch', documentId: 'document-a' }, frames = {}, downloads, fetch, local = { appToken: 'fixture-token', appTokenVersion: 2 } } = {}) {
  const listeners = {};
  const event = name => ({ addListener: listener => { listeners[name] = listener; } });
  const quota = { bytes: Infinity };
  const session = storage({}, quota);
  const warnings = [];
  const requests = [];
  const badges = [];
  const opened = [];
  const localStorage = storage(local);
  const chrome = {
    storage: { session, local: localStorage },
    action: { setBadgeText: async value => { badges.push(clone(value)); }, setBadgeBackgroundColor: async () => {} },
    runtime: { id: 'a'.repeat(32), getURL: value => `chrome-extension://${'a'.repeat(32)}/${value}`,
      getManifest: () => ({ version: '1.0.0' }), onMessage: event('message'), onInstalled: event('installed') },
    tabs: { get: async () => clone(tab), onRemoved: event('removed'), create: async value => { opened.push(value.url); } },
    webNavigation: { getFrame: async ({ frameId }) => clone(frames[frameId] || (frameId === 0 ? { url: tab.url, documentId: tab.documentId, parentFrameId: -1, frameType: 'outermost_frame', documentLifecycle: 'active' } : null)),
      onCommitted: event('committed'), onHistoryStateUpdated: event('history') },
    webRequest: { onBeforeSendHeaders: event('beforeHeaders'), onHeadersReceived: event('headers'),
      onCompleted: event('completed'), onErrorOccurred: event('error') },
    ...(downloads ? { downloads } : {}),
  };
  const context = vm.createContext({ chrome, URL, AbortSignal, TextEncoder, setTimeout, clearTimeout, crypto: { randomUUID, subtle: webcrypto.subtle, getRandomValues: array => webcrypto.getRandomValues(array) }, console: { warn: (...args) => warnings.push(args) },
    fetch: async (url, options) => { requests.push(new URL(url).pathname); return (fetch || (async () => ({ ok: true, json: async () => ({ jobId: 'desktop-job' }) })))(url, options); } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(extension, 'service-worker.js'), 'utf8'), context, { filename: 'service-worker.js' });
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  return {
    context, session, quota, warnings, requests, badges, opened, local: localStorage,
    content: (patch = {}) => ({ id: chrome.runtime.id, tab: clone(tab), frameId: 0, documentId: tab.documentId, url: tab.url, ...patch }),
    message(message, sender = popup) { return new Promise(resolve => listeners.message(message, sender, value => resolve(clone(value)))); },
    async emit(name, details) { await listeners[name](details); for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate); },
    async response(url, contentType, extra = {}) {
      const details = { requestId: randomUUID(), url, tabId: tab.id, frameId: 0, frameType: 'outermost_frame', documentLifecycle: 'active', documentId: tab.documentId, type: 'xmlhttprequest', timeStamp: Date.now(), ...extra };
      await listeners.beforeHeaders({ ...details, requestHeaders: extra.requestHeaders || [] });
      await this.emit('headers', { ...details, statusCode: 200, responseHeaders: [{ name: 'Content-Type', value: contentType }] });
    },
  };
}

test('page-posted media is an untrusted hint: no request context, no unprompted credentialed preview', async () => {
  const worker = loadWorker();
  const sourcePreview = require('../apps/extension/popup/source-preview');
  const intranet = 'http://intranet.example/admin/delete.mp4';
  const forged = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: intranet, contentType: 'video/mp4',
    requestHeaders: { origin: 'https://bank.example', referer: 'https://bank.example/', authorization: 'Bearer forged' } } }, worker.content());
  assert.equal(forged.ok, true);
  assert.deepEqual(forged.item.requestHeaders, {}, 'page-supplied Origin, Referer and credentials are discarded');
  assert.equal(forged.item.networkObserved, false);
  const hinted = sourcePreview.sourceFor(forged.item);
  assert.equal(hinted.trusted, false, 'the popup never prepares this poster without a hover');
  assert.equal(sourcePreview.fetchOptions(hinted, intranet).credentials, 'omit');

  // Chrome's own response for the same tab carries the real context.
  const cdn = 'https://cdn.example/movie.mp4';
  await worker.response(cdn, 'video/mp4', { type: 'media', requestHeaders: [{ name: 'Referer', value: 'https://cinema.example/watch' }] });
  const observed = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: cdn, contentType: 'video/mp4', requestHeaders: { referer: 'https://attacker.example/' } } }, worker.content());
  assert.equal(observed.item.networkObserved, true);
  assert.deepEqual(observed.item.requestHeaders, { referer: 'https://cinema.example/watch' });
  const source = sourcePreview.sourceFor(observed.item);
  assert.equal(source.trusted, true);
  assert.equal(sourcePreview.fetchOptions(source, cdn).credentials, 'include');

  // A playlist with a generic type is admitted by its body only after Chrome fetched it.
  const playlist = 'https://cdn.example/stream/index.jpg';
  await worker.response(playlist, 'image/jpeg', { requestHeaders: [{ name: 'Authorization', value: 'Bearer real' }] });
  const body = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: playlist, contentType: 'image/jpeg', manifestText: '#EXTM3U\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n' } }, worker.content());
  assert.equal(body.item.networkObserved, true);
  assert.deepEqual(body.item.requestHeaders, { authorization: 'Bearer real' });
});

test('fMP4 playlist pieces never become rows or rewrite the page, and new videos replace the oldest detection', async () => {
  const worker = loadWorker();
  const base = 'https://cdn.example/show/';
  const early = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: `${base}seg-0.mp4`, contentType: 'video/mp4' } }, worker.content());
  const manifest = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n' + Array.from({ length: 300 }, (_, index) => `#EXTINF:4,\nseg-${index}.mp4\n`).join('') + '#EXT-X-ENDLIST\n';
  await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: `${base}index.m3u8`, contentType: 'application/vnd.apple.mpegurl', manifestText: manifest } }, worker.content());
  let page = worker.session.values['snagthis:tab:7'];
  assert.ok(!page.items.some(item => item.id === early.item.id), 'a piece seen before its playlist is removed');
  const writes = page.updatedAt;
  for (const name of ['init.mp4', 'seg-1.mp4', 'seg-2.mp4']) {
    const result = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: `${base}${name}`, contentType: 'video/mp4' } }, worker.content());
    assert.equal(result.ignored, true);
  }
  assert.equal(worker.session.values['snagthis:tab:7'].updatedAt, writes, 'listed pieces cause no page write');

  for (let index = 0; index < 70; index++) {
    await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: `https://files.example/clip-${index}.mp4`, contentType: 'video/mp4' } }, worker.content());
  }
  page = worker.session.values['snagthis:tab:7'];
  assert.equal(page.items.length, 60);
  assert.ok(page.items.some(item => item.url === 'https://files.example/clip-69.mp4'), 'the newest video is kept');
  assert.ok(!page.items.some(item => item.url === `${base}index.m3u8`), 'the oldest unmapped detection made room');
});

test('a full session quota is logged, trimmed and retried; writes after tab close are dropped', async () => {
  const worker = loadWorker();
  const token = 'x'.repeat(400);
  const manifest = '#EXTM3U\n' + Array.from({ length: 1500 }, (_, index) => `#EXTINF:4,\npieces/${index}.mp4?token=${token}\n`).join('') + '#EXT-X-ENDLIST\n';
  // Another tab's older page holds most of the shared quota.
  worker.session.values['snagthis:tab:3'] = { url: 'https://other.example/', items: [], hidden: [], mappings: {}, contexts: {}, padding: 'p'.repeat(400000), updatedAt: 1 };
  worker.quota.bytes = 1_000_000;
  const stored = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/long/index.m3u8', contentType: 'application/vnd.apple.mpegurl', manifestText: manifest } }, worker.content());
  assert.equal(stored.ok, true, stored.error);
  const page = worker.session.values['snagthis:tab:7'];
  assert.ok(page, 'the current tab still records its video');
  assert.equal(worker.session.values['snagthis:tab:3'], undefined, 'the least recently updated other tab was evicted');
  const playlist = page.items[0].manifest;
  assert.deepEqual(playlist.segmentUrls, []);
  assert.deepEqual(playlist.segmentBases, ['https://cdn.example/long/pieces/']);
  assert.ok(worker.warnings.length > 0, 'the quota failure is logged');
  const piece = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: `https://cdn.example/long/pieces/9.mp4?token=${token}`, contentType: 'video/mp4' } }, worker.content());
  assert.equal(piece.ignored, true, 'trimmed playlists still recognise their pieces');
  const listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(listed.items.length, 1);

  worker.quota.bytes = Infinity;
  const pending = worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://files.example/late.mp4', contentType: 'video/mp4' } }, worker.content());
  await worker.emit('removed', 7);
  await pending;
  await new Promise(setImmediate);
  assert.equal(worker.session.values['snagthis:tab:7'], undefined, 'a queued write cannot recreate a closed tab');
});

test('prerendered pages keep separate detections until Chrome activates that document', async () => {
  const frames = { 5: { url: 'https://cinema.example/next', documentId: 'document-next', parentFrameId: -1, frameType: 'outermost_frame', documentLifecycle: 'prerender' } };
  const worker = loadWorker({ frames });
  await worker.emit('committed', { tabId: 7, frameId: 0, frameType: 'outermost_frame', documentLifecycle: 'active', url: 'https://cinema.example/watch', documentId: 'document-a', timeStamp: 1 });
  await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://files.example/current.mp4', contentType: 'video/mp4' } }, worker.content());
  await worker.emit('committed', { tabId: 7, frameId: 5, frameType: 'outermost_frame', documentLifecycle: 'prerender', url: 'https://cinema.example/next', documentId: 'document-next', timeStamp: 2 });
  const prerender = worker.content({ frameId: 5, documentId: 'document-next', documentLifecycle: 'prerender', url: 'https://cinema.example/next' });
  await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://files.example/next.mp4', contentType: 'video/mp4', sourcePageUrl: 'https://cinema.example/next' } }, prerender);
  await worker.response('https://files.example/next-network.mp4', 'video/mp4', { type: 'media', frameId: 5, documentId: 'document-next', documentLifecycle: 'prerender' });
  const before = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.deepEqual(before.items.map(item => item.url), ['https://files.example/current.mp4'], 'the visible page is unaffected by the prerender');

  // Activation commits the same document again with its non-zero frameId.
  frames[5].documentLifecycle = 'active';
  await worker.emit('committed', { tabId: 7, frameId: 5, frameType: 'outermost_frame', documentLifecycle: 'active', url: 'https://cinema.example/next', documentId: 'document-next', timeStamp: 3 });
  const after = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.deepEqual(after.items.map(item => item.url).sort(), ['https://files.example/next-network.mp4', 'https://files.example/next.mp4']);
  assert.notEqual(after.visit, before.visit);
  assert.ok(!Object.keys(worker.session.values).some(key => key.includes(':prerender:')), 'activated and abandoned prerender state is removed');
  const active = await worker.message({ cmd: 'PAGE_CONTEXT', context: { sourcePageUrl: 'https://cinema.example/next', sourcePageTitle: 'Next' } },
    worker.content({ frameId: 5, documentId: 'document-next', documentLifecycle: 'active', tab: { id: 7, url: 'https://cinema.example/next' } }));
  assert.equal(active.ok, true);
  assert.equal(active.ignored, undefined, 'the activated non-zero outermost frame is the top page');
});

test('Chrome-only downloads never need the desktop app, even for a row once sent to desktop', async () => {
  const downloads = {
    download: async () => 41,
    search: async ({ id }) => [{ id, byExtensionId: 'a'.repeat(32), state: 'in_progress', paused: false, danger: 'safe', mime: 'video/mp4', bytesReceived: 0, totalBytes: 100 }],
    cancel: async () => {},
    onChanged: { addListener() {} }, onErased: { addListener() {} },
  };
  const worker = loadWorker({ downloads });
  const url = 'https://files.example/film.mp4';
  const stored = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url, contentType: 'video/mp4' } }, worker.content());
  const page = worker.session.values['snagthis:tab:7'];
  page.mappings[stored.item.id] = 'desktop-job-1';
  // The desktop app is closed: any bridge request fails like a refused connection.
  worker.context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const result = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'browser', tabId: 7, mediaId: stored.item.id, payload: { mediaUrl: url, title: 'Film' } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.backend, 'browser');
  const desktop = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: stored.item.id, payload: { mediaUrl: url, title: 'Film' } });
  assert.equal(desktop.ok, false);
  assert.equal(desktop.error, "SnagThis desktop isn't running. Open it, then try again.", 'transport wording stays out of the popup');
});

test('the store build refuses YouTube handoff while development builds keep it', async () => {
  const worker = loadWorker({ tab: { id: 7, url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Video - YouTube', documentId: 'document-a' } });
  const stored = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://www.youtube.com/watch?v=abcdefghijk', mediaKind: 'youtube-page', contentType: 'video/youtube' } }, worker.content());
  assert.equal(stored.item.mediaKind, 'youtube-page');
  const development = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: stored.item.id, apiBase: 'http://127.0.0.1:39999', payload: { mediaUrl: 'https://www.youtube.com/watch?v=abcdefghijk' } });
  assert.equal(development.ok, true, development.error);
  assert.deepEqual(worker.requests, ['/v1/jobs']);
  worker.requests.length = 0;
  worker.context.SnagThisBuild = { storeBuild: true };
  const blocked = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: stored.item.id, apiBase: 'http://127.0.0.1:39999', payload: { mediaUrl: 'https://www.youtube.com/watch?v=abcdefghijk' } });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /paste it into the SnagThis desktop app/);
  assert.deepEqual(worker.requests, [], 'no desktop handoff is attempted');
});

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('one-click pairing: the worker keeps the secret, polls, stores its own key and badges the outcome', async () => {
  const bodies = [];
  let decided = false;
  const worker = loadWorker({ local: {}, fetch: async (url, options) => {
    const route = new URL(url).pathname; const body = JSON.parse(options.body || '{}'); bodies.push({ route, body, headers: options.headers });
    if (route === '/v1/pair/request') return reply(201, { requestId: 'c'.repeat(32), matchCode: '4719', expiresInMs: 120000, status: 'pending' });
    if (route === '/v1/pair/status') return reply(200, decided ? { status: 'approved', token: 'd'.repeat(64) } : { status: 'pending', expiresInMs: 110000 });
    return reply(404, {});
  } });
  const started = await worker.message({ cmd: 'PAIR_START', tabId: 7, apiBase: 'http://127.0.0.1:39999' });
  assert.equal(started.ok, true);
  assert.equal(started.state.status, 'waiting');
  assert.equal(started.state.matchCode, '4719');
  const request = bodies.find(entry => entry.route === '/v1/pair/request');
  assert.match(request.body.secret, /^[0-9a-f]{64}$/);
  assert.equal(request.headers.Authorization, undefined, 'a request carries no credential');
  const publicState = JSON.stringify(worker.session.values['snagthis:pairing']);
  assert.equal(publicState.includes(request.body.secret), false, 'the popup-visible state never holds the secret');
  assert.deepEqual(worker.badges.filter(badge => badge.text === '4719').map(badge => badge.tabId ?? null), [null, 7], 'the badge repeats the digits');
  assert.equal(worker.local.values.appToken, undefined);
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.deepEqual(worker.opened, ['snagthis://open/pair'], 'SnagThis is opened by a link carrying no ID or secret');
  decided = true;
  for (let turn = 0; turn < 40 && worker.session.values['snagthis:pairing']?.status !== 'connected'; turn++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(worker.session.values['snagthis:pairing'].status, 'connected');
  assert.equal(worker.session.values['snagthis:pairing-secret'], undefined, 'the secret is dropped once used');
  assert.equal(worker.local.values.appToken, 'd'.repeat(64));
  assert.equal(worker.local.values.appTokenVersion, 2);
  assert.ok(bodies.filter(entry => entry.route === '/v1/pair/status').every(entry => entry.body.secret === request.body.secret));
  assert.equal(worker.badges.at(-1).text, '✓');
  assert.equal((await worker.message({ cmd: 'PAIR_ACK' })).ok, true);
  assert.equal(worker.session.values['snagthis:pairing'], undefined);
  assert.equal(worker.badges.some(badge => badge.text === '' && badge.tabId === undefined), true, 'the celebration clears the badge');
  // Content scripts cannot start or read pairing.
  const fromPage = await worker.message({ cmd: 'PAIR_STATE' }, worker.content());
  assert.equal(fromPage.ok, false);
});

test('a key from before per-browser keys is swapped once for this browser\'s own', async () => {
  const worker = loadWorker({ local: { appToken: 'legacy-token' }, fetch: async (url, options) => {
    if (new URL(url).pathname === '/v1/pair/upgrade') { assert.equal(options.headers.Authorization, 'Bearer legacy-token'); return reply(200, { token: 'e'.repeat(64), paired: true }); }
    return reply(200, { jobId: 'desktop-job' });
  } });
  assert.equal((await worker.message({ cmd: 'PAIR_UPGRADE', apiBase: 'http://127.0.0.1:39999' })).ok, true);
  assert.equal(worker.local.values.appToken, 'e'.repeat(64));
  assert.equal(worker.local.values.appTokenVersion, 2);
  await worker.message({ cmd: 'PAIR_UPGRADE', apiBase: 'http://127.0.0.1:39999' });
  assert.deepEqual(worker.requests, ['/v1/pair/upgrade'], 'the swap happens once');
});
