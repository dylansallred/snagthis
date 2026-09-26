const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const extension = path.join(__dirname, '../apps/extension');
const clone = value => structuredClone(value);

function storage(initial = {}, quotaBytes = Infinity) {
  const values = clone(initial);
  return {
    setAccessLevel: async () => {},
    get: async keys => clone(keys == null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]))),
    set: async entries => {
      // Chrome estimates in-memory storage size. Serialized UTF-8 is a useful
      // lower bound here: the old 1 MiB quota cannot hold this signed playlist.
      if (Buffer.byteLength(JSON.stringify({ ...values, ...entries })) > quotaBytes) throw new Error('Session storage quota exceeded');
      Object.assign(values, clone(entries));
    },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}

function loadWorker(initialTab) {
  const listeners = {};
  const event = name => ({ addListener: listener => { listeners[name] = listener; } });
  let tab = clone(initialTab);
  let now = 1000;
  const downloads = [];
  const minimumChrome = Number(require('../apps/extension/manifest.json').minimum_chrome_version);
  const sessionQuota = (minimumChrome <= 111 ? 1 : 10) * 1024 * 1024;
  const chrome = {
    storage: { session: storage({}, sessionQuota), local: storage({ appToken: 'fixture-token' }) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { id: 'a'.repeat(32), getURL: value => `chrome-extension://${'a'.repeat(32)}/${value}`,
      getManifest: () => ({ version: '1.0.0' }), onMessage: event('message'), onInstalled: event('installed') },
    tabs: { get: async () => clone(tab), onRemoved: event('removed') },
    webNavigation: { getFrame: async () => ({ url: tab.url, documentId: tab.documentId }),
      onCommitted: event('committed'), onHistoryStateUpdated: event('history') },
    webRequest: { onBeforeSendHeaders: event('beforeHeaders'), onHeadersReceived: event('headers'),
      onCompleted: event('completed'), onErrorOccurred: event('error') },
  };
  const context = vm.createContext({ chrome, URL, AbortSignal, crypto: { randomUUID },
    Date: class extends Date { static now() { return now; } },
    fetch: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:39999/v1/jobs');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      downloads.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, jobId: 'fixture-small-video' }) };
    },
  });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(extension, 'service-worker.js'), 'utf8'), context, { filename: 'service-worker.js' });
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  return {
    downloads,
    setTab(value, timestamp) { tab = clone(value); now = timestamp; },
    message(message, sender = popup) { return new Promise(resolve => listeners.message(message, sender, value => resolve(clone(value)))); },
    async emit(name, details) {
      await listeners[name](details);
      // Chrome event listeners may schedule storage writes without returning
      // their promise; one event-loop turn drains this fixture's microtasks.
      await new Promise(setImmediate);
    },
  };
}

function loadDetector(pageUrl) {
  const location = { href: pageUrl };
  const observations = [];
  const fetchResponses = [];
  class Xhr {
    constructor() { this.listeners = new Map(); this.responseType = ''; this.status = 0; }
    open(_method, url) { this.responseURL = String(url); this.status = 0; }
    setRequestHeader() {}
    send() {}
    addEventListener(name, listener, options = {}) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push({ listener, once: options.once });
    }
    removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter(entry => entry.listener !== listener)); }
    async dispatch(name) {
      for (const entry of [...(this.listeners.get(name) || [])]) {
        if (entry.once) this.removeEventListener(name, entry.listener);
        await entry.listener.call(this);
      }
    }
    async abort() { this.status = 0; await this.dispatch('abort'); await this.dispatch('loadend'); }
    getResponseHeader(name) { return name.toLowerCase() === 'content-type' ? this.mime : name.toLowerCase() === 'content-length' ? String(this.response.byteLength ?? this.response.size) : null; }
    get responseText() { throw new Error('Binary XHR does not expose responseText'); }
    async complete(text, mime) {
      this.response = new TextEncoder().encode(text).buffer;
      this.mime = mime; this.status = 200;
      const original = this.response;
      await this.dispatch('load');
      await this.dispatch('loadend');
      assert.equal(this.response, original, 'observation must leave the page response untouched');
      return original;
    }
  }
  const window = { postMessage: message => observations.push(clone(message)), fetch: async () => {
    assert.ok(fetchResponses.length, 'detection must not create a request');
    return fetchResponses.shift();
  } };
  const context = vm.createContext({ window, location, document: { get baseURI() { return location.href; } },
    XMLHttpRequest: Xhr, URL, Headers, TextDecoder, TextEncoder, ArrayBuffer, Uint8Array, Blob,
    history: { pushState() {}, replaceState() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(extension, 'js/media-detector.js'), 'utf8'), context, { filename: 'media-detector.js' });
  return {
    location, observations,
    request(url) { const xhr = new Xhr(); xhr.open('GET', url); xhr.responseType = 'arraybuffer'; xhr.send(); return xhr; },
    async fetchPlaylist(url, chunks) {
      let index = 0;
      fetchResponses.push({ ok: true, url, headers: new Headers({ 'content-type': 'application/vnd.apple.mpegurl' }),
        clone: () => ({ body: { getReader: () => ({
          read: async () => index < chunks.length ? { value: new TextEncoder().encode(chunks[index++]), done: false } : { done: true },
          cancel: async () => {},
        }) } }),
      });
      await window.fetch(url);
      await new Promise(setImmediate);
    },
  };
}

