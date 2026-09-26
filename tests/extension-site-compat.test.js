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
      await listeners.headers({ ...details, statusCode: extra.statusCode || 200, responseHeaders: [{ name: 'Content-Type', value: contentType }, ...(extra.contentLength ? [{ name: 'Content-Length', value: String(extra.contentLength) }] : []),
        ...(extra.contentRange ? [{ name: 'Content-Range', value: extra.contentRange }] : [])] });
      for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate);
    },
  };
}

function loadDetector(pageUrl = 'https://cinema.example/watch', { navigator } = {}) {
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
    history: { pushState() {}, replaceState() {} }, ...(navigator ? { navigator } : {}) });
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
    // A binary response the page's player already received (an fMP4 init segment).
    async fetchBytes(url, contentType, bytes) {
      fetchResponses.push({ ok: true, url, headers: new Headers({ 'content-type': contentType, 'content-length': String(bytes.byteLength) }),
        clone: () => ({ arrayBuffer: async () => bytes.buffer.slice(0), body: null }) });
      await window.fetch(url);
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

// DRM: detection only. Protected media is one explanatory row, never a download.
const DRM_FIXTURES = path.join(__dirname, 'fixtures/drm');
const WIDEVINE_MPD = fs.readFileSync(path.join(DRM_FIXTURES, 'widevine.mpd'), 'utf8');
const SAMPLE_AES = fs.readFileSync(path.join(DRM_FIXTURES, 'sample-aes-widevine.m3u8'), 'utf8');
const AES_128 = fs.readFileSync(path.join(DRM_FIXTURES, 'aes-128.m3u8'), 'utf8');
const hls = require('../packages/contracts/src/hls');
const PROTECTED_CONTEXT = { sourcePageUrl: 'https://cinema.example/watch', sourcePageTitle: 'Bad Optics • Stream Service',
  protection: { keySystem: 'widevine', signal: 'mediakeys', siteName: 'Stream Service', mediaSourceUrl: 'blob:', durationSeconds: 3206.4 } };

test('manifest DRM signals: DASH ContentProtection and HLS SAMPLE-AES are DRM; AES-128 is not', () => {
  const dash = hls.parseDashManifest(WIDEVINE_MPD, 'https://cinema.example/manifest.mpd');
  assert.equal(dash.isDrm, true);
  assert.deepEqual(dash.keySystems, ['widevine', 'playready']);
  assert.equal(dash.durationSeconds, 3206.4);
  assert.equal(hls.matchesSegmentTemplate('https://media.stream.example/v1/title-123/video/v640/00012.mp4?sig=1', dash.segmentTemplates), true);
  assert.equal(hls.matchesSegmentTemplate('https://media.stream.example/v1/title-123/audio/aen/init.mp4', dash.segmentTemplates), true);
  assert.equal(hls.matchesSegmentTemplate('https://media.stream.example/v1/trailer.mp4', dash.segmentTemplates), false);
  const clear = hls.parseDashManifest(WIDEVINE_MPD.replace(/<ContentProtection[^>]*\/>|<ContentProtection[\s\S]*?<\/ContentProtection>/g, ''), 'https://cinema.example/clear.mpd');
  assert.equal(clear.isDrm, false);
  assert.equal(detection.mediaType('https://cinema.example/api/manifest', 'text/plain', WIDEVINE_MPD), 'dash', 'an MPD body is recognised without a .mpd name');

  const sample = hls.parseHlsManifest(SAMPLE_AES, 'https://cinema.example/drm/index.m3u8');
  assert.equal(sample.isDrm, true);
  assert.deepEqual(sample.keySystems, ['widevine', 'fairplay']);
  const aes = hls.parseHlsManifest(AES_128, 'https://cinema.example/aes/index.m3u8');
  assert.equal(aes.isDrm, false, 'plain AES-128 HLS is an ordinary key file, not DRM');
  assert.deepEqual(aes.keySystems, []);
});

test('a Widevine DASH page lists one protected row; its pieces never become rows and nothing can be downloaded', async () => {
  const worker = loadWorker();
  const mpdUrl = 'https://cinema.example/api/playback/manifest.mpd';
  const mpd = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: mpdUrl, contentType: 'application/dash+xml', manifestText: WIDEVINE_MPD, delivery: 'script' } });
  assert.equal(mpd.item.manifest.isDrm, true);
  // The player fetches init segments and 15 numbered fragments (video and audio).
  const base = 'https://media.stream.example/v1/title-123/';
  await worker.response(`${base}video/v640/init.mp4`, 'video/mp4', { contentLength: 900 });
  for (let index = 1; index <= 15; index++) await worker.response(`${base}video/v640/${String(index).padStart(5, '0')}.mp4`, 'video/mp4', { contentLength: 400000 });
  await worker.response(`${base}audio/aen/00001.mp4`, 'audio/mp4', { contentLength: 30000 });
  // EME is attached to the page's player.
  await worker.fromPage({ cmd: 'PAGE_CONTEXT', context: PROTECTED_CONTEXT });
  // A trailer from an unprotected CDN on the same page.
  await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://trailers.example/bad-optics/index.m3u8', manifestText: PLAYLIST, delivery: 'script' } });

  const listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(listed.items.length, 2, 'one protected title plus the clear trailer');
  const locked = listed.items.find(item => item.drm);
  assert.equal(locked.type, 'protected');
  assert.equal(locked.keySystem, 'widevine');
  assert.equal(locked.drmSite, 'Stream Service');
  assert.equal(locked.durationSeconds, 3206.4);
  assert.equal(locked.sourcePageTitle, 'Bad Optics • Stream Service');
  assert.equal(detection.protectedSiteName(locked), 'Stream Service');
  const trailer = listed.items.find(item => !item.drm);
  assert.equal(trailer.url, 'https://trailers.example/bad-optics/index.m3u8');
  assert.equal(listed.rawItems.some(item => /\/(?:init|\d{5})\.mp4$/.test(item.url)), false, 'segments are folded into their manifest');

  for (const mediaId of [locked.id, mpd.item.id]) {
    const refused = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId, payload: { mediaUrl: mpdUrl, title: 'Bad Optics' } });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /DRM/);
  }
  assert.equal(worker.jobs.filter(job => job.path === '/v1/jobs').length, 0, 'nothing reached the desktop app');
  const clear = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: trailer.id, payload: { mediaUrl: trailer.url, mediaType: 'hls', title: 'Trailer' } });
  assert.equal(clear.ok, true, 'the unprotected trailer stays downloadable');

  // Hiding the protected row hides it for this visit.
  await worker.message({ cmd: 'HIDE_MEDIA', tabId: 7, mediaIds: [locked.id, ...locked.detectedStreams.map(stream => stream.id)] });
  assert.equal((await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 })).items.some(item => item.drm), false);
});

