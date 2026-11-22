const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { startFixtureServer } = require('../fixtures/server');

const extension = path.resolve(__dirname, '../../apps/extension');

// The popup's Preview opens player.html with a worker session. Load the shipped
// page with only chrome.runtime stubbed; media requests never leave the test.
async function openPlayer(page, session, mediaOrigin) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const html = fs.readFileSync(path.join(extension, 'player.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const pageUrl = `${mediaOrigin || 'https://player.test'}/player.html?session=fixture-session`;
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url === pageUrl) return route.fulfill({ contentType: 'text/html', body: html });
    return new URL(url).origin === mediaOrigin ? route.continue() : route.abort();
  });
  await page.goto(pageUrl);
  await page.evaluate(value => {
    window.chrome = { runtime: { sendMessage: async message => (message.cmd === 'GET_STREAM_SESSION' ? { ok: true, session: value } : { ok: false }) } };
  }, session);
  await page.addScriptTag({ content: fs.readFileSync(path.join(extension, 'vendor/hls.min.js'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(extension, 'player.js'), 'utf8') });
  await expect(page.locator('#title')).toHaveText(session.title);
  return errors;
}

test('the preview page shows no diagnostics, source URLs, header names or dead buttons', async ({ page }) => {
  const errors = await openPlayer(page, {
    title: 'Fixture movie', declaredType: 'hls', credentialed: true,
    sourceUrl: 'https://media.example/movie/master.m3u8?token=signed-secret',
    sourcePageUrl: 'https://video.example/watch/123',
    requestHeaders: { Authorization: 'Bearer media-session', 'X-Custom-Token': 'token-value' },
  });
  await expect(page.locator('#source')).toHaveText('video.example');
  await expect(page.locator('#debugLog, pre')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /fallback/i })).toHaveCount(0);
  await expect(page.locator('button:disabled')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open page' })).toBeVisible();
  await expect(page.locator('#status')).not.toHaveText(/Preparing/);
  const text = await page.locator('body').innerText();
  for (const secret of ['signed-secret', 'media.example', 'master.m3u8', 'X-Custom-Token', 'Authorization', 'forwardedHeaderKeys']) {
    expect(text).not.toContain(secret);
  }
  expect(errors).toEqual([]);
});

test('a DASH preview says to open the page instead of failing to load', async ({ page }) => {
  const errors = await openPlayer(page, {
    title: 'Fixture DASH', declaredType: 'dash', credentialed: false,
    sourceUrl: 'https://media.example/movie/manifest.mpd', sourcePageUrl: 'https://video.example/watch/9', requestHeaders: {},
  });
  await expect(page.locator('#status')).toHaveText('This video can only be previewed on its page. Open the page to play it.');
  expect(await page.locator('video').getAttribute('src')).toBeNull();
  expect(errors).toEqual([]);
});

test('the HLS preview plays video and loads its WebVTT captions', async ({ page }) => {
  const fixture = await startFixtureServer();
  try {
    const errors = await openPlayer(page, {
      title: 'Captioned fixture', declaredType: 'hls', credentialed: false,
      sourceUrl: `${fixture.baseUrl}/media/master.m3u8`,
    }, fixture.baseUrl);
    const video = page.locator('video');
    await video.evaluate(element => { element.muted = true; });
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0);
    await expect.poll(() => video.evaluate(element => element.textTracks.length)).toBe(1);
    await video.evaluate(element => { element.textTracks[0].mode = 'showing'; });
    await expect.poll(() => video.evaluate(element => element.textTracks[0].cues?.[0]?.text))
      .toBe('SnagThis fixture: first half');
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
