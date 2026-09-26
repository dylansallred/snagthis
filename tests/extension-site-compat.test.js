const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const extension = path.join(__dirname, '../apps/extension');
const detection = require('../apps/extension/js/detection');
const clone = value => structuredClone(value);

// Shaped like cineby's POST /api/stream/m3u8 answer: absolute fMP4 segments.
const PLAYLIST = ['#EXTM3U', '#EXT-X-TARGETDURATION:6', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-VERSION:6',
  '#EXT-X-MAP:URI="https://kratos.example/?token=init"',
  ...Array.from({ length: 4 }, (_, index) => `#EXTINF:6.006,\nhttps://kratos.example/?token=seg-${index}`), '#EXT-X-ENDLIST', ''].join('\n');

function storage(initial = {}, quota = { bytes: Infinity }) {
  const values = clone(initial);
  return {
    values,
    setAccessLevel: async () => {},
    get: async keys => clone(keys == null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]))),
    set: async entries => {
      if (Buffer.byteLength(JSON.stringify({ ...values, ...entries })) > quota.bytes) throw new Error('Session storage quota bytes exceeded.');
      Object.assign(values, clone(entries));
    },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}

function loadWorker() {
  const tab = { id: 7, url: 'https://cinema.example/watch', title: 'Watch', documentId: 'document-a' };
  const listeners = {};
  const event = name => ({ addListener: listener => { listeners[name] = listener; } });
  const quota = { bytes: Infinity };
  const session = storage({}, quota);
  const jobs = [];
  const chrome = {
    storage: { session, local: storage({ appToken: 'fixture-token' }) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { id: 'a'.repeat(32), getURL: value => `chrome-extension://${'a'.repeat(32)}/${value}`,
      getManifest: () => ({ version: '1.0.0' }), onMessage: event('message'), onInstalled: event('installed') },
    tabs: { get: async () => clone(tab), onRemoved: event('removed') },
    webNavigation: { getFrame: async () => ({ url: tab.url, documentId: tab.documentId, parentFrameId: -1, frameType: 'outermost_frame', documentLifecycle: 'active' }),
      onCommitted: event('committed'), onHistoryStateUpdated: event('history') },
    webRequest: { onBeforeSendHeaders: event('beforeHeaders'), onHeadersReceived: event('headers'),
      onCompleted: event('completed'), onErrorOccurred: event('error') },
  };
  const context = vm.createContext({ chrome, URL, AbortSignal, crypto: { randomUUID }, console: { warn() {} },
    fetch: async (url, options) => { jobs.push({ path: new URL(url).pathname, body: JSON.parse(options.body || '{}') }); return { ok: true, json: async () => ({ jobId: 'desktop-job' }) }; } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(extension, 'service-worker.js'), 'utf8'), context, { filename: 'service-worker.js' });
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  const content = { id: chrome.runtime.id, tab: clone(tab), frameId: 0, documentId: tab.documentId, url: tab.url };
  return {
    session, quota, jobs,
    message(message, sender = popup) { return new Promise(resolve => listeners.message(message, sender, value => resolve(clone(value)))); },
    fromPage(message) { return this.message(message, content); },
    async response(url, contentType, extra = {}) {
      const details = { requestId: randomUUID(), url, tabId: tab.id, frameId: 0, frameType: 'outermost_frame', documentLifecycle: 'active', documentId: tab.documentId, type: 'xmlhttprequest', method: 'GET', timeStamp: Date.now(), ...extra };
      await listeners.beforeHeaders({ ...details, requestHeaders: [] });
      await listeners.headers({ ...details, statusCode: 200, responseHeaders: [{ name: 'Content-Type', value: contentType }, ...(extra.contentLength ? [{ name: 'Content-Length', value: String(extra.contentLength) }] : [])] });
      for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate);
    },
  };
}

