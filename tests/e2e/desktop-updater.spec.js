const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

test('approved Workbench component gallery: clean thumbnails, motion previews, accessible progress and layout', async ({ page }) => {
  const renderer = await startRenderer();
  try {
    await page.setViewportSize({ width: 820, height: 820 });
    await page.goto(`${renderer.baseUrl}/?gallery=states`);
    const states = [
      ['downloading', '34% · 5 min left'],
      ['finishing', 'Finishing up…'],
      ['paused', 'Paused at 48%'],
      ['waiting', 'Waiting · starts next'],
      ['problem-expired', 'Link expired. Reopen the page to continue from 48%.'],
      ['missing', 'File was moved or deleted'],
    ];
    for (const [id, copy] of states) {
      const row = page.locator(`[data-row-key="${id}"]`);
      await expect(row.locator('.row-status')).toHaveText(copy);
      expect(await row.locator('.thumb').evaluate((thumb) => getComputedStyle(thumb).getPropertyValue('--p'))).toBe('');
      await expect(row.locator('.thumb-ghost, .thumb-live, .thumb-edge, .thumb-duration')).toHaveCount(0);
    }
    await expect(page.locator('[data-row-key="saved"] .row-status')).toContainText('Saved today');
    await expect(page.locator('[data-row-key="placeholder"] .thumb')).toBeVisible();
    for (const [id, percent, moving] of [['downloading', 34, true], ['finishing', 97, true], ['paused', 48, false], ['problem-expired', 48, false]]) {
      const row = page.locator(`[data-row-key="${id}"]`);
      await expect(row).toHaveCSS('--row-progress', `${percent}%`);
      await expect(row).toHaveAttribute('data-progress-active', String(moving));
      const fill = row.locator(':scope > .row-fill');
      const fraction = await fill.evaluate((element) => element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width);
      expect(fraction).toBeCloseTo(percent / 100, 2);
      await expect(fill).toHaveCSS('z-index', '-1');
      await expect(row).toHaveCSS('isolation', 'isolate');
      expect(await fill.evaluate((element) => getComputedStyle(element, '::after').animationName)).toBe(moving ? 'soft-sweep' : 'none');
      const edge = row.locator(':scope > .progress-edge');
      if (moving) expect(await edge.evaluate((element) => getComputedStyle(element, '::after').animationName)).toBe('edge-travel');
      else await expect(edge).toBeHidden();
    }
    for (const id of ['waiting', 'saved', 'missing']) await expect(page.locator(`[data-row-key="${id}"] .row-fill`)).toHaveCount(0);
    const active = page.locator('[data-row-key="downloading"]');
    const progress = active.getByRole('progressbar');
    await expect(progress).toHaveAttribute('aria-valuenow', '34');
    await expect(progress).toHaveAttribute('aria-valuetext', '34% · 5 min left');
    await expect(active.locator('.thumb').getByRole('progressbar')).toHaveCount(0);
    await expect(active.locator('.row-heading .row-duration')).toHaveText('14:48');
    await expect(active.locator('.thumb .row-duration')).toHaveCount(0);
    await expect(active.locator('.thumb .row-fill, .thumb .progress-edge')).toHaveCount(0);
    await expect(active.locator('.thumb')).toHaveText('');
    await expect(active.locator('.thumb-poster')).toHaveCSS('filter', 'none');
    await expect(active.locator('.thumb-poster')).toHaveCSS('clip-path', 'none');
    await expect(active.locator('video')).toHaveCount(0);
    const expectMovingPreview = async () => {
      const video = active.locator('video');
      await expect(video).toBeVisible();
      await expect(video).toHaveCSS('opacity', '1');
      await expect(video).toHaveCSS('filter', 'none');
      await expect(video).toHaveCSS('clip-path', 'none');
      await expect(video).toHaveCSS('mix-blend-mode', 'normal');
      expect(await video.evaluate((element) => element.muted && element.loop && element.autoplay && element.playsInline)).toBe(true);
      const initialTime = await video.evaluate((element) => element.currentTime);
      await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(initialTime + 0.15);
    };
    await active.hover();
    await expectMovingPreview();
    await page.mouse.move(0, 0);
    await expect(active.locator('video')).toHaveCount(0);
    await expect(active.locator('.thumb-poster')).toBeVisible();
    await expect(page.locator('[data-row-key="finishing"] [title="Pause"]')).toHaveCount(0);
    await active.focus();
    await expectMovingPreview();
    await active.press('Enter');
    await expect(page.locator('#details-downloading')).toBeVisible();
    await active.press('Space');
    await expect(page.locator('#details-downloading')).toHaveCount(0);
    await page.getByPlaceholder('Paste a video link').focus();
    await expect(active.locator('video')).toHaveCount(0);
    await page.mouse.move(819, 819);
    await page.screenshot({ path: test.info().outputPath('workbench-desktop-820.png'), fullPage: true });
    await page.setViewportSize({ width: 640, height: 700 });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
    await page.screenshot({ path: test.info().outputPath('workbench-desktop-640.png'), fullPage: true });
    await active.hover();
    await expectMovingPreview();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(active.locator('video')).toHaveCount(0);
    await active.focus();
    await expect(active.locator('video')).toHaveCount(0);
    await expect(active.locator('.thumb-poster')).toBeVisible();
    await expect(active).toHaveCSS('--row-progress', '34%');
    await expect(active.locator('.row-fill')).toBeVisible();
    await expect(active.locator('.progress-edge')).toBeHidden();
    expect(await active.locator('.row-fill').evaluate((element) => getComputedStyle(element, '::after').display)).toBe('none');
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