test('EME alone (no manifest seen) still yields one protected row in place of its fragments', async () => {
  const worker = loadWorker();
  for (let index = 1; index <= 15; index++) await worker.response(`https://cdn.stream.example/a/b/seg_${index}.mp4`, 'video/mp4', { contentLength: 250000 + index });
  await worker.response('https://cdn.stream.example/a/b/init.mp4', 'video/mp4', { contentLength: 1200 });
  await worker.fromPage({ cmd: 'PAGE_CONTEXT', context: PROTECTED_CONTEXT });
  const listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].id, 'protected:0');
  assert.equal(listed.items[0].drm, true);
  const refused = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: 'protected:0', payload: { mediaUrl: 'https://cinema.example/watch' } });
  assert.equal(refused.ok, false);
});

test('SAMPLE-AES Widevine HLS is one protected row; plain AES-128 HLS stays downloadable', async () => {
  const worker = loadWorker();
  const drm = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/drm/index.m3u8', manifestText: SAMPLE_AES, delivery: 'script' } });
  const aes = await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/aes/index.m3u8', manifestText: AES_128, delivery: 'script' } });
  const listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(listed.items.length, 2);
  const locked = listed.items.find(item => item.drm);
  assert.equal(locked.id, drm.item.id);
  assert.equal(locked.keySystem, 'widevine');
  assert.equal(detection.protectedSiteName(locked), 'cinema.example');
  assert.equal(listed.items.find(item => item.id === aes.item.id).drm, undefined);
  assert.equal((await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: drm.item.id, payload: { mediaUrl: drm.item.url, mediaType: 'hls' } })).ok, false);
  const saved = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: aes.item.id, payload: { mediaUrl: aes.item.url, mediaType: 'hls', title: 'AES' } });
  assert.equal(saved.ok, true);
  assert.equal(worker.jobs.filter(job => job.path === '/v1/jobs').at(-1).body.mediaUrl, aes.item.url);
});

