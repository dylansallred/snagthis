const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const WebSocket = require('ws');
const { build } = require('esbuild');
const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { QueueManager } = require('../packages/downloader-engine');
const { HistoryIndexService } = require('../packages/downloader-api/src/services/historyIndex');
const { createApiServer } = require('../packages/downloader-api/src');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(condition, message) {
  const deadline = Date.now() + 2500;
  while (!condition() && Date.now() < deadline) await sleep(25);
  assert.ok(condition(), message);
}

test('API shutdown disconnects an unfinished preview response after saving local state', { timeout: 5000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-shutdown-stream-'));
  const api = createApiServer({ dataDir: directory, port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath,
    trustBinaryPaths: true, initialQueueSettings: { autoStart: false } });
  let request;
  let response;
  let stopPromise;
  t.after(async () => {
    request?.destroy();
    api.server.closeAllConnections();
    await (stopPromise || api.stop());
    await fs.rm(directory, { recursive: true, force: true });
  });
  // A renderer can hold a range response open while the Electron quit handler
  // waits for the API. It must not need to close its window to finish shutdown.
  api.app.get('/api/fixture-preview', (_request, stream) => {
    stream.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': 1024 * 1024 });
    stream.write(Buffer.alloc(1024));
  });
  const address = await api.start();
  let disconnected = false;
  await new Promise((resolve, reject) => {
    request = http.get(`http://127.0.0.1:${address.port}/api/fixture-preview`, {
      headers: { Authorization: `Bearer ${api.getAuthToken()}` },
    }, incoming => {
      response = incoming;
      incoming.on('error', () => {});
      incoming.once('close', () => { disconnected = true; });
      incoming.once('data', () => { incoming.pause(); resolve(); });
    });
    request.once('error', reject);
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.complete, false, 'the client still owns an unfinished media response');
  let stopped = false;
  stopPromise = api.stop().then(() => { stopped = true; });
  await Promise.race([stopPromise, sleep(1000)]);
  assert.equal(stopped, true, 'shutdown must not wait for the renderer to close its preview');
  await waitFor(() => disconnected, 'the preview socket closes during shutdown');
  assert.ok(JSON.parse(await fs.readFile(path.join(directory, 'queue.json'), 'utf8')));
});

test('queue broadcasts include metadata and rate changes without scanning history for transfer progress', { timeout: 15000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-progress-'));
  const downloadDir = path.join(directory, 'downloads');
  let api;
  let manager;
  let historyIndex;
  let heldScan;
  let releaseHeldScan;
  let stopPromise;
  let scans = 0;
  const originalQueue = QueueManager.prototype.getQueue;
  const originalWalk = HistoryIndexService.prototype.walkMediaFiles;
  QueueManager.prototype.getQueue = function (...args) {
    if (this.queueFilePath === path.join(directory, 'queue.json')) manager = this;
    return originalQueue.apply(this, args);
  };
  HistoryIndexService.prototype.walkMediaFiles = async function (currentDir = this.downloadDir, relativeDir = '') {
    if (this.downloadDir === downloadDir && !relativeDir) {
      historyIndex = this;
      scans += 1;
      if (heldScan) await heldScan;
    }
    return originalWalk.call(this, currentDir, relativeDir);
  };
  t.after(async () => {
    releaseHeldScan?.();
    if (api) await (stopPromise || api.stop());
    QueueManager.prototype.getQueue = originalQueue;
    HistoryIndexService.prototype.walkMediaFiles = originalWalk;
    await fs.rm(directory, { recursive: true, force: true });
  });
  await fs.mkdir(downloadDir);
  await fs.writeFile(path.join(directory, 'queue.json'), JSON.stringify({
    settings: { autoStart: false, maxConcurrent: 1 },
    queue: [{ id: 'fixture', title: 'Original title', url: 'https://example.invalid/never-requested.mp4',
      status: 'paused', queueStatus: 'paused', mediaType: 'file', progress: 10, bytesDownloaded: 100,
      totalBytes: 1000, speedBps: 100, etaSeconds: 9, updatedAt: Date.now() }],
  }));
  api = createApiServer({ dataDir: directory, downloadDir, port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath,
    trustBinaryPaths: true, initialQueueSettings: { autoStart: false } });
  const address = await api.start();
  assert.ok(manager);
  const job = manager.jobs.get('fixture');
  job.status = job.queueStatus = 'downloading';
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, ['snagthis', `snagthis-auth.${api.getAuthToken()}`]);
  const updates = [];
  socket.on('message', message => {
    const parsed = JSON.parse(message);
    if (parsed.type === 'queue:update') updates.push(parsed.data.queue[0]);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'subscribe', channel: 'queue' }));
  await waitFor(() => updates.length > 0, 'receive the authenticated queue subscription');
  await sleep(550);
  job.title = 'Renamed title';
  await waitFor(() => updates.at(-1).title === job.title, 'a title-only update must be broadcast');
  job.speedBps = 0; job.etaSeconds = null;
  await waitFor(() => updates.at(-1).speedBps === 0 && updates.at(-1).etaSeconds === null,
    'a rate-only update must clear stale speed and ETA');
  job.selection = { height: 800 }; job.durationSeconds = 8730.688;
  await waitFor(() => updates.at(-1).durationSeconds === job.durationSeconds && updates.at(-1).selection?.height === 800,
    'late source metadata must be broadcast');
  const scanStart = scans;
  for (let tick = 0; tick < 4; tick += 1) {
    job.bytesDownloaded += 100; job.progress += 1;
    await waitFor(() => updates.at(-1).bytesDownloaded === job.bytesDownloaded, 'transfer progress must still be broadcast');
  }
  assert.equal(scans, scanStart, 'progress-only updates must not walk the saved library');

  job.filePath = path.join(downloadDir, 'fixture.mp4');
  await fs.writeFile(job.filePath, 'fixture');
  job.status = job.queueStatus = 'failed';
  await waitFor(() => scans > scanStart, 'terminal/file state changes must refresh saved files');
  await historyIndex.refreshInFlight;
  const terminalScans = scans;
  heldScan = new Promise(resolve => { releaseHeldScan = resolve; });
  job.filePath = path.join(downloadDir, 'renamed.mp4');
  await fs.rename(path.join(downloadDir, 'fixture.mp4'), job.filePath);
  await waitFor(() => scans > terminalScans, 'file changes must refresh even when public queue fields are unchanged');
  let stopped = false;
  stopPromise = api.stop().then(() => { stopped = true; });
  try {
    // Hold the real scan before it can enqueue persistence. Shutdown must wait
    // for it, rather than returning while a later write races directory removal.
    await sleep(50);
    assert.equal(stopped, false, 'API shutdown must await the in-flight history scan');
    releaseHeldScan();
    await stopPromise;
    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'history-index.json'), 'utf8'));
    assert.ok(persisted.items.some(item => item.relativePath === 'renamed.mp4' && item.missing === false),
      'the final history scan and its write must finish before shutdown resolves');
  } finally {
    releaseHeldScan();
  }
});

