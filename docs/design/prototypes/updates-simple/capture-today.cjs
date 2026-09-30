// Screenshots of today's update experience from the real renderer's design gallery
// (`?gallery&update=<state>`; no update service is contacted). From the repository root:
//   node docs/design/prototypes/updates-simple/capture-today.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { startRenderer } = require('../../../../tests/e2e/helpers');

const OUT = path.join(__dirname, 'today');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const renderer = await startRenderer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const go = async (query) => {
    await page.goto(`${renderer.baseUrl}/?gallery&${query}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  try {
    await go('update=downloading&updateSheet=0'); await shot('01-chip-downloading');
    await go('update=downloading'); await shot('02-sheet-downloading');
    await go('update=ready&updateSheet=0'); await shot('03-chip-ready');
    await go('update=ready'); await shot('04-sheet-ready');
    await go('update=notes'); await shot('05-sheet-whats-new');
    await go('update=blocked'); await shot('06-sheet-blocked');
    await go('update=ready');
    await page.locator('.update-sheet').getByRole('button', { name: 'Later', exact: true }).click();
    await page.waitForTimeout(400); await shot('07-later-toast-chip-deferred');
    await go('update=installing'); await shot('08-sheet-installing');
    await go('update=error&updateSheet=0'); await shot('09-chip-failed');
    await go('update=error'); await shot('10-sheet-error');
    await go('update=checking'); await shot('11-sheet-checking');
    await go('update=uptodate'); await shot('12-sheet-uptodate');
    await go('update=ready&updateSheet=0&sheet=settings&section=about'); await shot('13-settings-ready');
    await go('update=blocked&updateSheet=0&sheet=settings&section=about'); await shot('14-settings-blocked');
    await go('update=uptodate&updateSheet=0'); await shot('15-after-relaunch');
    console.log('captured today ->', OUT);
  } finally {
    await browser.close();
    await renderer.close();
  }
})();