test('prepared page posters are source scoped, available in the first popup snapshot, and cleared on navigation', async () => {
  const tab = { id: 7, url: 'https://cinema.example/one', title: 'One', documentId: 'document-one' };
  const worker = loadWorker(tab);
  const sender = { id: 'a'.repeat(32), tab, frameId: 0, documentId: tab.documentId, url: tab.url };
  const movieUrl = 'https://media.example/movie.mp4';
  const trailerUrl = 'https://media.example/trailer.mp4';
  const poster = 'data:image/jpeg;base64,cHJlcGFyZWQ=';
  await worker.emit('committed', { tabId: 7, frameId: 0, url: tab.url, documentId: tab.documentId, timeStamp: 1000 });
  const movie = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: movieUrl, contentType: 'video/mp4' } }, sender);
  await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: trailerUrl, contentType: 'video/mp4' } }, sender);
  await worker.message({ cmd: 'PAGE_CONTEXT', context: { mediaSourceUrl: trailerUrl, durationSeconds: 20,
    sourcePreviewPoster: poster, sourcePreviewSceneStart: 1, sourcePreviewSceneScope: 'source' } }, sender);
  await worker.message({ cmd: 'PAGE_CONTEXT', context: { mediaSourceUrl: movieUrl, durationSeconds: 100,
    sourcePreviewPoster: poster, sourcePreviewSceneStart: 35, sourcePreviewSceneScope: 'source' } }, sender);
  const firstPopupSnapshot = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  const prepared = firstPopupSnapshot.items.find(item => item.url === movieUrl);
  assert.equal(prepared.sourcePreviewPoster, poster);
  assert.equal(prepared.sourcePreviewSceneStart, 35);
  assert.equal(prepared.sourcePreviewSceneScope, 'source');
  assert.equal(firstPopupSnapshot.items.find(item => item.url === trailerUrl).sourcePreviewPoster, undefined, 'an opening frame is rejected and the movie frame never decorates the trailer');
  await worker.message({ cmd: 'STORE_MEDIA_PREVIEW_POSTER', tabId: 7, mediaId: movie.item.id, mediaUrl: movieUrl,
    visit: firstPopupSnapshot.visit, poster, sceneStart: 2, sceneScope: 'prefix' });
  const prefix = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(prefix.items.find(item => item.url === movieUrl).sourcePreviewSceneScope, 'prefix', 'a bounded source-prefix frame must not become a full-source scene hint');

  const nextTab = { ...tab, url: 'https://cinema.example/two', documentId: 'document-two' };
  worker.setTab(nextTab, 2000);
  await worker.emit('committed', { tabId: 7, frameId: 0, url: nextTab.url, documentId: nextTab.documentId, timeStamp: 2000 });
  await worker.message({ cmd: 'PAGE_CONTEXT', context: { mediaSourceUrl: movieUrl, durationSeconds: 100,
    sourcePreviewPoster: poster, sourcePreviewSceneStart: 35 } }, sender);
  const next = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(next.items.length, 0);
  assert.notEqual(next.visit, firstPopupSnapshot.visit);
});