test('desktop library keeps live queue progress and ignores superseded HTTP refreshes', { timeout: 15000 }, async (t) => {
  const bundle = await build({
    stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { useLibrary } from '@/hooks/useLibrary';
      const pending = [];
      const refreshing = [];
      const sockets = [];
      class FakeSocket {
        static OPEN = 1; static CONNECTING = 0; readyState = 1;
        constructor() { sockets.push(this); }
        send() {}
        close() { this.readyState = 3; this.onclose?.(); }
      }
      window.WebSocket = FakeSocket;
      const queue = progress => ({ queue: [{ id: 'fixture', title: 'Fixture', status: 'downloading', queueStatus: 'downloading', progress }], settings: { maxConcurrent: 1, autoStart: false } });
      const api = { baseUrl: 'http://127.0.0.1:1', authToken: 'isolated-fixture',
        getQueue: () => new Promise(resolve => pending.push(resolve)),
        getHistory: async () => ({ items: [], nextCursor: null }) };
      let library;
      function Harness() { library = useLibrary(api, ''); return null; }
      const root = createRoot(document.getElementById('root'));
      flushSync(() => root.render(<Harness />));
      window.fixture = {
        live(progress) { flushSync(() => sockets[0].onmessage({ data: JSON.stringify({ type: 'queue:update', data: queue(progress) }) })); },
        resolve(index, progress) { pending[index](queue(progress)); },
        refresh() { refreshing.push(library.refresh()); },
        async finish(request, progress, refresh) {
          pending[request](queue(progress)); await refreshing[refresh];
          await new Promise(resolve => setTimeout(resolve, 0));
        },
        snapshot() { return { progress: library.queue.queue[0]?.progress, loading: library.loading }; },
        close() { flushSync(() => root.unmount()); }
      };
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': path.resolve(__dirname, '../apps/desktop/src') },
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => { window.fixture.live(80); window.fixture.resolve(0, 10); });
  await page.waitForFunction(() => !window.fixture.snapshot().loading);
  assert.equal(await page.evaluate(() => window.fixture.snapshot().progress), 80, 'an older HTTP snapshot must not roll back a live update');
  await page.evaluate(() => { window.fixture.refresh(); window.fixture.refresh(); });
  await page.evaluate(() => window.fixture.finish(2, 90, 1));
  assert.equal(await page.evaluate(() => window.fixture.snapshot().progress), 90);
  await page.evaluate(() => window.fixture.finish(1, 20, 0));
  assert.equal(await page.evaluate(() => window.fixture.snapshot().progress), 90, 'an earlier HTTP refresh must not replace a newer refresh');
  await page.evaluate(() => window.fixture.close());
});
