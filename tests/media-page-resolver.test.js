const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

test('a master accelerates media selection and live playlist refreshes do not postpone it', async () => {
  const source = path.resolve(__dirname, '../apps/desktop/electron/mediaPageResolver.js');
  const originalRequire = createRequire(source);
  const bodies = new Map();
  let refreshTimer;
  let masterTimer;
  let destroyed = false;
  let sequence = 0;
  const pageSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {}, onBeforeSendHeaders() {} },
    async closeAllConnections() {}, async clearStorageData() {}, async clearCache() {}, async clearAuthCache() {},
  });
  const debug = Object.assign(new EventEmitter(), {
    attach() {}, detach() {}, isAttached: () => true,
    async sendCommand(command, args) {
      return command === 'Network.getResponseBody' ? { body: bodies.get(args.requestId), base64Encoded: false } : {};
    },
  });
  const contents = Object.assign(new EventEmitter(), {
    debugger: debug, setAudioMuted() {}, setWindowOpenHandler() {},
    isDestroyed: () => destroyed,
    async executeJavaScript() { return { title: 'Live stream', videoCount: 1, duration: 0 }; },
  });
  function playlist(url, body) {
    const requestId = String(++sequence);
    bodies.set(requestId, body);
    debug.emit('message', {}, 'Network.responseReceived', {
      requestId, type: 'Fetch', response: { url, status: 200, mimeType: 'application/vnd.apple.mpegurl', headers: {} },
    });
    debug.emit('message', {}, 'Network.loadingFinished', { requestId, encodedDataLength: body.length });
  }
  const refreshLeaf = () => playlist('https://example.com/live.m3u8',
    `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n#EXTINF:1,\nsegment-${sequence}.ts\n`);
  class BrowserWindow {
    webContents = contents;
    async loadURL(url) {
      if (url === 'about:blank') return;
      contents.emit('dom-ready');
      refreshLeaf();
      masterTimer = setTimeout(() => playlist('https://example.com/master.m3u8',
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080\nlive.m3u8\n'), 100);
      refreshTimer = setInterval(refreshLeaf, 100);
    }
    destroy() { destroyed = true; clearInterval(refreshTimer); clearTimeout(masterTimer); }
  }
  // Exercise actual manifest parsing and resolver decisions without opening an
  // Electron profile or making network requests.
  const sandbox = {
    require: id => id === 'electron' ? { BrowserWindow, session: { fromPartition: () => pageSession } } : originalRequire(id),
    module: { exports: {} }, URL, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), sandbox, { filename: source });
  try {
    const result = await sandbox.module.exports.resolveMediaPage({ url: 'https://example.com/watch', timeoutMs: 1000 });
    assert.equal(result.mediaUrl, 'https://example.com/master.m3u8');
    assert.equal(result.mediaType, 'hls');
    assert.ok(result.manifestText.includes('RESOLUTION=1920x1080'));
    assert.ok(sequence >= 4, 'multiple live refreshes occurred while selection was pending');
    assert.ok(destroyed, 'resolver window is cleaned up');
  } finally { clearInterval(refreshTimer); clearTimeout(masterTimer); }
});

test('page resolves reuse a fixed pool of sessions, one resolve per session, wiped after each use', async () => {
  const source = path.resolve(__dirname, '../apps/desktop/electron/mediaPageResolver.js');
  const originalRequire = createRequire(source);
  const sessions = new Map();
  let maxConcurrentPerSession = 0;
  const fromPartition = (name) => {
    if (!sessions.has(name)) {
      const pageSession = Object.assign(new EventEmitter(), {
        name, active: 0, wiped: 0,
        setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {}, onBeforeSendHeaders() {} },
        async closeAllConnections() {}, async clearStorageData() { this.wiped += 1; }, async clearCache() {}, async clearAuthCache() {},
      });
      sessions.set(name, pageSession);
    }
    return sessions.get(name);
  };
  class BrowserWindow {
    constructor({ webPreferences }) {
      this.session = webPreferences.session;
      this.session.active += 1;
      maxConcurrentPerSession = Math.max(maxConcurrentPerSession, this.session.active);
      let destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        debugger: Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true, async sendCommand() { return {}; } }),
        setAudioMuted() {}, setWindowOpenHandler() {}, isDestroyed: () => destroyed,
        async executeJavaScript() { return { title: '', videoCount: 0, duration: 0 }; },
      });
      this.destroy = () => { destroyed = true; this.session.active -= 1; };
    }
    async loadURL() {}
  }
  const sandbox = {
    require: id => id === 'electron' ? { BrowserWindow, session: { fromPartition } } : originalRequire(id),
    module: { exports: {} }, URL, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), sandbox, { filename: source });
  // Pages without a video time out; five overlapping requests exercise queueing.
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
    sandbox.module.exports.resolveMediaPage({ url: `https://example.com/watch/${index}`, timeoutMs: 1000 })));
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'PAGE_VIDEO_UNAVAILABLE'));
  assert.ok(sessions.size <= 2, `only a fixed pool of sessions is created (got ${sessions.size})`);
  assert.equal(maxConcurrentPerSession, 1, 'concurrent resolves never share a session');
  assert.equal([...sessions.values()].reduce((total, entry) => total + entry.wiped, 0), 5, 'each resolve wipes its session afterwards');
});

