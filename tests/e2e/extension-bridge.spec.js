const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startFixtureServer, runTool } = require('../fixtures/server');
const { freePort, root } = require('./helpers');

test.describe.configure({ mode: 'serial' });
let fixture;
let context;
let worker;
let extensionId;
let profile;
let stub;
const state = { jobs: [], nextJobId: 0, settings: { preferredQuality: 'best', subtitleLanguage: 'none', notifyOnComplete: true, launchAtLogin: false }, opened: [], previewRequests: 0, minExtensionVersion: '1.0.0' };
const clipSignature = 'a'.repeat(64);

test.beforeAll(async () => {
  test.setTimeout(90_000);
  fixture = await startFixtureServer();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client, X-Protocol-Version, X-Extension-Version');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/v1/health') { json(200, { status: 'ok', appVersion: '2.0.0', apiVersion: '1', protocolVersion: '1', supportedProtocolVersions: { min: 1, max: 1 }, minExtensionVersion: state.minExtensionVersion, pairingRequired: false }); return; }
    if (url.pathname === '/downloads/__previews/fixture.mp4') {
      if (url.searchParams.get('signature') !== clipSignature) { json(403, { error: 'Signed clip required' }); return; }
      const bytes = fs.readFileSync(path.join(fixture.directory, 'media/direct.mp4'));
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length }); res.end(bytes); return;
    }
    if (url.pathname === '/downloads/fixture-video-frame.jpg') {
      if (url.searchParams.get('signature') !== clipSignature) { json(403, { error: 'Signed poster required' }); return; }
      const bytes = fs.readFileSync(path.join(fixture.directory, 'media/poster.jpg'));
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length }); res.end(bytes); return;
    }
    if (req.headers.authorization !== 'Bearer fixture-token') { json(401, { error: 'Fixture token required' }); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    if (url.pathname === '/v1/queue') { json(200, { queue: state.jobs, settings: { maxConcurrent: 1, autoStart: true } }); return; }
    const jobLookup = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobLookup && req.method === 'GET') {
      const job = state.jobs.find((item) => item.id === jobLookup[1]);
      json(job ? 200 : 404, job || { error: 'Job not found' }); return;
    }
    if (url.pathname === '/v1/settings') {
      Object.assign(state.settings, payload);
      json(200, { ...state.settings, settings: state.settings }); return;
    }
    if (url.pathname === '/v1/jobs' && req.method === 'POST') {
      const job = { id: `fixture-job-${++state.nextJobId}`, title: payload.title, url: payload.mediaUrl, mediaType: payload.mediaType, queueStatus: 'downloading', status: 'downloading', progress: 34, etaSeconds: 300, thumbnailUrls: [payload.thumbnailUrl || `${fixture.baseUrl}/media/poster.jpg`], bytesDownloaded: 714_000_000, totalBytes: 2_100_000_000 };
      state.jobs.push(job); json(200, { ok: true, jobId: job.id, id: job.id, status: 'downloading' }); return;
    }
    const match = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/(pause|resume|open|preview)$/);
    if (match) {
      const job = state.jobs.find((item) => item.id === match[1]);
      if (!job) { json(404, { error: 'Unknown job' }); return; }
      if (match[2] === 'preview') {
        state.previewRequests += 1;
        job.previewClipUrl = `/downloads/__previews/fixture.mp4?expires=${Date.now() + 600000}&signature=${clipSignature}`;
        job.previewClipDurationSeconds = 10;
        job.thumbnailUrls = [`/downloads/fixture-video-frame.jpg?expires=${Date.now() + 600000}&signature=${clipSignature}`];
        json(200, { status: 'ready', previewClipUrl: job.previewClipUrl, previewClipDurationSeconds: 10 }); return;
      }
      if (match[2] === 'open') state.opened.push(job.id);
      else { job.queueStatus = match[2] === 'pause' ? 'paused' : 'downloading'; job.status = job.queueStatus; }
      json(200, { ok: true, job }); return;
    }
    if (url.pathname === '/v1/app/focus') { json(200, { ok: true }); return; }
    json(404, { error: 'Fixture route not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  stub = { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-popup-e2e-'));
  const extension = path.join(root, 'apps/extension');
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'] });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ appToken: 'fixture-token', preferences: { preferredQuality: 'best', subtitleLanguage: 'none', notifyOnComplete: true, launchAtLogin: false } }));
});

test.afterAll(async () => { await context?.close(); await stub?.close(); await fixture?.close(); if (profile) fs.rmSync(profile, { recursive: true, force: true }); });

