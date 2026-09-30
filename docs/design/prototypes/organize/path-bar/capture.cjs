// Screenshots for the path-bar options. From the repository root:
//   node docs/design/prototypes/organize/path-bar/capture.cjs [baseline a-pixel-tabs b-title-trail c-address-field d-minimal]
// Per option folder: preview.png (three levels deep, 1200×800), state-<id>.png for every state (960px wide for the
// long-name states), and bar-three.png / bar-long.png (the header and path bar only) for the side-by-side table.
// 1x, reduced motion. Any PNG over 240 KB is reduced to a 256-colour palette with Pillow (python3).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('@playwright/test');

const LIMIT = 240 * 1024;
const QUANTIZE = 'import sys\nfrom PIL import Image\nfor p in sys.argv[1:]:\n  Image.open(p).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(p, optimize=True)';
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['baseline', 'a-pixel-tabs', 'b-title-trail', 'c-address-field', 'd-minimal'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1320, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  for (const dir of DIRS) {
    await page.goto('file://' + path.join(__dirname, dir, 'index.html'));
    await page.evaluate(() => document.fonts.ready);
    const states = await page.$$eval('#toolbar [data-state]', (els) => els.map((el) => el.dataset.state));
    for (const state of states) {
      await page.click(`#toolbar [data-state="${state}"]`);
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const win = page.locator('#window .win');
      await win.screenshot({ path: path.join(__dirname, dir, `state-${state}.png`) });
      if (state === 'three') await win.screenshot({ path: path.join(__dirname, dir, 'preview.png') });
      if (state === 'three' || state === 'long') {
        const box = await win.boundingBox();
        const bar = await page.locator('#window .pbar').boundingBox();
        await page.screenshot({ path: path.join(__dirname, dir, `bar-${state}.png`), clip: { x: box.x, y: box.y, width: box.width, height: bar.y + bar.height - box.y + 1 } });
      }
    }
    const big = fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.png')).map((f) => path.join(__dirname, dir, f)).filter((f) => fs.statSync(f).size > LIMIT);
    if (big.length) execFileSync('python3', ['-c', QUANTIZE, ...big]);
    console.log('captured', dir, states.join(' '), big.length ? `(${big.length} palette-reduced)` : '');
  }
  await browser.close();
})();