// A fake Electron environment whose debugger records every command with its
// CDP session and serves response bodies per `${sessionId}:${requestId}`.
function resolverHarness({ onLoad, executeJavaScript, onCommand }) {
  const source = path.resolve(__dirname, '../apps/desktop/electron/mediaPageResolver.js');
  const originalRequire = createRequire(source);
  const bodies = new Map();
  const commands = [];
  const timers = new Set();
  let destroyed = false;
  const pageSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {}, onBeforeSendHeaders() {} },
    async closeAllConnections() {}, async clearStorageData() {}, async clearCache() {}, async clearAuthCache() {},
  });
  const debug = Object.assign(new EventEmitter(), {
    attach() {}, detach() {}, isAttached: () => true,
    async sendCommand(command, args, sessionId) {
      commands.push({ command, args, sessionId });
      onCommand?.({ command, args, sessionId });
      if (command !== 'Network.getResponseBody') return {};
      const body = bodies.get(`${sessionId || ''}:${args.requestId}`);
      if (body === undefined) throw new Error('No resource with given identifier found');
      return { body, base64Encoded: false };
    },
  });
  const contents = Object.assign(new EventEmitter(), {
    debugger: debug, setAudioMuted() {}, setWindowOpenHandler() {},
    isDestroyed: () => destroyed,
    executeJavaScript: executeJavaScript || (async () => ({ title: 'Movie', videoCount: 1, duration: 0 })),
  });
  let sequence = 0;
  const env = {
    debug, commands, contents,
    later(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); },
    // Emit a successful response; `body` (when given) is readable only from `sessionId`.
    respond(url, { sessionId, body, mimeType = 'application/vnd.apple.mpegurl' } = {}) {
      const requestId = String(++sequence);
      if (body !== undefined) bodies.set(`${sessionId || ''}:${requestId}`, body);
      debug.emit('message', {}, 'Network.responseReceived', {
        requestId, type: 'Fetch', response: { url, status: 200, mimeType, headers: {} },
      }, sessionId);
      debug.emit('message', {}, 'Network.loadingFinished', { requestId, encodedDataLength: (body || '').length }, sessionId);
    },
  };
  class BrowserWindow {
    webContents = contents;
    async loadURL(url) {
      if (url === 'about:blank') return;
      contents.emit('dom-ready');
      onLoad(env);
    }
    destroy() { destroyed = true; for (const timer of timers) clearTimeout(timer); }
  }
  const sandbox = {
    require: id => id === 'electron' ? { BrowserWindow, session: { fromPartition: () => pageSession } } : originalRequire(id),
    module: { exports: {} }, URL, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), sandbox, { filename: source });
  env.resolve = (options) => sandbox.module.exports.resolveMediaPage(options);
  env.isDestroyed = () => destroyed;
  return env;
}

const MASTER = '#EXTM3U\n'
  + '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080.m3u8?sig=a\n'
  + '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n720.m3u8?sig=a\n';
const LEAF = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:4,\nseg-0.ts\n#EXT-X-ENDLIST\n';

