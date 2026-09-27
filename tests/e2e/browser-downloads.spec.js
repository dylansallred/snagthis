const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { root, freePort } = require('./helpers');
const { runTool } = require('../fixtures/server');
const { probeFile } = require('../fixtures/engine');

// Only this test uses the throttle and expiry controls; other fixture users
// retain their existing response timing. The signed-looking values are fake.
async function startBrowserFixture(directory) {
  const sourcePath = path.join(directory, 'original.mp4');
  await runTool(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '10', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', sourcePath,
  ]);
  const video = fs.readFileSync(sourcePath);
  const transfers = [];
  const controls = { expired: false, expiredResponses: 0, fast: false };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    response.setHeader('Cache-Control', 'no-store');
    const respond = (status, body, type) => {
      response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (url.pathname === '/direct' || url.pathname === '/retry') {
      const retry = url.pathname === '/retry';
      respond(200, `<!doctype html><html lang="en"><meta charset="utf-8"><title>${retry ? 'Retry' : 'Chrome-only'} download fixture</title>
        <h1>${retry ? 'Retry' : 'Chrome-only'} download fixture</h1>
        <video controls preload="metadata" width="640" src="/media/${retry ? 'expiring' : 'direct'}.mp4?token=fixture-private-${retry ? 'retry' : 'source'}"></video></html>`, 'text/html');
      return;
    }
    if (url.pathname === '/hls') {
      respond(200, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Stream download fixture</title><h1>Stream download fixture</h1><script>fetch("/stream/master.m3u8").then(response => response.text())</script></html>', 'text/html');
      return;
    }
    if (url.pathname === '/stream/master.m3u8') {
      respond(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720\nvideo.m3u8\n', 'application/vnd.apple.mpegurl');
      return;
    }
    if (!['/media/direct.mp4', '/media/expiring.mp4'].includes(url.pathname)) { respond(404, 'Not found', 'text/plain'); return; }
    if (url.pathname === '/media/expiring.mp4' && controls.expired) { controls.expiredResponses++; respond(403, 'Fixture URL expired', 'text/plain'); return; }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('ETag', '"snagthis-browser-fixture"');
    if (start > end) { response.setHeader('Content-Range', `bytes */${video.length}`); respond(416, '', 'text/plain'); return; }
    if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${video.length}`);
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1 });
    if (request.method === 'HEAD') { response.end(); return; }
    const transfer = { pathname: url.pathname, destination: request.headers['sec-fetch-dest'] || '', start, bytesSent: 0, active: true };
    transfers.push(transfer);
    let offset = start;
    const timer = setInterval(() => {
      const chunkSize = controls.fast ? 512 * 1024 : transfer.destination === 'video' ? 16 * 1024 : 4 * 1024;
      const chunk = video.subarray(offset, Math.min(end + 1, offset + chunkSize));
      offset += chunk.length;
      transfer.bytesSent += chunk.length;
      response.write(chunk);
      if (offset > end) { clearInterval(timer); response.end(); }
    }, 80);
    response.once('close', () => { transfer.active = false; clearInterval(timer); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`, controls, transfers,
    bytes: video.length, sha256: createHash('sha256').update(video).digest('hex'),
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

async function chromeDownload(popup, id) {
  return popup.evaluate(async downloadId => (await chrome.downloads.search({ id: downloadId }))[0], id);
}

async function tabSnapshot(popup, tabId) {
  return popup.evaluate(id => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId: id }), tabId);
}

async function workerGlobal(cdp, workerUrl, expression) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find(item => item.type === 'service_worker' && item.url === workerUrl);
  expect(target, 'running extension worker target').toBeTruthy();
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let listener;
  let timer;
  try {
    const result = new Promise((resolve, reject) => {
      listener = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        else resolve(message.result.result.value);
      };
      cdp.on('Target.receivedMessageFromTarget', listener);
      timer = setTimeout(() => reject(new Error('Worker global inspection did not respond')), 5000);
    });
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }) });
    return await result;
  } finally {
    clearTimeout(timer);
    cdp.off('Target.receivedMessageFromTarget', listener);
    await cdp.send('Target.detachFromTarget', { sessionId });
  }
}