function loadDetector(pageUrl = 'https://cinema.example/watch') {
  const observations = [];
  const fetchResponses = [];
  class Xhr {
    constructor() { this.listeners = new Map(); this.responseType = ''; this.status = 0; }
    open(_method, url) { this.responseURL = String(url); }
    send() {}
    addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
    removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter(entry => entry !== listener)); }
    getResponseHeader(name) { return name.toLowerCase() === 'content-type' ? this.mime : null; }
    async complete(text, mime) {
      this.responseText = text; this.mime = mime; this.status = 200;
      for (const listener of [...(this.listeners.get('load') || [])]) await listener.call(this);
    }
  }
  const window = { postMessage: message => observations.push(clone(message)), fetch: async () => fetchResponses.shift() };
  const context = vm.createContext({ window, location: { href: pageUrl }, document: { baseURI: pageUrl }, XMLHttpRequest: Xhr, URL, Headers, TextDecoder, TextEncoder,
    history: { pushState() {}, replaceState() {} } });
  vm.runInContext(fs.readFileSync(path.join(extension, 'js/media-detector.js'), 'utf8'), context, { filename: 'media-detector.js' });
  return {
    observations, Xhr,
    async fetch(input, init, { url, contentType, body }) {
      const bytes = new TextEncoder().encode(body); let read = false;
      fetchResponses.push({ ok: true, url, headers: new Headers({ 'content-type': contentType }),
        clone: () => ({ body: { getReader: () => ({ read: async () => (read ? { done: true } : (read = true, { value: bytes, done: false })), cancel: async () => {} }) } }) });
      await window.fetch(input, init);
      for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
    },
  };
}

test('the page detector reports a POST playlist only with its text and method', async () => {
  const detector = loadDetector();
  await detector.fetch('https://cinema.example/api/stream/m3u8', { method: 'post', body: '{}' },
    { url: 'https://cinema.example/api/stream/m3u8', contentType: 'application/vnd.apple.mpegurl', body: PLAYLIST });
  const media = detector.observations.map(value => value.media);
  assert.equal(media.length, 1, 'the header-only observation of a POST is not a replayable row');
  assert.equal(media[0].method, 'POST');
  assert.equal(media[0].manifestText, PLAYLIST);

  // A Request object carries its own method; a non-playlist POST answer is never reported.
  await detector.fetch({ url: 'https://cinema.example/api/log', method: 'POST' }, undefined,
    { url: 'https://cinema.example/api/log', contentType: 'text/plain', body: 'ok' });
  assert.equal(detector.observations.length, 1);

  // An XHR POST keeps the method given to open().
  const xhr = new detector.Xhr();
  xhr.open('POST', 'https://cinema.example/api/other/m3u8'); xhr.send('{}');
  await xhr.complete(PLAYLIST, 'application/vnd.apple.mpegurl');
  assert.equal(detector.observations.at(-1).media.method, 'POST');
  assert.equal(detector.observations.at(-1).media.url, 'https://cinema.example/api/other/m3u8');

  // The player's blob: copy of that playlist has no fetchable URL and is not a second row.
  const blob = new detector.Xhr();
  blob.open('GET', 'blob:https://cinema.example/51aad6c8-e5fb-4669-b3d0-7d4038f2c7af'); blob.send();
  await blob.complete(PLAYLIST, 'application/vnd.apple.mpegurl');
  assert.equal(detector.observations.length, 2);

  // Ordinary GET detections still report headers first.
  await detector.fetch('https://cdn.example/movie.mp4', undefined, { url: 'https://cdn.example/movie.mp4', contentType: 'video/mp4', body: '' });
  assert.equal(detector.observations.at(-1).media.method, 'GET');
  assert.equal(detector.observations.at(-1).media.url, 'https://cdn.example/movie.mp4');
});

