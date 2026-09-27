const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

test('approved Workbench component gallery: clean thumbnails, motion previews, accessible progress and layout', async ({ page }) => {
  const renderer = await startRenderer();
  try {
    await page.setViewportSize({ width: 820, height: 820 });
    await page.goto(`${renderer.baseUrl}/?gallery=states`);
    await expect(page.locator('.top-bar').getByRole('img', { name: 'SnagThis', exact: true })).toBeVisible();
    await expect(page.locator('.top-bar')).toHaveCSS('padding-left', '14px');
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
    await expect(page.locator('[data-row-key="saved"] .saved-badge')).toHaveText('Saved today');
    await expect(page.locator('[data-row-key="saved"] .thumb .saved-badge')).toHaveCount(0);
    await expect(page.locator('[data-row-key="placeholder"] .thumb')).toBeVisible();
    const expectPiecesLayout = async (row) => {
      expect(await row.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const lane = element.querySelector('.progress-pieces').getBoundingClientRect();
        const thumb = element.querySelector('.thumb').getBoundingClientRect();
        const main = ['.row-text', '.row-actions'].map(selector => element.querySelector(selector).getBoundingClientRect());
        return lane.top > Math.max(...main.map(part => part.bottom)) && Math.abs(lane.left - main[0].left) < 1 && Math.abs(bounds.right - lane.right - 14) < 1 && Math.abs(thumb.height - bounds.height) < 1 && bounds.height <= 100;
      })).toBe(true);
    };
    for (const [id, percent, moving] of [['downloading', 34, true], ['finishing', 97, true], ['paused', 48, false], ['problem-expired', 48, false]]) {
      const row = page.locator(`[data-row-key="${id}"]`);
      await expect(row).toHaveAttribute('data-progress', String(percent));
      await expect(row).toHaveAttribute('data-progress-active', String(moving));
      await expect(row.locator('.row-fill, .progress-edge')).toHaveCount(0);
      const pieces = row.locator(':scope > .progress-pieces');
      await expect(pieces).toBeVisible();
      await expect(pieces.locator('.progress-piece')).toHaveCount(40);
      await expect(pieces.locator('.progress-piece.done')).toHaveCount(Math.floor(percent / 100 * 40));
      await expect(pieces.locator('.progress-piece.current')).toHaveCount(1);
      expect(await pieces.locator('.progress-piece.current').evaluate((element) => getComputedStyle(element, '::after').animationName)).toBe(moving ? 'piece-working' : 'none');
      if (!moving) await expect(pieces).toHaveCSS('opacity', '0.62');
      await expectPiecesLayout(row);
    }
    for (const id of ['waiting', 'saved', 'missing']) await expect(page.locator(`[data-row-key="${id}"] .progress-pieces`)).toHaveCount(0);
    const active = page.locator('[data-row-key="downloading"]');
    const progress = active.getByRole('progressbar');
    await expect(progress).toHaveAttribute('aria-valuenow', '34');
    await expect(progress).toHaveAttribute('aria-valuetext', '34% · 5 min left');
    await expect(active.locator('.thumb').getByRole('progressbar')).toHaveCount(0);
    await expect(active.locator('.row-heading .row-duration')).toHaveText('12:37');
    await expect(active.locator('.thumb .row-duration')).toHaveCount(0);
    await expect(active.locator('.thumb .row-fill, .thumb .progress-edge')).toHaveCount(0);
    await expect(active.locator('.thumb .progress-pieces')).toHaveCount(0);
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
    await page.keyboard.press('Tab');
    await active.focus();
    await expectMovingPreview();
    await active.press('Enter');
    await expect(page.locator('#details-downloading')).toBeVisible();
    await expect(page.locator('#details-downloading .detail-folder-name')).toBeVisible();
    await expect(page.locator('#details-downloading .technical-details')).toHaveCount(0);
    await expect(page.locator('#details-downloading .detail-location')).toHaveJSProperty('tagName', 'BUTTON');
    await expect(page.locator('#details-downloading .detail-folder-name')).toHaveText('~/Downloads/SnagThis');
    await expect(page.locator('#details-downloading [data-connections]')).toBeVisible();
    await expect(page.locator('#details-downloading [data-connections]')).toHaveText('6 of 16 active');
    const activeDetails = page.locator('#details-downloading');
    await expect(activeDetails).toHaveCSS('transform', 'none'); // the drawer has finished sliding open
    await expect(activeDetails).toHaveCSS('padding-left', '14px');
    await expect(activeDetails.locator('.detail-card .speed-chart svg')).toBeVisible();
    await expect(activeDetails.locator('[data-speed]')).toHaveText('3.91 MB/s');
    await expect(activeDetails.locator('.row-facts dt').first()).toHaveCSS('color', 'rgb(137, 146, 159)');
    await expect(activeDetails.locator('.detail-text-action svg').first()).toHaveCSS('width', '14px');
    await activeDetails.screenshot({ path: test.info().outputPath('streamlined-corrected-820.png') });
    await expect(activeDetails.locator('.detail-card .pieces-panel canvas')).toBeVisible();
    await expect(activeDetails.locator('.pieces-legend')).toHaveText('CompletedDownloadingRetryingPending');
    await expect(activeDetails.locator('.technical-details .pieces-panel')).toHaveCount(0);
    await expect(activeDetails.locator('[data-transfer-size]')).toHaveText('714 MB / ~2.1 GB');
    for (const label of ['Copy link', 'Open page', 'Cancel download']) {
      const action = activeDetails.getByRole('button', { name: label, exact: true });
      await expect(action).toHaveAttribute('title', label);
      // The copy confirmation reserves label width with an aria-hidden span.
      // Assert the rendered text and accessible name, not that hidden duplicate.
      await expect(action).toHaveText(label, { useInnerText: true });
      await expect(action).toHaveAccessibleName(label);
      await expect(action.locator('svg')).toHaveCount(1);
    }
    expect(await activeDetails.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(await active.evaluate(element => getComputedStyle(element).backgroundColor));
    await expect(active).toHaveCSS('outline-style', 'none');
    await expect(active).not.toHaveCSS('box-shadow', 'none');
    await active.click();
    await expect(active).toHaveCSS('box-shadow', 'none');
    await active.press('Enter');
    await expect(active).not.toHaveCSS('box-shadow', 'none');
    await expect(page.locator('#details-downloading .technical-details')).toHaveCount(0);
    await active.press('Space');
    await expect(page.locator('#details-downloading')).toHaveCount(0);
    const finishing = page.locator('[data-row-key="finishing"]');
    await finishing.focus();
    await finishing.press('Enter');
    await expect(page.locator('#details-finishing [data-connections]')).toHaveText('Not reported by this downloader · limit 16');
    await expect(page.locator('#details-finishing [data-transfer-size]')).toHaveText('1.1 GB / 1.2 GB');
    await expect(page.locator('#details-finishing .technical-details')).toHaveCount(0);
    await finishing.press('Space');
    const savedRow = page.locator('[data-row-key="saved"]');
    await savedRow.press('Enter');
    const savedDetails = page.locator('#details-saved');
    await expect(savedDetails).toHaveCSS('transform', 'none'); // the drawer has finished sliding open
    const folderAction = savedDetails.getByRole('button', { name: /^Saved in/ });
    await expect(folderAction).toHaveClass('detail-location');
    await expect(folderAction).toHaveAttribute('title', 'Open folder: ~/Downloads/SnagThis');
    await expect(folderAction).toContainText('Saved in');
    await expect(folderAction.locator('.detail-folder-name')).toHaveText('~/Downloads/SnagThis');
    // Closed/open folder layers plus the chevron form Open + settle.
    await expect(folderAction.locator('svg')).toHaveCount(3);
    await expect(savedDetails.locator('.detail-links .lucide-folder-open')).toHaveCount(0);
    await expect(savedDetails.locator('.detail-links > button')).toHaveCount(3);
    await expect(savedDetails.locator('.technical-details')).toHaveCount(0);
    await expect(savedDetails.getByText('Technical details', { exact: true })).toHaveCount(0);
    await expect(savedDetails.getByText('Full path', { exact: true })).toHaveCount(0);
    await expect(savedDetails.locator('.speed-chart')).toHaveCount(0);
    // Inspector card: folder header, then facts, then one footer row of labelled actions with Remove set apart.
    const cardLayout = await savedDetails.evaluate(element => {
      const card = element.querySelector('.detail-card').getBoundingClientRect();
      const folder = element.querySelector('.detail-location').getBoundingClientRect();
      const facts = element.querySelector('.row-facts').getBoundingClientRect();
      const actions = element.querySelector('.detail-links').getBoundingClientRect();
      return folder.top - card.top < 2 && facts.top >= folder.bottom && actions.top >= facts.bottom && Math.abs(actions.bottom - card.bottom) < 2;
    });
    expect(cardLayout).toBe(true);
    const removeAction = savedDetails.getByRole('button', { name: 'Remove…', exact: true });
    await expect(removeAction).toHaveAttribute('title', 'Remove…');
    await expect(removeAction).toHaveText('Remove…');
    await expect(removeAction.locator('svg')).toHaveCount(1);
    // Read both positions in one browser task: another drawer may still be
    // collapsing above this one, moving both buttons between separate calls.
    const actionSpacing = await savedDetails.evaluate(element => {
      const copy = element.querySelector('.detail-links .copy-action').getBoundingClientRect();
      const remove = element.querySelector('.detail-links .destructive-text').getBoundingClientRect();
      return { vertical: remove.y - copy.y, horizontal: remove.x - copy.x };
    });
    expect(actionSpacing.vertical).toBe(0);
    expect(actionSpacing.horizontal).toBeGreaterThan(300);
    await savedDetails.screenshot({ path: test.info().outputPath('saved-details-aligned.png') });
    await savedRow.press('Space');
    const expiredRow = page.locator('[data-row-key="problem-expired"]');
    await expiredRow.press('Enter');
    await expect(page.locator('#details-problem-expired .detail-problem')).toContainText('SOURCE_EXPIRED');
    await expect(page.locator('#details-problem-expired .technical-details')).toHaveCount(0);
    await expiredRow.press('Space');
    await page.getByPlaceholder('Paste a video link').focus();
    await page.mouse.move(819, 819);
    await expect(active.locator('video')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('workbench-desktop-820.png'), fullPage: true });
    await page.setViewportSize({ width: 640, height: 700 });
    await active.click();
    await expect(page.locator('#details-downloading .detail-location')).toBeVisible();
    expect(await page.locator('#details-downloading').evaluate(element => {
      const location = element.querySelector('.detail-location');
      return element.scrollWidth <= element.clientWidth && location.scrollWidth <= location.clientWidth;
    })).toBe(true);
    await page.locator('#details-downloading').screenshot({ path: test.info().outputPath('streamlined-details-640.png') });
    await active.click();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
    await expectPiecesLayout(active);
    await page.screenshot({ path: test.info().outputPath('workbench-desktop-640.png'), fullPage: true });
    await active.hover();
    await expectMovingPreview();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(active.locator('video')).toHaveCount(0);
    await active.focus();
    await expect(active.locator('video')).toHaveCount(0);
    await expect(active.locator('.thumb-poster')).toBeVisible();
    await expect(active).toHaveAttribute('data-progress', '34');
    await expect(active.locator('.progress-pieces')).toBeVisible();
    await expect(active.locator('.progress-piece.done')).toHaveCount(13);
    expect(await active.locator('.progress-piece.current').evaluate((element) => getComputedStyle(element, '::after').display)).toBe('none');
    expect(await active.locator('.progress-piece.current').evaluate((element) => getComputedStyle(element, '::after').animationName)).toBe('none');
    const motion = await active.locator('.thumb').evaluate((thumb) => [...thumb.children].map((element) => ({ duration: getComputedStyle(element).transitionDuration, shadow: getComputedStyle(element).boxShadow })));
    expect(motion.every((style) => style.duration === '0s')).toBe(true);
    expect(motion.every((style) => style.shadow === 'none')).toBe(true);
  } finally { await renderer.close(); }
});

