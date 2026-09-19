const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startFixtureServer } = require('../fixtures/server');
const { freePort, root } = require('./helpers');

test.describe.configure({ mode: 'serial' });
let fixture;
let context;
let worker;
let extensionId;
let profile;
let stub;
const state = { jobs: [], settings: { preferredQuality: 'best', subtitleLanguage: 'none', notifyOnComplete: true, launchAtLogin: false }, opened: [], minExtensionVersion: '1.0.0' };

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
    if (req.headers.authorization !== 'Bearer fixture-token') { json(401, { error: 'Fixture token required' }); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    if (url.pathname === '/v1/queue') { json(200, { queue: state.jobs, settings: { maxConcurrent: 1, autoStart: true } }); return; }
    if (url.pathname === '/v1/settings') {
      Object.assign(state.settings, payload);
      json(200, { ...state.settings, settings: state.settings }); return;
    }
    if (url.pathname === '/v1/jobs' && req.method === 'POST') {
      const job = { id: `fixture-job-${state.jobs.length + 1}`, title: payload.title, url: payload.mediaUrl, mediaType: payload.mediaType, queueStatus: 'downloading', status: 'downloading', progress: 34, etaSeconds: 300, thumbnailUrls: [payload.thumbnailUrl || `${fixture.baseUrl}/media/poster.jpg`], bytesDownloaded: 714_000_000, totalBytes: 2_100_000_000 };
      state.jobs.push(job); json(200, { ok: true, jobId: job.id, id: job.id, status: 'downloading' }); return;
    }
    const match = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/(pause|resume|open)$/);
    if (match) {
      const job = state.jobs.find((item) => item.id === match[1]);
      if (!job) { json(404, { error: 'Unknown job' }); return; }
      if (match[2] === 'open') state.opened.push(job.id);
      else { job.queueStatus = match[2] === 'pause' ? 'paused' : 'downloading'; job.status = job.queueStatus; }
      json(200, { ok: true, job }); return;
    }
    if (url.pathname === '/v1/app/focus') { json(200, { ok: true }); return; }
    json(404, { error: 'Fixture route not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  stub = { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-popup-e2e-'));
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

test('actual popup: poster, Download → Pause → reopen → Saved → Play', async () => {
  const fixturePage = await openFixture('poster');
  let popup = fixturePage.popup;
  try {
    const row = () => popup.locator('.video-row').first();
    await expect(row().getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    await expect(row().locator('.thumb img').first()).toHaveAttribute('src', /poster\.jpg/);
    await row().getByRole('button', { name: 'Download', exact: true }).click();
    await expect(row()).toContainText('34%');
    await expect(row().locator('.thumb')).toHaveCSS('--p', '34%');
    await row().getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(row()).toContainText('Paused at 34%');
    const popupUrl = popup.url();
    await popup.close();
    popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(row()).toContainText('Paused at 34%');
    expect(state.jobs).toHaveLength(1);
    await row().getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(row()).toContainText('34%');
    Object.assign(state.jobs[0], { queueStatus: 'completed', status: 'completed', progress: 100 });
    await expect(row()).toContainText('Saved');
    await row().getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(() => state.opened.length).toBe(1);
    await popup.screenshot({ path: test.info().outputPath('popup-saved.png') });
  } finally { await popup.close(); await fixturePage.page.close(); }
});

test('offline popup disables download and shows the specified recovery banner', async () => {
  const opened = await openFixture('direct', `http://127.0.0.1:${await freePort()}`);
  try {
    await expect(opened.popup.getByText("VidSnag isn't open, so downloads can't start.", { exact: true })).toBeVisible();
    await expect(opened.popup.locator('#video-list')).toHaveAttribute('inert', '');
    await expect(opened.popup.locator('.video-row')).toHaveCount(1);
  } finally { await opened.popup.close(); await opened.page.close(); }
});

test('master variants collapse, unrelated videos remain separate, SPA clears detections', async () => {
  const master = await openFixture('variants');
  try {
    await expect(master.popup.locator('.video-row')).toHaveCount(1);
    await expect(master.popup.getByRole('button', { name: 'Choose quality', exact: true })).toBeVisible();
    const media = await master.popup.evaluate((tabId) => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), master.tabId);
    expect(media.items[0].variants).toHaveLength(3);
  } finally { await master.popup.close(); await master.page.close(); }
  const two = await openFixture('two');
  try { await expect(two.popup.locator('.video-row')).toHaveCount(2); } finally { await two.popup.close(); await two.page.close(); }
  const spa = await openFixture('spa');
  try {
    await expect(spa.popup.locator('.video-row')).toHaveCount(1);
    await spa.page.locator('#navigate').click();
    await expect.poll(async () => (await spa.popup.evaluate((tabId) => chrome.runtime.sendMessage({ cmd: 'GET_TAB_MEDIA', tabId }), spa.tabId)).items.length).toBe(0);
  } finally { await spa.popup.close(); await spa.page.close(); }
});