test('a POST playlist is kept as a bounded snapshot and sent to the desktop instead of a GET replay', async () => {
  const worker = loadWorker();
  const url = 'https://cinema.example/api/stream/m3u8';
  const stored = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url, method: 'POST', manifestText: PLAYLIST, contentType: 'application/vnd.apple.mpegurl' } });
  assert.equal(stored.item.manifestSnapshot, PLAYLIST);
  assert.equal(stored.item.requestMethod, 'POST');
  // Chrome's own observation of the same POST keeps the text.
  await worker.response(url, 'application/vnd.apple.mpegurl', { method: 'POST' });
  const listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  const row = listed.items.find(item => item.url === url);
  assert.equal(row.hasManifestSnapshot, true);
  assert.equal(row.manifestSnapshot, undefined, 'the popup poll does not carry megabytes of text');
  assert.equal(listed.rawItems.some(item => 'manifestSnapshot' in item), false);
  assert.equal(row.networkObserved, true);

  // titles.buildJobPayload includes the text when the payload URL is the item's own URL.
  const titles = require('../apps/extension/popup/titles');
  assert.equal(titles.buildJobPayload({ url, type: 'hls', manifestSnapshot: PLAYLIST }).manifestText, PLAYLIST);
  assert.equal(titles.buildJobPayload({ url, type: 'hls' }).manifestText, undefined);

  // The worker attaches the stored text itself; a popup-supplied text is never trusted.
  const result = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: row.id, payload: { mediaUrl: url, mediaType: 'hls', title: 'Film', manifestText: '#EXTM3U\nforged' } });
  assert.equal(result.ok, true);
  const sent = worker.jobs.find(job => job.path === '/v1/jobs').body;
  assert.equal(sent.manifestText, PLAYLIST);
  assert.equal(sent.mediaUrl, url);

  const other = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/other.m3u8', manifestText: PLAYLIST, method: 'GET' } });
  assert.equal(other.item.manifestSnapshot, undefined, 'a GET playlist is replayed by URL');
  await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: other.item.id, payload: { mediaUrl: other.item.url, mediaType: 'hls', manifestText: PLAYLIST } });
  assert.equal(worker.jobs.filter(job => job.path === '/v1/jobs').at(-1).body.manifestText, undefined);
});

test('oversized snapshots are dropped and quota trimming drops snapshots first', async () => {
  const worker = loadWorker();
  const huge = `${PLAYLIST}${'#EXT-X-COMMENT\n'.repeat(160000)}`;
  assert.ok(huge.length > 2 * 1024 * 1024);
  const oversized = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cinema.example/api/big/m3u8', method: 'POST', manifestText: huge } });
  assert.equal(oversized.item.manifestSnapshot, undefined);
  assert.equal(oversized.item.requestMethod, 'POST');

  const url = 'https://cinema.example/api/stream/m3u8';
  const snapshot = `${PLAYLIST}${'#EXT-X-COMMENT\n'.repeat(20000)}`;
  await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url, method: 'POST', manifestText: snapshot } });
  worker.quota.bytes = Buffer.byteLength(JSON.stringify(worker.session.values)) + 200;
  await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/movie.mp4', contentType: 'video/mp4', durationSeconds: 600 } });
  const page = worker.session.values['snagthis:tab:7'];
  assert.ok(page.items.some(item => item.url === 'https://cdn.example/movie.mp4'), 'the new detection is stored');
  assert.equal(page.items.find(item => item.url === url).manifestSnapshot, undefined);
});

test('media only a page Service Worker serves is marked in either report order', async () => {
  const worker = loadWorker();
  const source = 'https://storage.example/mediastorage/1/132201720.mp4';
  const early = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: `${source}#mp4/chunk/1/2097152/480p/h264?maxChunkSize=5242880`, contentType: 'video/unknown' } });
  assert.equal(early.item.serviceWorkerServed, undefined);
  assert.equal((await worker.fromPage({ cmd: 'SERVICE_WORKER_MEDIA', urls: [source, 'javascript:alert(1)'] })).ok, true);
  let items = (await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 })).items;
  assert.equal(items.find(item => item.id === early.item.id).serviceWorkerServed, true);

  const late = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://storage.example/late.mp4', contentType: 'video/mp4' } });
  assert.equal(late.item.serviceWorkerServed, undefined);
  await worker.fromPage({ cmd: 'SERVICE_WORKER_MEDIA', urls: ['https://storage.example/second.mp4'] });
  const reported = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://storage.example/second.mp4', contentType: 'video/mp4' } });
  assert.equal(reported.item.serviceWorkerServed, true, 'a URL reported before its row is remembered for the page');

  // Chrome delivering the URL to the tab itself proves it can be fetched.
  await worker.response('https://storage.example/second.mp4', 'video/mp4', { type: 'media' });
  items = (await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 })).items;
  assert.equal(items.find(item => item.url === 'https://storage.example/second.mp4').serviceWorkerServed, undefined);
});

