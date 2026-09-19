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

function loadContent() {
  const location = { href: 'https://example.test/watch' };
  const window = target();
  const video = Object.assign(target(), {
    currentSrc: 'https://media.example.test/movie.mp4', readyState: 0, videoHeight: 720, duration: 20,
    getAttribute: () => '', querySelector: () => null, querySelectorAll: () => [],
  });
  const document = Object.assign(target(), {
    title: 'A real video', baseURI: location.href, documentElement: {},
    querySelector: () => null, querySelectorAll: selector => selector === 'video' ? [video] : [],
  });
  const sent = [];
  const runtimeListeners = new Set();
  const timers = new Map();
  let timerId = 0;
  let failure;
  let reject = false;
  let observer;
  const chrome = { runtime: {
    sendMessage(message) {
      sent.push(message);
      if (failure) { if (reject) return Promise.reject(failure); throw failure; }
      return Promise.resolve({ ok: true });
    },
    onMessage: { addListener: listener => runtimeListeners.add(listener), removeListener: listener => runtimeListeners.delete(listener) },
  } };
  const context = {
    window, document, location, chrome, URL, AbortController, Promise,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/extension/js/content.js'), 'utf8'), context);
  return { sent, timers, runtimeListeners, window, video, location, observer,
    fail(error, asynchronously = false) { failure = error; reject = asynchronously; },
    emitMedia() { window.dispatch('message', { source: window, data: { source: 'vidsnag:media', media: { url: video.currentSrc } } }); },
  };
}

test('content messaging works normally and retires all page work after synchronous context invalidation', () => {
  const page = loadContent();
  assert.deepEqual(page.sent.map(message => message.cmd), ['PAGE_CONTEXT', 'STORE_DETECTED_MEDIA']);
  page.emitMedia();
  assert.equal(page.sent.at(-1).media.url, page.video.currentSrc);
  assert.equal(page.observer.disconnected, false);
  page.observer.callback();
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
  page.observer.callback();
  runtimeCallback({ cmd: 'SCAN_PAGE' });
  assert.equal(page.sent.length, attempts, 'retired callbacks must never contact the unloaded extension again');
  assert.equal(page.timers.size, 0);
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
