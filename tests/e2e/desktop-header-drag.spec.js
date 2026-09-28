const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

// The logo and the tabs move the window from JavaScript (useWindowDrag) instead of a native drag
// region, which would swallow their pointer events: pressing and moving drags, clicking still works.
let renderer;
test.beforeAll(async () => { renderer = await startRenderer(); });
test.afterAll(async () => { await renderer?.close(); });

test('the logo shines on hover, and the logo and tabs drag the window without swallowing clicks', async ({ page }) => {
  await page.addInitScript(() => {
    window.__drags = [];
    window.desktop = Object.assign(window.desktop || {}, {
      startWindowDrag: async () => { window.__drags.push('start'); return { ok: true }; },
      endWindowDrag: async () => { window.__drags.push('end'); return { ok: true }; },
    });
  });
  await page.goto(`${renderer.baseUrl}/?gallery`);
  const brand = page.locator('.app-brand');
  await expect(brand).toBeVisible();
  const drags = () => page.evaluate(() => window.__drags);

  // Hover shines (once per entry).
  await page.mouse.move(5, 400);
  await brand.hover();
  await expect.poll(() => brand.evaluate((element) => element.classList.contains('shining') || element.getAnimations({ subtree: true }).length > 0)).toBe(true);

  // A click on the logo (no movement) is not a drag.
  await brand.click();
  expect(await drags()).toEqual([]);

  // Pressing and moving the logo drags the window, and releasing ends the drag.
  const box = await brand.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  await expect.poll(drags).toEqual(['start', 'end']);

  // A plain click on a tab still switches it.
  const downloading = page.locator('.list-tabs button[data-tab="downloading"]');
  const saved = page.locator('.list-tabs button[data-tab="saved"]');
  await downloading.click();
  await expect(downloading).toHaveAttribute('aria-current', 'page');

  // Dragging from a tab moves the window and doesn't switch to the tab it started on.
  const tab = await saved.boundingBox();
  await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
  await page.mouse.down();
  await page.mouse.move(tab.x + tab.width / 2 + 30, tab.y + tab.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(drags).toEqual(['start', 'end', 'start', 'end']);
  await expect(downloading).toHaveAttribute('aria-current', 'page');
  await expect(saved).not.toHaveAttribute('aria-current', 'page');

  // The next real click on that tab is not swallowed.
  await saved.click();
  await expect(saved).toHaveAttribute('aria-current', 'page');
});
