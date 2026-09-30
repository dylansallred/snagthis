const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

// Updates, direction C · Dedicated sheet: the header chip, the update sheet and the Settings summary,
// driven through the design gallery's `update=<state>` previews (no update service is contacted).
let renderer;
test.beforeAll(async () => { renderer = await startRenderer(); });
test.afterAll(async () => { await renderer?.close(); });

// Escape goes to whatever has focus; wait until the sheet has taken it before pressing it.
async function focusInside(page, selector) {
  await expect.poll(() => page.evaluate((value) => !!document.activeElement?.closest(value), selector)).toBe(true);
}
const open = async (page, query) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${renderer.baseUrl}/?gallery&${query}`);
};

test('a ready update shows the NEW chip, which opens the sheet with tagged notes; Esc closes it', async ({ page }) => {
  await open(page, 'update=ready&updateSheet=0');
  const chip = page.locator('.top-bar .update-chip');
  await expect(chip).toHaveAttribute('data-kind', 'ready');
  await expect(chip).toHaveText('NEW 1.1.0');
  await expect(chip).toHaveAccessibleName('SnagThis 1.1.0 is ready. See what’s new');
  await expect(page.locator('.update-sheet')).toHaveCount(0);

  await chip.click();
  const sheet = page.getByRole('dialog', { name: 'SnagThis 1.1.0 is ready' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.update-hero-version')).toHaveText('New version1.1.0');
  const notes = sheet.locator('.update-notes li');
  await expect(notes).toHaveCount(3);
  await expect(notes.locator('.update-tag')).toHaveText(['New', 'New', 'Better']);
  await expect(notes.first().locator('strong')).toHaveText('Accent colours.');
  await expect(notes.first().locator('span')).toHaveText('Pick Orange, Cobalt, Violet, Mint or Magenta. Chrome follows along.');
  await sheet.getByRole('button', { name: 'See all 5 changes' }).click();
  await expect(notes).toHaveCount(5);
  await expect(notes.locator('.update-tag')).toHaveText(['New', 'New', 'Better', 'Fixed', 'Fixed']);
  // Every row keeps the badge beside its text.
  expect(await notes.evaluateAll((items) => items.every((item) => item.children[1].getBoundingClientRect().left > item.children[0].getBoundingClientRect().right))).toBe(true);
  // The installer guide under the release notes is not a change.
  await expect(sheet).not.toContainText('SnagThis-mac-arm64.dmg');
  await expect(sheet.getByRole('button', { name: 'Full release notes on GitHub' })).toBeVisible();
  await expect(sheet.getByText('You’re on 1.0.0', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Restart & install' })).toBeEnabled();

  await focusInside(page, '.update-sheet');
  await page.keyboard.press('Escape');
  await expect(page.locator('.update-sheet')).toHaveCount(0);
  await expect(chip).toBeVisible();
});

test('Later closes the sheet, toasts the reminder time with Undo, and the chip shows that time', async ({ page }) => {
  await open(page, 'update=ready');
  const sheet = page.locator('.update-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Reminding you at' });
  await expect(toast).toBeVisible();
  const time = (await toast.locator('[data-title]').textContent()).replace('Reminding you at ', '').trim();
  // The locale's short time, never a full date.
  expect(time).toMatch(/^\d{1,2}[:.]\d{2}/);
  expect(time).not.toMatch(/\d{4}|\//);
  const chip = page.locator('.top-bar .update-chip');
  await expect(chip).toHaveAttribute('data-kind', 'deferred');
  await expect(chip).toHaveText(`1.1.0 · ${time}`);

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('dialog', { name: 'SnagThis 1.1.0 is ready' })).toBeVisible();
  await expect(chip).toHaveAttribute('data-kind', 'ready');
});

test('active downloads block the install: they are listed and Install when downloads finish can be turned off', async ({ page }) => {
  await open(page, 'update=blocked');
  const sheet = page.locator('.update-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.update-description')).toHaveText(/^\d downloads are still running\. Restarting now would interrupt them\.$/);
  const waiting = sheet.getByRole('list', { name: 'Downloads still running' }).locator('li');
  await expect(waiting.first()).toContainText('Neon Rain — night drive');
  await expect(waiting.first()).toContainText('34%');
  await expect(waiting.first().locator('.update-waiting-cells i')).toHaveCount(12);
  const wait = sheet.getByRole('checkbox', { name: 'Install when downloads finish' });
  await expect(wait).toBeChecked();
  await expect(sheet.getByRole('button', { name: 'Restart & install' })).toBeDisabled();
  await expect(sheet.locator('.update-foot-note')).toHaveText('Installs when downloads finish');
  await wait.uncheck();
  await expect(wait).not.toBeChecked();
  await expect(sheet.locator('.update-foot-note')).toHaveText('Available when downloads finish');
  // Unticked stays unticked for this version, even after reopening.
  await focusInside(page, '.update-sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.locator('.top-bar .update-chip').click();
  await expect(wait).not.toBeChecked();
  await wait.check();
  await expect(wait).toBeChecked();
  await focusInside(page, '.update-sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Settings ▸ Updates & support summarises it and opens the same sheet above Settings.
  await page.keyboard.press('ControlOrMeta+Comma');
  const settings = page.locator('.settings-sheet');
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: 'Updates & support' }).click();
  await expect(settings.locator('.update-summary-hint')).toHaveText(/^1\.1\.0 installs after \d downloads finish$/);
  await settings.getByRole('button', { name: 'See update' }).click();
  await expect(sheet).toBeVisible();
  await focusInside(page, '.update-sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(settings).toBeVisible();
});

test('an update error explains itself, keeps raw text behind Details, and Try again checks again', async ({ page }) => {
  await open(page, 'update=error');
  const chip = page.locator('.top-bar .update-chip');
  await expect(chip).toHaveAttribute('data-kind', 'failed');
  await expect(chip).toHaveText('Update failed');
  const sheet = page.getByRole('dialog', { name: 'Couldn’t download the update' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.update-description')).toHaveText('The connection dropped at 38 of 92 MB. You’re still on 1.0.0; nothing changed.');
  const raw = sheet.locator('.update-details pre');
  await expect(raw).toBeHidden();
  await sheet.getByText('Details', { exact: true }).click();
  await expect(raw).toBeVisible();
  await expect(raw).toContainText('net::ERR_CONNECTION_RESET');
  await expect(sheet.getByRole('button', { name: 'Download installer' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('dialog', { name: 'Checking for updates…' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'You’re up to date' })).toBeVisible();
  await expect(chip).toHaveCount(0);
});

test('a downloading update shows its bytes and time left, and Keep snagging closes the sheet', async ({ page }) => {
  await open(page, 'update=downloading');
  const chip = page.locator('.top-bar .update-chip');
  await expect(chip).toHaveText('41%');
  const sheet = page.getByRole('dialog', { name: 'Downloading SnagThis 1.1.0' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('progressbar', { name: 'Update download' })).toHaveAttribute('aria-valuenow', '41');
  await expect(sheet.locator('.update-progress-meta')).toHaveText('38 of 92 MBabout 20 s left');
  await sheet.getByRole('button', { name: 'Keep snagging' }).click();
  await expect(page.locator('.update-sheet')).toHaveCount(0);
});
