const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener, options = {}) {
      if (options.signal?.aborted) return;
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      options.signal?.addEventListener('abort', () => listeners.get(name)?.delete(listener), { once: true });
    },
    dispatch(name, event = {}) { for (const listener of [...(listeners.get(name) || [])]) listener(event); },
  };
}

function element(tag, parentElement = null) {
  return {
    nodeType: 1, tagName: tag.toUpperCase(), parentElement,
    matches(selector) { return selector.split(',').includes(tag); },
    closest(selector) { return this.matches(selector) ? this : parentElement?.closest(selector); },
    querySelector() { return null; },
  };
}

function loadContent({ pageUrl = 'https://example.test/watch', poster = '', pageImage = '', pageMeta = {}, title = 'A real video', frame = null, hasVideo = true, atTime = 12, reply, resources = null } = {}) {
  const location = { href: pageUrl };
  const window = target();
  let frameReads = 0;
  let playbackTime = atTime;
  const video = Object.assign(target(), element('video'), {
    currentSrc: 'https://media.example.test/movie.mp4', readyState: frame ? 2 : 0, videoWidth: 1280, videoHeight: 720, duration: 20, poster,
    play: () => { throw new Error('The page video must not be played by detection'); },
    pause: () => { throw new Error('The page video must not be paused by detection'); },
    getAttribute: () => '', querySelector: () => null, querySelectorAll: () => [],
  });
  const videos = hasVideo ? [video] : [];
  Object.defineProperty(video, 'currentTime', { get: () => playbackTime, set: () => { throw new Error('Detection must not seek the page video'); } });
  const document = Object.assign(target(), {
    title, baseURI: location.href, documentElement: element('html'),
    querySelector: selector => {
      const value = selector === 'meta[property="og:image"]' ? pageImage || pageMeta[selector] : pageMeta[selector];
      return value ? { getAttribute: () => value } : null;
    },
    querySelectorAll: selector => selector === 'video' ? videos : [],
    createElement: () => ({
      getContext: () => ({
        drawImage: () => {},
        getImageData: () => {
          frameReads += 1;
          if (frame === 'tainted') throw new Error('The canvas is tainted');
          return { data: frame };
        },
      }),
      toDataURL: () => 'data:image/jpeg;base64,dmlkZW8tZnJhbWU=',
    }),
  });
  const sent = [];
  const runtimeListeners = new Set();
  const timers = new Map();
  let now = 0;
  let timerId = 0;
  let failure;
  let reject = false;
  let observer;
  let resourceObserver;
  const chrome = { runtime: {
    sendMessage(message) {
      sent.push(message);
      if (failure) { if (reject) return Promise.reject(failure); throw failure; }
      return reply ? reply(message) : Promise.resolve({ ok: true });
    },
    onMessage: { addListener: listener => runtimeListeners.add(listener), removeListener: listener => runtimeListeners.delete(listener) },
  } };
  const context = {
    window, document, location, chrome, URL, AbortController, Promise,
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, due: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    ...(resources ? {
      performance: { getEntriesByType: type => (type === 'resource' ? resources : []) },
      PerformanceObserver: class {
        constructor(callback) { this.callback = callback; resourceObserver = this; }
        observe() {}
        disconnect() { this.disconnected = true; }
      },
    } : {}),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/extension/js/content.js'), 'utf8'), context);
  return { sent, timers, runtimeListeners, window, video, videos, location, observer, get frameReads() { return frameReads; },
    setPlaybackTime(value) { playbackTime = value; },
    resourceTimings(entries) { resourceObserver.callback({ getEntries: () => entries }); },
    get resourceObserver() { return resourceObserver; },
    mutate(mutation = { type: 'attributes', target: video }) { observer.callback([mutation]); },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > until) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback();
      }
      now = until;
    },
    fail(error, asynchronously = false) { failure = error; reject = asynchronously; },
    emitMedia() { window.dispatch('message', { source: window, data: { source: 'snagthis:media', media: { url: video.currentSrc } } }); },
  };
}

