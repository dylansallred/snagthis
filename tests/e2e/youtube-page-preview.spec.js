const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTool } = require('../fixtures/server');
const { freePort, root } = require('./helpers');

test('offline YouTube hover records a quick loop, upgrades to a silent excerpt, and leaves the page player alone', async () => {
  test.setTimeout(75_000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-youtube-preview-'));
  const pageUrl = 'https://www.youtube.com/watch?v=abc123XYZ_-';
  const mediaUrl = 'https://www.youtube.com/snagthis-fixture.mp4';
  const posterUrl = 'https://i.ytimg.com/vi/abc123XYZ_-/hqdefault.jpg';
  const apiBase = `http://127.0.0.1:${await freePort()}`;
  let context;
  try {
    const sourceFile = path.join(directory, 'source.mp4');
    const posterFile = path.join(directory, 'poster.jpg');
    await runTool(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', sourceFile]);
    await runTool(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-i', sourceFile, '-frames:v', '1', '-vf', 'scale=320:180', posterFile]);
    const media = fs.readFileSync(sourceFile);
    const poster = fs.readFileSync(posterFile);
    const extension = path.join(root, 'apps/extension');
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    });
    const unexpectedRequests = [];
    const downloadRequests = [];
    context.on('request', request => {
      if (request.method() === 'POST' && /\/jobs(?:\/|$)/.test(new URL(request.url()).pathname)) downloadRequests.push(request.url());
    });
    // The real YouTube origin exercises the extension's site path, while every
    // page, image and media byte is local. No desktop API or download job exists.
    await context.route('**/*', async route => {
      const request = route.request(); const url = request.url();
      if (url === pageUrl) {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
          <title>Local moving video — YouTube</title><meta property="og:title" content="Local moving video">
          <meta property="og:image" content="${posterUrl}"></head><body>
          <h1>Local moving video</h1><div class="html5-video-player">
          <video id="source-video" class="html5-main-video" autoplay muted playsinline preload="auto"
            width="640" height="360" src="${mediaUrl}" poster="${posterUrl}"></video></div></body></html>` });
      } else if (url === mediaUrl) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
        await route.fulfill({ status: range ? 206 : 200, body: media.subarray(start, end + 1), headers: {
          'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
        } });
      } else if (url === posterUrl) {
        await route.fulfill({ contentType: 'image/jpeg', body: poster, headers: { 'Access-Control-Allow-Origin': '*' } });
      } else if (url === 'https://www.youtube.com/favicon.ico') {
        await route.fulfill({ status: 204 });
      } else if (url.startsWith('chrome-extension:')) {
        await route.continue();
      } else {
        if (!url.startsWith(apiBase + '/')) unexpectedRequests.push(url);
        await route.abort('connectionrefused');
      }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const source = await context.newPage();
    await source.goto(pageUrl);
    await expect.poll(() => source.locator('video').evaluate(video => !video.paused && video.currentTime > 0.2)).toBe(true);
    await source.evaluate(() => {
      const video = document.querySelector('video');
      window.playerEvents = [];
      window.initialPlayerTime = video.currentTime;
      for (const name of ['play', 'pause', 'seeking', 'seeked']) video.addEventListener(name, () => window.playerEvents.push(name));
    });
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, pageUrl);
    expect(Number.isInteger(tabId)).toBe(true);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(apiBase)}`);
    await popup.bringToFront();
    const row = popup.locator('.video-row');
    const clip = row.locator('video.thumb-preview');
    await expect(popup.getByText('Save supported files in Chrome. Open SnagThis for streams and more.', { exact: true })).toBeVisible();
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('button', { name: 'Use desktop app', exact: true })).toBeEnabled();
    await expect(row.locator('.thumb-poster')).toHaveAttribute('src', posterUrl);
    await expect.poll(() => row.locator('.thumb-poster').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await row.hover();
    await expect(clip).toHaveAttribute('data-preview-phase', 'quick', { timeout: 12_000 });
    await expect(clip).toBeVisible();
    await expect(clip).toHaveJSProperty('muted', true);
    await expect(clip).toHaveJSProperty('loop', true);
    await expect.poll(() => clip.evaluate(video => video.currentTime)).toBeGreaterThan(1);
    // Observe a natural wrap, without seeking either the source or its preview.
    await expect.poll(() => clip.evaluate(video => video.currentTime < 0.75)).toBe(true);
    await expect(clip).toHaveAttribute('data-preview-phase', 'full', { timeout: 15_000 });
    await expect.poll(() => clip.evaluate(video => video.currentTime)).toBeGreaterThan(0.2);
    await expect(row.locator('.thumb-poster')).toHaveAttribute('src', posterUrl);
    const requestId = (await clip.getAttribute('data-clip-key')).split(':')[1];
    const mediaId = await row.getAttribute('data-row-key');
    const playing = await clip.elementHandle();
    const recording = await clip.evaluate(async video => {
      const bytes = new Uint8Array(await (await fetch(video.src)).arrayBuffer());
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    const recordingFile = path.join(directory, 'full-preview.webm');
    fs.writeFileSync(recordingFile, Buffer.from(recording, 'base64'));
    // MediaRecorder may report an infinite HTML duration until the first end.
    // Packet timestamps verify the actual bounded recording instead.
    const probe = JSON.parse(await runTool(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height:packet=pts_time,duration_time', '-of', 'json', recordingFile]));
    expect(probe.streams).toEqual([expect.objectContaining({ codec_type: 'video', codec_name: 'vp8', width: 320, height: 180 })]);
    const times = probe.packets.map(packet => Number(packet.pts_time)).filter(Number.isFinite);
    const seconds = Math.max(...times) - Math.min(...times);
    expect(seconds).toBeGreaterThan(9);
    expect(seconds).toBeLessThan(11);
    expect(times.length / seconds).toBeGreaterThan(10);
    expect(times.length / seconds).toBeLessThan(14);
    expect(fs.statSync(recordingFile).size).toBeLessThan(1024 * 1024);
    expect(await source.evaluate(() => window.playerEvents)).toEqual([]);
    expect(await source.evaluate(() => document.querySelector('video').currentTime - window.initialPlayerTime)).toBeGreaterThan(9);

    await popup.locator('.popup-header').hover();
    await expect(clip).toHaveCount(0);
    expect(await playing.evaluate(video => video.paused && !video.hasAttribute('src'))).toBe(true);
    await expect.poll(() => popup.evaluate(async value => {
      const result = await chrome.runtime.sendMessage({ cmd: 'GET_PAGE_VIDEO_PREVIEW', phase: 'full', ...value });
      return { ok: result.ok, status: result.status, hasBytes: Boolean(result.sourcePreviewDataUrl) };
    }, { tabId, mediaId, requestId })).toEqual({ ok: false, status: 'unavailable', hasBytes: false });

    await source.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video.paused) await new Promise(resolve => { video.addEventListener('pause', resolve, { once: true }); video.pause(); });
      window.playerEvents.length = 0;
      window.pausedPlayerTime = video.currentTime;
    });
    await row.hover();
    await expect.poll(() => row.evaluate(node => node.sourcePreviewFailed)).toBe(true);
    await expect(clip).toHaveCount(0);
    await expect(row.locator('.thumb-poster')).toHaveAttribute('src', posterUrl);
    expect(await source.evaluate(() => ({ paused: document.querySelector('video').paused,
      unchanged: document.querySelector('video').currentTime === window.pausedPlayerTime, events: window.playerEvents })))
      .toEqual({ paused: true, unchanged: true, events: [] });
    const storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    expect(JSON.stringify(storage)).not.toMatch(/data:video\/|blob:|sourcePreviewDataUrl/);
    expect(storage.session[`snagthis:tab:${tabId}`].mappings).toEqual({});
    expect(downloadRequests).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  } finally {
    await context?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
