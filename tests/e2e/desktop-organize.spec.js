const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

// Saved's real folders, sorting and grouping, driven through the design gallery's organise
// preview (the Pixel worlds sample library in memory; the bridge's file operations have their
// own tests with real files in tests/library-folders.test.js).
let renderer;
test.beforeAll(async () => { renderer = await startRenderer(); });
test.afterAll(async () => { await renderer?.close(); });

// Escape goes to whatever has focus; wait until the dialog or menu has taken it (see desktop-overlays).
async function focusInside(page, selector) {
  await expect.poll(() => page.evaluate((value) => !!document.activeElement?.closest(value), selector)).toBe(true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function open(page, query = '') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${renderer.baseUrl}/?gallery&organize${query}`);
  await expect(page.locator('.path-bar')).toBeVisible();
  await expect(page.locator('.saved-folder-row').first()).toBeVisible();
}
const savedTitles = (page) => page.locator('.video-row[data-state="saved"] .row-title').allTextContents();
const folderRow = (page, name) => page.locator(`.saved-folder-row[data-folder="${name}"]`);
const crumbs = (page) => page.locator('.path-bar .crumbs li').allTextContents();

test('Sort & group changes the order, names the view and is remembered per place', async ({ page }) => {
  await open(page);
  const sort = page.locator('.path-bar .sort-button');
  await expect(sort).toHaveText('Newest saved');
  const newest = await savedTitles(page);
  expect(newest[0]).toBe('Sky Hop — a play button’s day out');

  await sort.click();
  await page.getByRole('menuitemradio', { name: 'Name A–Z' }).click();
  await expect(sort).toHaveText('Name A–Z');
  const byName = await savedTitles(page);
  expect(byName).toEqual([...newest].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })));
  // Folders stay first whatever the order.
  await expect(page.locator('.video-list > [role="listitem"]').first()).toHaveClass(/folder-item/);

  // A folder has its own view; coming back finds the save folder's order again.
  await folderRow(page, 'Road trips').click();
  await expect(sort).toHaveText('Newest saved');
  await sort.click();
  await page.getByRole('menuitemradio', { name: 'Largest' }).click();
  expect(await savedTitles(page)).toEqual(['Harbour lights timelapse', 'Ember Tide — sunset crossing', 'Coast road — drive at dusk', 'Night bus to the coast', 'Neon Rain — night drive']);
  await page.locator('.path-bar .crumb.up', { hasText: 'SnagThis' }).click();
  await expect(sort).toHaveText('Name A–Z');
  expect(await savedTitles(page)).toEqual(byName);

  // All sorts every saved video below the downloads in progress; Downloading keeps queue order.
  await page.locator('.list-tabs button[data-tab="all"]').click();
  await expect(sort).toHaveText('Newest saved');
  await sort.click();
  await page.getByRole('menuitemradio', { name: 'Longest' }).click();
  const states = await page.locator('.video-list .video-row').evaluateAll((rows) => rows.map((row) => row.dataset.state));
  const firstSaved = states.indexOf('saved');
  expect(states.slice(firstSaved).every((state) => state === 'saved')).toBe(true);
  expect((await savedTitles(page))[0]).toBe('Lo-fi harbour loop (1 hour)');
  await expect(page.locator('.video-row[data-state="saved"]').first().locator('.row-location')).toHaveText('Music & ambience');
  await page.locator('.list-tabs button[data-tab="downloading"]').click();
  await expect(page.locator('.path-bar .sort-button')).toBeDisabled();
  await expect(page.locator('.path-bar .sort-button')).toHaveText('Queue order');
  await page.locator('.list-tabs button[data-tab="saved"]').click();
  await expect(sort).toHaveText('Name A–Z');
});

test('Group by site shows collapsible headers with each group’s count and size', async ({ page }) => {
  await open(page);
  await page.locator('.path-bar .sort-button').click();
  await page.getByRole('menuitemradio', { name: 'Site' }).nth(1).click();
  await expect(page.locator('.path-bar .sort-button')).toHaveText('Site · Newest');
  // The menu hands focus back to its button as it closes.
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.path-bar .sort-button')).toBeFocused();
  const headers = page.locator('.group-header');
  await expect(headers).toHaveText(['archive.org2 videos · 1.4 GB', 'dailymotion.com1 video · 505 MB', 'nebula.tv2 videos · 728 MB', 'vimeo.com2 videos · 394 MB']);
  const archive = headers.first();
  await expect(archive).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.video-row', { hasText: 'Night market in 8 bits' })).toBeVisible();
  await archive.click();
  await expect(archive).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.video-row', { hasText: 'Night market in 8 bits' })).toHaveCount(0);
  // Headers are buttons in the keyboard order of the list.
  await archive.focus();
  await page.keyboard.press('Enter');
  await expect(archive).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.video-row', { hasText: 'Night market in 8 bits' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.video-row', { hasText: 'Star Courier — boss rush' })).toBeFocused();
});

test('folders open from their row or the keyboard, and the breadcrumb and Back return', async ({ page }) => {
  await open(page);
  await expect(page.locator('.path-bar .crumb.current')).toHaveText('SnagThis');
  await expect(page.locator('.path-bar .path-text')).toHaveText('~/Downloads/SnagThis');
  await expect(folderRow(page, 'Tutorials')).toContainText('3 videos · 870 MB');
  await folderRow(page, 'Tutorials').click();
  expect(await crumbs(page)).toEqual(['SnagThis', 'Tutorials']);
  await expect(page.locator('.path-bar [aria-current="page"]')).toHaveText('Tutorials');
  await expect(page.locator('.path-bar .path-text')).toHaveText('~/Downloads/SnagThis/Tutorials');
  await expect(page.locator('.video-row .row-title')).toHaveText(['Drawing pixel rain in 20 minutes', 'Platformer physics, explained']);
  await folderRow(page, 'Tutorials/Advanced').focus();
  await page.keyboard.press('Enter');
  expect(await crumbs(page)).toEqual(['SnagThis', 'Tutorials', 'Advanced']);
  await expect(page.locator('.video-row .row-title')).toHaveText(['Palette cycling deep dive']);
  await page.locator('.path-bar .crumb.up', { hasText: 'Tutorials' }).click();
  expect(await crumbs(page)).toEqual(['SnagThis', 'Tutorials']);
  await page.locator('.path-bar .path-back').click();
  expect(await crumbs(page)).toEqual(['SnagThis']);
  await expect(folderRow(page, 'Road trips')).toBeVisible();
});

test('dragging a saved row onto a folder moves it there, and onto the breadcrumb moves it back', async ({ page }) => {
  // Tall enough that the row and the folder are both in view: a drag that scrolls the list lands on another row.
  await page.setViewportSize({ width: 1200, height: 1400 });
  await open(page);
  await page.locator('.video-row[data-row-key="g-rooftop"]').dragTo(folderRow(page, 'Watch later'));
  await expect(page.getByText('Moved “Neon Rain — rooftop chase” to Watch later')).toBeVisible();
  await expect(page.locator('.video-row[data-row-key="g-rooftop"]')).toHaveCount(0);
  await expect(folderRow(page, 'Watch later')).toContainText('3 videos · 908 MB');
  await folderRow(page, 'Watch later').click();
  await expect(page.locator('.video-row[data-row-key="g-rooftop"]')).toBeVisible();
  await page.locator('.video-row[data-row-key="g-rooftop"]').dragTo(page.locator('.path-bar .crumb.up', { hasText: 'SnagThis' }));
  await expect(page.getByText('Moved “Neon Rain — rooftop chase” to SnagThis')).toBeVisible();
  await expect(page.locator('.video-row[data-row-key="g-rooftop"]')).toHaveCount(0);
});

test('Move to… works from the keyboard, and Escape returns to the row', async ({ page }) => {
  await open(page);
  const row = page.locator('.video-row[data-row-key="g-market"]');
  await row.focus();
  await page.keyboard.press('m');
  const menu = page.getByRole('menu', { name: 'Move to' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /SnagThis/ })).toHaveAttribute('aria-disabled', 'true');
  await focusInside(page, '[role="menu"]');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();

  // The row's More menu leads to the same picker; the tree lists nested folders.
  await row.locator('.more-action').focus();
  await page.keyboard.press('Enter');
  await focusInside(page, '[role="menu"]');
  await page.getByRole('menuitem', { name: 'Move to…' }).focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await focusInside(page, '[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: /Advanced/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /Road trips/ })).toBeFocused();
  await expect(menu.locator('.menu-note')).toHaveText('Moves the file, its subtitles and poster into ~/Downloads/SnagThis/Road trips');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Moved “Night market in 8 bits” to Road trips')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(folderRow(page, 'Road trips')).toContainText('6 videos');
});

test('multi-select with ⌘/Ctrl-click and Shift-click, then move, remove from list or clear with Esc', async ({ page }) => {
  await open(page);
  const bar = page.locator('.selection-bar');
  await page.locator('.video-row[data-row-key="g-skyhop"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar).toContainText('1 selected');
  await page.locator('.video-row[data-row-key="g-speedrun"]').click({ modifiers: ['Shift'] });
  await expect(bar).toContainText('4 selected');
  await expect(page.locator('.video-item.selected')).toHaveCount(4);
  await page.locator('.video-row[data-row-key="g-boss"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar).toContainText('3 selected');

  // Esc belongs to an open menu first; the next one clears the selection.
  await page.locator('.path-bar .sort-button').click();
  await focusInside(page, '[role="menu"]');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(bar).toBeVisible();
  await page.locator('.video-row[data-row-key="g-skyhop"]').focus();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.locator('.video-item.selected')).toHaveCount(0);

  // Select again and move them together.
  await page.locator('.video-row[data-row-key="g-skyhop"]').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.video-row[data-row-key="g-commentary"]').click({ modifiers: ['ControlOrMeta'] });
  await bar.getByRole('button', { name: 'Move to…' }).click();
  const menu = page.getByRole('menu', { name: 'Move to' });
  await expect(menu.getByText('Move 2 videos to')).toBeVisible();
  await menu.getByRole('menuitem', { name: /Tutorials/ }).first().click();
  await expect(page.getByText('Moved 2 videos to Tutorials')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(folderRow(page, 'Tutorials')).toContainText('5 videos');

  // Remove from list keeps the files (it never offers Trash for a selection).
  await page.locator('.video-row[data-row-key="g-palette"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar.getByRole('button', { name: /Trash/ })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Remove from list' }).click();
  await expect(page.getByText('Removed 1 video from the list. The files stay in their folders.')).toBeVisible();
  await expect(page.locator('.video-row[data-row-key="g-palette"]')).toHaveCount(0);
});

test('deleting a folder asks Keep the videos or Move folder to Trash; an empty one just goes', async ({ page }) => {
  await open(page);
  const popover = page.locator('.folder-delete');

  // Keep the videos (the default choice).
  await folderRow(page, 'Road trips').hover();
  await folderRow(page, 'Road trips').locator('.more-action').click();
  await page.getByRole('menuitem', { name: 'Delete folder…' }).click();
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('radio', { name: /Keep the videos/ })).toHaveAttribute('aria-checked', 'true');
  await expect(popover).toContainText('It also holds 2 files SnagThis didn’t save (route.gpx, notes.txt). They go with your choice.');
  await focusInside(page, '.folder-delete');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(folderRow(page, 'Road trips')).toBeVisible();
  await folderRow(page, 'Road trips').focus();
  await page.keyboard.press('Delete');
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: 'Delete folder' }).click();
  await expect(page.getByText('Deleted “Road trips”. Its 5 videos are now in SnagThis.')).toBeVisible();
  await expect(folderRow(page, 'Road trips')).toHaveCount(0);
  await expect(page.locator('.video-row', { hasText: 'Harbour lights timelapse' })).toBeVisible();

  // Move folder to Trash.
  await folderRow(page, 'Music & ambience').focus();
  await page.keyboard.press('Delete');
  await expect(popover).toBeVisible();
  await focusInside(page, '.folder-delete');
  await page.keyboard.press('ArrowDown');
  await expect(popover.getByRole('radio', { name: /Move folder to Trash/ })).toHaveAttribute('aria-checked', 'true');
  await popover.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page.getByText('Moved “Music & ambience” and its 3 videos to the Trash')).toBeVisible();
  await expect(folderRow(page, 'Music & ambience')).toHaveCount(0);
  await page.locator('.list-tabs button[data-tab="all"]').click();
  await expect(page.locator('.video-row', { hasText: 'Lo-fi harbour loop (1 hour)' })).toHaveCount(0);
  await page.locator('.list-tabs button[data-tab="saved"]').click();

  // A new, empty folder is deleted without a choice.
  await page.locator('.path-bar').getByRole('button', { name: 'New folder' }).click();
  const name = page.getByRole('textbox', { name: 'New folder' });
  await expect(name).toBeFocused();
  await name.fill('CON');
  await name.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'reserved by Windows' })).toBeVisible();
  await name.fill('watch LATER');
  await name.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'There’s already a folder called' })).toBeVisible();
  await name.fill('Game jams');
  await name.press('Enter');
  await expect(folderRow(page, 'Game jams')).toContainText('Empty');
  await folderRow(page, 'Game jams').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByText('Deleted “Game jams”')).toBeVisible();
  await expect(popover).toHaveCount(0);
  await expect(folderRow(page, 'Game jams')).toHaveCount(0);
});

test('renaming a folder in place checks its name; a failed move says why and Try again finishes it', async ({ page }) => {
  await open(page, '=failed');
  const row = page.locator('.video-row[data-row-key="g-skyhop"]');
  await expect(row.locator('.row-status')).toHaveText('Couldn’t move to Watch later: the file is open in another app');
  await expect(page.getByText('Moved 2 of 3 videos to Watch later. 1 couldn’t move.')).toBeVisible();
  await row.getByRole('button', { name: /Try again/ }).click();
  await expect(page.getByText('Moved “Sky Hop — a play button’s day out” to Watch later')).toBeVisible();
  await expect(row).toHaveCount(0);

  await folderRow(page, 'Watch later').focus();
  await page.keyboard.press('F2');
  const field = page.getByRole('textbox', { name: 'Rename' });
  await expect(field).toBeFocused();
  await field.fill('Later.');
  await field.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'can’t end with a dot or a space' })).toBeVisible();
  await field.fill('Later/today');
  await field.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'can’t contain / or' })).toBeVisible();
  await field.fill('Later');
  await field.press('Enter');
  await expect(folderRow(page, 'Later')).toContainText('5 videos');
  await expect(folderRow(page, 'Watch later')).toHaveCount(0);
});

test('New folder… in Move to… names a folder here and moves the videos into it', async ({ page }) => {
  await open(page);
  const row = page.locator('.video-row[data-row-key="g-palette"]');
  await row.focus();
  await page.keyboard.press('m');
  await page.getByRole('menuitem', { name: 'New folder…' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog).toContainText('The new folder is made in SnagThis, and the videos move into it.');
  const name = dialog.getByRole('textbox');
  await expect(name).toBeFocused();
  await name.fill('Tutorials');
  await name.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('There’s already a folder called “Tutorials” here');
  await name.fill('Palettes');
  await dialog.getByRole('button', { name: 'Create and move' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Moved “Palette swap: dusk to dawn” to Palettes')).toBeVisible();
  await expect(folderRow(page, 'Palettes')).toContainText('1 video · 88 MB');
  // Nothing is left holding the window: the list still takes clicks.
  await folderRow(page, 'Palettes').click();
  await expect(page.locator('.path-bar [aria-current="page"]')).toHaveText('Palettes');
});
