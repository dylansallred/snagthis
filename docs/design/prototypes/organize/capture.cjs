// Screenshots for the library-organising prototypes. From the repository root:
//   node docs/design/prototypes/organize/capture.cjs [a-collections b-folders c-groups]
// Writes state-<id>.png per state and preview.png (the first state) into each direction's folder,
// plus baseline.png. Captured at 1x with reduced motion to keep PNGs small.
const path = require('path');
const { chromium } = require('@playwright/test');

const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['a-collections', 'b-folders', 'c-groups', 'baseline'];
const PREVIEW = { 'a-collections': 'moveto', 'b-folders': 'drag', 'c-groups': 'sorted' };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  for (const dir of DIRS) {
    const url = 'file://' + path.join(__dirname, dir, 'index.html');
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const states = await page.$$eval('#toolbar [data-state]', (els) => els.map((el) => el.dataset.state));
    for (const state of states) {
      await page.click(`#toolbar [data-state="${state}"]`);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(120);
      const out = path.join(__dirname, dir, dir === 'baseline' ? 'baseline.png' : `state-${state}.png`);
      await page.locator('#window .win').screenshot({ path: out });
      if (PREVIEW[dir] === state) await page.locator('#window .win').screenshot({ path: path.join(__dirname, dir, 'preview.png') });
    }
    console.log('captured', dir, states.join(' '));
  }
  await browser.close();
})();
