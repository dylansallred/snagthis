// Screenshots for the update prototypes. From the repository root:
//   node docs/design/prototypes/updates/capture.cjs [a-chip b-banner c-sheet]
const path = require('path');
const { chromium } = require('@playwright/test');

const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['a-chip', 'b-banner', 'c-sheet'];
const KEY = ['downloading', 'ready', 'notes', 'blocked', 'deferred', 'error'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  for (const dir of DIRS) {
    const url = 'file://' + path.join(__dirname, dir, 'index.html');
    const out = (name) => path.join(__dirname, dir, name);
    for (const state of KEY) {
      await page.goto(`${url}#state=${state}`);
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.locator('#window .win').screenshot({ path: out(`state-${state}.png`) });
      if (state === 'ready') await page.locator('#window .win').screenshot({ path: out('preview.png') });
    }
    const rest = { 'a-chip': 'popOpen=0', 'c-sheet': 'sheetOpen=0' }[dir];
    if (rest) {
      await page.goto(`${url}#state=ready&${rest}`);
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await page.locator('#window .win').screenshot({ path: out('state-ready-at-rest.png') });
    }
    await page.evaluate(() => { document.getElementById('toolbar').style.position = 'static'; document.querySelectorAll('#grid details').forEach((d) => { d.open = true; }); });
    await page.locator('#grid').screenshot({ path: out('all-states.png') });
    console.log('captured', dir);
  }
  await browser.close();
})();