test('first navigation keeps large HLS metadata and child artwork, excludes components, and ignores stale page responses', async () => {
  const pageA = 'https://cinema.example/movie/first';
  const pageB = 'https://cinema.example/movie/thor';
  const tabA = { id: 7, url: pageA, title: 'First movie', documentId: 'document-a' };
  const tabB = { id: 7, url: pageB, title: 'Thor', documentId: 'document-b' };
  const masterUrl = 'https://media.example/thor/master.m3u8';
  const childUrl = 'https://media.example/thor/1080/index.jpg';
  const initUrl = 'https://media.example/thor/1080/0.mp4';
  const token = 'a'.repeat(640);
  const segmentUrl = `https://media.example/thor/1080/pieces/0.mp4?token=${token}`;
  const oldUrl = 'https://media.example/first/old.mp4';
  const smallUrl = 'https://media.example/independent-short.mp4';
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080\n1080/index.jpg\n';
  const duration = 8221.004;
  const child = '#EXTM3U\n#EXT-X-TARGETDURATION:12\n#EXT-X-MAP:URI="0.mp4"\n'
    + Array.from({ length: 1643 }, (_, index) => `#EXTINF:${index === 1642 ? 11.004 : 5},\npieces/${index}.mp4?token=${token}\n`).join('')
    + '#EXT-X-ENDLIST\n';
  assert.ok(Buffer.byteLength(child) > 1024 * 1024, 'a long signed-URL playlist exceeds the old inspection limit');
  const worker = loadWorker(tabA);
  const detector = loadDetector(pageA);
  const senderB = { id: 'a'.repeat(32), tab: tabB, frameId: 0, documentId: 'document-b', url: pageB };
  const request = (id, url, documentId) => ({ requestId: id, url, tabId: 7, frameId: 0, documentId, type: 'xmlhttprequest', requestHeaders: [] });
  const headers = (details, contentType, size = 512) => ({ ...details, statusCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: contentType }, { name: 'Content-Length', value: String(size) }] });
  await worker.emit('committed', { tabId: 7, frameId: 0, url: pageA, documentId: 'document-a', timeStamp: 1000 });
  worker.setTab(tabA, 1100);
  const oldRequest = request('old-request', oldUrl, 'document-a');
  await worker.emit('beforeHeaders', oldRequest);
  const lateXhr = detector.request('https://media.example/first/master.m3u8');

  worker.setTab(tabB, 2000);
  detector.location.href = pageB;
  const committedB = { tabId: 7, frameId: 0, url: pageB, documentId: 'document-b', timeStamp: 2000 };
  // Content may beat Chrome's commit callback. Chrome's current frame identity
  // must admit this new document without admitting the old document's response.
  const early = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: masterUrl,
    contentType: 'application/vnd.apple.mpegurl', sourcePageUrl: pageB, sourcePageTitle: 'Cinejoy' } }, senderB);
  assert.equal(early.ok, true);
  worker.setTab(tabB, 2100);
  for (const [id, url, contentType] of [['master', masterUrl, 'application/vnd.apple.mpegurl'],
    ['child', childUrl, 'application/vnd.apple.mpegurl'], ['init', initUrl, 'video/mp4'], ['segment', segmentUrl, 'video/mp4']]) {
    const details = request(id, url, 'document-b');
    await worker.emit('beforeHeaders', details);
    await worker.emit('headers', headers(details, contentType));
  }
  const initial = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(initial.rawItems.length, 4);
  assert.ok(initial.rawItems.every(item => !item.manifest), 'the first response headers have no playlist body yet');
  const firstVisit = initial.visit;

  await detector.request(masterUrl).complete(master, 'application/vnd.apple.mpegurl');
  await detector.request(childUrl).complete(child, 'image/jpeg');
  const bodies = detector.observations.filter(message => message.media?.manifestText);
  assert.equal(bodies.length, 2, 'both ArrayBuffer manifests must reach the isolated-world bridge');
  assert.deepEqual(bodies.map(message => message.media.manifestText), [master, child]);
  for (const message of bodies) {
    const result = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { ...message.media,
      sourcePageUrl: pageB, sourcePageTitle: 'Thor' } }, senderB);
    assert.equal(result.ok, true);
  }
  await worker.message({ cmd: 'PAGE_CONTEXT', context: { mediaSourceUrl: 'blob:', sourcePageUrl: pageB,
    sourcePageTitle: 'Thor', durationSeconds: duration, height: 1080, thumbnailUrl: 'https://cinema.example/thor.jpg' } }, senderB);
  // A duplicate commit must not erase observations already attached to this document.
  await worker.emit('committed', committedB);
  await worker.emit('headers', headers(oldRequest, 'video/mp4'));
  await worker.message({ cmd: 'PAGE_NAVIGATED', pageUrl: pageA }, { ...senderB, tab: tabA, documentId: 'document-a', url: pageA });
  const beforeLateBody = detector.observations.length;
  await lateXhr.complete(master, 'application/vnd.apple.mpegurl');
  assert.equal(detector.observations.length, beforeLateBody, 'an old page response must not be relabelled as the new movie');
  const discovered = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(discovered.visit, firstVisit);
  assert.equal(discovered.items.length, 1);
  const movie = discovered.items[0];
  assert.equal(movie.url, masterUrl);
  assert.equal(movie.sourcePageTitle, 'Thor');
  assert.equal(movie.durationSeconds, duration);
  assert.equal(movie.height, 1080);
  assert.equal(movie.thumbnailUrl, 'https://cinema.example/thor.jpg');
  assert.deepEqual(movie.variants.map(variant => ({ url: variant.url, height: variant.height })), [{ url: childUrl, height: 1080 }]);
  assert.equal(movie.variants[0].sizeBytes, Math.round(4000000 * duration / 8));
  assert.equal(movie.variants[0].sizeEstimated, true);
  assert.ok(discovered.rawItems.every(item => item.url !== initUrl && item.url !== segmentUrl && item.url !== oldUrl));
  assert.equal(discovered.rawItems.find(item => item.url === masterUrl).thumbnailUrl, undefined, 'the blob frame belongs to the media child, not arbitrary page requests');

  const { parseHlsManifest, collapseDetections } = require('../packages/contracts');
  const wrapperUrl = 'https://media.example/thor/wrapper.m3u8';
  const wrapper = { id: 'wrapper', url: wrapperUrl, manifest: parseHlsManifest('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nmaster.m3u8\n', wrapperUrl) };
  const audioUrl = 'https://media.example/thor/audio.m3u8';
  wrapper.manifest.referencedUrls.push(audioUrl);
  const audio = { id: 'audio', url: audioUrl, thumbnailUrl: 'https://cinema.example/unrelated.jpg', height: 9999,
    manifest: parseHlsManifest('#EXTM3U\n#EXTINF:1,\naudio.aac\n#EXT-X-ENDLIST\n', audioUrl) };
  const nested = collapseDetections([wrapper, audio, ...discovered.rawItems])[0];
  assert.equal(nested.durationSeconds, duration);
  assert.equal(nested.height, 1080);
  assert.equal(nested.thumbnailUrl, 'https://cinema.example/thor.jpg', 'nested video references provide artwork, never referenced audio');

  // A separate short video remains a real Download action: only exact playlist
  // component references justify hiding the tiny initialization MP4 above.
  await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: smallUrl, contentType: 'video/mp4',
    contentLength: 512, sourcePageUrl: pageB, sourcePageTitle: 'Independent short', durationSeconds: 2 } }, senderB);
  const withShort = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(withShort.items.length, 2);
  const short = withShort.items.find(item => item.url === smallUrl);
  assert.ok(short);
  const download = await worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: 7, mediaId: short.id,
    apiBase: 'http://127.0.0.1:39999', payload: { mediaUrl: smallUrl, title: 'Independent short' } });
  assert.equal(download.ok, true);
  assert.deepEqual(worker.downloads, [{ mediaUrl: smallUrl, title: 'Independent short' }]);
  const oversized = detector.request('https://media.example/too-large.m3u8');
  const limit = 5 * 1024 * 1024;
  await oversized.complete('#EXTM3U\n' + 'x'.repeat(limit), 'application/vnd.apple.mpegurl');
  assert.ok(!detector.observations.at(-1)?.media?.manifestText, 'binary manifest inspection remains bounded');
  const exactLimit = '#EXTM3U\n#' + 'x'.repeat(limit - 10) + '\n';
  await detector.fetchPlaylist('https://media.example/exact-limit.m3u8', [exactLimit]);
  assert.equal(detector.observations.at(-1).media.manifestText.length, limit, 'an exact-limit complete playlist is accepted');
  await detector.fetchPlaylist('https://media.example/longer-than-limit.m3u8', [exactLimit, '#EXTINF:1,\nlate.ts\n#EXT-X-ENDLIST\n']);
  assert.ok(!detector.observations.at(-1).media.manifestText, 'a prefix at the exact limit must never become a truncated playlist');
});

