const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

test('approved Workbench component gallery: exact states, keyboard, reduced motion and layout', async ({ page }) => {
  const renderer = await startRenderer();
  try {
    await page.setViewportSize({ width: 820, height: 820 });
    await page.goto(`${renderer.baseUrl}/?gallery=states`);
    const states = [
      ['downloading', '34% · 5 min left', '34%'],
      ['finishing', 'Finishing up…', '97%'],
      ['paused', 'Paused at 48%', '48%'],
      ['waiting', 'Waiting · starts next', '0%'],
      ['problem-expired', 'Link expired. Reopen the page to continue from 48%.', '48%'],
      ['missing', 'File was moved or deleted', '100%'],
    ];
    for (const [id, copy, progress] of states) {
      const row = page.locator(`[data-row-key="${id}"]`);
      await expect(row.locator('.row-status')).toHaveText(copy);
      await expect(row.locator('.thumb')).toHaveCSS('--p', progress);
    }
    await expect(page.locator('[data-row-key="saved"] .row-status')).toContainText('Saved today');
    await expect(page.locator('[data-row-key="placeholder"] .thumb')).toBeVisible();
    const active = page.locator('[data-row-key="downloading"]');
    await expect(active.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '34');
    await expect(page.locator('[data-row-key="finishing"] [title="Pause"]')).toHaveCount(0);
    await active.focus();
    await active.press('Enter');
    await expect(page.locator('#details-downloading')).toBeVisible();
    await active.press('Space');
    await expect(page.locator('#details-downloading')).toHaveCount(0);
    await page.mouse.move(819, 819);
    await page.screenshot({ path: test.info().outputPath('workbench-desktop-820.png'), fullPage: true });
    await page.setViewportSize({ width: 640, height: 700 });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
    await page.screenshot({ path: test.info().outputPath('workbench-desktop-640.png'), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await active.locator('.thumb').evaluate((thumb) => [...thumb.children].map((element) => ({ duration: getComputedStyle(element).transitionDuration, shadow: getComputedStyle(element).boxShadow })));
    expect(motion.every((style) => style.duration === '0s')).toBe(true);
    expect(motion.every((style) => style.shadow === 'none')).toBe(true);
  } finally { await renderer.close(); }
});

test('approved first-launch gallery provides the first-download instructions', async ({ page }) => {
  const renderer = await startRenderer();
  try {
    await page.goto(`${renderer.baseUrl}/?gallery=empty`);
    await expect(page.getByPlaceholder('Paste a video link')).toBeVisible();
    await expect(page.getByText('Download your first video', { exact: true })).toBeVisible();
    await expect(page.getByText('Paste a link above, or play a video in Chrome and click the VidSnag icon in the toolbar.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add VidSnag to Chrome', exact: true })).toBeVisible();
  } finally { await renderer.close(); }
});
