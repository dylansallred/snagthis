const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { startRenderer, launchDesktop } = require('./helpers');
const { startFixtureServer } = require('../fixtures/server');
const { probeFile } = require('../fixtures/engine');

test('real Electron: paste, pause/resume, save, persist, and remove from list safely', async () => {
  test.setTimeout(150_000);
  const fixture = await startFixtureServer();
  fs.mkdirSync(fixture.directory + '/saved');
  const renderer = await startRenderer();
  let native;
  try {
    native = await launchDesktop(renderer.baseUrl);
    let window = await native.app.firstWindow();
    await expect(window.getByPlaceholder('Paste a video link')).toBeVisible();
    await expect.poll(() => window.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)).toBe('ready');
    const ipc = await window.evaluate(async () => ({ info: await window.desktop.getAppInfo(), settings: await window.desktop.getSettings(), updater: await window.desktop.getUpdaterState() }));
    expect(ipc.info.apiBaseUrl).toBe(native.baseUrl);
    expect(typeof ipc.updater.phase).toBe('string');
    expect(typeof ipc.settings.notifyOnComplete).toBe('boolean');
    await window.evaluate(async (folder) => window.desktop.saveSettings({ outputDirectory: folder, notifyOnComplete: false }), fixture.directory + '/saved');
    const paste = window.getByPlaceholder('Paste a video link');
    await paste.fill(`${fixture.baseUrl}/cases/throttled/direct.mp4`);
    await paste.press('Enter');
    const row = window.locator('.video-row').first();
    await expect(row.getByRole('button', { name: /^Pause:/ })).toBeVisible();
    await row.getByRole('button', { name: /^Pause:/ }).click();
    await expect(row).toContainText('Paused at');
    await row.getByRole('button', { name: /^Resume download:/ }).click();
    await expect(row.getByRole('button', { name: /^Play:/ })).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('Saved');
    const history = await window.evaluate(async () => {
      const info = await window.desktop.getAppInfo();
      const response = await fetch(info.apiBaseUrl + '/api/history', { headers: info.apiAuthToken ? { Authorization: `Bearer ${info.apiAuthToken}` } : {} });
      return response.json();
    });
    const item = history.items[0];
    expect(item).toBeTruthy();
    const filePath = item.absolutePath;
    const metadata = await probeFile(filePath);
    expect(metadata.height).toBe(1080);
    expect(metadata.hasAudio).toBe(true);
    expect(Math.abs(metadata.durationSeconds - 10)).toBeLessThanOrEqual(1);
    const profile = native.profile;
    await native.app.close();
    native = await launchDesktop(renderer.baseUrl, { userDataDirectory: profile });
    window = await native.app.firstWindow();
    await expect(window.locator('.video-row')).toHaveCount(1);
    await expect(window.locator('.video-row')).toContainText('Saved');
    await window.locator('.video-row').click();
    await window.getByRole('button', { name: 'Remove…', exact: true }).click();
    await window.getByRole('button', { name: /^Remove from list/ }).click();
    await expect(window.locator('.video-row')).toHaveCount(0);
    expect(fs.existsSync(filePath)).toBe(true);
  } finally { await native?.close(); await renderer.close(); await fixture.close(); }
});