test('content messaging works normally and retires all page work after synchronous context invalidation', () => {
  const page = loadContent();
  assert.deepEqual(page.sent.map(message => message.cmd), ['PAGE_CONTEXT', 'STORE_DETECTED_MEDIA']);
  page.emitMedia();
  assert.equal(page.sent.at(-1).media.url, page.video.currentSrc);
  // Any page script can post on this channel; only a detection hint crosses it.
  page.window.dispatch('message', { source: page.window, data: { source: 'snagthis:media', media: { url: 'http://intranet.example/a.mp4',
    contentType: 'video/mp4', requestHeaders: { origin: 'https://bank.example', referer: 'https://bank.example/' }, mediaKind: 'youtube-page', networkObserved: true } } });
  const hint = page.sent.at(-1).media;
  assert.equal(hint.url, 'http://intranet.example/a.mp4');
  for (const field of ['requestHeaders', 'mediaKind', 'networkObserved']) assert.equal(Object.hasOwn(hint, field), false, `${field} is never forwarded from the page`);
  assert.equal(page.observer.disconnected, false);
  page.mutate();
  assert.equal(page.timers.size, 1);

  const runtimeCallback = [...page.runtimeListeners][0];
  page.fail(new Error('Extension context invalidated.'));
  assert.doesNotThrow(() => page.emitMedia());
  assert.equal(page.observer.disconnected, true);
  assert.equal(page.timers.size, 0);
  assert.equal(page.runtimeListeners.size, 0);
  const attempts = page.sent.length;
  page.location.href = 'https://example.test/next';
  page.window.dispatch('popstate');
  page.window.dispatch('hashchange');
  page.video.dispatch('playing');
  page.video.dispatch('loadedmetadata');
  page.emitMedia();
  page.mutate();
  runtimeCallback({ cmd: 'SCAN_PAGE' });
  assert.equal(page.sent.length, attempts, 'retired callbacks must never contact the unloaded extension again');
  assert.equal(page.timers.size, 0);
});

test('representative page frames are ready before popup discovery without opening-frame grabs or repeated work', t => {
  const frame = Uint8ClampedArray.from({ length: 208 * 116 * 4 }, (_, index) => index % 4 === 3 ? 255 : Math.floor(index / 4) % 2 ? 190 : 60);
  const page = loadContent({ frame, atTime: 0 });
  assert.equal(page.frameReads, 0, 'opening frames are not captured as representative posters');
  assert.equal(page.sent.find(message => message.cmd === 'PAGE_CONTEXT').context.sourcePreviewPoster, undefined);
  page.setPlaybackTime(6);
  page.video.dispatch('timeupdate');
  assert.equal(page.frameReads, 0, 'the video has not reached the representative scene range');
  const messagesBeforeReady = page.sent.length;
  page.setPlaybackTime(7);
  page.video.dispatch('timeupdate');
  const prepared = page.sent.at(-1);
  assert.equal(prepared.cmd, 'PAGE_CONTEXT');
  assert.equal(prepared.context.mediaSourceUrl, page.video.currentSrc);
  assert.equal(prepared.context.sourcePreviewPoster, 'data:image/jpeg;base64,dmlkZW8tZnJhbWU=');
  assert.equal(prepared.context.sourcePreviewSceneStart, 7);
  assert.equal(prepared.context.sourcePreviewSceneScope, 'source');
  for (let index = 0; index < 20; index++) { page.setPlaybackTime(7 + index / 10); page.video.dispatch('timeupdate'); }
  assert.equal(page.frameReads, 1, 'read only one already-decoded frame for the current source');
  assert.equal(page.sent.length - messagesBeforeReady, 1, 'publish the prepared frame once, before any SCAN_PAGE request');
  t.diagnostic(JSON.stringify({ popupRequests: 0, preparedPosters: 1, decodedFrameReads: page.frameReads, readinessMessages: page.sent.length - messagesBeforeReady, repeatedTimeUpdates: 20 }));

  page.video.currentSrc = 'https://media.example.test/second.mp4';
  page.setPlaybackTime(7); page.video.dispatch('timeupdate');
  assert.equal(page.frameReads, 2, 'a new source gets its own readiness capture');
  assert.equal(page.sent.at(-1).context.mediaSourceUrl, page.video.currentSrc);
  page.fail(new Error('Extension context invalidated.'));
  page.emitMedia();
  const readsAtRetirement = page.frameReads;
  page.video.currentSrc = 'https://media.example.test/third.mp4';
  page.video.dispatch('timeupdate');
  assert.equal(page.frameReads, readsAtRetirement, 'retired contexts remove the readiness listener');
});

