const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

// A saved video's details (owner choice A · Spec sheet with H3 · Pixel shine), driven through the design
// gallery's organise preview. The bridge's probe, rename and source retention have real-file tests in
// tests/saved-details.test.js.
let renderer;
test.beforeAll(async () => { renderer = await startRenderer(); });
test.afterAll(async () => { await renderer?.close(); });

async function open(page, query, { reduced = true } = {}) {
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  // Copy page link writes through the renderer's clipboard; keep what it wrote.
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); }, readText: async () => '' } });
    localStorage.setItem('snagthis.startupSeen', '1');
  });
  await page.goto(`${renderer.baseUrl}/?gallery&organize${query}`);
  await expect(page.locator('.path-bar')).toBeVisible();
}
const labels = (page) => page.locator('.saved-spec .spec-row:not(.pending) dt').allTextContents();
const fact = (page, key) => page.locator(`.saved-spec .spec-row[data-fact="${key}"] dd`);
const harbour = (page) => page.locator('.video-row', { hasText: 'Harbour lights timelapse' });

test('opening a saved video shows the spec sheet with every known fact, in order', async ({ page }) => {
  await open(page, '=folder');
  await harbour(page).click();
  const details = page.locator('.saved-spec');
  await expect(details).toBeVisible();
  await expect(details.locator('.spec-title')).toHaveText('Harbour lights timelapse');
  await expect.poll(() => labels(page)).toEqual(['Quality', 'Length', 'Size', 'Format', 'Video', 'Frame rate', 'Audio · 2', 'Subtitles', 'Source', 'Saved', 'Folder', 'File']);
  await expect(fact(page, 'quality')).toHaveText('4K2160p · HDR10');
  await expect(fact(page, 'length')).toHaveText('4:05');
  await expect(fact(page, 'size')).toHaveText('1.8 GB');
  await expect(fact(page, 'format')).toHaveText('MP4 · HEVC Main 10');
  await expect(fact(page, 'video')).toHaveText('3840 × 2160 · 15.8 Mb/s');
  await expect(fact(page, 'fps')).toHaveText('60 fps');
  await expect(fact(page, 'audio').locator('.spec-track')).toHaveText(['EnglishStereo · AAC 256 kb/sDefault', 'Japanese5.1 · AAC 384 kb/s']);
  await expect(fact(page, 'subtitles').locator('.spec-track')).toHaveText(['EnglishIn the fileDefault', 'SpanishSide file · .srt']);
  await expect(fact(page, 'source')).toHaveText('aarchive.org · Pixel Worlds Studio');
  await expect(fact(page, 'folder').locator('.spec-crumb')).toHaveText(['SnagThis', 'Road trips']);
  await expect(fact(page, 'folder').locator('.spec-crumb.current')).toHaveText('Road trips');
  await expect(fact(page, 'file')).toHaveText('Harbour lights timelapse.mp4');
  await expect(details.locator('.spec-play')).toHaveText('Play');
  await expect(details.locator('.spec-bar button')).toHaveText([/^Show in (Finder|Explorer)$|^Open in file manager$/, 'Open original page', /Copy page link$/, 'Move to…M', 'Rename…', 'Remove…']);
  // Downloading and waiting rows keep the inspector card.
  await page.locator('.list-tabs button[data-tab="all"]').click();
  await page.locator('.video-row[data-state="downloading"]').first().click();
  await expect(page.locator('.detail-card')).toBeVisible();
  await expect(page.locator('.saved-spec')).toHaveCount(0);
});

