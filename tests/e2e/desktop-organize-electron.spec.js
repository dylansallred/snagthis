const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { startRenderer, launchDesktop } = require('./helpers');
const { startFixtureServer } = require('../fixtures/server');
const { probeFile } = require('../fixtures/engine');

test('real Electron: a downloaded video moves into a folder of the save folder and still plays', async () => {
  test.setTimeout(150_000);
  const fixture = await startFixtureServer();
  const saveDir = path.join(fixture.directory, 'organised');
  fs.mkdirSync(path.join(saveDir, 'Road trips'), { recursive: true });
  const renderer = await startRenderer();
  let native;
  try {
    native = await launchDesktop(renderer.baseUrl);
    const window = await native.app.firstWindow();
    await expect(window.getByPlaceholder('Paste a video link')).toBeVisible();
    // The development renderer may reload once while it prepares its modules; ask again after it does.
    await expect.poll(() => window.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState).catch(() => 'reloading'), { timeout: 30_000 }).toBe('ready');
    await expect(window.getByPlaceholder('Paste a video link')).toBeVisible();
    await window.evaluate(async (folder) => window.desktop.saveSettings({ outputDirectory: folder, notifyOnComplete: false }), saveDir);
    const paste = window.getByPlaceholder('Paste a video link');
    await paste.fill(`${fixture.baseUrl}/cases/plain/direct.mp4`);
    await paste.press('Enter');
    await expect(window.locator('.video-row').first().getByRole('button', { name: /^Play:/ })).toBeVisible({ timeout: 60_000 });

    // Saved is the save folder: the folder made outside the app is listed before the video.
    await window.locator('.list-tabs button[data-tab="saved"]').click();
    await expect(window.locator('.path-bar .crumb.current')).toHaveText('organised');
    const folder = window.locator('.saved-folder-row[data-folder="Road trips"]');
    await expect(folder).toContainText('Empty');
    const row = window.locator('.video-row[data-state="saved"]').first();
    await expect(row).toBeVisible();
    const before = await window.evaluate(async () => {
      const info = await window.desktop.getAppInfo();
      const response = await fetch(`${info.apiBaseUrl}/api/history`, { headers: { Authorization: `Bearer ${info.apiAuthToken}` } });
      return (await response.json()).items[0].absolutePath;
    });
    expect(before.startsWith(saveDir)).toBe(true);

    await row.focus();
    await window.keyboard.press('m');
    await window.getByRole('menu', { name: 'Move to' }).getByRole('menuitem', { name: /Road trips/ }).click();
    await expect(window.getByText(/^Moved “.+” to Road trips$/)).toBeVisible();
    await expect(folder).toContainText('1 video');
    await expect(window.locator('.video-row[data-state="saved"]')).toHaveCount(0);

    // On disk: the video's own folder moved whole, and the file is still the same playable video.
    const after = await window.evaluate(async () => {
      const info = await window.desktop.getAppInfo();
      const response = await fetch(`${info.apiBaseUrl}/api/history?folder=${encodeURIComponent('Road trips')}`, { headers: { Authorization: `Bearer ${info.apiAuthToken}` } });
      return (await response.json()).items.map((item) => item.absolutePath);
    });
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(path.join(saveDir, 'Road trips', path.relative(saveDir, before)));
    expect(fs.existsSync(before)).toBe(false);
    const metadata = await probeFile(after[0]);
    expect(metadata.height).toBe(1080);
    expect(metadata.hasAudio).toBe(true);
    expect(Math.abs(metadata.durationSeconds - 10)).toBeLessThanOrEqual(1);

    await folder.click();
    await expect(window.locator('.path-bar [aria-current="page"]')).toHaveText('Road trips');
    await expect(window.locator('.video-row[data-state="saved"]').getByRole('button', { name: /^Play:/ })).toBeVisible();
  } finally { await native?.close(); await renderer.close(); await fixture.close(); }
});
