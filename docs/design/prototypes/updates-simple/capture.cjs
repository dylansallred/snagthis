// Storyboard frames, 1200×800 previews and today's notification frames for the simpler update studies.
// From the repository root (after capture-today.cjs for the real-renderer screenshots):
//   node docs/design/prototypes/updates-simple/capture.cjs [a-quiet-chip b-install-on-quit c-automatic]
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ALL = ['a-quiet-chip', 'b-install-on-quit', 'c-automatic'];
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const url = (...parts) => 'file://' + path.join(__dirname, ...parts);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const settle = async () => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(120); };

  for (const dir of DIRS) {
    const frames = path.join(__dirname, dir, 'frames');
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });
    await page.goto(url(dir, 'index.html'));
    await settle();
    const list = await page.evaluate(() => [...document.querySelectorAll('[data-scen]')].map((b) => b.dataset.scen));
    for (const [si, sid] of list.entries()) {
      await page.goto(url(dir, 'index.html') + `#s=${sid}&f=0`);
      await page.reload();
      await settle();
      const count = await page.evaluate(() => document.querySelectorAll('#strip [data-frame]').length);
      for (let f = 0; f < count; f++) {
        await page.goto(url(dir, 'index.html') + `#s=${sid}&f=${f}`);
        await page.reload();
        await settle();
        const name = `${String.fromCharCode(97 + si)}-${sid}-${String(f + 1).padStart(2, '0')}.png`;
        await page.locator('#stage > *').first().screenshot({ path: path.join(frames, name) });
      }
    }
    const preview = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await preview.goto(url(dir, 'index.html') + '?preview');
    await preview.evaluate(() => document.fonts.ready);
    await preview.waitForTimeout(150);
    await preview.screenshot({ path: path.join(__dirname, dir, 'preview.png') });
    await preview.close();
    console.log('captured', dir);
  }

  // Today's OS notifications, drawn from main.js strings (the gallery can't show native notifications).
  await page.goto(url('index.html'));
  await settle();
  await page.evaluate(() => { document.getElementById('today-notifs').style.cssText = 'position:static;display:grid;gap:20px'; });
  for (const id of ['downloading', 'ready', 'both']) {
    await page.locator(`#n-${id} > .desk`).screenshot({ path: path.join(__dirname, 'today', `00-notif-${id}.png`) });
  }
  console.log('captured today notifications');
  await browser.close();
})();