test('junk media: short sounds and ad creatives are hidden unless Show all; videos and playlists stay', async () => {
  // Unit rules.
  assert.equal(detection.isJunkMedia({ id: 'a', url: 'https://st.chatango.com/pcache/sounds/message_received.mp3?1', mediaKind: 'video', contentType: 'audio/mpeg', contentLength: 3584 }), true);
  assert.equal(detection.isJunkMedia({ id: 'b', url: 'https://cdn.example/podcast.mp3', mediaKind: 'video', contentType: 'audio/mpeg', durationSeconds: 1800 }), false);
  assert.equal(detection.isJunkMedia({ id: 'c', url: 'https://cdn.example/ding.m4a', mediaKind: 'video', durationSeconds: 2 }), true);
  assert.equal(detection.isJunkMedia({ id: 'd', url: 'https://static.a-ads.com/a-ads-video-banners/124/728x90?region=eu-central-1', mediaKind: 'video', contentType: 'video/webm', durationSeconds: 2.5 }), true);
  assert.equal(detection.isJunkMedia({ id: 'e', url: 'https://cdn.example/clip.mp4', mediaKind: 'video', durationSeconds: 3, presentation: { width: 1280, height: 720, muted: true, autoplay: true } }), true);
  assert.equal(detection.isJunkMedia({ id: 'e2', url: 'https://cdn.example/clip.mp4', mediaKind: 'video', durationSeconds: 3 }), false, 'an ordinary short video stays');
  assert.equal(detection.isJunkMedia({ id: 'f', url: 'https://cdn.example/banner.mp4', mediaKind: 'video', durationSeconds: 12, presentation: { width: 728, height: 90, loop: true, muted: true, autoplay: true } }), true);
  assert.equal(detection.isJunkMedia({ id: 'g', url: 'https://cdn.example/banner.mp4', mediaKind: 'video', durationSeconds: 12, presentation: { width: 1280, height: 720, loop: true, muted: true } }), false);
  assert.equal(detection.isJunkMedia({ id: 'h', url: 'https://cdn.example/movie.mp4', mediaKind: 'video', durationSeconds: 600 }), false);
  assert.equal(detection.isJunkMedia({ id: 'i', url: 'https://ads.doubleclick.net/short.m3u8', mediaKind: 'hls-manifest', streamType: 'hls', durationSeconds: 2 }), false);
  assert.equal(detection.isJunkMedia({ id: 'j', url: 'https://cdn.example/clip.mp4', mediaKind: 'video', durationSeconds: 3, presentation: { height: 720, muted: true } }, { j: 'job-1' }), false, 'a started download is never hidden');

  // Worker list and Show all.
  const worker = loadWorker();
  await worker.response('https://st.chatango.com/pcache/sounds/message_received.mp3?1', 'audio/mpeg', { type: 'media', contentLength: 3584 });
  await worker.response('https://static.a-ads.com/a-ads-video-banners/124/728x90?region=eu-central-1', 'video/webm', { type: 'media' });
  await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/movie.mp4', contentType: 'video/mp4', mediaSourceUrl: 'https://cdn.example/movie.mp4', durationSeconds: 600 } });
  await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/stream.m3u8', manifestText: PLAYLIST } });
  let listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.deepEqual(listed.rawItems.map(item => item.url).sort(), ['https://cdn.example/movie.mp4', 'https://cdn.example/stream.m3u8']);
  await worker.message({ cmd: 'SHOW_ALL_MEDIA', tabId: 7 });
  listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(listed.rawItems.length, 4);
});
