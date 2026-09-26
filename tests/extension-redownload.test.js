const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { jobFor } = require('../apps/extension/popup/model');
const { toRowModel } = require('../packages/contracts/src/rows');

function storage(initial = {}) {
  const values = structuredClone(initial);
  return {
    setAccessLevel: async () => {},
    get: async keys => structuredClone(keys == null ? values : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]]))),
    set: async entries => { Object.assign(values, structuredClone(entries)); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}

// Run the shipped worker against the real authenticated API; only Chrome's
// browser event/storage surface is replaced for this queue-lifecycle fixture.
function loadWorker(tab, token) {
  const listeners = {};
  const event = name => ({ addListener: listener => { listeners[name] = listener; } });
  const requests = [];
  const chrome = {
    storage: { session: storage(), local: storage({ appToken: token, appTokenVersion: 2 }) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    runtime: { id: 'a'.repeat(32), getURL: value => `chrome-extension://${'a'.repeat(32)}/${value}`,
      getManifest: () => ({ version: '1.0.0' }), onMessage: event('message'), onInstalled: event('installed') },
    tabs: { get: async () => structuredClone(tab), onRemoved: event('removed') },
    webNavigation: { getFrame: async () => ({ url: tab.url, documentId: tab.documentId }),
      onCommitted: event('committed'), onHistoryStateUpdated: event('history') },
    webRequest: { onBeforeSendHeaders: event('beforeHeaders'), onHeadersReceived: event('headers'),
      onCompleted: event('completed'), onErrorOccurred: event('error') },
  };
  const context = vm.createContext({ chrome, URL, AbortSignal, crypto: { randomUUID },
    fetch: async (url, options) => {
      const response = await fetch(url, options);
      requests.push({ path: new URL(url).pathname, method: options.method, status: response.status });
      return response;
    },
  });
  const extension = path.join(__dirname, '../apps/extension');
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(extension, 'service-worker.js'), 'utf8'), context, { filename: 'service-worker.js' });
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  return {
    requests,
    message(message, sender = popup) {
      return new Promise(resolve => listeners.message(message, sender, result => resolve(structuredClone(result))));
    },
    contentSender: { id: chrome.runtime.id, tab, frameId: 0, documentId: tab.documentId, url: tab.url },
  };
}

test('extension Download works after desktop cancel, Undo and remove, preserving the extension API boundary', async () => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snagthis-redownload-'));
  const downloadDir = path.join(dataDir, 'downloads');
  await fs.promises.mkdir(downloadDir);
  // Queue transitions are under test; no media download or user's profile runs.
  await fs.promises.writeFile(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: [], settings: { autoStart: false, maxConcurrent: 1 } }));
  const api = createApiServer({ dataDir, downloadDir, port: 0, ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true });
  const address = await api.start();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${api.getAuthToken()}` };
  const desktop = (route, method = 'POST') => fetch(`${base}${route}`, { method, headers });
  const tab = { id: 7, url: 'https://cinema.example/movie', title: 'Fixture movie', documentId: 'fixture-document' };
  const worker = loadWorker(tab, api.getAuthToken());
  try {
    const detected = await worker.message({ cmd: 'STORE_DETECTED_MEDIA', media: { url: 'https://media.example/video.mp4', contentType: 'video/mp4', sourcePageTitle: tab.title } }, worker.contentSender);
    assert.equal(detected.ok, true);
    const item = detected.item;
    const download = () => worker.message({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId: tab.id, mediaId: item.id, apiBase: base,
      payload: { mediaUrl: item.url, mediaType: 'file', title: tab.title } });
    const original = await download();
    assert.equal(original.ok, true, original.error);

    // Desktop removal of an unfinished row cancels and hides it; Undo creates
    // a new job while the extension still remembers the original mapped job.
    assert.equal((await desktop(`/api/jobs/${original.jobId}/cancel`)).status, 200);
    assert.equal(toRowModel(api.getState().queue.find(job => job.id === original.jobId)), null);
    const undoResponse = await desktop(`/api/jobs/${original.jobId}/retry`);
    assert.equal(undoResponse.status, 200);
    const undo = await undoResponse.json();
    assert.notEqual(undo.jobId, original.jobId);
    assert.equal((await desktop(`/api/jobs/${undo.jobId}/cancel`)).status, 200);
    const before = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: tab.id });
    assert.equal(before.mappings[item.id], original.jobId);
    assert.equal(jobFor(item, before.mappings, api.getState().queue), null, 'the popup must offer Download again');

    // The old worker queried this desktop-only route and turned its expected
    // 403 into a transient "Something went wrong at 0%" row. Keep it forbidden.
    const forbidden = await fetch(`${base}/api/jobs/${original.jobId}`, { headers: { ...headers, 'X-Client': 'snagthis-extension' } });
    assert.equal(forbidden.status, 403);
    const repeated = await download();
    assert.equal(repeated.ok, true, repeated.error);
    assert.notEqual(repeated.jobId, original.jobId);
    assert.notEqual(repeated.jobId, undo.jobId);
    const after = await worker.message({ cmd: 'GET_TAB_MEDIA', tabId: tab.id });
    assert.equal(after.mappings[item.id], repeated.jobId);
    assert.equal(jobFor(item, after.mappings, api.getState().queue)?.queueStatus, 'queued');
    assert.equal(api.getState().queue.filter(job => job.queueStatus === 'cancelled').length, 2);

    // A repeated click on the replacement job must still reuse the active job.
    assert.equal((await download()).jobId, repeated.jobId);
    assert.equal(api.getState().queue.length, 3);
    assert.deepEqual(worker.requests.map(request => request.path), ['/v1/jobs', '/v1/queue', '/v1/jobs', '/v1/queue']);
    assert.ok(worker.requests.every(request => request.status === 200));
  } finally {
    await api.stop();
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }
});
