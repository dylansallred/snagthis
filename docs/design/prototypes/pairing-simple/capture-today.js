#!/usr/bin/env node
/*
 * Captures today's pairing flow (read-only) from the real desktop app and the real unpacked
 * extension, in isolated profiles, into docs/design/prototypes/pairing-simple/today/.
 * Mirrors tests/e2e/pairing-onboarding.spec.js; it changes no app code and no auth check.
 *
 *   unset ELECTRON_RUN_AS_NODE; npm run build:extension:css
 *   node docs/design/prototypes/pairing-simple/capture-today.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { root, startRenderer, launchDesktop } = require('../../../../tests/e2e/helpers');

const out = path.join(__dirname, 'today');
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) { try { if (await check()) return; } catch { /* retry */ } if (Date.now() > end) throw new Error(`timed out: ${check}`); await sleep(150); }
}
const visible = locator => until(() => locator.first().isVisible());

// A page with one playable sample clip, so the popup lists a real video.
function startFixture() {
  const media = path.join(root, 'apps/extension/popup/media');
  const server = http.createServer((req, res) => {
    const file = req.url.split('?')[0].slice(1);
    if (!file) { res.setHeader('content-type', 'text/html'); res.end('<title>Neon Rain</title><video src="/neon-rain.mp4" poster="/neon-rain.jpg" controls muted></video>'); return; }
    const full = path.join(media, path.basename(file));
    if (!fs.existsSync(full)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', full.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` })));
}

(async () => {
  const renderer = await startRenderer();
  const fixture = await startFixture();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-pairing-simple-'));
  let native; let context;
  try {
    native = await launchDesktop(renderer.baseUrl);
    const desktop = await native.app.firstWindow();
    const shotD = async name => { await sleep(350); const file = path.join(out, `${name}.png`); await desktop.screenshot({ path: file, animations: 'disabled' }); execFileSync('sips', ['-Z', '820', file], { stdio: 'ignore' }); console.log('desktop', name); };
    await desktop.waitForFunction(() => typeof window.desktop?.getAppInfo === 'function');
    await until(async () => (await desktop.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)) === 'ready', 30000);
    await visible(desktop.getByRole('button', { name: 'Add SnagThis to Chrome', exact: true }));
    await sleep(4000); // let the startup logo settle into the header
    await shotD('d01-first-launch');
    await desktop.getByRole('button', { name: 'Already installed? Connect Chrome', exact: true }).click();
    const setup = desktop.getByRole('region', { name: 'Chrome extension setup' });
    await visible(setup);
    await shotD('d02-settings-chrome-unpaired');

    const extension = path.join(root, 'apps/extension');
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 480, height: 560 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const source = await context.newPage();
    await source.goto(fixture.baseUrl);
    await source.locator('video').evaluate(video => new Promise(resolve => { if (video.readyState >= 1) resolve(); else video.addEventListener('loadedmetadata', resolve, { once: true }); }));
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(url))?.id, fixture.baseUrl);
    const popupUrl = `chrome-extension://${extensionId}/popup.html?tab=${tabId}&apiBase=${encodeURIComponent(native.baseUrl)}`;
    const openPopup = async () => { const page = await context.newPage(); await page.goto(popupUrl); await sleep(900); return page; };
    let popup;
    const shotP = async name => { await sleep(350); await popup.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' }); console.log('popup', name); };

    // Desktop not running: the bridge refuses the connection (no fake API responses).
    popup = await context.newPage();
    await popup.route(`${native.baseUrl}/**`, route => route.abort('connectionrefused'));
    await popup.goto(popupUrl);
    await visible(popup.locator('#connection-banner').getByRole('button', { name: 'Open SnagThis', exact: true }));
    await shotP('p01-app-not-running');
    // "Open SnagThis" tries snagthis://open, and after 3 s without an answer offers the download page.
    await popup.evaluate(() => { window.open = () => null; });
    await popup.locator('#connection-banner').getByRole('button', { name: 'Open SnagThis', exact: true }).click();
    await visible(popup.locator('#connection-banner').getByRole('button', { name: 'Get the app', exact: true })).catch(() => {});
    await shotP('p02-get-the-app');
    for (const page of context.pages()) if (page !== popup && page !== source) await page.close().catch(() => {});
    await popup.close();

    // App running, not paired.
    popup = await openPopup();
    await visible(popup.locator('#connection-banner').getByRole('button', { name: 'Connect', exact: true }));
    await shotP('p03-unpaired-banner');

    const openPairLink = () => native.app.evaluate(({ app }) => { app.emit('open-url', { preventDefault() {} }, 'snagthis://open/pair'); });
    const approve = desktop.getByRole('dialog', { name: 'Connect Chrome?' });

    // Deny path.
    await popup.locator('#connection-banner').getByRole('button', { name: 'Connect', exact: true }).click();
    await visible(popup.locator('#sheet .pair-digits'));
    await shotP('p04-pairing-waiting');
    await visible(setup.getByText('Chrome is asking to connect'));
    await shotD('d03-settings-review-row');
    await openPairLink();
    await visible(approve);
    await shotD('d04-approve-dialog');
    await approve.getByRole('button', { name: 'Deny', exact: true }).click();
    await visible(desktop.getByText('Chrome wasn’t connected. It can ask again in an hour.'));
    await shotD('d05-denied-toast');
    await until(async () => (await popup.locator('#sheet').textContent()).includes('SnagThis chose Deny'));
    await shotP('p05-denied');

    // Code fallback.
    await popup.getByRole('button', { name: 'Use a code', exact: true }).click();
    await visible(popup.getByLabel('Connection code', { exact: true }));
    await shotP('p06-code-sheet');
    await setup.getByRole('button', { name: 'Show connection code', exact: true }).click();
    const code = (await desktop.getByLabel('Connection code', { exact: true }).textContent()).trim();
    await shotD('d06-connection-code');
    await popup.getByLabel('Connection code', { exact: true }).fill(code);
    await visible(popup.locator('#notice'));
    await shotP('p07-code-connected-notice');
    await visible(setup.getByText(/Connected to/));
    await shotD('d07-settings-connected');

    // Disconnect from the popup.
    await popup.locator('#settings-button').click();
    await popup.locator('#sheet').getByRole('tab', { name: 'Connection, Connected', exact: true }).click();
    await shotP('p08-settings-connection');
    await popup.locator('#sheet').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await until(async () => (await popup.locator('#connection-banner').textContent()).includes('Disconnected'));
    await shotP('p09-disconnected-banner');

    // One-click Allow. In real Chrome the popup closes as soon as SnagThis takes focus.
    await popup.locator('#connection-banner').getByRole('button', { name: 'Connect again', exact: true }).click();
    await visible(popup.locator('#sheet .pair-digits'));
    await popup.close();
    await openPairLink();
    await visible(approve);
    const allow = approve.getByRole('button', { name: 'Allow', exact: true });
    await until(() => allow.isEnabled());
    await allow.click();
    const connected = desktop.getByRole('dialog', { name: 'Chrome connected' });
    await visible(connected);
    await sleep(900);
    await shotD('d08-chrome-connected-dialog');
    await connected.getByRole('button', { name: 'Done', exact: true }).click();

    // The next popup opening shows the Connected sheet (the owner's "why?").
    popup = await openPopup();
    await visible(popup.locator('#sheet .pair-yay-title'));
    await sleep(700);
    await shotP('p10-reopen-connected-sheet');
    await popup.getByRole('button', { name: 'Done', exact: true }).click();
    await sleep(600);
    await shotP('p11-video-list-paired');
    await popup.close();

    // Disconnect from the desktop.
    await setup.getByRole('button', { name: `Disconnect ${extensionId.slice(0, 6)}…${extensionId.slice(-6)}`, exact: true }).click();
    await shotD('d09-disconnect-confirm');
  } finally {
    await context?.close().catch(() => {});
    await native?.close().catch(() => {});
    await renderer.close();
    fixture.server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }

  // Sheet states the live flow can't reach on demand, drawn by the shipped popup in demo mode.
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 560 } });
    for (const [name, query] of [['p12-state-starting', 'pair=starting'], ['p13-state-expired', 'pair=expired'], ['p14-state-waiting-store', 'pair=waiting&build=store']]) {
      await page.goto(`file://${path.join(root, 'apps/extension/popup.html')}?demo=pairing&${query}`);
      await sleep(900);
      await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' });
      console.log('popup', name);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
