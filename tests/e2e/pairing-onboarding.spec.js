const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { root, startRenderer, launchDesktop } = require('./helpers');

test('first-run connection explains setup, rejects expired codes, and remembers real pairing', async () => {
  test.setTimeout(90_000);
  const renderer = await startRenderer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-pairing-browser-'));
  const evidence = path.join(root, 'work/verification/pairing-onboarding');
  fs.mkdirSync(evidence, { recursive: true });
  let native;
  let context;
  let desktop;
  let clockShifted = false;
  const cleanupStage = stage => fs.writeFileSync(path.join(evidence, 'cleanup.json'), JSON.stringify({ stage, at: new Date().toISOString() }));
  try {
    native = await launchDesktop(renderer.baseUrl);
    desktop = await native.app.firstWindow();
    await desktop.waitForFunction(() => typeof window.desktop?.getAppInfo === 'function');
    await expect.poll(() => desktop.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)).toBe('ready');
    await expect(desktop.getByRole('button', { name: 'Add SnagThis to Chrome', exact: true })).toBeVisible();
    await desktop.screenshot({ path: path.join(evidence, 'desktop-first-launch.png') });
    await desktop.getByRole('button', { name: 'Already installed? Connect Chrome', exact: true }).click();
    const setup = desktop.getByRole('region', { name: 'Chrome extension setup' });
    await expect(setup.getByRole('button', { name: 'Show connection code', exact: true })).toBeVisible();
    await expect(desktop.getByLabel('Connection code', { exact: true })).toHaveCount(0);
    await expect(setup).toContainText('Extensions (the puzzle icon) → SnagThis → Connect');
    await desktop.screenshot({ path: path.join(evidence, 'desktop-setup.png') });

    const extension = path.join(root, 'apps/extension');
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 480, height: 560 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const popupUrl = `chrome-extension://${extensionId}/popup.html?apiBase=${encodeURIComponent(native.baseUrl)}`;
    const popup = await context.newPage();
    // Simulate a closed app as a network failure, without faking an API response
    // or modifying any authentication checks.
    await popup.route(`${native.baseUrl}/**`, route => route.abort('connectionrefused'));
    await popup.goto(popupUrl);
    await expect(popup.locator('#connection-banner')).toContainText('Save supported files in Chrome. Open SnagThis for streams and more.');
    await expect(popup.locator('#connection-banner').getByRole('button', { name: 'Open SnagThis', exact: true })).toBeVisible();
    await popup.screenshot({ path: path.join(evidence, 'extension-offline.png') });
    await popup.unroute(`${native.baseUrl}/**`);
    await popup.locator('#connection-banner').getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(popup.locator('#sheet')).toContainText('Settings → Chrome extension → Show connection code');
    await expect(popup.getByRole('button', { name: 'Open app settings', exact: true })).toBeVisible();
    await expect(popup.getByLabel('Connection code', { exact: true })).toBeFocused();
    await popup.screenshot({ path: path.join(evidence, 'extension-connect.png') });
    expect((await fetch(`${native.baseUrl}/v1/queue`)).status).toBe(401);

    await setup.getByRole('button', { name: 'Show connection code', exact: true }).click();
    const originalCode = (await desktop.getByLabel('Connection code', { exact: true }).textContent()).trim();
    expect(originalCode).toMatch(/^\d{6}$/);
    await expect(setup).toContainText('Expires in');
    // Exercise Copy without overwriting the owner's system clipboard.
    await desktop.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async value => { window.__copiedPairingCode = value; },
    } }));
    await setup.getByRole('button', { name: 'Copy code', exact: true }).click();
    await expect(setup.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    expect(await desktop.evaluate(() => window.__copiedPairingCode)).toBe(originalCode);
    await desktop.screenshot({ path: path.join(evidence, 'desktop-code.png') });

    // Six digits submit on their own; no Connect click is needed.
    await popup.getByLabel('Connection code', { exact: true }).fill(originalCode === '000000' ? '111111' : '000000');
    await expect(popup.locator('.sheet-error')).toContainText('incorrect or expired');
    // Advance only these isolated desktop clocks. The real API expiry check
    // still rejects the code through its unchanged five-minute boundary.
    clockShifted = true;
    await native.app.evaluate(() => { globalThis.__pairingRealNow = Date.now; Date.now = () => globalThis.__pairingRealNow() + 301000; });
    await desktop.evaluate(() => { window.__pairingRealNow = Date.now; Date.now = () => window.__pairingRealNow() + 301000; });
    await expect(setup.getByRole('button', { name: 'Get a new code', exact: true })).toBeVisible();
    await expect(desktop.getByLabel('Connection code', { exact: true })).toHaveCount(0);
    const expiredResponse = popup.waitForResponse(response => response.url().endsWith('/v1/pair/complete'));
    await popup.getByLabel('Connection code', { exact: true }).fill(originalCode);
    expect((await expiredResponse).status()).toBe(403);
    await expect(popup.locator('.sheet-error')).toContainText('Settings → Chrome extension');
    await popup.screenshot({ path: path.join(evidence, 'extension-expired-code.png') });
    await desktop.screenshot({ path: path.join(evidence, 'desktop-expired-code.png') });

    await setup.getByRole('button', { name: 'Get a new code', exact: true }).click();
    const freshCode = (await desktop.getByLabel('Connection code', { exact: true }).textContent()).trim();
    await popup.getByLabel('Connection code', { exact: true }).fill(freshCode);
    await expect(popup.locator('#sheet')).not.toBeVisible();
    await expect(popup.locator('#connection-banner')).toBeHidden();
    await expect(popup.locator('#notice')).toContainText('Connected to SnagThis');
    await expect(setup).toContainText('Chrome is connected');
    await expect(desktop.getByLabel('Connection code', { exact: true })).toHaveCount(0);
    await popup.screenshot({ path: path.join(evidence, 'extension-connected.png') });
    await desktop.screenshot({ path: path.join(evidence, 'desktop-connected.png') });
    await native.app.evaluate(() => { Date.now = globalThis.__pairingRealNow; delete globalThis.__pairingRealNow; });
    await desktop.evaluate(() => { Date.now = window.__pairingRealNow; delete window.__pairingRealNow; });
    clockShifted = false;

    // Reopening uses the credential produced by real pairing, not a test token.
    await popup.close();
    const reopened = await context.newPage();
    await reopened.goto(popupUrl);
    await expect(reopened.locator('#popup')).not.toHaveAttribute('aria-busy', 'true');
    await expect(reopened.locator('#connection-banner')).toBeHidden();
    const remembered = await worker.evaluate(async () => Boolean((await chrome.storage.local.get('appToken')).appToken));
    expect(remembered).toBe(true);
    expect((await fetch(`${native.baseUrl}/v1/queue`)).status).toBe(401);
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({
      firstRunSetupVisible: true, explicitCodeGeneration: true, copyFeedback: true,
      offlineRecovery: true, invalidAndExpiredRejected: true, realPairingSucceeded: true,
      pairedStateSurvivedPopupReopen: remembered, unauthenticatedQueueRejected: true,
      screenshotsUseIsolatedProfiles: true,
    }, null, 2));
  } finally {
    try {
      if (clockShifted) {
        cleanupStage('restoring-clocks');
        await native?.app.evaluate(() => { if (globalThis.__pairingRealNow) { Date.now = globalThis.__pairingRealNow; delete globalThis.__pairingRealNow; } });
        if (desktop && !desktop.isClosed()) await desktop.evaluate(() => { if (window.__pairingRealNow) { Date.now = window.__pairingRealNow; delete window.__pairingRealNow; } });
      }
    } finally {
      try {
        cleanupStage('closing-chrome'); await context?.close();
      } finally {
        try {
          cleanupStage('closing-electron'); await native?.close();
        } finally {
          cleanupStage('closing-renderer'); await renderer.close();
          fs.rmSync(profile, { recursive: true, force: true });
          cleanupStage('complete');
        }
      }
    }
  }
});
