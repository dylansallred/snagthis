const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { startRenderer } = require('./e2e/helpers');
process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
process.env.LOG_LEVEL = 'error';
const { createApiServer } = require('../packages/downloader-api/src');

test('desktop paste keeps resolved titles, quality and source metadata, and explains pages without a video', { timeout: 35000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-paste-'));
  const renderer = await startRenderer();
  const source = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html><h1>Movie fixture</h1></html>');
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${source.address().port}`;
  const originalFetch = global.fetch;
  global.fetch = (input, init) => String(input).startsWith('https://www.youtube.com/oembed?')
    ? Promise.resolve(new Response(JSON.stringify({ title: 'A real title, not video', thumbnail_url: 'https://i.ytimg.com/vi/example/hqdefault.jpg' }), { headers: { 'Content-Type': 'application/json' } }))
    : originalFetch(input, init);
  const api = createApiServer({ dataDir: directory, port: 0, allowedOrigins: [renderer.baseUrl],
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true,
    // The fixture source server is on 127.0.0.1, which the desktop refuses to inspect.
    inspectPrivateAddresses: true,
    initialQueueSettings: { autoStart: false },
    onResolvePage: async ({ url }) => {
      if (url.endsWith('/empty')) throw new Error('No player');
      return { title: 'Thor: Love and Thunder', mediaUrl: `${fixtureUrl}/master.m3u8`, sourcePageUrl: url,
        mediaType: 'hls', headers: { Referer: url, Origin: fixtureUrl },
        manifestText: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n720.m3u8\n' };
    } });
  const address = await api.start();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await api.stop(); await renderer.close();
    source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
    global.fetch = originalFetch;
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.addInitScript(({ baseUrl, token }) => {
    window.desktop = {
      getAppInfo: async () => ({ apiBaseUrl: baseUrl, apiAuthToken: token, apiStartupState: 'ready', extensionConnected: true, version: 'test' }),
      getSettings: async () => ({ queueAutoStart: false, fileNaming: 'title', subtitleLanguage: 'en' }),
      getUpdaterState: async () => ({ phase: 'idle', progress: 0 }),
      onAppInfoUpdate: () => () => {}, onUpdaterEvent: () => () => {}, onOpenSettings: () => () => {},
    };
  }, { baseUrl: `http://127.0.0.1:${address.port}`, token: api.getAuthToken() });
  const submissions = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/jobs')) submissions.push(request.postDataJSON().queue); });
  await page.goto(renderer.baseUrl);
  const paste = page.getByRole('textbox', { name: 'Paste a video link' });
  const submit = async (url) => { await paste.fill(url); await paste.press('Enter'); };

  const youtubeUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
  await submit(youtubeUrl);
  await page.getByText('A real title, not video', { exact: true }).waitFor();
  assert.equal(api.getState().queue[0].title, 'A real title, not video');
  assert.equal(submissions[0].url, youtubeUrl, 'keep the watch URL for yt-dlp');

  await submit(`${fixtureUrl}/watch`);
  await page.locator('label.quality-option').filter({ hasText: '720p' }).click();
  assert.equal(await page.getByRole('radio', { name: '720p' }).isChecked(), true);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByText('Thor: Love and Thunder', { exact: true }).waitFor();
  const movie = api.getState().queue.find(job => job.title === 'Thor: Love and Thunder');
  assert.equal(submissions[1].url, `${fixtureUrl}/master.m3u8`);
  assert.equal(movie.mediaType, 'hls');
  assert.equal(movie.selection.variantUrl, `${fixtureUrl}/720.m3u8`);
  assert.equal(movie.selection.subtitleLang, 'none', 'a preferred language must not request a nonexistent HLS subtitle track');
  assert.equal(movie.sourcePageUrl, `${fixtureUrl}/watch`);
  assert.equal(submissions[1].selection.height, 720);
  assert.equal(submissions[1].selection.variantUrl, `${fixtureUrl}/720.m3u8`);
  assert.equal(submissions[1].headers.Referer || submissions[1].headers.referer, `${fixtureUrl}/watch`);
  assert.ok(api.getState().queue.every(job => job.queueStatus === 'queued'));

  await submit(`${fixtureUrl}/empty`);
  await page.getByText('Could not find a video automatically. Open this page in Chrome, press play, then choose it in SnagThis.', { exact: true }).waitFor();
  assert.equal(api.getState().queue.length, 2, 'unsupported pages must not create a doomed download');
});
