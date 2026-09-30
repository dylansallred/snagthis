const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

// Updates, option B · Install on quit or idle (spec §8.1): the quiet header chip and its popover, the
// "Updated to" toast and the Settings summary row, driven through the design gallery's
// `update=<state>` previews (no update service is contacted).
let renderer;
test.beforeAll(async () => { renderer = await startRenderer(); });
test.afterAll(async () => { await renderer?.close(); });

const open = async (page, query) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${renderer.baseUrl}/?gallery&${query}`);
  await expect(page.locator('.top-bar')).toBeVisible();
};
const chipIn = (page) => page.locator('.top-bar .update-chip');
async function openUpdateSettings(page) {
  const settings = page.locator('.settings-sheet');
  await expect(settings).toBeVisible();
  return settings.locator('.settings-row').filter({ has: page.locator('#update-status-label') });
}

test('a ready update is a quiet "1.1.0 ready" chip whose popover has What’s new and Restart now', async ({ page }) => {
  await open(page, 'update=ready');
  const chip = chipIn(page);
  await expect(chip).toHaveAttribute('data-kind', 'ready');
  await expect(chip).toHaveText('1.1.0 ready');
  await expect(chip).toHaveAccessibleName('SnagThis 1.1.0 is ready. Show update');
  await expect(chip.locator('.update-chip-version')).toHaveCSS('font-family', /Jersey 15/);
  await expect(page.locator('.update-popover')).toHaveCount(0);

  await chip.click();
  const popover = page.getByRole('dialog', { name: 'SnagThis 1.1.0 is ready' });
  await expect(popover).toBeVisible();
  const notes = popover.locator('.update-notes li');
  await expect(notes).toHaveCount(3);
  await expect(notes.locator('.update-tag')).toHaveText(['New', 'New', 'Better']);
  await expect(notes.first().locator('strong')).toHaveText('Accent colours.');
  // The installer guide under the release notes is not a change.
  await expect(popover).not.toContainText('SnagThis-mac-arm64.dmg');
  await expect(popover.locator('.update-pop-line')).toHaveText('Installs next time you quit SnagThis, or restart now.');
  await expect(popover.getByRole('button', { name: 'Full release notes' })).toBeVisible();
  // Nothing about Later, reminders or waiting for downloads.
  await expect(popover.getByRole('button', { name: /Later|Remind/ })).toHaveCount(0);
  await expect(popover.getByRole('checkbox')).toHaveCount(0);

  await expect(popover).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(chip).toBeFocused();

  await chip.click();
  await popover.getByRole('button', { name: 'Restart now' }).click();
  await expect(popover).toHaveCount(0);
  const restarting = chipIn(page);
  await expect(restarting).toHaveAttribute('data-kind', 'restarting');
  await expect(restarting).toHaveText('Restarting…');
  await expect(restarting).toHaveRole('status');
});

test('with downloads running, Restart now is disabled and says when it becomes available', async ({ page }) => {
  await open(page, 'update=blocked&updatePopover=1');
  const popover = page.getByRole('dialog', { name: 'SnagThis 1.1.0 is ready' });
  await expect(popover).toBeVisible();
  const restart = popover.getByRole('button', { name: 'Restart now' });
  await expect(restart).toBeDisabled();
  const note = popover.locator('.update-pop-note');
  await expect(note).toHaveText(/^After \d downloads finish$/);
  await expect(restart).toHaveAccessibleDescription(await note.textContent());
});

test('downloading and up to date show no chip: updates arrive silently', async ({ page }) => {
  for (const state of ['downloading', 'checking', 'uptodate']) {
    await open(page, `update=${state}`);
    await expect(chipIn(page)).toHaveCount(0);
  }
});

test('after an update, one fading "Updated to 1.1.0" toast opens What’s new, and nothing lingers', async ({ page }) => {
  await open(page, 'update=updated');
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Updated to 1.1.0' });
  await expect(toast).toHaveCount(1);
  await expect(chipIn(page)).toHaveCount(0);
  await toast.getByRole('button', { name: 'What’s new' }).click();
  const notes = page.getByRole('dialog', { name: 'What’s new in 1.1.0' });
  await expect(notes).toBeVisible();
  await expect(notes.locator('.update-notes li')).toHaveCount(5);
  await expect(notes.locator('.update-tag')).toHaveText(['New', 'New', 'Better', 'Fixed', 'Fixed']);
  await expect(toast).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(notes).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

  // Left alone (the pointer away from it, since hovering pauses it), the toast fades by itself and is not shown again.
  await page.mouse.move(10, 300);
  await open(page, 'update=updated');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(page.locator('.update-popover')).toHaveCount(0);
});

test('a failed install shows an amber chip with the friendly error, Details, Download installer and Try again', async ({ page }) => {
  await open(page, 'update=failed-install');
  const chip = chipIn(page);
  await expect(chip).toHaveAttribute('data-kind', 'failed');
  await expect(chip).toHaveText('1.1.0 didn’t install');
  await chip.click();
  const popover = page.getByRole('dialog', { name: 'Couldn’t install 1.1.0' });
  await expect(popover).toBeVisible();
  await expect(popover.locator('.update-pop-line')).toHaveText('The installer didn’t finish. You’re still on 1.0.0; nothing changed.');
  const raw = popover.locator('.update-details pre');
  await expect(raw).toBeHidden();
  await popover.getByText('Details', { exact: true }).click();
  await expect(raw).toContainText('the app reopened on 1.0.0');
  await expect(popover.getByRole('button', { name: 'Download installer' })).toBeVisible();
  await popover.getByRole('button', { name: 'Try again' }).click();
  // Try again checks; the gallery's check finds nothing newer.
  await expect(chip).toHaveCount(0);

  await open(page, 'update=error');
  await expect(chipIn(page)).toHaveText('1.1.0 didn’t download');
  await chipIn(page).click();
  await expect(page.getByRole('dialog', { name: 'Couldn’t download 1.1.0' }).locator('.update-pop-line')).toHaveText('The connection dropped at 38 of 92 MB. You’re still on 1.0.0; nothing changed.');
});

test('Settings ▸ Updates & support is one summary row: Up to date, 1.1.0 ready · Restart now, Couldn’t update · Details', async ({ page }) => {
  await open(page, 'update=uptodate&sheet=settings&section=about');
  let row = await openUpdateSettings(page);
  await expect(row.locator('.update-summary-hint')).toHaveText('Up to date · checked just now');
  await row.getByRole('button', { name: 'Check now' }).click();
  await expect(row.locator('.update-summary-hint')).toHaveText('Checking for updates…');
  await expect(row.getByRole('button', { name: 'Check now' })).toBeDisabled();
  await expect(row.locator('.update-summary-hint')).toHaveText('Up to date · checked just now');
  await expect(page.getByLabel('Check automatically', { exact: true })).toBeChecked();

  await open(page, 'update=ready&sheet=settings&section=about');
  row = await openUpdateSettings(page);
  await expect(row.locator('.update-summary-hint')).toHaveText('1.1.0 ready');
  await row.getByRole('button', { name: 'Restart now' }).click();
  await expect(row.locator('.update-summary-hint')).toHaveText('Restarting to install 1.1.0…');

  await open(page, 'update=blocked&sheet=settings&section=about');
  row = await openUpdateSettings(page);
  await expect(row.locator('.update-summary-hint')).toHaveText(/^1\.1\.0 ready · after \d downloads finish$/);
  await expect(row.getByRole('button', { name: /^Restart now/ })).toBeDisabled();

  await open(page, 'update=failed-install&sheet=settings&section=about');
  row = await openUpdateSettings(page);
  await expect(row.locator('.update-summary-hint')).toHaveText('Couldn’t update');
  const details = row.getByRole('button', { name: 'Details', exact: true });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(row.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.update-summary-details')).toContainText('Couldn’t install 1.1.0');
  await expect(row.getByRole('button', { name: 'Download installer' })).toBeVisible();
  await row.getByRole('button', { name: 'Try again' }).click();
  await expect(row.locator('.update-summary-hint')).toHaveText('Up to date · checked just now');

  await open(page, 'update=move&sheet=settings&section=about');
  row = await openUpdateSettings(page);
  await expect(row.locator('.update-summary-hint')).toHaveText('Updates need SnagThis in your Applications folder.');
  await expect(row.getByRole('button', { name: 'Move to Applications' })).toBeVisible();
});