async function openFixture(kind, apiBase = stub.baseUrl) {
  const page = await context.newPage();
  await page.goto(`${fixture.baseUrl}/pages/${kind}.html`);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(apiBase)}`);
  return { page, popup, tabId };
}

async function downloadWithDesktop(popup, row) {
  // Direct files default to Chrome. These bridge scenarios explicitly exercise
  // the desktop queue through the same contextual action offered to users.
  await expect(popup.locator('#video-list')).not.toHaveClass(/unavailable/);
  await row.click({ button: 'right' });
  await popup.getByRole('toolbar').getByRole('button', { name: 'Download with desktop', exact: true }).click();
  // The actions drawer slides shut before the row's geometry is checked.
  await expect(row.locator('.row-drawer')).toHaveCount(0);
}

test('trailer and movie stay separate, sizes stay truthful, and wider metadata fits one line', async () => {
  const page = await context.newPage();
  let popup;
  try {
    await page.route('**/pages/metadata-replay.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>The End of Oak Street</title>' }));
    await page.goto(`${fixture.baseUrl}/pages/metadata-replay.html`);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
    const urls = { trailer: `${fixture.baseUrl}/media/observed-trailer.mp4`, movie: `${fixture.baseUrl}/media/observed-movie.m3u8`,
      master: `${fixture.baseUrl}/media/observed-master.m3u8`, poster: `${fixture.baseUrl}/media/poster.jpg` };
    // Replay the observed site sequence: a direct 142-second trailer, followed
    // by a 5984-second blob player backed by a bitrate-free media playlist.
    const discovered = await worker.evaluate(async ({ tabId, urls }) => {
      const tab = await chrome.tabs.get(tabId);
      const sender = { id: chrome.runtime.id, tab, frameId: 0, url: tab.url };
      const send = (cmd, data) => globalThis.handleMessage({ cmd, ...data }, sender);
      await send('PAGE_CONTEXT', { context: { mediaSourceUrl: urls.trailer, sourcePageTitle: 'The End of Oak Street',
        durationSeconds: 142.142, height: 1080, thumbnailUrl: urls.poster } });
      await send('STORE_DETECTED_MEDIA', { media: { url: urls.trailer, contentType: 'video/mp4', contentLength: 92_000_000 } });
      await send('STORE_DETECTED_MEDIA', { media: { url: urls.movie, contentType: 'application/vnd.apple.mpegurl', contentLength: 153873,
        manifestText: '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:2992.302,\npart-1.ts\n#EXTINF:2992.302,\npart-2.ts\n#EXT-X-ENDLIST\n' } });
      await send('PAGE_CONTEXT', { context: { mediaSourceUrl: 'blob:', sourcePageTitle: 'The End of Oak Street',
        durationSeconds: 5984.604000000061, height: 1080, thumbnailUrl: `${urls.poster}?movie` } });
      // Later response headers must not assign the movie's metadata to the trailer.
      await send('STORE_DETECTED_MEDIA', { media: { url: urls.trailer, contentType: 'video/mp4' } });
      await send('STORE_DETECTED_MEDIA', { media: { url: urls.movie, contentType: 'application/vnd.apple.mpegurl', contentLength: 153873 } });
      return globalThis.handleMessage({ cmd: 'GET_TAB_MEDIA', tabId }, { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') });
    }, { tabId, urls });
    expect(discovered.items).toHaveLength(2);
    const trailer = discovered.items.find(item => item.url === urls.trailer);
    const movie = discovered.items.find(item => item.url === urls.movie);
    expect(trailer.durationSeconds).toBe(142.142);
    expect(trailer.thumbnailUrl).toBe(urls.poster);
    expect(movie.durationSeconds).toBeCloseTo(5984.604, 3);
    expect(movie.thumbnailUrl).toBe(`${urls.poster}?movie`);
    expect(movie.height).toBe(1080);
    expect(movie.variants.length).toBeLessThanOrEqual(1);

    popup = await context.newPage();
    const errors = [];
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(stub.baseUrl)}`);
    await expect(popup.locator('.video-row')).toHaveCount(2);
    const trailerRow = popup.locator(`[data-row-key="${trailer.id}"]`);
    const movieRow = popup.locator(`[data-row-key="${movie.id}"]`);
    await expect(trailerRow.locator('.row-status')).toContainText('92 MB');
    await expect(trailerRow.locator('.row-duration')).toHaveText('2:22');
    await expect(movieRow.locator('.row-status')).toContainText('N/A');
    await expect(movieRow.locator('.row-duration')).toHaveText('1:39:44');
    await expect(popup.getByRole('button', { name: 'Choose quality' })).toHaveCount(0);
    expect(await popup.locator('#popup').evaluate(node => node.getBoundingClientRect().width)).toBe(480);
    for (const row of [trailerRow, movieRow]) {
      expect(await row.locator('.row-meta').evaluate(node => {
        // The status wrapper uses display:contents; measure its visible badge.
        const status = node.querySelector('.quality-mark').getBoundingClientRect();
        const duration = node.querySelector('.row-duration').getBoundingClientRect();
        return duration.top < status.bottom && duration.bottom > status.top && node.scrollWidth <= node.clientWidth;
      })).toBe(true);
    }

    // A later master explicitly links the same movie. Its bitrate plus the
    // observed child duration is enough for an estimate, without fetching media.
    await worker.evaluate(async ({ tabId, urls }) => {
      const tab = await chrome.tabs.get(tabId);
      await globalThis.handleMessage({ cmd: 'STORE_DETECTED_MEDIA', media: { url: urls.master, contentType: 'application/vnd.apple.mpegurl',
        manifestText: `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080\n${urls.movie}\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n720.m3u8\n` } },
      { id: chrome.runtime.id, tab, frameId: 0, url: tab.url });
    }, { tabId, urls });
    await popup.reload();
    await expect(popup.locator('.video-row')).toHaveCount(2);
    const quality = popup.getByRole('button', { name: 'Choose quality' });
    await expect(quality).toHaveCount(1);
    await expect(popup.locator('.row-status', { has: quality })).toContainText('about');
    await quality.click();
    await expect(popup.getByRole('radio')).toHaveCount(2);
    await expect(popup.getByRole('radio').first()).toContainText('1080p');
    await expect(popup.getByRole('radio').first()).toContainText('about');
    await expect(popup.getByRole('radio').last()).toContainText('720p');
    expect(errors).toEqual([]);
    await popup.screenshot({ path: 'test-results/extension-metadata-regression.png' });
  } finally { await popup?.close(); await page.close(); }
});