test('fragment bursts and byte ranges are grouped away on any site; standalone short videos stay', async () => {
  const worker = loadWorker();
  // 15 numbered .m4s pieces plus their init segment, fetched by a player script.
  for (let index = 1; index <= 15; index++) await worker.response(`https://cdn.example/stream/720/chunk-${index}.m4s`, 'video/iso.segment', { contentLength: 800000 });
  await worker.response('https://cdn.example/stream/720/init.mp4', 'video/mp4', { contentLength: 1100 });
  // The same pattern as .mp4 fragments large enough to escape the size rule.
  for (let index = 1; index <= 15; index++) await worker.response(`https://cdn.example/stream/1080/${index}.mp4`, 'video/mp4', { contentLength: 1500000 + index });
  // Byte-range requests on one URL: the total size comes from Content-Range.
  await worker.response('https://cdn.example/on-demand/video-1080.mp4', 'video/mp4', { statusCode: 206, contentLength: 65536, contentRange: 'bytes 65536-131071/734003200' });
  let listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.deepEqual(listed.items, [], 'no fragment, init segment or range piece is a row');

  // A real short video the page plays directly keeps its Download.
  await worker.response('https://cdn.example/clips/intro-2s.mp4', 'video/mp4', { type: 'media', contentLength: 512 });
  await worker.fromPage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://cdn.example/clips/intro-2s.mp4', contentType: 'video/mp4', delivery: 'element', mediaSourceUrl: 'https://cdn.example/clips/intro-2s.mp4', durationSeconds: 2 } });
  listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.deepEqual(listed.items.map(item => item.url), ['https://cdn.example/clips/intro-2s.mp4']);
  assert.equal(listed.items[0].drm, undefined);
  const saved = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: listed.items[0].id, payload: { mediaUrl: listed.items[0].url, title: 'Intro' } });
  assert.equal(saved.ok, true);

  // Show all still lists every recorded piece, with the range file's real size.
  await worker.message({ cmd: 'SHOW_ALL_MEDIA', tabId: 7 });
  listed = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(listed.rawItems.find(item => item.url.endsWith('video-1080.mp4')).contentLength, 734003200);
  assert.equal(listed.rawItems.length, 18);

  // Unit rules: numbered siblings need a burst; one numbered file is not a fragment.
  const one = { id: 'x', url: 'https://cdn.example/video/episode-12.mp4', mediaKind: 'video', delivery: 'script', contentLength: 250000000, durationSeconds: 1500 };
  assert.equal(detection.isStreamFragment(one, [one]), false);
  assert.equal(detection.isStreamFragment({ ...one, delivery: 'element', url: 'https://cdn.example/init.mp4' }), false, 'a <video src> is never a fragment');
  assert.equal(detection.isStreamFragment({ ...one, contentLength: 400000 }, [one]), true, '<1 MB for 25 minutes is a piece, not the film');
});

test('the page detector reads MPD bodies, observes EME key systems and encrypted init segments without altering them', async () => {
  const requested = [];
  const access = { keySystem: 'com.widevine.alpha' };
  const navigator = { requestMediaKeySystemAccess(keySystem) { requested.push([this, keySystem]); return Promise.resolve(access); } };
  const detector = loadDetector('https://cinema.example/watch', { navigator });
  await detector.fetch('https://cinema.example/api/playback', undefined, { url: 'https://cinema.example/api/playback', contentType: 'application/xml', body: WIDEVINE_MPD });
  const dash = detector.observations.filter(message => message.media?.manifestText);
  assert.equal(dash.length, 1);
  assert.equal(dash[0].media.type, 'dash');

  const result = navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{}]);
  assert.equal(await result, access, 'the page receives its own MediaKeySystemAccess');
  assert.equal(requested[0][0], navigator, 'the original is called on navigator');
  await new Promise(setImmediate);
  assert.deepEqual(detector.observations.at(-1).protection, { signal: 'access', keySystem: 'com.widevine.alpha' });

  const init = new Uint8Array(64);
  init.set([0, 0, 0, 40, 0x70, 0x73, 0x73, 0x68, 0, 0, 0, 0, 0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed], 0);
  await detector.fetchBytes('https://cdn.example/v/init.mp4', 'video/mp4', init);
  assert.deepEqual(detector.observations.at(-1).protection, { signal: 'init', keySystem: 'edef8ba979d64acea3c827dcd51d21ed' });
  const clearInit = new Uint8Array(64); clearInit.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0);
  const before = detector.observations.length;
  await detector.fetchBytes('https://cdn.example/clear/init.mp4', 'video/mp4', clearInit);
  assert.equal(detector.observations.slice(before).some(message => message.protection), false);
});
