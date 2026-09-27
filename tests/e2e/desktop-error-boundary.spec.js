const { test, expect } = require('@playwright/test');
const { startRenderer } = require('./helpers');

let renderer;
test.beforeAll(async () => { renderer = await startRenderer(); });
test.afterAll(async () => { await renderer?.close(); });

test('a render error shows a movable, recoverable window and copies details without credentials', async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedDetails = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedDetails.push(text); } } });
  });
  await page.goto(`${renderer.baseUrl}/?gallery&crash`);
  const fallback = page.getByRole('alert');
  await expect(fallback.getByRole('heading', { name: 'Something went wrong.' })).toBeVisible();
  expect(await fallback.locator('header').evaluate((header) => getComputedStyle(header).getPropertyValue('-webkit-app-region'))).toBe('drag');
  expect(await fallback.getByRole('button', { name: 'Reload' }).evaluate((button) => getComputedStyle(button).getPropertyValue('-webkit-app-region'))).toBe('no-drag');

  await fallback.getByRole('button', { name: 'Copy details' }).click();
  await expect(fallback.getByRole('button', { name: 'Copied' })).toBeVisible();
  const [details] = await page.evaluate(() => window.copiedDetails);
  expect(details).toContain('Gallery render failure at https://example.com/video.m3u8');
  expect(details).toContain('at App');
  expect(details).not.toMatch(/viewer|secret|private/);

  await fallback.getByRole('button', { name: 'Reload' }).click();
  await expect(fallback.getByRole('heading', { name: 'Something went wrong.' })).toBeVisible();
});