test('desktop preview stops on pointer exit and hands off between rows without retained mouse focus', async ({ page }) => {
  const renderer = await startRenderer();
  try {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto(`${renderer.baseUrl}/?gallery=states`);
    const first = page.locator('[data-row-key="downloading"]');
    const second = page.locator('[data-row-key="finishing"]');
    const moving = async row => {
      await expect(row.locator('video.thumb-preview')).toHaveCount(1);
      await expect.poll(() => row.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(.15);
      await expect(page.locator('video.thumb-preview')).toHaveCount(1);
    };
    await first.hover();
    await moving(first);
    // Pointer clicks retain DOM focus after the details drawer is closed.
    await first.click();
    await first.click();
    await expect(first).toBeFocused();
    const oldVideo = await first.locator('video').elementHandle();
    await second.hover();
    await expect(first.locator('video')).toHaveCount(0);
    await expect.poll(() => oldVideo.evaluate(video => video.paused && !video.getAttribute('src'))).toBe(true);
    await moving(second);
    await page.locator('.top-bar').hover();
    await expect(page.locator('video.thumb-preview')).toHaveCount(0);

    // Keyboard previews still follow focus, with only one video playing.
    await first.press('ArrowDown');
    await expect(second).toBeFocused();
    await moving(second);
    await second.press('ArrowUp');
    await expect(first).toBeFocused();
    await moving(first);
    await second.hover();
    await expect(first.locator('video')).toHaveCount(0);
    await moving(second);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('video.thumb-preview')).toHaveCount(0);
  } finally { await renderer.close(); }
});