test('SCAN_PAGE acknowledges only after its detected metadata has been stored', async () => {
  let hold = false;
  const pending = [];
  const page = loadContent({ reply: () => hold ? new Promise(resolve => pending.push(resolve)) : Promise.resolve({ ok: true }) });
  await Promise.resolve();
  hold = true;
  let response;
  const keepChannel = [...page.runtimeListeners][0]({ cmd: 'SCAN_PAGE' }, {}, value => { response = value; });
  assert.equal(keepChannel, true);
  assert.equal(pending.length, 2);
  await Promise.resolve();
  assert.equal(response, undefined, 'a cached GET must not race the outstanding context and media writes');
  pending[0]({ ok: true });
  await Promise.resolve();
  assert.equal(response, undefined);
  pending[1]({ ok: true });
  await new Promise(setImmediate);
  assert.equal(response.ok, true);
});

test('a usable video frame beats its poster, generic page artwork is rejected, and YouTube artwork remains valid', () => {
  const pixels = (value) => Uint8ClampedArray.from({ length: 208 * 116 * 4 }, (_, index) => index % 4 === 3 ? 255 : value(Math.floor(index / 4)));
  const artwork = 'https://example.test/page-artwork.jpg';
  const poster = 'https://example.test/video-poster.jpg';
  const useful = pixels(index => index % 2 ? 190 : 60);
  const thumbnail = page => page.sent.find(message => message.cmd === 'PAGE_CONTEXT').context.thumbnailUrl;
  const page = loadContent({ frame: useful, poster, pageImage: artwork });
  assert.equal(thumbnail(page), 'data:image/jpeg;base64,dmlkZW8tZnJhbWU=');
  assert.equal(page.video.currentTime, 12);
  assert.ok(page.frameReads > 0);
  for (const frame of [pixels(() => 0), pixels(() => 128), 'tainted']) {
    assert.equal(thumbnail(loadContent({ frame, poster, pageImage: artwork })), poster);
  }
  assert.equal(thumbnail(loadContent({ frame: pixels(() => 0), pageImage: artwork })), '');
  // YouTube artwork is used only when the share tags describe this video.
  const id = 'abc123XYZ_-';
  const own = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
  const youtube = loadContent({ pageUrl: `https://www.youtube.com/watch?v=${id}`, frame: useful, poster,
    pageImage: own, pageMeta: { 'meta[property="og:url"]': `https://www.youtube.com/watch?v=${id}` } });
  assert.equal(thumbnail(youtube), own);
  assert.equal(youtube.frameReads, 0, 'this video’s YouTube artwork remains preferred without reading the video canvas');
});

