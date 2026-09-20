const { test, expect } = require('@playwright/test');
const { startRenderer, launchDesktop } = require('./helpers');

test('desktop opens with the approved reveal, shimmer and short hold, then stays usable', async () => {
  const renderer = await startRenderer();
  let native;
  try {
    native = await launchDesktop(renderer.baseUrl);
    const page = await native.app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof window.desktop?.getAppInfo === 'function');
    await expect.poll(() => page.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)).toBe('ready');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(page.locator('.startup-logo-overlay')).toBeVisible();

    // Real startup continues underneath the entrance; no API or library mocks.
    await expect(page.getByRole('button', { name: 'Add VidSnag to Chrome', exact: true })).toBeAttached();
    await page.waitForFunction(() => {
      const shine = document.querySelector('.startup-logo-shine');
      return shine && Number(getComputedStyle(shine).opacity) > .1;
    });
    const finish = await page.locator('.startup-logo-artwork').evaluate(element => {
      const mark = element.querySelector('.startup-logo-mark');
      const words = element.querySelector('.startup-logo-words');
      const shine = element.querySelector('.startup-logo-shine');
      return {
        width: element.getBoundingClientRect().width,
        mark: getComputedStyle(mark).transform,
        words: getComputedStyle(words).clipPath,
        mask: getComputedStyle(shine).maskImage,
      };
    });
    expect(finish.width).toBe(280);
    expect(finish.mark).toBe('matrix(1, 0, 0, 1, 0, 0)');
    expect(finish.words).toBe('inset(0px 0% 0px 0px)');
    expect(finish.mask).toContain('vidsnag-logo-title');
    await page.screenshot({ path: test.info().outputPath('startup-shimmer.png') });

    await page.waitForFunction(() => {
      const shine = document.querySelector('.startup-logo-shine');
      return shine && Number(getComputedStyle(shine).opacity) === 0;
    });
    await expect(page.locator('.startup-logo-overlay')).toBeVisible();
    expect((await page.locator('.startup-logo-artwork').boundingBox()).width).toBe(280);
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);
    const brand = page.locator('.top-bar').getByRole('img', { name: 'VidSnag', exact: true });
    await expect(brand).toBeVisible();
    expect((await brand.boundingBox()).width).toBe(112);
    await page.getByRole('button', { name: 'Saved', exact: true }).click();
    await expect(page.getByText('No saved videos yet', { exact: true })).toBeVisible();
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('startup-complete.png') });

    // Reduced motion avoids the splash entirely, including its extra hold.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(brand).toBeVisible();
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);

    // Keyboard input dismisses an in-flight entrance and leaves the app usable.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(page.locator('.startup-logo-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);
    await expect(brand).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.target?.closest?.('.startup-logo-overlay')).length)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    try { await native?.close(); } finally { await renderer.close(); }
  }
});
