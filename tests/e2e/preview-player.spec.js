const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startFixtureServer } = require('../fixtures/server');
const { root } = require('./helpers');

// The Cinema preview player (ui-design-spec §5.5) in the real extension: the popup's Preview opens it
// with a worker session, it plays the generated HLS fixture (1080/720/480 + WebVTT), and Snag it goes to
// a stub desktop bridge through the worker's download path.
test.describe.configure({ mode: 'serial' });
let fixture; let context; let worker; let extensionId; let profile; let stub;
const jobs = [];
const shots = process.env.PREVIEW_PLAYER_SHOTS || '';

test.beforeAll(async () => {
  test.setTimeout(90_000);
  fixture = await startFixtureServer();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client, X-Protocol-Version, X-Extension-Version');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/v1/health') { json(200, { status: 'ok', appVersion: '2.0.0', protocolVersion: '1', supportedProtocolVersions: { min: 1, max: 1 }, minExtensionVersion: '1.0.0', pairingRequired: false }); return; }
    if (req.headers.authorization !== 'Bearer fixture-token') { json(401, { error: 'Fixture token required' }); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    if (url.pathname === '/v1/queue') { json(200, { queue: [] }); return; }
    if (url.pathname === '/v1/jobs' && req.method === 'POST') { const payload = JSON.parse(body); jobs.push(payload); json(200, { ok: true, jobId: `fixture-job-${jobs.length}`, status: 'downloading' }); return; }
    json(404, { error: 'Fixture route not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  stub = { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-player-e2e-'));
  const extension = path.join(root, 'apps/extension');
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'] });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ appToken: 'fixture-token', appTokenVersion: 2, preferences: { preferredQuality: 'best', subtitleLanguage: 'none' } }));
});

test.afterAll(async () => { await context?.close(); await stub?.close(); await fixture?.close(); if (profile) fs.rmSync(profile, { recursive: true, force: true }); });