test('longest first with real previews for large MP4 and page-context-protected HLS', async () => {
  const directory = path.join(fixture.directory, 'media/preview-context');
  fs.mkdirSync(directory, { recursive: true });
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '2', '-i', path.join(fixture.directory, 'media/direct.mp4'),
    '-t', '30', '-c', 'copy', '-movflags', '+faststart', path.join(directory, 'direct.mp4')]);
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '1', '-i', path.join(directory, 'direct.mp4'),
    '-t', '60', '-c', 'copy', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', 'segment-%02d.m4s', 'index.m3u8'], { cwd: directory });
  expect(fs.statSync(path.join(directory, 'direct.mp4')).size).toBeGreaterThan(8 * 1024 * 1024);
  const page = await context.newPage();
  let popup;
  try {
    await page.route('**/pages/preview-context.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Movie and trailer</title>' }));
    await page.goto(`${fixture.baseUrl}/pages/preview-context.html`);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    await worker.evaluate(async ({ tabId, base }) => {
      const tab = await chrome.tabs.get(tabId);
      // Replay Chrome's own network observation: only that path may carry the
      // request context (page messages are untrusted hints without headers).
      for (const [name, duration, contentType] of [['direct.mp4', 30, 'video/mp4'], ['index.m3u8', 60, 'application/vnd.apple.mpegurl']]) {
        await globalThis.storeMedia(tabId, { url: `${base}/cases/preview-context/${name}`, durationSeconds: duration,
          contentType, height: 1080, sourcePageTitle: 'Movie and trailer', requestHeaders: { Referer: `${base}/`, ...(name.endsWith('m3u8') ? { Origin: base } : {}) } },
        0, tab.url, { fromNetwork: true, outermost: true });
      }
    }, { tabId, base: fixture.baseUrl });
    popup = await context.newPage();
    const failures = [];
    popup.on('pageerror', error => failures.push(error.message));
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(`http://127.0.0.1:${await freePort()}`)}`);
    const rows = popup.locator('.video-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('.row-duration')).toHaveText('1:00');
    await expect(rows.last().locator('.row-duration')).toHaveText('0:30');
    for (const row of [rows.first(), rows.last()]) {
      await expect(row.locator('img.thumb-poster')).toHaveAttribute('src', /^data:image\/jpeg;base64,/, { timeout: 20000 });
      await expect.poll(() => row.locator('img.thumb-poster').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      expect(await row.locator('img.thumb-poster').evaluate(image => {
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 18;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 32, 18);
        return window.SnagThisSourcePreview.nonblack(ctx.getImageData(0, 0, 32, 18).data);
      })).toBe(true);
    }
    for (const row of [rows.first(), rows.last()]) {
      await row.hover();
      const video = row.locator('video.thumb-preview');
      await expect(video).toBeVisible({ timeout: 15000 });
      await expect.poll(() => video.evaluate(v => v.videoWidth > 0 && !v.paused && v.readyState >= 2)).toBe(true);
      const initial = await video.evaluate(v => v.currentTime);
      await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(initial + .2);
      const loopEnd = await video.evaluate(v => {
        const start = v.closest('.video-row').sourceSceneStart;
        const end = Math.min(start + 10, v.buffered.end(0) - .05);
        v.currentTime = end - .1;
        return end;
      });
      await expect.poll(() => video.evaluate(v => v.currentTime)).toBeLessThan(loopEnd - .5);
      const playing = await video.elementHandle();
      await popup.locator('.popup-header').hover();
      await expect(video).toHaveCount(0);
      expect(await playing.evaluate(v => v.paused && !v.getAttribute('src'))).toBe(true);
    }
    const directRequests = fixture.requests.filter(r => r.pathname === '/cases/preview-context/direct.mp4');
    expect(directRequests.filter(r => r.range === 'bytes=0-2097151').length).toBeGreaterThan(0);
    expect(directRequests.filter(r => r.range === 'bytes=0-8388607').length).toBeGreaterThan(0);
    expect(directRequests.every(r => ['bytes=0-2097151', 'bytes=0-8388607'].includes(r.range))).toBe(true);
    expect(failures).toEqual([]);
    await popup.screenshot({ path: test.info().outputPath('movie-and-trailer-previews.png') });
  } finally { await popup?.close(); await page.close(); }
  await expect.poll(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).filter(r => r.id >= 2400000 && r.id < 2400016).length)).toBe(0);
});

test('actual popup: clean looping preview, Download with desktop → Pause → reopen → Saved → Play', async () => {
  const fixturePage = await openFixture('poster');
  let popup = fixturePage.popup;
  try {
    const row = () => popup.locator('.video-row').first();
    const download = row().getByRole('button', { name: 'Download', exact: true });
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('data-tip', 'Download');
    await expect(download).toHaveText('');
    await expect(download.locator('svg')).toHaveCount(1);
    await expect(download).toHaveClass(/primary icon-only/);
    await expect(download).toHaveCSS('width', '30px');
    await expect(row().locator('.row-title-line .row-duration')).toHaveCount(0);
    await expect(row().locator('.row-meta .row-duration')).toHaveText(/\d+:\d{2}/);
    await expect(row().locator('.thumb')).toHaveCSS('width', '128px');
    expect(await row().evaluate(node => Math.abs(node.querySelector('.thumb').getBoundingClientRect().height - node.clientHeight) < 1)).toBe(true);
    await expect(row().locator('.progress-pieces')).toBeHidden();
    const initialPoster = row().locator('.thumb-poster');
    await expect(initialPoster).toHaveAttribute('src', /(?:^data:image\/jpeg;base64,|\/media\/poster\.jpg$)/);
    await expect.poll(() => initialPoster.evaluate(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)).toBe(true);
    await downloadWithDesktop(popup, row());
    await expect(row()).toContainText('34%');
    await expect(row().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '34');
    await expect(row()).toHaveAttribute('data-progress', '34');
    await expect(row()).toHaveAttribute('data-progress-active', 'true');
    await expect(row().locator('.row-fill, .progress-edge')).toHaveCount(0);
    await expect(row().locator('.progress-pieces')).toBeVisible();
    await expect(row().locator('.progress-piece')).toHaveCount(40);
    await expect(row().locator('.progress-piece.done')).toHaveCount(13);
    await expect(row().locator('.progress-piece.current')).toHaveCount(1);
    expect(await row().locator('.progress-piece.current').evaluate(node => getComputedStyle(node, '::after').animationName)).toBe('piece-working');
    expect(await row().evaluate(node => {
      const lane = node.querySelector('.progress-pieces').getBoundingClientRect();
      const thumb = node.querySelector('.thumb').getBoundingClientRect();
      const body = node.querySelector('.row-body').getBoundingClientRect();
      const action = node.querySelector(':scope > .action').getBoundingClientRect();
      return lane.top > Math.max(body.bottom, action.bottom) && Math.abs(lane.left - body.left) < 1 && Math.abs(lane.right - action.right) < 1 && Math.abs(thumb.height - node.clientHeight) < 1;
    })).toBe(true);
    await expect(row().locator('.thumb .ghost, .thumb .live, .thumb .edge, .thumb .duration, .thumb .preview-hint')).toHaveCount(0);
    await expect(row().locator('.thumb-poster')).toHaveCSS('filter', 'none');
    await expect(row().locator('.row-meta .row-duration')).toHaveText(/\d+:\d{2}/);
    const clip = () => row().locator('video.thumb-preview');
    await row().hover();
    await expect(clip()).toBeVisible();
    await expect(row().locator('.thumb-poster')).toHaveAttribute('src', new RegExp(`^${stub.baseUrl.replaceAll('.', '\\.')}\/downloads\/fixture-video-frame\\.jpg\\?`));
    await expect.poll(() => row().locator('.thumb-poster').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await expect(clip()).toHaveJSProperty('muted', true);
    await expect.poll(() => clip().evaluate(video => video.currentTime)).toBeGreaterThan(0.2);
    await clip().evaluate(video => { video.currentTime = video.duration - 0.15; });
    await expect.poll(() => clip().evaluate(video => video.currentTime < video.duration - 0.5)).toBe(true);
    const playingVideo = await clip().elementHandle();
    await popup.getByRole('button', { name: 'Settings', exact: true }).focus();
    await popup.locator('.popup-header').hover();
    await expect(clip()).toHaveCount(0);
    expect(await playingVideo.evaluate(video => video.paused)).toBe(true);
    await row().getByRole('button', { name: 'Pause', exact: true }).focus();
    await expect.poll(() => clip().evaluate(video => video.currentTime)).toBeGreaterThan(0.2);
    await popup.getByRole('button', { name: 'Settings', exact: true }).focus();
    await expect(clip()).toHaveCount(0);
    await popup.emulateMedia({ reducedMotion: 'reduce' });
    await expect(row().locator('.progress-pieces')).toBeVisible();
    await expect(row().locator('.progress-piece.done')).toHaveCount(13);
    expect(await row().locator('.progress-piece.current').evaluate(node => getComputedStyle(node, '::after').animationName)).toBe('none');
    const previewRequests = state.previewRequests;
    await row().hover();
    await expect(clip()).toHaveCount(0);
    expect(state.previewRequests).toBe(previewRequests);
    await popup.emulateMedia({ reducedMotion: 'no-preference' });
    await row().getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(row()).toContainText('Paused at 34%');
    await expect(row()).toHaveAttribute('data-progress-active', 'false');
    await expect(row().locator('.progress-pieces')).toBeVisible();
    await expect(row().locator('.progress-piece.done')).toHaveCount(13);
    await expect(row().locator('.progress-pieces')).toHaveCSS('opacity', '0.62');
    expect(await row().locator('.progress-piece.current').evaluate(node => getComputedStyle(node, '::after').animationName)).toBe('none');
    const popupUrl = popup.url();
    await popup.close();
    popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(row()).toContainText('Paused at 34%');
    expect(state.jobs).toHaveLength(1);
    await row().getByRole('button', { name: 'Resume download', exact: true }).click();
    await expect(row()).toContainText('34%');
    Object.assign(state.jobs[0], { queueStatus: 'completed', status: 'completed', progress: 100 });
    await expect(row()).toContainText('Saved');
    await expect(row().locator('.progress-pieces')).toBeHidden();
    await row().getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => state.opened.length).toBe(1);
    await popup.screenshot({ path: test.info().outputPath('popup-saved.png') });
  } finally { await popup.close(); await fixturePage.page.close(); }
});

test('cancelled and removed desktop downloads stay visible in the popup and can be downloaded again', async () => {
  const opened = await openFixture('direct');
  const { popup } = opened;
  try {
    const row = popup.locator('.video-row');
    await downloadWithDesktop(popup, row);
    await expect(row).toHaveAttribute('data-state', 'downloading');
    const cancelled = state.jobs.at(-1);
    Object.assign(cancelled, { queueStatus: 'cancelled', status: 'cancelled' });
    await expect(popup.locator('#page-count')).toHaveText('1 video on this page');
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    await downloadWithDesktop(popup, row);
    await expect(row).toHaveAttribute('data-state', 'downloading');
    const replacement = state.jobs.at(-1);
    expect(replacement.id).not.toBe(cancelled.id);
    const count = state.jobs.length;
    const repeatDownload = () => popup.evaluate(async ({ tabId, apiBase }) => {
      const media = await chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId });
      return chrome.runtime.sendMessage({ cmd: 'DOWNLOAD_MEDIA', backend: 'desktop', tabId, mediaId: media.items[0].id, apiBase, payload: { mediaUrl: media.items[0].url, title: 'Fixture video' } });
    }, { tabId: opened.tabId, apiBase: stub.baseUrl });
    expect((await repeatDownload()).jobId).toBe(replacement.id);
    Object.assign(replacement, { queueStatus: 'completed', status: 'completed', progress: 100 });
    expect((await repeatDownload()).jobId).toBe(replacement.id);
    expect(state.jobs).toHaveLength(count);
    state.jobs = state.jobs.filter(job => job.id !== replacement.id);
    await expect(row.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    await downloadWithDesktop(popup, row);
    await expect(row).toHaveAttribute('data-state', 'downloading');
    expect(state.jobs.at(-1).id).not.toBe(replacement.id);
    await expect(popup.locator('#page-count')).toHaveText('1 video on this page');
    await expect(row).toHaveCount(1);
  } finally { await popup.close(); await opened.page.close(); }
});

test('popup prepares a verified poster without hover and keeps it across reopen', async () => {
  const pageUrl = `${fixture.baseUrl}/pages/generic-poster.html`;
  const largePlaylistUrl = `${fixture.baseUrl}/media/480/index.m3u8`;
  const largePlaylist = fs.readFileSync(path.join(fixture.directory, 'media/480/index.m3u8'), 'utf8') + '# proxy metadata\n'.repeat(70_000);
  expect(Buffer.byteLength(largePlaylist)).toBeGreaterThan(1024 * 1024);
  await context.route(largePlaylistUrl, route => route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: largePlaylist }));
  await context.route(pageUrl, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Thor — movie fixture</title><meta property="og:image" content="${fixture.baseUrl}/media/poster.jpg"><meta name="twitter:image" content="${fixture.baseUrl}/media/poster.jpg"></head><body><h1>Thor — movie fixture</h1><script>fetch('/media/master.m3u8').then(response => response.text());</script></body></html>` }));
  const page = await context.newPage(); await page.goto(pageUrl);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, pageUrl);
  const opened = { page, tabId };
  let popup = await context.newPage();
  await popup.addInitScript(() => {
    window.posterProbePlays = 0;
    document.addEventListener('loadedmetadata', event => { if (event.target.classList?.contains('poster-probe')) window.posterProbe = event.target; }, true);
    document.addEventListener('play', event => { if (event.target.classList?.contains('poster-probe')) window.posterProbePlays++; }, true);
  });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(`http://127.0.0.1:${await freePort()}`)}`);
  try {
    const row = () => popup.locator('.video-row').first();
    await expect(row()).toBeVisible();
    await expect(popup.getByText('Save supported files in Chrome. Open SnagThis for streams and more.', { exact: true })).toBeVisible();
    const initial = await popup.evaluate(tabId => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), opened.tabId);
    expect(initial.items[0].thumbnailUrl || '').toBe('');
    await expect(row().locator('img.thumb-poster')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(row().locator('video')).toHaveCount(0);
    expect(await popup.evaluate(() => window.posterProbePlays)).toBe(0);
    expect(await popup.evaluate(() => window.posterProbe.paused && !window.posterProbe.isConnected && !window.posterProbe.getAttribute('src'))).toBe(true);
    const poster = await row().locator('img.thumb-poster').getAttribute('src');
    expect(poster.length).toBeLessThanOrEqual(20480);
    expect(await row().locator('img.thumb-poster').evaluate(image => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 18;
      const drawing = canvas.getContext('2d'); drawing.drawImage(image, 0, 0, 32, 18);
      return SnagThisSourcePreview.nonblack(drawing.getImageData(0, 0, 32, 18).data);
    })).toBe(true);
    await expect.poll(() => popup.evaluate(async tabId => (await chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId })).items[0].sourcePreviewPoster, opened.tabId)).toBe(poster);
    const enriched = await popup.evaluate(async tabId => (await chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId })).items[0], opened.tabId);
    expect(enriched.durationSeconds).toBeCloseTo(10, 1);
    expect(enriched.variants.find(variant => variant.height === 1080)).toMatchObject({ sizeBytes: 5_000_000, sizeEstimated: true });
    await expect(row().locator('.row-duration-meta')).toContainText('0:10');
    const sceneStart = await popup.evaluate(async tabId => (await chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId })).items[0].sourcePreviewSceneStart, opened.tabId);
    expect(sceneStart).toBeGreaterThan(3); expect(sceneStart).toBeLessThan(4);
    await popup.screenshot({ path: test.info().outputPath('popup-automatic-poster.png') });
    const popupUrl = popup.url();
    await popup.close();
    popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(row().locator('img.thumb-poster')).toHaveAttribute('src', poster);
    await expect.poll(() => row().locator('img.thumb-poster').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(row().locator('video.thumb-preview')).toHaveCount(0);
    const quality = row().getByRole('button', { name: 'Choose quality', exact: true });
    await expect(quality).toContainText('1080p');
    await expect(popup.locator('#popup')).toHaveCSS('transform', 'none');
    const closedBounds = await quality.boundingBox();
    await quality.click();
    await expect(quality).toHaveAttribute('aria-expanded', 'true');
    expect(await quality.boundingBox()).toEqual(closedBounds);
    await popup.screenshot({ path: test.info().outputPath('popup-quality-drawer.png') });
    await popup.getByRole('radio', { name: /720p/ }).click();
    await expect(quality).toContainText('720p');
    // With more than one line of choices (here, subtitles too) the drawer stays open until Esc.
    await expect(quality).toHaveAttribute('aria-expanded', 'true');
    await popup.keyboard.press('Escape');
    await expect(quality).toHaveAttribute('aria-expanded', 'false');
    await expect(quality).toBeFocused();
    await row().hover();
    await expect.poll(() => row().locator('video.thumb-preview').evaluate(video => video.currentTime)).toBeGreaterThan(sceneStart + .2);
    await popup.getByRole('button', { name: 'Settings', exact: true }).focus();
    await popup.locator('.popup-header').hover();
    await expect(row().locator('video')).toHaveCount(0);
    // A delayed old popup cannot attach that frame to the next page visit.
    await opened.page.reload();
    await expect.poll(() => popup.evaluate(async tabId => (await chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId })).visit, opened.tabId)).not.toBe(initial.visit);
    const stale = await popup.evaluate(message => chrome.runtime.sendMessage(message), { cmd: 'STORE_MEDIA_PREVIEW_POSTER', tabId: opened.tabId, mediaId: initial.items[0].id, mediaUrl: initial.items[0].url, visit: initial.visit, poster, sceneStart: 0 });
    expect(stale).toMatchObject({ ok: false, ignored: true });
    const staleMetadata = await popup.evaluate(message => chrome.runtime.sendMessage(message), { cmd: 'STORE_MEDIA_PREVIEW_METADATA', tabId: opened.tabId, mediaId: initial.items[0].id, mediaUrl: initial.items[0].url, visit: initial.visit, durationSeconds: 9999 });
    expect(staleMetadata).toMatchObject({ ok: false, ignored: true });
    await expect.poll(() => popup.evaluate(async tabId => (await chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId })).items[0]?.id, opened.tabId)).not.toBe(initial.items[0].id);
  } finally { await popup.close(); await opened.page.close(); await context.unroute(pageUrl); await context.unroute(largePlaylistUrl); }
});

test('offline popup previews direct and HLS sources before any desktop job exists', async () => {
  const jobCount = state.jobs.length;
  const apiBase = `http://127.0.0.1:${await freePort()}`;
  const blackDirectory = path.join(fixture.directory, 'media/black-preview');
  fs.mkdirSync(blackDirectory, { recursive: true });
  await runTool(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '40',
    '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,25)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-g', '12', '-an',
    '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(blackDirectory, 'segment-%02d.ts'), path.join(blackDirectory, 'index.m3u8')]);
  for (const kind of ['direct', 'variants', 'black-preview']) {
    const opened = await openFixture(kind, apiBase);
    const { popup } = opened;
    let mediaRequests = 0;
    const mediaPaths = [];
    popup.on('request', request => { if (request.url().startsWith(fixture.baseUrl)) { mediaRequests++; mediaPaths.push(new URL(request.url()).pathname); } });
    try {
      await expect(popup.getByText('Save supported files in Chrome. Open SnagThis for streams and more.', { exact: true })).toBeVisible();
      await expect(popup.locator('#video-list')).not.toHaveAttribute('inert', '');
      const row = popup.locator('.video-row'); const video = row.locator('video.thumb-preview');
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('button', { name: kind === 'direct' ? 'Download' : 'Use desktop app', exact: true })).toBeEnabled();
      if (kind === 'black-preview') await popup.evaluate(() => {
        window.previewEvents = [];
        for (const type of ['loadedmetadata', 'loadeddata', 'timeupdate', 'seeked', 'playing', 'waiting', 'pause', 'error']) document.addEventListener(type, event => {
          const element = event.target;
          if (element instanceof HTMLVideoElement) window.previewEvents.push({ event: type, time: element.currentTime, paused: element.paused, ready: element.readyState, buffered: Array.from({ length: element.buffered.length }, (_, index) => [element.buffered.start(index), element.buffered.end(index)]) });
          if (window.previewEvents.length > 80) window.previewEvents.shift();
        }, true);
      });
      await row.hover();
      await expect(video).toBeVisible({ timeout: 15000 }).catch(async error => {
        const playback = await video.evaluateAll(elements => elements.map(element => ({ currentTime: element.currentTime, duration: element.duration, readyState: element.readyState, paused: element.paused, ended: element.ended, error: element.error?.message, width: element.videoWidth, height: element.videoHeight, thumbClass: element.parentElement.className, poster: element.parentElement.querySelector('.thumb-poster')?.getAttribute('src')?.slice(0, 80) })));
        error.message += `\nPreview fixture: ${kind}; playback: ${JSON.stringify(playback)}; requests: ${JSON.stringify(mediaPaths)}; events: ${JSON.stringify(await popup.evaluate(() => window.previewEvents))}`;
        throw error;
      });
      await expect(video).toHaveJSProperty('muted', true);
      await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(.2);
      await expect(row.locator('.thumb-poster')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
      // hls.js loads once, and only for a stream preview; a direct file never pulls it in.
      expect(await popup.evaluate(() => ({ loaded: typeof window.Hls === 'function', scripts: document.querySelectorAll('script[src="vendor/hls.min.js"]').length })))
        .toEqual(kind === 'direct' ? { loaded: false, scripts: 0 } : { loaded: true, scripts: 1 });
      if (kind === 'black-preview') expect(await video.evaluate(element => element.currentTime)).toBeGreaterThanOrEqual(25);
      await expect(row.locator('.thumb')).toHaveText('');
      const scene = await video.evaluate(element => { const start = element.closest('.video-row').sourceSceneStart; return { start, end: Math.min(element.duration, start + 10) }; });
      await expect.poll(() => video.evaluate((element, selected) => Array.from({ length: element.buffered.length }, (_, index) => element.buffered.start(index) <= selected.start + .1 && element.buffered.end(index) >= selected.end - .2).some(Boolean), scene)).toBe(true);
      await video.evaluate((element, selected) => { element.currentTime = selected.end - .1; }, scene);
      await expect.poll(() => video.evaluate((element, selected) => element.currentTime < selected.end - .5, scene)).toBe(true).catch(async error => {
        error.message += `\nLoop fixture: ${kind}; scene: ${JSON.stringify(scene)}; events: ${JSON.stringify(await popup.evaluate(() => window.previewEvents))}; playback: ${JSON.stringify(await video.evaluateAll(elements => elements.map(element => ({ time: element.currentTime, duration: element.duration, paused: element.paused, seeking: element.seeking, ready: element.readyState, buffered: Array.from({ length: element.buffered.length }, (_, index) => [element.buffered.start(index), element.buffered.end(index)]) }))))}`;
        throw error;
      });
      const playing = await video.elementHandle();
      await popup.locator('.popup-header').hover();
      await expect(video).toHaveCount(0);
      expect(await playing.evaluate(element => element.paused)).toBe(true);
      await row.focus();
      await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(.2);
      await popup.emulateMedia({ reducedMotion: 'reduce' });
      await expect(video).toHaveCount(0);
      const stoppedRequests = mediaRequests;
      await row.hover();
      await expect(video).toHaveCount(0);
      expect(mediaRequests).toBe(stoppedRequests);
      expect(state.jobs).toHaveLength(jobCount);
    } finally { await popup.close(); await opened.page.close(); }
  }
});