test('stale YouTube share tags after in-page navigation never become this video’s artwork or title', () => {
  const id = 'v2yscspL_AQ';
  const context = page => page.sent.find(message => message.cmd === 'PAGE_CONTEXT').context;
  for (const pageMeta of [
    // YouTube's generic logo card, left from the home page.
    { 'meta[property="og:url"]': 'https://www.youtube.com/', 'meta[property="og:image"]': 'https://www.youtube.com/img/desktop/yt_1200.png', 'meta[property="og:title"]': 'YouTube' },
    // The previous video's tags.
    { 'meta[property="og:url"]': 'https://www.youtube.com/watch?v=previous123', 'meta[property="og:image"]': 'https://i.ytimg.com/vi/previous123/hqdefault.jpg', 'meta[property="og:title"]': 'The previous video' },
    // Current page, but YouTube's generic card instead of a thumbnail.
    { 'meta[property="og:url"]': `https://www.youtube.com/watch?v=${id}`, 'meta[property="og:image"]': 'https://www.youtube.com/img/desktop/yt_1200.png' },
  ]) {
    const page = loadContent({ pageUrl: `https://www.youtube.com/watch?v=${id}`, hasVideo: false, pageMeta,
      title: '(3) The CRAZIEST Reveal In Financial Audit History - YouTube' });
    assert.equal(context(page).thumbnailUrl, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    assert.equal(context(page).youtubeMetadata.thumbnailUrl, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    assert.equal(context(page).youtubeMetadata.title, pageMeta['meta[property="og:title"]'] && pageMeta['meta[property="og:url"]'].includes(id)
      ? pageMeta['meta[property="og:title"]'] : 'The CRAZIEST Reveal In Financial Audit History');
  }
});

test('unrelated mutations neither postpone video discovery nor repeat frame captures and messages', t => {
  const frame = Uint8ClampedArray.from({ length: 208 * 116 * 4 }, (_, index) => index % 4 === 3 ? 255 : Math.floor(index / 4) % 2 ? 190 : 60);
  const page = loadContent({ frame, hasVideo: false });
  page.sent.length = 0;
  page.videos.push(page.video);
  page.mutate({ type: 'childList', target: element('div'), addedNodes: [page.video], removedNodes: [] });
  const irrelevant = { type: 'characterData', target: { nodeType: 3, parentElement: element('span') } };
  page.advance(100);
  page.mutate(irrelevant);
  page.mutate(); // A relevant update must not restart the pending deadline either.
  page.advance(50);
  assert.equal(page.sent.filter(message => message.cmd === 'STORE_DETECTED_MEDIA').length, 1, 'new video is discovered at the original 150ms deadline');
  const messages = page.sent.length;
  const readbacks = page.frameReads;
  for (let index = 0; index < 20; index++) { page.mutate(irrelevant); page.advance(200); }
  assert.equal(page.sent.length - messages, 0, '20 unrelated updates send no additional runtime messages');
  assert.equal(page.frameReads - readbacks, 0, '20 unrelated updates perform no additional canvas readbacks');
  t.diagnostic(JSON.stringify({ unrelatedTextUpdates: 20, extraMessages: page.sent.length - messages, extraCanvasReadbacks: page.frameReads - readbacks, discoveryDeadlineMs: 150 }));

  for (const mutation of [
    { type: 'attributes', target: page.video, attributeName: 'poster' },
    { type: 'attributes', target: element('source', page.video), attributeName: 'src' },
    { type: 'childList', target: page.video, addedNodes: [element('source')], removedNodes: [] },
    { type: 'childList', target: page.video, addedNodes: [], removedNodes: [element('source')] },
    { type: 'characterData', target: { nodeType: 3, parentElement: element('title') } },
    { type: 'attributes', target: element('meta'), attributeName: 'content' },
  ]) {
    const before = page.sent.length;
    page.mutate(mutation); page.advance(150);
    assert.equal(page.sent.length, before + 2, `${mutation.type} still updates video metadata`);
  }
  const beforeExplicit = page.frameReads;
  page.mutate();
  [...page.runtimeListeners][0]({ cmd: 'SCAN_PAGE' });
  assert.equal(page.frameReads, beforeExplicit + 2, 'explicit refresh captures a fresh frame immediately');
  assert.equal(page.timers.size, 0, 'explicit refresh also satisfies the pending scan');
  page.location.href = 'https://example.test/next';
  page.window.dispatch('popstate');
  assert.equal(page.sent.at(-1).cmd, 'PAGE_NAVIGATED');
  page.advance(150);
  assert.equal(page.sent.at(-1).cmd, 'STORE_DETECTED_MEDIA');
});

test('asynchronous invalidation retires content, while an ordinary unavailable receiver does not', async () => {
  const page = loadContent();
  page.fail(new Error('Could not establish connection. Receiving end does not exist.'), true);
  page.emitMedia();
  await Promise.resolve();
  assert.equal(page.observer.disconnected, false);
  assert.equal(page.runtimeListeners.size, 1);
  page.fail(new Error('Extension context invalidated.'), true);
  page.emitMedia();
  await Promise.resolve();
  assert.equal(page.observer.disconnected, true);
  assert.equal(page.runtimeListeners.size, 0);
});

test('media answered by the frame Service Worker is reported once; ordinary responses are not', () => {
  const page = loadContent({ resources: [
    { name: 'https://storage.example.test/mediastorage/1/132201720.mp4', initiatorType: 'video', workerStart: 12.5 },
    { name: 'https://media.example.test/movie.mp4', initiatorType: 'video', workerStart: 0 },
    { name: 'https://example.test/app.js', initiatorType: 'script', workerStart: 3 },
  ] });
  const reports = () => page.sent.filter(message => message.cmd === 'SERVICE_WORKER_MEDIA');
  assert.deepEqual(reports().map(message => [...message.urls]), [['https://storage.example.test/mediastorage/1/132201720.mp4']]);
  page.resourceTimings([
    { name: 'https://storage.example.test/mediastorage/1/132201720.mp4', initiatorType: 'video', workerStart: 20 },
    { name: 'https://cdn.example.test/clip.webm#t=4', initiatorType: 'fetch', workerStart: 1 },
  ]);
  assert.deepEqual([...reports().at(-1).urls], ['https://cdn.example.test/clip.webm'], 'a URL is reported once, without its fragment');
  assert.equal(reports().length, 2);
  // Detections carry how the element is shown, for the worker's banner rule.
  const detected = page.sent.find(message => message.cmd === 'STORE_DETECTED_MEDIA').media;
  assert.deepEqual({ ...detected.presentation }, { width: 0, height: 0, loop: false, muted: false, autoplay: false });
  page.fail(new Error('Extension context invalidated.'));
  page.emitMedia();
  assert.equal(page.resourceObserver.disconnected, true);
});