test('a cross-origin iframe player is observed through its own auto-attached CDP session', async () => {
  const env = resolverHarness({ onLoad: (env) => {
    // The top page only loads unrelated JSON under a request id the child reuses.
    env.respond('https://aggregator.example/api/config', { body: '{}', mimeType: 'application/json' });
    env.debug.emit('message', {}, 'Target.attachedToTarget', {
      sessionId: 'frame-1', waitingForDebugger: true,
      targetInfo: { targetId: 'T1', type: 'iframe', url: 'https://player.example/embed/1' },
    });
    env.later(() => {
      env.respond('https://cdn.player.example/v/master.m3u8', { sessionId: 'frame-1', body: MASTER });
      env.respond('https://cdn.player.example/v/720.m3u8?sig=a', { sessionId: 'frame-1', body: LEAF });
    }, 50);
  } });
  const result = await env.resolve({ url: 'https://aggregator.example/watch/1', timeoutMs: 3000 });
  assert.equal(result.mediaUrl, 'https://cdn.player.example/v/master.m3u8');
  assert.equal(result.mediaType, 'hls');
  assert.ok(result.manifestText.includes('RESOLUTION=1920x1080'));
  assert.deepEqual([...result.observedUrls], ['https://cdn.player.example/v/720.m3u8?sig=a']);
  const childCommands = env.commands.filter(entry => entry.sessionId === 'frame-1').map(entry => entry.command);
  assert.ok(childCommands.includes('Network.enable'), 'network observation is enabled in the iframe target');
  assert.ok(childCommands.includes('Target.setAutoAttach'), 'nested iframes are auto-attached too');
  assert.ok(childCommands.includes('Runtime.runIfWaitingForDebugger'), 'the paused iframe is resumed');
  const bodyReads = env.commands.filter(entry => entry.command === 'Network.getResponseBody');
  assert.ok(bodyReads.some(entry => entry.sessionId === 'frame-1'), 'child bodies are read from the child session');
  assert.ok(bodyReads.every(entry => entry.args.requestId !== '1' || entry.sessionId === undefined), 'top-page request ids stay in the top session');
  const topAutoAttach = env.commands.find(entry => entry.command === 'Target.setAutoAttach' && entry.sessionId === undefined);
  assert.deepEqual({ ...topAutoAttach.args }, { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  assert.ok(env.isDestroyed(), 'resolver window is cleaned up');
});

test('with no media, the resolver clicks the largest video once and resolves what playback loads', async () => {
  let clicked = false;
  let targetLookups = 0;
  const env = resolverHarness({
    onLoad: () => {},
    async executeJavaScript(script) {
      if (script.includes('elementFromPoint')) { targetLookups += 1; return { x: 550, y: 310, kind: 'video' }; }
      return { title: 'Clip', videoCount: 1, duration: clicked ? 60 : 0 };
    },
    onCommand({ command, args }) {
      if (command === 'Input.dispatchMouseEvent' && args.type === 'mouseReleased') {
        clicked = true;
        env.later(() => env.respond('https://cdn.example/clip/master.m3u8', { body: MASTER }), 20);
        env.later(() => env.respond('https://cdn.example/clip/1080.m3u8?sig=a', { body: LEAF }), 40);
      }
    },
  });
  const result = await env.resolve({ url: 'https://example.com/watch/2', timeoutMs: 3000 });
  assert.equal(result.mediaUrl, 'https://cdn.example/clip/master.m3u8');
  const presses = env.commands.filter(entry => entry.command === 'Input.dispatchMouseEvent' && entry.args.type === 'mousePressed');
  assert.equal(presses.length, 1, 'exactly one click is dispatched');
  assert.equal(presses[0].args.x, 550);
  assert.equal(presses[0].args.y, 310);
  assert.equal(presses[0].sessionId, undefined, 'the click is dispatched in the top page');
  assert.equal(targetLookups, 1, 'the click target is looked up only once');
});

test('observedUrls lists the child playlists the page player loaded', async () => {
  const env = resolverHarness({ onLoad: (env) => {
    env.respond('https://cdn.example/show/master.m3u8', { body: MASTER });
    // The player's 720p request arrives after the master is ready to choose;
    // its query string differs from the master's listing.
    env.later(() => env.respond('https://cdn.example/show/720.m3u8?sig=b', { body: LEAF }), 600);
  } });
  const result = await env.resolve({ url: 'https://example.com/watch/3', timeoutMs: 5000 });
  assert.equal(result.mediaUrl, 'https://cdn.example/show/master.m3u8');
  assert.deepEqual([...result.observedUrls], ['https://cdn.example/show/720.m3u8?sig=a']);
});

test('inspection marks variants the resolved page player loaded as observed', async () => {
  const { inspectMedia } = require('../packages/downloader-api/src/services/mediaInspection');
  const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), body: { async cancel() {} } });
  const inspection = await inspectMedia({
    mediaUrl: 'https://example.com/watch/4', fetchImpl,
    resolvePage: async ({ url }) => ({
      mediaUrl: 'https://cdn.example/show/master.m3u8', mediaType: 'hls', sourcePageUrl: url, headers: {},
      manifestText: MASTER, observedUrls: ['https://cdn.example/show/720.m3u8?sig=rotated'],
    }),
  });
  const byHeight = Object.fromEntries(inspection.variants.map(variant => [variant.height, variant.observed]));
  assert.equal(byHeight[720], true, 'origin+path match survives a changed signed query');
  assert.equal(byHeight[1080], undefined);
  const unobserved = await inspectMedia({
    mediaUrl: 'https://example.com/watch/5', fetchImpl,
    resolvePage: async ({ url }) => ({ mediaUrl: 'https://cdn.example/show/master.m3u8', sourcePageUrl: url, headers: {}, manifestText: MASTER }),
  });
  assert.ok(unobserved.variants.every(variant => !('observed' in variant)));
});