test('quality drawer opens inside the row without moving the row or header, grows the popup by itself only, and selection applies', async () => {
  const opened = await openFixture('variants');
  const { popup } = opened;
  try {
    const quality = popup.getByRole('button', { name: 'Choose quality', exact: true });
    await expect(quality).toBeVisible();
    await expect(quality.locator('.resolution')).toHaveText('1080p');
    await popup.evaluate(() => document.fonts.ready);
    await expect(popup.locator('#popup')).toHaveCSS('transform', 'none');
    const initialSize = await popup.locator('#popup').boundingBox();
    // Match Chrome's compact popup viewport so overflowing drawer content cannot hide in a full tab.
    await popup.setViewportSize({ width: 480, height: Math.ceil(initialSize.height) });
    const geometry = () => popup.evaluate(() => ({
      boxes: Object.fromEntries(['html', 'body', '#popup', '.popup-header', '.video-row', '.thumb', '.row-body', '.row-title', '.row-meta', '.popup-footer'].map(selector => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return [selector, { x, y, width, height }];
      })),
      viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, x: scrollX, y: scrollY },
    }));
    const settled = () => popup.waitForFunction(() => [...document.querySelectorAll('.row-drawer')].every(node => !node.getAnimations().length));
    const before = await geometry();
    const fixed = value => Object.fromEntries(['.popup-header', '.thumb', '.row-body', '.row-title', '.row-meta'].map(selector => [selector, value.boxes[selector]]));
    await quality.click();
    const drawer = popup.getByRole('group', { name: /^Quality for / });
    await expect(drawer).toBeVisible();
    await expect(popup.locator('#menu')).toBeHidden();
    await settled();
    // The popup grows by the drawer alone (Chrome resizes its window to fit): no 300px floor, nothing overlaid.
    const grown = await popup.locator('#popup').boundingBox();
    const box = await popup.locator('.row-drawer').boundingBox();
    expect(Math.abs(grown.height - initialSize.height - box.height)).toBeLessThanOrEqual(1);
    await popup.setViewportSize({ width: 480, height: Math.ceil(grown.height) });
    expect(fixed(await geometry())).toEqual(fixed(before));
    const row = before.boxes['.video-row'];
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(row.y + row.height - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(480);
    expect(box.y + box.height).toBeLessThanOrEqual((await popup.locator('.popup-footer').boundingBox()).y);
    await popup.screenshot({ path: test.info().outputPath('popup-quality-drawer.png') });
    await drawer.getByRole('radio', { name: /^720p/ }).click();
    await expect(quality.locator('.resolution')).toHaveText('720p');
    await expect(drawer.getByRole('radio', { name: /^720p/ })).toHaveAttribute('aria-checked', 'true');
    // This fixture also offers audio or subtitles, so the drawer stays open for them until Esc.
    await popup.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(quality).toHaveAttribute('aria-expanded', 'false');
    await expect(quality).toBeFocused();
    await quality.blur();
    await settled();
    await popup.setViewportSize({ width: 480, height: Math.ceil(initialSize.height) });
    expect(await geometry()).toEqual(before);
  } finally { await popup.close(); await opened.page.close(); }
});

