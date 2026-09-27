const { test, expect } = require('@playwright/test');
const { startRenderer, launchDesktop } = require('./helpers');

// The accent is a real desktop setting shared with the Chrome extension through the local bridge.
test('real Electron: accent migrates from localStorage, follows the extension live, ignores older choices and persists', async () => {
  test.setTimeout(120_000);
  const renderer = await startRenderer();
  let native;
  try {
    native = await launchDesktop(renderer.baseUrl);
    let window = await native.app.firstWindow();
    await expect(window.getByPlaceholder('Paste a video link')).toBeVisible();
    await expect.poll(() => window.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)).toBe('ready');
    expect(await window.evaluate(() => document.documentElement.dataset.accent)).toBe('orange');

    // A choice from before the accent was a setting moves into settings.json once.
    await window.evaluate(() => localStorage.setItem('snagthis.accent', 'mint'));
    await window.reload();
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.accent)).toBe('mint');
    await expect.poll(() => window.evaluate(async () => (await window.desktop.getSettings()).accent)).toBe('mint');
    expect(await window.evaluate(() => localStorage.getItem('snagthis.accent'))).toBeNull();

    // The paired extension's later choice reaches the open window without a reload.
    const token = await window.evaluate(async () => (await window.desktop.getAppInfo()).apiAuthToken);
    const bridge = (route, body) => fetch(`${native.baseUrl}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-Client': 'snagthis-extension', 'X-Protocol-Version': '1', 'X-Extension-Version': '1.0.0', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const chosenAt = Date.now() + 1000;
    const saved = await bridge('/v1/settings', { accent: 'violet', accentChangedAt: chosenAt });
    expect(saved.status).toBe(200);
    expect(saved.body.appearance).toEqual({ accent: 'violet', accentChangedAt: chosenAt });
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.accent)).toBe('violet');
    expect(await window.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-bevel-face').trim())).toBe('#8b5cf6');
    expect((await bridge('/v1/queue')).body.appearance).toEqual({ accent: 'violet', accentChangedAt: chosenAt });

    // An offline choice made before the desktop's own is ignored, and the reply says which won.
    const stale = await bridge('/v1/settings', { accent: 'cobalt', accentChangedAt: chosenAt - 60_000 });
    expect(stale.body.appearance).toEqual({ accent: 'violet', accentChangedAt: chosenAt });
    expect(await window.evaluate(() => document.documentElement.dataset.accent)).toBe('violet');
    expect((await bridge('/v1/settings', { accent: 'teal' })).status).toBe(400);

    // Choosing in desktop Settings is newer still and reaches the extension's queue poll.
    await window.evaluate(() => window.desktop.saveSettings({ accent: 'magenta' }));
    await expect.poll(async () => (await bridge('/v1/queue')).body.appearance.accent).toBe('magenta');
    await expect.poll(() => window.evaluate(() => document.documentElement.dataset.accent)).toBe('magenta');

    const profile = native.profile;
    await native.app.close();
    native = await launchDesktop(renderer.baseUrl, { userDataDirectory: profile });
    window = await native.app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    // Applied before React renders anything, straight from settings.json.
    expect(await window.evaluate(() => document.documentElement.dataset.accent)).toBe('magenta');
  } finally { await native?.close(); await renderer.close(); }
});