test('facts nobody knows are left out; the missing file says so and offers Locate…', async ({ page }) => {
  await open(page, '&saved=minimal');
  await expect(page.locator('.saved-spec')).toBeVisible();
  await expect(page.locator('.saved-spec .spec-title')).toHaveText('neon-rain_final_v3');
  await expect.poll(() => labels(page)).toEqual(['Size', 'Format', 'Saved', 'Folder', 'File']);
  await expect(fact(page, 'format')).toHaveText('MP4');
  await expect(page.locator('.saved-spec .spec-bar button')).toHaveText([/^Show in|^Open in/, 'Move to…M', 'Rename…', 'Remove…']);

  await page.goto(`${renderer.baseUrl}/?gallery&organize&saved=missing`);
  const missing = page.locator('.saved-spec.missing');
  await expect(missing).toBeVisible();
  await expect(missing.locator('.spec-missing')).toContainText('File was moved or deleted');
  await expect(missing.locator('.spec-missing')).toContainText('Last seen in ~/Downloads/SnagThis/');
  await expect(missing.locator('.spec-play')).toHaveCount(0);
  await expect.poll(() => labels(page)).toEqual(['Quality', 'Length', 'Size', 'Format', 'Source', 'Saved', 'Last folder', 'File']);
  await expect(fact(page, 'size')).toHaveText('410 MB last seen');
  await expect(missing.locator('.spec-bar button')).toHaveText(['Open original page', /Copy page link$/, 'Remove from list']);
  // Remove from list only: there is no file to put in the Trash.
  await missing.locator('.spec-bar button', { hasText: 'Remove from list' }).click();
  await expect(page.locator('.remove-popover .remove-choice')).toHaveCount(1);
  await expect(page.locator('.remove-popover .remove-choice').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await missing.locator('.spec-locate').click();
  await expect(page.locator('.video-row', { hasText: 'Neon Rain — soundtrack live' })).toHaveAttribute('data-state', 'saved');
});

test('while the file is read its facts hold their places quietly', async ({ page }) => {
  await open(page, '&saved=loading');
  const grid = page.locator('.saved-spec .spec-grid');
  await expect(grid).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.saved-spec .spec-row.pending')).toHaveCount(2);
  await expect(page.locator('.saved-spec .spec-row.pending dt')).toHaveText(['Video', 'Audio']);
  await expect(page.locator('.saved-spec [role="status"]', { hasText: 'Reading the file…' })).toHaveCount(1);
  // What is already known shows at once.
  await expect(fact(page, 'size')).toHaveText('1.8 GB');
});

test('the action bar is wired: copy the page link, rename, move and remove', async ({ page }) => {
  await open(page, '&saved=rich');
  const details = page.locator('.saved-spec');
  await expect(details).toBeVisible();

  const copy = details.locator('.spec-bar button', { hasText: 'Copy page link' });
  await copy.click();
  await expect(copy).toContainText('Copied');
  expect(await page.evaluate(() => window.__copied)).toEqual(['https://archive.org/watch/g-harbour']);

  // Rename…: the folder name rules, then the new name everywhere.
  await details.locator('.spec-bar button', { hasText: 'Rename…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename video' });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('textbox', { name: 'Video name' });
  await expect(field).toHaveValue('Harbour lights timelapse');
  await field.fill('dusk/dawn');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('.folder-dialog-problem')).toHaveText('Video names can’t contain / or \\');
  await field.fill('Harbour at dusk');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Renamed to “Harbour at dusk”' })).toBeVisible();
  await expect(page.locator('.saved-spec .spec-title')).toHaveText('Harbour at dusk');
  await expect(fact(page, 'file')).toHaveText('Harbour at dusk.mp4');

  // Move to… opens the folder menu.
  await page.locator('.saved-spec .spec-bar button', { hasText: 'Move to…' }).click();
  await expect(page.getByRole('menu')).toContainText('Move to');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // Remove… still asks, with Remove from list first and focused, Move file to Trash explicit.
  await page.locator('.saved-spec .spec-bar button', { hasText: 'Remove…' }).click();
  const choices = page.locator('.remove-popover .remove-choice');
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toContainText('Remove from list');
  await expect(choices.nth(0)).toBeFocused();
  await expect(choices.nth(1)).toContainText('Move file to Trash');
  await page.keyboard.press('Escape');
  await expect(page.locator('.remove-popover')).toHaveCount(0);

  // The row's ⋯ menu has Rename… too.
  const row = page.locator('.video-row', { hasText: 'Harbour at dusk' });
  await row.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A folder segment opens that folder in Saved.
  await page.locator('.saved-spec .spec-crumb', { hasText: 'SnagThis' }).click();
  await expect(page.locator('.path-bar .crumb.current')).toHaveText('SnagThis');
  await expect(page.locator('.saved-spec')).toHaveCount(0);
});

test('keyboard: Enter opens the details and Tab reaches Play, the folder and every action with a visible ring', async ({ page }) => {
  await open(page, '=folder');
  const row = harbour(page);
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.saved-spec')).toBeVisible();
  const reached = [];
  for (let step = 0; step < 16 && !reached.includes('Remove…'); step += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      return element?.closest('.saved-spec') ? { text: element.textContent.trim(), ring: getComputedStyle(element).boxShadow } : null;
    });
    if (focused) {
      reached.push(focused.text);
      expect(focused.ring, `${focused.text} shows focus`).not.toBe('none');
    }
  }
  expect(reached[0]).toBe('Play');
  expect(reached).toEqual(expect.arrayContaining(['SnagThis', 'Road trips', 'Rename…', 'Remove…']));
  expect(reached.some((text) => text.endsWith('Copy page link'))).toBe(true);
  // Escape closes the details again.
  await row.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.saved-spec')).toHaveCount(0);
});

test('motion: the sheet eases open with staggered facts and H3 shines once on hover; reduced motion is instant with a short fade', async ({ page }) => {
  await open(page, '=folder', { reduced: false });
  await harbour(page).click();
  const drawer = page.locator('.details-drawer.spec');
  await expect(drawer).toHaveClass(/open/);
  expect(await drawer.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0.24s');
  const delays = await page.locator('.saved-spec .spec-row').evaluateAll((rows) => rows.map((row) => [getComputedStyle(row).animationName, parseFloat(getComputedStyle(row).animationDelay)]));
  expect(delays.every(([name]) => name === 'spec-rise')).toBe(true);
  expect(delays.map(([, delay]) => delay)).toEqual([...delays.map(([, delay]) => delay)].sort((a, b) => a - b));
  const action = page.locator('.saved-spec .spec-bar button').first();
  await action.hover();
  expect(await action.evaluate((element) => getComputedStyle(element, '::before').animationName)).toBe('px-shine');
  expect(await action.evaluate((element) => getComputedStyle(element, '::before').animationIterationCount)).toBe('1');
  await page.locator('.saved-spec .spec-play').hover();
  expect(await page.locator('.saved-spec .spec-play').evaluate((element) => getComputedStyle(element, '::before').animationName)).toBe('px-shine');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await harbour(page).click();
  await expect(page.locator('.saved-spec')).toHaveCount(0);
  await harbour(page).click();
  await expect(drawer).toHaveClass(/open/);
  expect(await drawer.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
  const card = page.locator('.saved-spec .spec-card');
  expect(await card.evaluate((element) => [getComputedStyle(element).animationName, getComputedStyle(element).animationDuration])).toEqual(['spec-fade', '0.12s']);
  expect(await page.locator('.saved-spec .spec-row').first().evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await action.hover();
  expect(await action.evaluate((element) => getComputedStyle(element, '::before').animationName)).toBe('none');
});