test('master variants collapse, unrelated videos remain separate, SPA clears detections', async () => {
  const master = await openFixture('variants');
  try {
    await expect(master.popup.locator('.video-row')).toHaveCount(1);
    await expect(master.popup.getByRole('button', { name: 'Choose quality', exact: true })).toBeVisible();
    // Quality, size and duration each draw a 3px separator before themselves; a separator
    // that would start a line falls in the list's clipped 13px strip.
    const metadataItems = master.popup.locator('.row-meta .meta-item:visible');
    await expect(metadataItems).toHaveCount(3);
    for (const item of await metadataItems.all()) {
      expect(await item.evaluate(node => { const dot = getComputedStyle(node, '::before'); return [dot.content, dot.width, dot.height]; })).toEqual(['""', '3px', '3px']);
    }
    expect(await master.popup.locator('.row-meta').evaluate(node => {
      const left = node.getBoundingClientRect().left; const clip = left + 13;
      return [...node.querySelectorAll('.meta-item')].filter(item => item.offsetParent).every(item => {
        const start = item.getBoundingClientRect().left;
        return Math.abs(start - left) < 1 ? start + 8 <= clip : start + 5 >= clip;
      });
    })).toBe(true);
    await expect(master.popup.locator('.row-meta')).toHaveCSS('row-gap', '4px');
    await expect(master.popup.locator('.thumb')).toHaveCSS('width', '128px');
    expect(await master.popup.locator('.video-row').evaluate(node => Math.abs(node.querySelector('.thumb').getBoundingClientRect().height - node.clientHeight) < 1)).toBe(true);
    await expect(master.popup.locator('.video-row')).toHaveCSS('min-height', '96px');
    await master.popup.screenshot({ path: test.info().outputPath('popup-metadata.png') });
    const media = await master.popup.evaluate((tabId) => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), master.tabId);
    expect(media.items[0].variants).toHaveLength(3);
  } finally { await master.popup.close(); await master.page.close(); }
  const two = await openFixture('two');
  try { await expect(two.popup.locator('.video-row')).toHaveCount(2); } finally { await two.popup.close(); await two.page.close(); }
  const embedded = await openFixture('nested');
  try {
    await expect(embedded.popup.locator('.video-row')).toHaveCount(1);
    // A child frame's captured URL differs from its tab URL. Its actual
    // manifest body must still reach the worker through the content script.
    await expect.poll(async () => (await embedded.popup.evaluate((tabId) => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), embedded.tabId)).items[0]?.manifest?.durationSeconds || 0).toBeGreaterThan(0);
  } finally { await embedded.popup.close(); await embedded.page.close(); }
  const spa = await openFixture('spa');
  try {
    await expect(spa.popup.locator('.video-row')).toHaveCount(1);
    const sourcePageUrl = spa.page.url();
    const previous = await spa.popup.evaluate((tabId) => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), spa.tabId);
    await spa.page.locator('#navigate').click();
    await expect(spa.page).toHaveURL(`${sourcePageUrl}?next=1`);
    // Deterministically deliver an observation captured before pushState after
    // Chrome has updated the tab URL. Document ID and sender.url stay unchanged.
    const late = await worker.evaluate(async ({ tabId, sourcePageUrl, url }) => {
      const tab = await chrome.tabs.get(tabId);
      const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
      const sender = { id: chrome.runtime.id, tab, frameId: 0, documentId: frame.documentId, url: sourcePageUrl };
      return globalThis.handleMessage({ cmd: 'STORE_DETECTED_MEDIA', media: { url, sourcePageUrl, contentType: 'video/mp4' } }, sender);
    }, { tabId: spa.tabId, sourcePageUrl, url: previous.items[0].url });
    expect(late).toMatchObject({ ok: true, ignored: true });
    await expect.poll(async () => (await spa.popup.evaluate((tabId) => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), spa.tabId)).items.length).toBe(0);
    const nextMediaUrl = `${fixture.baseUrl}/media/second.mp4`;
    await spa.page.locator('video').evaluate((video, url) => { video.src = url; video.play().catch(() => {}); }, nextMediaUrl);
    await expect.poll(async () => (await spa.popup.evaluate((tabId) => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), spa.tabId)).items.map(item => item.mediaSourceUrl)).toEqual([nextMediaUrl]);
  } finally { await spa.popup.close(); await spa.page.close(); }
});
