const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

// The design gallery drives the real App: shortcuts, Escape and drops must respect whichever
// dialog, menu or panel currently owns the keyboard.
let renderer;
test.beforeAll(async () => { renderer = await startRenderer(); });
test.afterAll(async () => { await renderer?.close(); });

// Escape goes to whatever has focus; wait until the dialog or menu has taken it (slower on CI).
// Radix only treats a just-opened layer as the top one after a follow-up render, so let two
// frames pass as well before pressing Escape.
async function focusInside(page, selector) {
  await expect.poll(() => page.evaluate((value) => !!document.activeElement?.closest(value), selector)).toBe(true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('Escape closes only the dialog or menu it was pressed in, and shortcuts never stack dialogs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${renderer.baseUrl}/?gallery&details=1`);
  const details = page.locator('.details-drawer');
  await expect(details).toHaveCount(1);

  // Closing Settings with Escape keeps the expanded details.
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.locator('.settings-sheet')).toBeVisible();
  await focusInside(page, '.settings-sheet');
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-sheet')).toHaveCount(0);
  await expect(details).toHaveCount(1);

  // Closing a row's More menu with Escape keeps them too.
  await page.locator('.video-row .more-action').nth(2).click({ force: true });
  await expect(page.locator('[role="menu"]')).toBeVisible();
  await focusInside(page, '[role="menu"]');
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await expect(details).toHaveCount(1);

  // Escape on the row itself still collapses them.
  await page.locator('.video-row[data-row-key="downloading"]').focus();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);

  // With the remove popover open, Settings, search and the palette stay closed.
  await page.locator('.video-row[data-state="saved"]').first().focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.remove-popover')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Comma');
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.settings-sheet')).toHaveCount(0);
  await expect(page.locator('.search-field')).toHaveCount(0);
  await expect(page.locator('.command-palette')).toHaveCount(0);
  await expect(page.locator('.remove-popover')).toBeVisible();
});

test('closing Settings with Escape keeps a pending quality choice', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${renderer.baseUrl}/?gallery&picker`);
  await expect(page.locator('.quality-picker')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.locator('.settings-sheet')).toBeVisible();
  await focusInside(page, '.settings-sheet');
  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-sheet')).toHaveCount(0);
  await expect(page.locator('.quality-picker')).toBeVisible();
});

test('link drags never reach the window behind the palette or a dialog', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${renderer.baseUrl}/?gallery`);
  const drag = (selector) => page.evaluate((target) => {
    const data = new DataTransfer();
    data.setData('text/uri-list', 'https://example.com/video');
    const element = document.querySelector(target);
    element.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }));
    const over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true });
    element.dispatchEvent(over);
    return { claimed: over.defaultPrevented, effect: data.dropEffect };
  }, selector);
  const overlay = page.getByTestId('drop-overlay');

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.command-palette')).toBeVisible();
  // Claimed (so Electron does not navigate to the link) but refused, with no overlay under the palette.
  expect(await drag('.command-palette')).toEqual({ claimed: true, effect: 'none' });
  await expect(overlay).not.toHaveClass(/\bshow\b/);
  // The palette's own field still accepts dropped text.
  expect((await drag('.command-palette input')).claimed).toBe(false);
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+Comma');
  expect(await drag('.settings-sheet')).toEqual({ claimed: true, effect: 'none' });
  await expect(overlay).not.toHaveClass(/\bshow\b/);
});

test('the Connect Chrome dialog owns the keyboard: no shortcut, paste or link drop reaches the app behind it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Only the pairing channel of the desktop bridge; the gallery ignores the rest.
  await page.addInitScript(() => {
    window.desktop = {
      onPairingShow: (callback) => { window.__showPairing = callback; return () => {}; },
      onPairingState: () => () => {},
    };
  });
  await page.goto(`${renderer.baseUrl}/?gallery`);
  await page.waitForFunction(() => typeof window.__showPairing === 'function');
  await page.evaluate(() => window.__showPairing({ requestId: 'req-1', status: 'pending', matchCode: '123456', expiresAt: Date.now() + 120000,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop', extensionVersion: '2.0.0', identity: 'unrecognized' }));
  const dialog = page.locator('.pairing-dialog');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.press('ControlOrMeta+Comma');
  await expect(page.locator('.command-palette')).toHaveCount(0);
  await expect(page.locator('.search-field')).toHaveCount(0);
  await expect(page.locator('.settings-sheet')).toHaveCount(0);

  // The dialog hides the rest of the window from the accessibility tree.
  const paste = page.locator('textarea[aria-label="Paste a video link"]');
  const before = await paste.inputValue();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://example.com/pasted-behind-the-dialog');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(paste).toHaveValue(before);

  const refused = await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/uri-list', 'https://example.com/video');
    const element = document.querySelector('.pairing-dialog');
    element.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }));
    const over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true });
    element.dispatchEvent(over);
    return { claimed: over.defaultPrevented, effect: data.dropEffect };
  });
  expect(refused).toEqual({ claimed: true, effect: 'none' });
  await expect(page.getByTestId('drop-overlay')).not.toHaveClass(/\bshow\b/);
  await expect(dialog).toBeVisible();
});

test('paste picker labels nameless audio tracks, plays a sample on hover, and Esc stops it before closing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${renderer.baseUrl}/?gallery&picker=tracks`);
  const picker = page.locator('.quality-picker');
  await expect(picker).toHaveClass(/\bwide\b/);
  await expect(picker.locator('.audio-set legend')).toHaveText('Audio 4 tracks · samples start 25% in');
  const rows = picker.locator('.atrack');
  await expect(rows.locator('.alabel b')).toHaveText(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
  await expect(rows.locator('.alabel small')).toHaveText(['Unknown language · Default', 'Unknown language', 'Unknown language', 'Unknown language']);
  await expect(rows.nth(0).locator('input')).toBeChecked();
  await expect(picker.locator('.menu-note')).toHaveText('This site doesn’t name its tracks. Rest on one to check.');
  await picker.locator('.quality-heading strong').click(); // User activation, as in the real app.
  await rows.nth(2).hover();
  await expect(rows.nth(2)).toHaveClass(/is-playing/, { timeout: 10_000 });
  await expect(picker.locator('[aria-live="polite"]')).toHaveText(/Playing a sample of Track 3/);
  await rows.nth(2).locator('input').focus();
  await page.keyboard.press('Escape');
  await expect(rows.nth(2)).not.toHaveClass(/is-playing|is-loading/);
  await expect(picker).toBeVisible();
  await rows.nth(2).locator('label').click();
  await expect(rows.nth(2).locator('input')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
});