// Opens the fixture page, then Preview from the popup row's right-click menu, as a person would.
async function previewFromPopup() {
  const page = await context.newPage();
  await page.goto(`${fixture.baseUrl}/pages/variants.html`);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(stub.baseUrl)}`);
  const row = popup.locator('.video-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Choose quality' })).toBeVisible();
  await row.click({ button: 'right' });
  const opened = context.waitForEvent('page');
  await popup.getByRole('menuitem', { name: 'Preview', exact: true }).click();
  const player = await opened;
  await player.setViewportSize({ width: 1440, height: 900 });
  await popup.close();
  return { page, player };
}
const video = player => player.locator('#player');
const shot = async (player, name) => { if (shots) await player.screenshot({ path: path.join(shots, `preview-player-${name}.png`) }); };

test('Preview plays the real stream in the Cinema player with quality, captions, keyboard and Snag it', async () => {
  const { page, player } = await previewFromPopup();
  const errors = []; player.on('pageerror', error => errors.push(error.message));
  try {
    await expect(player).toHaveURL(/\/player\.html\?session=[\w-]+$/);
    await expect(player.locator('#source')).toHaveText('127.0.0.1');
    await expect(player.locator('#kind')).toHaveText('HLS stream');
    // Real playback: decoded frames and a moving playhead.
    await expect.poll(() => video(player).evaluate(element => element.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.5);
    expect(await video(player).evaluate(element => element.videoWidth)).toBeGreaterThan(0);
    await expect(player.locator('#player-root')).not.toHaveClass(/is-loading/);
    expect(await video(player).evaluate(element => element.controls)).toBe(false);

    // Snag it shows the popup row's default (Best) quality and the bridge it will use.
    const snag = player.locator('.pl-top .pl-snag');
    await expect(snag).toContainText('Snag it');
    await expect(snag.locator('.pl-snag-meta')).toHaveText(/^1080p( · about .+)?$/);
    await expect(player.locator('.pl-under')).toHaveText('Downloads with SnagThis');

    // Controls hide after stillness while playing and return on movement.
    await player.mouse.move(700, 400);
    await expect(player.locator('#player-root')).not.toHaveClass(/is-idle/);
    await shot(player, 'playing');
    await expect(player.locator('#player-root')).toHaveClass(/is-idle/, { timeout: 5000 });
    await player.mouse.move(720, 420);
    await expect(player.locator('#player-root')).not.toHaveClass(/is-idle/);

    // Quality: Auto plus the stream's levels, highest first; choosing 480p really switches renditions.
    const qualityButton = player.getByRole('button', { name: /^Quality, / });
    await qualityButton.click();
    const items = player.locator('#menu-quality [role="menuitemradio"]');
    await expect(items).toHaveText([/^Auto/, /^1080p/, /^720p/, /^480p/]);
    await expect(items.first()).toBeFocused();
    await expect(player.locator('#qualityFoot')).toHaveText('Snag it saves the quality you pick.');
    await player.mouse.move(1100, 600);
    await shot(player, 'menu-open');
    await player.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await player.keyboard.press('Enter');
    await expect(player.locator('#menu-quality')).toBeHidden();
    await expect(qualityButton).toBeFocused();
    await expect.poll(() => video(player).evaluate(element => element.videoHeight), { timeout: 20_000 }).toBe(480);
    await expect(snag.locator('.pl-snag-meta')).toHaveText(/^480p/);

    // Captions from the WebVTT rendition, drawn above the bar.
    await player.keyboard.press('Escape');
    await player.locator('body').press('c');
    await player.locator('body').press('2');
    await expect(player.locator('#cues')).toHaveText(/^SnagThis fixture: (first|second) half$/, { timeout: 15_000 }).catch(async error => {
      error.message += `\nTracks: ${JSON.stringify(await video(player).evaluate(element => ({ time: element.currentTime, paused: element.paused, ended: element.ended, tracks: [...element.textTracks].map(track => ({ kind: track.kind, mode: track.mode, cues: track.cues?.length, active: track.activeCues?.length })) })))}`;
      throw error;
    });
    await expect(player.getByRole('button', { name: 'Audio and subtitles (C)' })).toHaveAttribute('aria-pressed', 'true');

    // Keyboard: K pauses, digits jump, J/L and arrows seek, M mutes, ? lists shortcuts.
    await player.locator('body').press('k');
    await expect.poll(() => video(player).evaluate(element => element.paused)).toBe(true);
    await expect(player.locator('#player-root')).toHaveClass(/is-paused/);
    await player.locator('body').press('5');
    await expect.poll(() => video(player).evaluate(element => Math.round(element.currentTime))).toBe(5);
    await player.locator('body').press('ArrowLeft');
    await expect.poll(() => video(player).evaluate(element => Math.round(element.currentTime))).toBe(0);
    await player.locator('body').press('l');
    await expect.poll(() => video(player).evaluate(element => element.currentTime)).toBeGreaterThan(9);
    await player.locator('body').press('3');
    await player.locator('body').press('m');
    await expect.poll(() => video(player).evaluate(element => element.muted)).toBe(true);
    await player.locator('body').press('m');
    await player.locator('body').press('?');
    await expect(player.getByRole('dialog', { name: 'Keyboard' })).toBeVisible();
    await player.keyboard.press('Escape');
    await expect(player.getByRole('dialog', { name: 'Keyboard' })).toBeHidden();
    await expect(player.locator('#player-root')).not.toHaveClass(/is-idle/);
    await player.waitForTimeout(2600);
    await expect(player.locator('#player-root')).not.toHaveClass(/is-idle/, { timeout: 100 });
    await shot(player, 'paused');

    // The scrub bar is a labelled slider.
    const scrub = player.getByRole('slider', { name: 'Seek' });
    await expect(scrub).toHaveAttribute('aria-valuetext', /^0:03 of 0:10$/);
    await scrub.focus();
    await player.keyboard.press('End');
    await expect.poll(() => video(player).evaluate(element => element.currentTime)).toBeGreaterThan(9);

    // Details drawer.
    await player.locator('body').press('i');
    await expect(player.locator('#info')).toContainText('Site127.0.0.1');
    await expect(player.locator('#info')).toContainText('Quality480p');
    await player.keyboard.press('Escape');

    // Snag it: the picked 480p rendition goes to SnagThis through the worker.
    await snag.click();
    await expect(player.locator('#toast')).toHaveText(/^Sent to SnagThis · 480p/);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].mediaUrl).toBe(`${fixture.baseUrl}/media/master.m3u8`);
    expect(jobs[0].mediaType).toBe('hls');
    expect(jobs[0].selection.variantUrl).toBe(`${fixture.baseUrl}/media/480/index.m3u8`);
    expect(errors).toEqual([]);
  } finally { await player.close(); await page.close(); }
});

test('without a connection Snag it shows the popup\'s guidance inline and sends nothing', async () => {
  await worker.evaluate(() => chrome.storage.local.remove(['appToken', 'appTokenVersion']));
  const { page, player } = await previewFromPopup();
  try {
    await expect.poll(() => video(player).evaluate(element => element.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
    await expect(player.locator('.pl-under')).toHaveText('Needs SnagThis for desktop');
    await player.locator('.pl-top .pl-snag').click();
    const guide = player.getByRole('region', { name: 'SnagThis for desktop' });
    await expect(guide).toContainText('Connect SnagThis desktop for streams and more.');
    await expect(guide.getByRole('button', { name: 'Connect' })).toBeFocused();
    await player.keyboard.press('Escape');
    await expect(guide).toBeHidden();
    await expect(player.locator('.pl-top .pl-snag')).toBeFocused();
    expect(jobs).toHaveLength(1);
  } finally {
    await player.close(); await page.close();
    await worker.evaluate(() => chrome.storage.local.set({ appToken: 'fixture-token', appTokenVersion: 2 }));
  }
});

test('reduced motion keeps every control and the auto-hide, without transitions', async () => {
  const { page, player } = await previewFromPopup();
  try {
    await player.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => video(player).evaluate(element => element.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
    expect(await player.locator('.pl-dock').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
    await player.mouse.move(600, 300);
    await expect(player.locator('#player-root')).toHaveClass(/is-idle/, { timeout: 5000 });
  } finally { await player.close(); await page.close(); }
});