test('aborted and reused XHRs emit one detection and keep async response identity', async t => {
  const detector = loadDetector('https://cinema.example/watch');
  const xhr = detector.request('https://media.example/aborted-0.m3u8');
  for (let index = 0; index < 5; index++) {
    if (index) { xhr.open('GET', `https://media.example/aborted-${index}.m3u8`); xhr.send(); }
    await xhr.abort();
    assert.equal([...xhr.listeners.values()].flat().length, 0, 'abort removes every observation handler');
  }
  xhr.open('GET', 'https://media.example/current.m3u8'); xhr.send();
  const manifest = '#EXTM3U\n#EXTINF:10,\npart.ts\n#EXT-X-ENDLIST\n';
  await xhr.complete(manifest, 'application/vnd.apple.mpegurl');
  assert.equal(detector.observations.length, 1, 'five aborted reuses followed by one success produce only one detection');
  t.diagnostic(JSON.stringify({ abortedReuses: 5, successfulRequests: 1, detections: detector.observations.length }));
  assert.equal(detector.observations[0].media.url, 'https://media.example/current.m3u8');
  assert.equal([...xhr.listeners.values()].flat().length, 0);
  for (const terminal of ['error', 'timeout', 'loadend']) {
    xhr.open('GET', 'https://media.example/failed.m3u8'); xhr.send();
    await xhr.dispatch(terminal);
    assert.equal([...xhr.listeners.values()].flat().length, 0, `${terminal} removes every observation handler`);
  }

  xhr.open('GET', 'https://media.example/original.m3u8'); xhr.send();
  xhr.responseType = 'blob'; xhr.status = 200; xhr.mime = 'application/vnd.apple.mpegurl';
  let finishBlob;
  xhr.response = { size: manifest.length, text: () => new Promise(resolve => { finishBlob = resolve; }) };
  const pending = xhr.dispatch('load');
  xhr.open('GET', 'https://media.example/reused.m3u8'); xhr.responseType = 'arraybuffer'; xhr.send();
  finishBlob(manifest);
  await pending;
  assert.equal(detector.observations.at(-1).media.url, 'https://media.example/original.m3u8', 'an async Blob read keeps its completed response URL');
  assert.equal(detector.observations.at(-1).media.manifestText, manifest);
  await xhr.complete(manifest, 'application/vnd.apple.mpegurl');
  assert.equal(detector.observations.at(-1).media.url, 'https://media.example/reused.m3u8');
  assert.equal(detector.observations.length, 3);
});

