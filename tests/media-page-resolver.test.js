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
    async closeAllConnections() {}, async clearStorageData() {},
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
