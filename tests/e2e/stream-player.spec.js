const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const extension = path.resolve(__dirname, '../../apps/extension');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

// The popup's Preview opens player.html with a worker session. Serve the shipped extension files
// (popup.css is built by build:extension:css) with only chrome.runtime stubbed. Media answers 403,
// the way a site refuses a preview that is not its own page.
async function openPlayer(page, session, { snag = null } = {}) {
  const errors = [];
  const sent = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://player.test') {
      const file = path.join(extension, decodeURIComponent(url.pathname));
      if (!file.startsWith(extension) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    }
    if (url.hostname === 'media.example') return route.fulfill({ status: 403, body: 'Forbidden' });
    return route.abort();
  });
  await page.exposeFunction('recordMessage', message => { sent.push(message); });
  await page.addInitScript(({ value, offer }) => {
    window.chrome = { runtime: { id: 'fixture', sendMessage: async message => {
      window.recordMessage(message);
      if (message.cmd === 'GET_STREAM_SESSION') return value ? { ok: true, session: value, snag: offer } : { ok: false };
      if (message.cmd === 'PREVIEW_DESKTOP_STATE') return { ok: true, state: 'unpaired' };
      return { ok: false };
    } } };
  }, { value: session, offer: snag });
  await page.goto('https://player.test/player.html?session=fixture-session');
  if (session) await expect(page.locator('#title')).toHaveText(session.title);
  return { errors, sent };
}

test('the preview page shows no diagnostics, source URLs, header names or dead buttons', async ({ page }) => {
  const { errors } = await openPlayer(page, {
    title: 'Fixture movie', declaredType: 'hls', credentialed: true,
    sourceUrl: 'https://media.example/movie/master.m3u8?token=signed-secret',
    sourcePageUrl: 'https://video.example/watch/123',
    requestHeaders: { Authorization: 'Bearer media-session', 'X-Custom-Token': 'token-value' },
  });
  await expect(page.locator('#source')).toHaveText('video.example');
  await expect(page.locator('#kind')).toHaveText('HLS stream');
  // The site refuses the playlist: one card, the page's name, and only actions that work.
  await expect(page.getByRole('heading', { name: 'This video plays only on its page' })).toBeVisible();
  await expect(page.locator('#failBody')).toHaveText("video.example wouldn't let the preview load it here. You can still watch it on the page or try again.");
  await expect(page.locator('#debugLog, pre')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /fallback/i })).toHaveCount(0);
  await expect(page.locator('button:disabled')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open page' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Snag it anyway' })).toBeHidden();
  const text = await page.locator('body').innerText();
  for (const secret of ['signed-secret', 'media.example', 'master.m3u8', 'X-Custom-Token', 'Authorization', 'forwardedHeaderKeys']) {
    expect(text).not.toContain(secret);
  }
  expect(errors).toEqual([]);
});

test('a DASH preview says to open the page instead of failing to load, and never fetches hls.js', async ({ page }) => {
  const scripts = [];
  page.on('request', request => { if (request.url().endsWith('.js')) scripts.push(new URL(request.url()).pathname); });
  const { errors } = await openPlayer(page, {
    title: 'Fixture DASH', declaredType: 'dash', credentialed: false,
    sourceUrl: 'https://media.example/movie/manifest.mpd', sourcePageUrl: 'https://video.example/watch/9', requestHeaders: {},
  });
  await expect(page.locator('#status')).toHaveText('This video can only be previewed on its page. Open the page to play it.');
  await expect(page.getByRole('heading', { name: 'This video plays only on its page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
  expect(await page.locator('video').getAttribute('src')).toBeNull();
  expect(scripts).not.toContain('/vendor/hls.min.js');
  expect(errors).toEqual([]);
});

test('an expired session shows the expiry card; a refused stream offers Snag it anyway when the row allows it', async ({ page, context }) => {
  const { errors } = await openPlayer(page, null);
  await expect(page.getByRole('heading', { name: 'This preview expired' })).toBeVisible();
  await expect(page.locator('#failBody')).toHaveText('Previews open for 10 minutes after you choose them. Choose Preview in SnagThis again to reload it.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
  expect(errors).toEqual([]);

  const other = await context.newPage();
  const snag = { backend: 'desktop', variantUrl: 'https://media.example/movie/1080.m3u8', height: 1080, sizeBytes: 4_300_000_000, sizeEstimated: true, variants: [] };
  const opened = await openPlayer(other, { title: 'Refused', declaredType: 'hls', credentialed: false, sourceUrl: 'https://media.example/movie/master.m3u8', sourcePageUrl: 'https://video.example/watch/1', requestHeaders: {} }, { snag });
  await expect(other.getByRole('button', { name: 'Snag it anyway' })).toBeVisible();
  await expect(other.locator('.pl-top .pl-snag')).toContainText('1080p · about 4.3 GB');
  // SnagThis is reachable but not connected: the popup's banner sentence, inline, and nothing is sent.
  await other.getByRole('button', { name: 'Snag it anyway' }).click();
  await expect(other.locator('#guide')).toContainText('Connect SnagThis desktop for streams and more.');
  await expect(other.locator('#guide').getByRole('button', { name: 'Connect' })).toBeFocused();
  expect(opened.sent.some(message => message.cmd === 'SNAG_STREAM_SESSION')).toBe(false);
  expect(opened.errors).toEqual([]);
});