test('in-page anchors keep detections, hash routes reset them, and redirect hops are not media', async () => {
  const tab = { id: 7, url: 'https://cinema.example/watch', title: 'Watch', documentId: 'document-one' };
  const worker = loadWorker(tab);
  const sender = () => ({ id: 'a'.repeat(32), tab: clone(tab), frameId: 0, documentId: tab.documentId, url: 'https://cinema.example/watch' });
  const movieUrl = 'https://media.example/movie.mp4';
  await worker.emit('committed', { tabId: 7, frameId: 0, url: tab.url, documentId: tab.documentId, timeStamp: 1000 });
  await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: movieUrl, contentType: 'video/mp4' } }, sender());
  const first = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(first.items.length, 1);

  for (const url of ['https://cinema.example/watch#comments', 'https://cinema.example/watch#t=90']) {
    tab.url = url;
    worker.setTab(tab, 2000);
    await worker.message({ cmd: 'PAGE_NAVIGATED', pageUrl: url }, sender());
    await worker.emit('history', { tabId: 7, frameId: 0, url, documentId: tab.documentId, timeStamp: 2000 });
    const same = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
    assert.deepEqual(same.items.map(item => item.url), [movieUrl], `${url} is the same video page`);
    assert.equal(same.visit, first.visit);
  }
  // Observations from the anchored page still attach to it.
  await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://media.example/extra.mp4', contentType: 'video/mp4',
    sourcePageUrl: tab.url } }, sender());
  assert.equal((await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 })).items.length, 2);

  // A redirect response names the old URL but describes the redirect.
  const redirect = { requestId: 'redirect', url: 'https://media.example/redirected.mp4', tabId: 7, frameId: 0,
    documentId: tab.documentId, type: 'media', statusCode: 302,
    responseHeaders: [{ name: 'Content-Type', value: 'text/html' }, { name: 'Content-Length', value: '154' }] };
  await worker.emit('headers', redirect);
  assert.ok((await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 })).rawItems.every(item => item.url !== redirect.url));

  const route = 'https://cinema.example/watch#/episode/2';
  tab.url = route;
  worker.setTab(tab, 3000);
  await worker.message({ cmd: 'PAGE_NAVIGATED', pageUrl: route }, sender());
  const next = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: 7 });
  assert.equal(next.items.length, 0, 'a hash route is a different video page');
  assert.notEqual(next.visit, first.visit);
});