test('Chrome-only files survive popup and worker closure, retry expired URLs, and keep streams on desktop', async () => {
  test.setTimeout(90_000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-browser-downloads-'));
  const downloadsPath = path.join(directory, 'downloads');
  const evidencePath = path.join(root, 'work/verification/browser-downloads');
  fs.mkdirSync(downloadsPath);
  fs.mkdirSync(evidencePath, { recursive: true });
  let fixture;
  let context;
  let popup;
  const evidence = {};
  try {
    fixture = await startBrowserFixture(directory);
    const apiBase = `http://127.0.0.1:${await freePort()}`;
    const extensionPath = path.join(root, 'apps/extension');
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
      channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const source = await context.newPage();
    const cdp = await context.newCDPSession(source);
    // Native extension downloads must land inside this test, not the owner's
    // system Downloads folder. Preserve Chrome's real filenames and file I/O.
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsPath });
    const workerLifecycle = [];
    const workerVersions = new Map();
    cdp.on('ServiceWorker.workerVersionUpdated', event => {
      for (const version of event.versions) if (version.scriptURL === worker.url()) {
        workerLifecycle.push(version.runningStatus);
        workerVersions.set(version.versionId, version);
      }
    });
    await cdp.send('ServiceWorker.enable');
    await source.goto(`${fixture.baseUrl}/direct`);
    await source.locator('video').evaluate(video => new Promise(resolve => {
      if (video.readyState >= 1) resolve(); else video.addEventListener('loadedmetadata', resolve, { once: true });
    }));
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, source.url());
    expect(tabId).toBeGreaterThan(0);
    const openPopup = async () => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 480, height: 560 });
      await page.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(apiBase)}`);
      return page;
    };
    const screenshot = async name => {
      const outputPath = test.info().outputPath(`${name}.png`);
      await popup.screenshot({ path: outputPath });
      fs.copyFileSync(outputPath, path.join(evidencePath, `${name}.png`));
    };
    popup = await openPopup();

    await test.step('fresh unpaired Chrome detects a real file and can download with desktop offline', async () => {
      await expect(popup.locator('.video-row')).toHaveCount(1);
      await expect(popup.locator('#connection-banner')).toContainText('Save supported files in Chrome');
      await expect(popup.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
      expect((await popup.evaluate(() => chrome.storage.local.get('appToken'))).appToken).toBeUndefined();
      const snapshot = await tabSnapshot(popup, tabId);
      expect(snapshot.items[0].type).toBe('file');
      expect(snapshot.items[0].url).toContain('/media/direct.mp4');
      await screenshot('chrome-offline-ready');
      evidence.offlineUnpairedDownloadEnabled = true;
    });

    let downloadId;
    await test.step('the real native transfer pauses and resumes from the popup', async () => {
      await popup.getByRole('button', { name: 'Download', exact: true }).click();
      await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      const snapshot = await tabSnapshot(popup, tabId);
      const job = snapshot.browserQueue.find(item => item.backend === 'browser');
      expect(job.id).toMatch(/^browser:\d+$/);
      expect(Object.values(snapshot.mappings)).toContain(job.id);
      downloadId = Number(job.id.slice('browser:'.length));
      await expect.poll(async () => (await chromeDownload(popup, downloadId)).bytesReceived).toBeGreaterThan(0);
      await popup.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(popup.getByRole('button', { name: 'Resume download', exact: true })).toBeVisible();
      expect((await chromeDownload(popup, downloadId)).paused).toBe(true);
      const pausedBytes = (await chromeDownload(popup, downloadId)).bytesReceived;
      await popup.getByRole('button', { name: 'Resume download', exact: true }).click();
      await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await expect.poll(async () => (await chromeDownload(popup, downloadId)).bytesReceived).toBeGreaterThan(pausedBytes);
      evidence.nativePauseResume = true;
    });

    await test.step('native bytes continue with popup closed and the extension worker stopped', async () => {
      await popup.close();
      await worker.evaluate(() => { globalThis.__snagthisLifecycleProbe = 'isolated-worker-state'; });
      const lifecycleStart = workerLifecycle.length;
      // Chromium keeps the DevTools target (and Playwright Worker handle) across
      // a worker restart. Assert Chrome's stopped/running events and a fresh
      // global scope instead of relying on a missing Playwright `close` event.
      const version = [...workerVersions.values()].find(item => item.runningStatus === 'running');
      expect(version, 'running extension service worker version').toBeTruthy();
      await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
      await expect.poll(() => workerLifecycle.slice(lifecycleStart).includes('stopped')).toBe(true);
      evidence.workerStopMethod = 'ServiceWorker.stopWorker';
      evidence.workerLifecycle = workerLifecycle;
      // Chrome can resume small files by restarting from byte zero. The popup
      // is closed and cancelled its preview requests, so the sole live
      // non-video response is the browser-owned download, regardless of Range.
      const nativeTransfers = fixture.transfers.filter(item => item.pathname === '/media/direct.mp4' && item.destination !== 'video' && item.active);
      expect(nativeTransfers, 'one active native HTTP transfer after worker stopped').toHaveLength(1);
      const [nativeTransfer] = nativeTransfers;
      const sentAfterStop = nativeTransfer.bytesSent;
      await expect.poll(() => nativeTransfer.bytesSent).toBeGreaterThan(sentAfterStop + 16 * 1024);
      evidence.bytesDeliveredAfterWorkerStop = nativeTransfer.bytesSent - sentAfterStop;
      popup = await openPopup();
      await expect(popup.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      const lifecycle = workerLifecycle.slice(lifecycleStart);
      expect(lifecycle.slice(lifecycle.indexOf('stopped') + 1)).toContain('running');
      expect(await workerGlobal(cdp, worker.url(), 'typeof globalThis.__snagthisLifecycleProbe')).toBe('undefined');
      expect(Object.values((await tabSnapshot(popup, tabId)).mappings)).toContain(`browser:${downloadId}`);
      evidence.workerLifecycle = lifecycle;
      evidence.freshWorkerGlobal = true;
      fixture.controls.fast = true;
      await expect(popup.locator('.saved-copy')).toHaveText('Saved in Chrome');
      await expect(popup.getByRole('button', { name: 'Show in folder', exact: true })).toBeEnabled();
      const saved = await chromeDownload(popup, downloadId);
      expect(saved.state).toBe('complete');
      expect(saved.exists).toBe(true);
      expect(path.resolve(saved.filename).startsWith(downloadsPath + path.sep)).toBe(true);
      const actual = fs.readFileSync(saved.filename);
      expect(actual.length).toBe(fixture.bytes);
      expect(createHash('sha256').update(actual).digest('hex')).toBe(fixture.sha256);
      const media = await probeFile(saved.filename);
      expect(media.format).toContain('mp4');
      expect(media.height).toBe(720);
      expect(media.hasAudio).toBe(true);
      expect(Math.abs(media.durationSeconds - 10)).toBeLessThanOrEqual(1);
      evidence.savedMedia = { bytes: actual.length, height: media.height, hasAudio: media.hasAudio, durationSeconds: media.durationSeconds, matchesSourceSha256: true };
      await screenshot('chrome-saved');
    });

    await test.step('an expired file has a real failed state and can retry a current source', async () => {
      await source.goto(`${fixture.baseUrl}/retry`);
      await expect.poll(async () => (await tabSnapshot(popup, tabId)).items.some(item => item.url.includes('/media/expiring.mp4'))).toBe(true);
      await expect(popup.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
      fixture.controls.expired = true;
      await popup.getByRole('button', { name: 'Download', exact: true }).click();
      await expect(popup.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
      expect(fixture.controls.expiredResponses).toBeGreaterThan(0);
      const failedSnapshot = await tabSnapshot(popup, tabId);
      const failedJobId = Object.values(failedSnapshot.mappings)[0];
      // Depending on Chrome's network timing, a 403 either rejects download()
      // before assigning an ID or creates an interrupted native item.
      let initialState = 'rejected before native ID';
      if (failedJobId) {
        const failed = await chromeDownload(popup, Number(failedJobId.slice('browser:'.length)));
        expect(failed.state).toBe('interrupted');
        expect(failed.error).toBeTruthy();
        initialState = failed.state;
      }
      fixture.controls.expired = false;
      await popup.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(popup.locator('.saved-copy')).toHaveText('Saved in Chrome');
      const retriedSnapshot = await tabSnapshot(popup, tabId);
      const retriedJobId = Object.values(retriedSnapshot.mappings)[0];
      expect(retriedJobId).not.toBe(failedJobId);
      const retried = await chromeDownload(popup, Number(retriedJobId.slice('browser:'.length)));
      expect(retried.state).toBe('complete');
      expect(path.resolve(retried.filename).startsWith(downloadsPath + path.sep)).toBe(true);
      expect(createHash('sha256').update(fs.readFileSync(retried.filename)).digest('hex')).toBe(fixture.sha256);
      evidence.expiredFileRetry = { initialState, retryState: retried.state, matchesSourceSha256: true };
    });

    await test.step('streams still request desktop, and extension persistence contains no source credentials', async () => {
      await source.goto(`${fixture.baseUrl}/hls`);
      await expect(popup.getByRole('button', { name: 'Use desktop app', exact: true })).toBeVisible();
      await expect(popup.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
      const before = await popup.evaluate(() => chrome.downloads.search({}));
      await popup.getByRole('button', { name: 'Use desktop app', exact: true }).click();
      await expect(popup.locator('#sheet')).toContainText('Open SnagThis and connect Chrome to try this download.');
      await expect(popup.locator('#sheet').getByRole('button', { name: 'Open SnagThis', exact: true })).toBeVisible();
      expect((await popup.evaluate(() => chrome.downloads.search({}))).map(item => item.id)).toEqual(before.map(item => item.id));
      const stored = await popup.evaluate(() => chrome.storage.local.get(null));
      expect(stored.appToken).toBeUndefined();
      const records = Object.entries(stored).filter(([key]) => key.startsWith('snagthis:browser-download:'));
      expect(records.length).toBeGreaterThanOrEqual(2);
      for (const [, record] of records) {
        expect(Object.keys(record).sort()).toEqual(['downloadId', 'durationSeconds', 'height', 'pageKey', 'sourceKey', 'title']);
        expect(record.sourceKey).toMatch(/^[a-f0-9]{64}$/);
        expect(record.pageKey).toMatch(/^[a-f0-9]{64}$/);
      }
      const persistentText = JSON.stringify(stored);
      expect(persistentText).not.toContain('fixture-private-');
      expect(persistentText).not.toContain(fixture.baseUrl);
      expect(persistentText).not.toMatch(/"(?:url|requestHeaders|headers|cookie|authorization|filename)"\s*:/i);
      evidence.hlsRequiresDesktop = true;
      evidence.safePersistedBrowserRecords = records.length;
    });
    evidence.completed = true;
  } finally {
    fs.writeFileSync(path.join(evidencePath, 'result.json'), JSON.stringify({ ...evidence, transfers: fixture?.transfers }, null, 2) + '\n');
    const cleanup = await Promise.allSettled([context?.close(), fixture?.close()]);
    fs.rmSync(directory, { recursive: true, force: true });
    const errors = cleanup.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Chrome-only fixture cleanup failed');
  }
});
