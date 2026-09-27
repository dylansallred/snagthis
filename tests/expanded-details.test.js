const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const { chromium, expect } = require('@playwright/test');
const { startRenderer, launchDesktop } = require('./e2e/helpers');

test('expanded location opens its trusted folder and three design studies remain usable', { timeout: 60000 }, async (t) => {
  const studyServer = http.createServer(express().use(express.static(path.resolve(__dirname, '..'))));
  await new Promise((resolve, reject) => {
    studyServer.once('error', reject);
    studyServer.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => { studyServer.closeAllConnections(); studyServer.close(resolve); }));
  const studyBase = `http://127.0.0.1:${studyServer.address().port}`;
  const renderer = await startRenderer();
  t.after(() => renderer.close());
  const desktop = await launchDesktop(renderer.baseUrl);
  t.after(() => desktop.close());
  const page = await desktop.app.firstWindow();
  const rendererErrors = [];
  const apiRequests = [];
  const remember = (entries, value) => { entries.push(value); if (entries.length > 20) entries.shift(); };
  page.on('pageerror', error => remember(rendererErrors, error.message.slice(0, 400)));
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (/^\/(api|v1)\//.test(pathname)) remember(apiRequests, { path: pathname, status: response.status() });
  });
  page.on('requestfailed', request => {
    const pathname = new URL(request.url()).pathname;
    if (/^\/(api|v1)\//.test(pathname)) remember(apiRequests, { path: pathname, failure: request.failure()?.errorText });
  });
  await page.waitForFunction(() => !!window.desktop);
  await expect.poll(() => page.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState), { timeout: 30000 }).toBe('ready');
  const info = await page.evaluate(() => window.desktop.getAppInfo());
  assert.equal(await desktop.app.evaluate(({ app }) => app.getPath('userData')), desktop.profile);
  assert.equal(info.apiBaseUrl, desktop.baseUrl, 'use the fixture desktop’s isolated API port');
  assert.notEqual(info.apiBaseUrl, 'http://127.0.0.1:49732');
  assert.ok(info.apiAuthToken, 'the ready private API provides its installation token');
  await page.evaluate(() => window.desktop.saveSettings({ queueAutoStart: false }));
  const headers = { Authorization: `Bearer ${info.apiAuthToken}`, 'Content-Type': 'application/json' };
  const created = await fetch(`${info.apiBaseUrl}/api/jobs`, { method: 'POST', headers,
    body: JSON.stringify({ queue: { url: `${studyBase}/apps/extension/popup/media/sintel.mp4`, mediaType: 'file', title: 'Sintel folder layout check' } }) });
  assert.equal(created.status, 200);
  const queue = await fetch(`${info.apiBaseUrl}/api/queue`, { headers }).then(r => r.json());
  const job = queue.queue.find(item => item.title === 'Sintel folder layout check');
  assert.equal(job.queueStatus, 'queued');
  await desktop.app.evaluate(({ shell }) => { global.__openedFolders = []; shell.openPath = async value => { global.__openedFolders.push(value); return ''; }; });
  const row = page.locator(`[data-row-key="${job.id}"]`);
  try { await row.click(); } catch (error) {
    try {
      const renderer = await page.evaluate(async () => {
        const info = await window.desktop.getAppInfo();
        return {
          apiStartupState: info.apiStartupState,
          hasAuthToken: Boolean(info.apiAuthToken),
          bodyText: document.body.innerText.slice(0, 2500),
          rowIds: Array.from(document.querySelectorAll('[data-row-key]')).slice(0, 20).map(node => node.dataset.rowKey),
          // Playwright's stability check needs animation frames; none means a hidden window or a stalled compositor.
          visibility: document.visibilityState,
          framesInOneSecond: await new Promise(resolve => {
            let frames = 0;
            const tick = () => { frames += 1; requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
            setTimeout(() => resolve(frames), 1000);
          }),
        };
      });
      const main = await desktop.app.evaluate(({ app, BrowserWindow }) => ({
        windows: BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused() })),
        processes: app.getAppMetrics().map(metric => metric.type),
        gpuCompositing: app.getGPUFeatureStatus().gpu_compositing,
      }));
      const output = path.join(__dirname, '../work/verification/performance-audit');
      fs.mkdirSync(output, { recursive: true });
      const diagnostic = JSON.stringify({ renderer, main, rendererErrors, apiRequests }, null, 2).replaceAll(info.apiAuthToken, '[REDACTED]');
      fs.writeFileSync(path.join(output, 'expanded-details-failure.json'), `${diagnostic}\n`);
      // CI keeps only the log for unit tests, so the evidence must be printed as well.
      t.diagnostic(JSON.stringify(JSON.parse(diagnostic)));
    } catch { /* Preserve the row assertion failure even if the renderer has closed. */ }
    throw error;
  }
  const details = page.locator(`#details-${job.id}`);
  const location = details.getByRole('button', { name: /^Saving to/ });
  await location.waitFor();
  assert.ok((await location.innerText()).includes(job.outputDirectory), 'show the entire directory directly');
  assert.equal(await details.getByText('Full path', { exact: true }).count(), 0);
  await location.hover();
  assert.deepEqual(await desktop.app.evaluate(() => global.__openedFolders), [], 'hover highlights without opening Finder');
  await location.click();
  await page.waitForFunction(() => !document.querySelector('.detail-location')?.disabled);
  await location.focus(); await location.press('Enter');
  await page.waitForTimeout(100);
  assert.deepEqual(await desktop.app.evaluate(() => global.__openedFolders), [job.outputDirectory, job.outputDirectory]);
  const rejected = await page.evaluate(() => window.desktop.openHistoryFolder('/tmp'));
  assert.equal(rejected.ok, false, 'arbitrary renderer paths cannot be opened');
  assert.equal(await location.evaluate(element => element.scrollWidth <= element.clientWidth), true);

  const output = path.join(__dirname, '../work/verification/expanded-details');
  fs.mkdirSync(output, { recursive: true });
  await details.screenshot({ path: path.join(output, 'desktop-location.png') });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const study = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const base = `${studyBase}/docs/design/prototypes/expanded-details`;
  for (const design of ['streamlined', 'grouped', 'pieces-first']) {
    await study.goto(`${base}/${design}/`);
    await study.locator('.location').waitFor();
    assert.ok((await study.locator('.location-path').innerText()).startsWith('/Users/dylanallred/Library/'));
    assert.equal(await study.getByText('Technical details', { exact: true }).count(), 0);
    await study.getByRole('button', { name: 'Open download folder' }).click();
    await study.locator('.notice[role="status"]').waitFor();
    assert.match(await study.locator('.notice').innerText(), /Opens this download’s folder/);
    await study.locator('#progress').evaluate(input => { input.value = '64'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await study.getByRole('progressbar').getAttribute('aria-valuenow'), '64');
    await study.locator('#state').selectOption('paused');
    assert.equal(await study.locator('.status').innerText(), 'Paused at 64%');
    await study.locator('#state').selectOption('saved');
    assert.equal(await study.locator('.pieces').isVisible(), false);
    assert.equal(await study.locator('.location-label').innerText(), 'Saved in');
    await study.locator('#state').selectOption('downloading');
    const thumb = study.locator('.thumb');
    await thumb.hover();
    await study.waitForFunction(() => document.querySelector('.thumb video').currentTime > .1 && !document.querySelector('.thumb video').paused);
    await study.mouse.move(1099, 819);
    assert.equal(await study.locator('video').evaluate(video => video.paused), true);
    await study.locator('.notice').evaluate(node => node.hidden = true);
    await study.screenshot({ path: path.join(output, `${design}.png`), fullPage: true });
    await study.setViewportSize({ width: 640, height: 820 });
    assert.equal(await study.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${design} fits 640px`);
    const fits = await study.locator('.location-path').evaluate(node => node.scrollWidth <= node.clientWidth);
    assert.equal(fits, true, `${design} keeps the full path within its button`);
    await study.screenshot({ path: path.join(output, `${design}-640.png`), fullPage: true });
    await study.setViewportSize({ width: 1100, height: 820 });
  }
  await study.goto(`${base}/`);
  for (const name of ['B · Grouped', 'C · Pieces first', 'A · Streamlined']) {
    const tab = study.getByRole('tab', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    await tab.click(); assert.equal(await tab.getAttribute('aria-selected'), 'true');
  }
  await study.screenshot({ path: path.join(output, 'comparison.png'), fullPage: true });
});
