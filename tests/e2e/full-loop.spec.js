const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { root, startRenderer, launchDesktop } = require('./helpers');
const { startFixtureServer } = require('../fixtures/server');
const { probeFile } = require('../fixtures/engine');

test('full loop: actual Chrome pairing and 480p selection → Electron → playable saved video', async () => {
  test.setTimeout(150_000);
  const fixture = await startFixtureServer();
  const renderer = await startRenderer();
  const browserProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-full-loop-browser-'));
  const outputDirectory = path.join(fixture.directory, 'saved-videos');
  fs.mkdirSync(outputDirectory);
  let native;
  let context;
  try {
    native = await launchDesktop(renderer.baseUrl);
    const desktop = await native.app.firstWindow();
    await desktop.waitForFunction(() => typeof window.desktop?.getAppInfo === 'function');
    await expect.poll(() => desktop.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)).toBe('ready');
    await desktop.evaluate((folder) => window.desktop.saveSettings({ outputDirectory: folder, notifyOnComplete: false, queueMaxConcurrent: 1, queueAutoStart: true }), outputDirectory);

    // Use the actual product pairing flow; no test bearer token or fake API.
    await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
    await desktop.locator('summary').filter({ hasText: 'Advanced' }).click();
    await desktop.getByRole('button', { name: 'Connect Chrome', exact: true }).click();
    const code = (await desktop.getByLabel('Connection code', { exact: true }).textContent()).trim();
    expect(code).toMatch(/^\d{6}$/);

    const extensionPath = path.join(root, 'apps/extension');
    context = await chromium.launchPersistentContext(browserProfile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--autoplay-policy=no-user-gesture-required'],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const source = await context.newPage();
    await source.goto(`${fixture.baseUrl}/pages/variants.html`);
    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, source.url());
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(native.baseUrl)}`);
    await popup.locator('#connection-banner').getByRole('button', { name: 'Connect', exact: true }).click();
    await popup.getByLabel('Connection code', { exact: true }).fill(code);
    await popup.locator('#sheet').getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(popup.locator('#connection-banner')).toBeHidden();
    await expect.poll(() => desktop.evaluate(async () => (await window.desktop.getConnectionState()).extensionConnected)).toBe(true);
    await desktop.getByRole('button', { name: 'Close settings', exact: true }).click();

    await expect(popup.locator('.video-row')).toHaveCount(1);
    await popup.getByRole('button', { name: 'Choose quality', exact: true }).click();
    await popup.getByRole('menuitemradio', { name: /^480p/ }).click();
    await expect(popup.locator('.row-status')).toContainText('480p');
    await popup.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(desktop.locator('.video-row')).toHaveCount(1);
    await expect(desktop.locator('.video-row').getByRole('button', { name: /^Play:/ })).toBeVisible({ timeout: 60_000 });
    await expect(popup.locator('.row-status')).toHaveText('Saved');
    await expect(popup.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    const history = await desktop.evaluate(async () => {
      const info = await window.desktop.getAppInfo();
      return (await fetch(`${info.apiBaseUrl}/api/history`, { headers: { Authorization: `Bearer ${info.apiAuthToken}` } })).json();
    });
    expect(history.items).toHaveLength(1);
    const saved = history.items[0];
    expect(path.resolve(saved.absolutePath).startsWith(outputDirectory + path.sep)).toBe(true);
    const metadata = await probeFile(saved.absolutePath);
    expect(metadata.format).toContain('mp4');
    expect(metadata.height).toBe(480);
    expect(metadata.hasAudio).toBe(true);
    expect(Math.abs(metadata.durationSeconds - 10)).toBeLessThanOrEqual(1);
    await desktop.screenshot({ path: test.info().outputPath('full-loop-desktop-saved.png') });
    await popup.screenshot({ path: test.info().outputPath('full-loop-popup-saved.png') });
  } finally {
    await context?.close();
    await native?.close();
    await renderer.close();
    await fixture.close();
    fs.rmSync(browserProfile, { recursive: true, force: true });
  }
});