test('approved first-launch gallery provides the first-download instructions', async ({ page }) => {
  const renderer = await startRenderer();
  try {
    await page.goto(`${renderer.baseUrl}/?gallery=empty`);
    await expect(page.getByPlaceholder('Paste a video link')).toBeVisible();
    await expect(page.getByText('Download your first video', { exact: true })).toBeVisible();
    await expect(page.getByText('Paste a link above, or play a video in Chrome and click the SnagThis icon in the toolbar.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add SnagThis to Chrome', exact: true })).toBeVisible();
  } finally { await renderer.close(); }
});

test('settings sections swap from the rail, confirm saves, pick an accent and validate number fields', async ({ page }) => {
  const renderer = await startRenderer();
  try {
    await page.setViewportSize({ width: 960, height: 660 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${renderer.baseUrl}/?gallery=states&sheet=settings`);
    const sheet = page.locator('.settings-sheet');
    await expect(sheet).toBeVisible();
    expect(Math.round((await sheet.boundingBox()).width)).toBe(640);
    const rail = sheet.getByRole('tablist', { name: 'Settings sections' });
    await expect(rail.getByRole('tab')).toHaveText(['Chrome extension', 'Downloads', 'App', 'Appearance', 'Advanced', 'Updates & support']);
    // Downloads is the first section shown in a session.
    await expect(rail.getByRole('tab', { name: 'Downloads' })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.getByRole('tabpanel', { name: 'Downloads' })).toContainText('Save videos to');

    await rail.getByRole('tab', { name: 'App', exact: true }).click();
    await page.getByLabel('Tell me when a download finishes', { exact: true }).click();
    await expect(sheet.locator('.saved-mark')).toContainText('Saved');
    await expect(page.getByRole('status').filter({ hasText: 'Tell me when a download finishes saved' })).toHaveCount(1);

    // Arrow keys move through the rail and show each section.
    await rail.getByRole('tab', { name: 'App', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rail.getByRole('tab', { name: 'Appearance' })).toBeFocused();
    const accents = sheet.getByRole('radiogroup', { name: 'Accent colour' });
    await expect(accents.getByRole('radio')).toHaveCount(5);
    await expect(accents.getByRole('radio', { name: 'Orange' })).toBeChecked();
    await accents.getByRole('radio', { name: 'Cobalt' }).check();
    await expect(accents.getByRole('radio', { name: 'Cobalt' })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Accent colour saved' })).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(accents.getByRole('radio', { name: 'Violet' })).toBeChecked();
    await page.evaluate(() => localStorage.removeItem('snagthis.accent'));

    await rail.getByRole('tab', { name: 'Appearance' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(rail.getByRole('tab', { name: 'Advanced' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Downloads at once', { exact: true })).toBeInViewport();
    await page.getByLabel('Downloads at once', { exact: true }).fill('40');
    await page.getByLabel('Downloads at once', { exact: true }).press('Enter');
    await expect(sheet.getByText('Enter a whole number from 1 to 16.')).toBeVisible();
    // Esc first reverts the unsaved value; a second Esc closes the sheet.
    await page.getByLabel('Downloads at once', { exact: true }).press('Escape');
    await expect(page.getByLabel('Downloads at once', { exact: true })).toHaveValue('1');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // Reopening keeps the last section; Already installed? Connect Chrome lands on the extension setup.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sheet.getByRole('tab', { name: 'Advanced' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await page.goto(`${renderer.baseUrl}/?gallery=empty`);
    await page.getByRole('button', { name: 'Already installed? Connect Chrome', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Chrome extension setup' }).getByRole('button', { name: 'Show connection code', exact: true })).toBeVisible();

    // A narrow 640px window keeps the rail and a usable pane.
    await page.setViewportSize({ width: 640, height: 560 });
    await expect(sheet).toBeVisible();
    expect(Math.round((await sheet.boundingBox()).width)).toBe(640);
    await sheet.getByRole('tab', { name: 'Downloads' }).click();
    await expect(sheet.getByRole('button', { name: 'Change save folder' })).toBeInViewport();
  } finally { await renderer.close(); }
});
