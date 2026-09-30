const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { root, startRenderer, launchDesktop } = require('./helpers');

// Pairing, simplified (owner pick 2026-09-29: docs/design/prototypes/pairing-simple, B · Pair from the
// desktop with A's one-tap banner as the popup-first fallback). The security check is unchanged: the
// person chooses Allow in SnagThis after comparing the same four digits.
test('pairing: desktop waits and Chrome asks by itself; Deny inline; code fallback; popup-first Connect without focus steal; disconnect', async () => {
  test.setTimeout(240_000);
  const renderer = await startRenderer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-pairing-browser-'));
  const evidence = path.join(root, 'work/verification/pairing-onboarding');
  fs.mkdirSync(evidence, { recursive: true });
  let native;
  let context;
  let desktop;
  let clockShifted = false;
  const cleanupStage = stage => fs.writeFileSync(path.join(evidence, 'cleanup.json'), JSON.stringify({ stage, at: new Date().toISOString() }));
  const shot = (page, name) => page.screenshot({ path: path.join(evidence, `${name}.png`), animations: 'disabled' });
  try {
    native = await launchDesktop(renderer.baseUrl);
    desktop = await native.app.firstWindow();
    await desktop.waitForFunction(() => typeof window.desktop?.getAppInfo === 'function');
    await expect.poll(() => desktop.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)).toBe('ready');
    const health = async () => (await (await fetch(`${native.baseUrl}/v1/health`, { headers: { 'X-Client': 'snagthis-extension', 'X-Protocol-Version': '1' } })).json()).pairing;
    const pending = () => desktop.evaluate(async () => { const request = await window.desktop.getPairingRequest(); return request && { requestId: request.requestId, status: request.status }; });

    // 1. First run: one compact card, already waiting for Chrome. The bridge says so without a secret.
    const card = desktop.getByRole('region', { name: 'Connect Chrome', exact: true });
    await expect(card).toContainText('Waiting for Chrome…');
    await expect(card).toContainText('Click SnagThis in Chrome’s toolbar');
    await expect(card.getByRole('button', { name: 'Add SnagThis to Chrome', exact: true })).toBeVisible();
    await expect.poll(async () => (await health()).listening).toBe(true);
    const listening = await health();
    expect(Object.keys(listening).sort()).toEqual(['listening', 'session']);
    expect((await fetch(`${native.baseUrl}/v1/queue`)).status).toBe(401);
    await expect(desktop.locator('.startup-logo-overlay')).toHaveCount(0, { timeout: 15_000 });
    await shot(desktop, 'desktop-waiting');

    const extension = path.join(root, 'apps/extension');
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 480, height: 560 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const popupUrl = `chrome-extension://${extensionId}/popup.html?apiBase=${encodeURIComponent(native.baseUrl)}`;
    const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
    const snagthisTabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.pendingUrl || tab.url || '').filter(url => url.startsWith('snagthis:')));
    // Record Allow's state the moment it first renders (card or dialog).
    const watchAllow = () => desktop.evaluate(() => {
      window.__allowSeen = null;
      const observer = new MutationObserver(() => {
        const allow = document.querySelector('button.pairing-allow');
        if (allow && !window.__allowSeen) { window.__allowSeen = { disabled: allow.disabled, focused: document.activeElement === allow, arming: allow.classList.contains('arming') }; observer.disconnect(); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    // SnagThis closed: the popup says so (a network failure, not a faked response or relaxed auth).
    let popup = await context.newPage();
    await popup.route(`${native.baseUrl}/**`, route => route.abort('connectionrefused'));
    await popup.goto(popupUrl);
    const banner = popup.locator('#connection-banner');
    await expect(banner).toContainText('Save supported files in Chrome. Open SnagThis for streams and more.');
    await expect(banner.getByRole('button', { name: 'Open SnagThis', exact: true })).toBeVisible();
    await shot(popup, 'extension-offline');
    await expect.poll(pending).toBeNull();

    // 2. SnagThis is reachable and waiting: the popup asks without a click, and the card turns into the approve card in place.
    await watchAllow();
    await popup.unroute(`${native.baseUrl}/**`);
    const popupDigits = banner.locator('.pair-digits');
    await expect(popupDigits).toBeVisible();
    const deniedCode = await popupDigits.getAttribute('data-code');
    expect(deniedCode).toMatch(/^\d{4}$/);
    await expect(banner).toContainText('Connecting to SnagThis on this computer');
    await expect(banner).toContainText(/Choose Allow there if the digits match · \d:\d\d/);
    await expect(banner.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(popup.locator('.popup-header .pair-devchip')).toHaveText('DEV BUILD');
    await expect(popup.locator('#sheet')).not.toBeVisible();
    await expect(card).toContainText('Chrome wants to connect');
    await expect(card.getByRole('img', { name: /^Match code/ })).toHaveAttribute('data-code', deniedCode);
    await expect(card.locator('.pairing-who')).toContainText(`${extensionId.slice(0, 6)}…${extensionId.slice(-6)}`);
    await expect(card).toContainText('Not Web Store');
    await expect.poll(() => desktop.evaluate(() => window.__allowSeen)).toEqual({ disabled: true, focused: false, arming: true });
    await expect(desktop.getByRole('dialog', { name: 'Connect Chrome?' })).toHaveCount(0);
    await expect.poll(badge).toBe(deniedCode);
    expect(await snagthisTabs()).toEqual([]);
    const firstRequest = await pending();
    expect(firstRequest.status).toBe('pending');
    // While one request waits, the bridge stops inviting others.
    expect((await health()).listening).toBe(false);
    await shot(popup, 'extension-auto-waiting');
    await shot(desktop, 'desktop-approve-in-place');

    // Reopening the popup joins the same request: one pending request, never a second (which would cancel both).
    const second = await context.newPage();
    await second.goto(popupUrl);
    await expect(second.locator('#connection-banner .pair-digits')).toHaveAttribute('data-code', deniedCode);
    expect(await pending()).toEqual(firstRequest);
    await second.close();

    // 3. Deny in the card: one toast on the desktop, one inline line in Chrome that clears itself. No sheet.
    await card.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(desktop.getByText('Chrome wasn’t connected. It can ask again in an hour.')).toBeVisible();
    await expect(card).toContainText('Waiting for Chrome…');
    await expect(banner).toContainText('SnagThis chose Deny. Chrome can ask again in an hour.');
    await expect(banner.getByRole('button', { name: 'Use a code', exact: true })).toBeVisible();
    await expect(popup.locator('#sheet')).not.toBeVisible();
    await expect.poll(badge).toBe('');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('appToken')).appToken)).toBeUndefined();
    expect((await fetch(`${native.baseUrl}/v1/queue`)).status).toBe(401);
    await shot(popup, 'extension-denied-inline');
    await shot(desktop, 'desktop-denied-toast');
    await expect(banner).toContainText('Connect SnagThis desktop for streams and more.', { timeout: 12_000 });
    // The card is waiting again, but Chrome doesn't ask again on its own (the same waiting card, and the Deny block).
    await expect.poll(async () => (await health()).listening).toBe(true);
    await popup.close();
    popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(popup.locator('#connection-banner')).toContainText('Connect SnagThis desktop for streams and more.');
    await popup.waitForTimeout(2500);
    expect((await pending())?.status).not.toBe('pending');
    await expect(popup.locator('#sheet')).not.toBeVisible();
    const offerBanner = popup.locator('#connection-banner');
    await shot(popup, 'extension-connect-offer');

    // 4. The code fallback, tucked behind the banner's menu and Settings → Chrome extension → Show connection code.
    await offerBanner.getByRole('button', { name: 'More ways to connect', exact: true }).click();
    await popup.getByRole('menuitem', { name: 'Use a code instead', exact: true }).click();
    await expect(popup.locator('#sheet')).toContainText('Settings → Chrome extension → Show connection code');
    await expect(popup.getByRole('button', { name: 'Open app settings', exact: true })).toBeVisible();
    await expect(popup.getByLabel('Connection code', { exact: true })).toBeFocused();
    await shot(popup, 'extension-connect-code');

    await desktop.evaluate(() => window.desktop.openSettings());
    const setup = desktop.getByRole('region', { name: 'Chrome extension setup' });
    await expect(setup.getByRole('region', { name: 'Connect Chrome', exact: true })).toContainText('Waiting for Chrome…');
    // Nothing is generated by opening Settings.
    await expect(desktop.getByLabel('Connection code', { exact: true })).toHaveCount(0);
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
    await shot(desktop, 'desktop-code');

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

    await setup.getByRole('button', { name: 'Get a new code', exact: true }).click();
    const freshCode = (await desktop.getByLabel('Connection code', { exact: true }).textContent()).trim();
    await popup.getByLabel('Connection code', { exact: true }).fill(freshCode);
    await expect(popup.locator('#sheet')).not.toBeVisible();
    await expect(popup.locator('#connection-banner')).toBeHidden();
    await expect(popup.locator('#notice')).toContainText('Connected to SnagThis');
    await expect(setup).toContainText('Connected to Chrome extension');
    await expect(setup.getByRole('list', { name: 'Connected browsers' }).getByRole('listitem')).toHaveCount(1);
    await expect(desktop.getByLabel('Connection code', { exact: true })).toHaveCount(0);
    // Connected: nothing waits for Chrome any more.
    await expect.poll(async () => (await health()).listening).toBe(false);
    await shot(desktop, 'desktop-connected');
    await native.app.evaluate(() => { Date.now = globalThis.__pairingRealNow; delete globalThis.__pairingRealNow; });
    await desktop.evaluate(() => { Date.now = window.__pairingRealNow; delete window.__pairingRealNow; });
    clockShifted = false;
    const codeToken = await worker.evaluate(async () => (await chrome.storage.local.get('appToken')).appToken);
    const desktopToken = await desktop.evaluate(async () => (await window.desktop.getAppInfo()).apiAuthToken);
    expect(codeToken).toMatch(/^[0-9a-f]{64}$/);
    expect(codeToken).not.toBe(desktopToken);

    // 5. Disconnect this browser from the popup; its key stops working at once.
    await popup.locator('#settings-button').click();
    await popup.locator('#sheet').getByRole('tab', { name: 'Connection, Connected', exact: true }).click();
    await expect(popup.locator('#sheet')).toContainText('Connected to SnagThis');
    await popup.locator('#sheet').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(popup.locator('#connection-banner')).toContainText('Disconnected from SnagThis. Supported files still save in Chrome.');
    expect((await fetch(`${native.baseUrl}/v1/queue`, { headers: { Authorization: `Bearer ${codeToken}` } })).status).toBe(401);
    await expect(setup.getByRole('list', { name: 'Connected browsers' })).toHaveCount(0);
    await shot(popup, 'extension-disconnected');

    // 6. Popup first: SnagThis isn't waiting (Settings shows Downloads), so the banner's one Connect asks.
    // SnagThis surfaces its approve dialog itself: no snagthis:// link, no focus taken from Chrome,
    // so the popup stays open with the same digits beside it.
    await desktop.getByRole('tab', { name: 'Downloads', exact: true }).click();
    await expect.poll(async () => (await health()).listening).toBe(false);
    await native.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      globalThis.__windowCalls = { focus: 0, show: 0, showInactive: 0 };
      for (const name of ['focus', 'show', 'showInactive']) { const original = window[name].bind(window); window[name] = (...args) => { globalThis.__windowCalls[name] += 1; return original(...args); }; }
    });
    await watchAllow();
    await popup.locator('#connection-banner').getByRole('button', { name: 'Connect again', exact: true }).click();
    const approveDialog = desktop.getByRole('dialog', { name: 'Connect Chrome?' });
    await expect(approveDialog).toBeVisible();
    const allowedCode = await popup.locator('#connection-banner .pair-digits').getAttribute('data-code');
    expect(allowedCode).toMatch(/^\d{4}$/);
    await expect(approveDialog.getByRole('img', { name: /^Match code/ })).toHaveAttribute('data-code', allowedCode);
    await expect(approveDialog).toContainText('Not Web Store');
    await expect.poll(() => desktop.evaluate(() => window.__allowSeen)).toEqual({ disabled: true, focused: false, arming: true });
    expect(await native.app.evaluate(() => globalThis.__windowCalls)).toMatchObject({ focus: 0, show: 0 });
    expect(popup.isClosed()).toBe(false);
    expect(popup.url()).toBe(popupUrl);
    expect(await snagthisTabs()).toEqual([]);
    await expect(popup.locator('#connection-banner')).toContainText('Connecting to SnagThis on this computer');
    await shot(popup, 'extension-popup-first-waiting');
    await shot(desktop, 'desktop-approve-dialog');

    // Allow: the dialog shows Connected and closes by itself; the popup shows one green line, then just the list.
    await approveDialog.getByRole('button', { name: 'Allow', exact: true }).click();
    const connectedDialog = desktop.getByRole('dialog', { name: 'Chrome connected' });
    await expect(connectedDialog).toBeVisible();
    await expect(connectedDialog.getByRole('button')).toHaveCount(0);
    await shot(desktop, 'desktop-approved');
    await expect(popup.locator('#connection-banner')).toContainText('Connected to SnagThis');
    await shot(popup, 'extension-connected-inline');
    await expect(connectedDialog).toBeHidden({ timeout: 5000 });
    await expect(popup.locator('#connection-banner')).toBeHidden({ timeout: 5000 });
    await expect(popup.locator('#sheet')).not.toBeVisible();
    const stored = await worker.evaluate(() => chrome.storage.local.get(['appToken', 'appTokenVersion']));
    expect(stored.appToken).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.appToken).not.toBe(codeToken);
    expect(stored.appTokenVersion).toBe(2);
    await expect.poll(badge).toBe('');

    // Reopening shows nothing about pairing: no sheet, no Done, no banner.
    await popup.close();
    popup = await context.newPage();
    await popup.goto(popupUrl);
    await expect(popup.locator('#popup')).not.toHaveAttribute('aria-busy', 'true');
    await popup.waitForTimeout(1000);
    await expect(popup.locator('#connection-banner')).toBeHidden();
    await expect(popup.locator('#sheet')).not.toBeVisible();
    await expect(desktop.getByRole('dialog')).toHaveCount(1); // only Settings
    expect((await fetch(`${native.baseUrl}/v1/queue`)).status).toBe(401);
    await shot(popup, 'extension-reopened');

    // 7. Disconnect from the desktop; the popup learns its key is dead.
    await desktop.getByRole('tab', { name: 'Chrome extension', exact: true }).click();
    await setup.getByRole('button', { name: `Disconnect ${extensionId.slice(0, 6)}…${extensionId.slice(-6)}`, exact: true }).click();
    await expect(setup).toContainText('Chrome stops sending downloads here');
    await setup.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(setup).toContainText('Chrome is disconnected. Its key no longer works.');
    // After a desktop Disconnect, SnagThis waits for Chrome only when asked to.
    await expect(setup.getByRole('button', { name: 'Connect Chrome', exact: true })).toBeVisible();
    await expect(popup.locator('#connection-banner')).toContainText('Disconnected from SnagThis');
    expect((await fetch(`${native.baseUrl}/v1/queue`, { headers: { Authorization: `Bearer ${stored.appToken}` } })).status).toBe(401);
    fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({
      desktopWaitsOnFirstRun: true, autoRequestWithoutClick: true, approveInPlace: true, onePendingRequest: true,
      denyInlineAndClears: true, denyNotRetriedAutomatically: true, codeFallbackConnected: true, invalidAndExpiredRejected: true,
      popupFirstNoFocusSteal: true, noSnagthisLink: true, dialogAndBannerCloseThemselves: true, reopenShowsNoSheet: true,
      perExtensionTokenDiffersFromDesktop: true, popupDisconnectRevokedKey: true, desktopDisconnectRevokedKey: true,
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

// The popup's banner states that the live flow can't reach on demand, drawn by the shipped renderer in demo mode.
test('pairing banner states: one inline line each, never a sheet; Web Store build and reduced motion', async () => {
  const evidence = path.join(root, 'work/verification/pairing-onboarding');
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 560 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const banner = page.locator('#connection-banner');
    const open = async query => { await page.goto(`file://${path.join(root, 'apps/extension/popup.html')}?demo=pairing${query ? `&${query}` : ''}`); await expect(banner).toBeVisible(); };
    await open('');
    await expect(banner).toContainText('Connect SnagThis desktop for streams and more.');
    await expect(banner.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    await open('pair=starting');
    await expect(banner).toContainText('Asking SnagThis for four digits…');
    await expect(banner.locator('.pair-digits')).toHaveCount(0);
    await page.screenshot({ path: path.join(evidence, 'extension-state-starting.png'), animations: 'disabled' });
    await open('pair=expired');
    await expect(banner.getByRole('alert')).toHaveText('Timed out. Nothing was connected.');
    await expect(banner.locator('.action.primary')).toHaveText('Try again');
    await page.screenshot({ path: path.join(evidence, 'extension-state-expired.png'), animations: 'disabled' });
    await open('pair=denied');
    await expect(banner.locator('.action.primary')).toHaveText('Use a code');
    await open('pair=blocked');
    await expect(banner).toContainText('less than an hour ago');
    await open('pair=conflict');
    await expect(banner.locator('.action.primary')).toHaveText('Try again');
    await open('pair=waiting&build=store');
    await expect(page.locator('.pair-devchip')).toHaveCount(0);
    await expect(banner.locator('.pair-digits')).toHaveAttribute('data-code', '4719');
    await page.screenshot({ path: path.join(evidence, 'extension-state-waiting-store.png'), animations: 'disabled' });
    await open('pair=connected');
    await expect(banner).toHaveClass(/\bok\b/);
    await expect(banner).toContainText('Connected to SnagThis');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open('pair=waiting');
    await expect(page.locator('.popup-header .pair-devchip')).toHaveText('DEV BUILD');
    expect(await banner.locator('.pair-digit').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await expect(page.locator('#sheet')).not.toBeVisible();
    await page.screenshot({ path: path.join(evidence, 'extension-state-waiting-reduced.png') });
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});
