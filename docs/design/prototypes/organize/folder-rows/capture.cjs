// Screenshots for the folder-row options. From the repository root:
//   node docs/design/prototypes/organize/folder-rows/capture.cjs [a-pixel-folder b-adaptive-stack c-sections]
// Writes preview.png (the list state) and state-<id>.png per state into each option's folder, 1200×800 at 1x
// with reduced motion. Any PNG over 240 KB (poster-heavy shelf shots) is reduced to a 256-colour palette with
// Pillow (python3) so every file stays under ~250 KB.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const LIMIT = 240 * 1024;
const QUANTIZE = 'import sys\nfrom PIL import Image\nfor p in sys.argv[1:]:\n  Image.open(p).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(p, optimize=True)';
const { chromium } = require('@playwright/test');

const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['a-pixel-folder', 'b-adaptive-stack', 'c-sections'];

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
      await page.waitForTimeout(150);
      const win = page.locator('#window .win');
      await win.screenshot({ path: path.join(__dirname, dir, `state-${state}.png`) });
      if (state === 'list') await win.screenshot({ path: path.join(__dirname, dir, 'preview.png') });
    }
    const big = fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.png')).map((f) => path.join(__dirname, dir, f)).filter((f) => fs.statSync(f).size > LIMIT);
    if (big.length) execFileSync('python3', ['-c', QUANTIZE, ...big]);
    console.log('captured', dir, states.join(' '), big.length ? `(${big.length} palette-reduced)` : '');
  }
  await browser.close();
})();
