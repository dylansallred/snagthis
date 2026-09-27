const { test, expect } = require('@playwright/test');
const { startRenderer, launchDesktop } = require('./helpers');

// Freeze the first-launch opening as its animations are created, so frames can be
// inspected at exact times instead of racing a 50ms-per-letter sequence.
const freezeOpening = () => {
  if (localStorage.getItem('test.freezeStartup') !== '1') return;
  localStorage.removeItem('test.freezeStartup');
  new MutationObserver((records, observer) => {
    if (!records.some(record => record.target.dataset?.phase === 'typing')) return;
    observer.disconnect();
    window.openingAnimations = document.getAnimations().filter(animation => animation.effect?.target?.closest?.('.startup-logo-overlay'));
    window.openingAnimations.forEach(animation => animation.pause());
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-phase'] });
};
const seek = (page, ms) => page.evaluate(time => { window.openingAnimations.forEach(animation => { animation.currentTime = time; }); }, ms);
const openingState = page => page.evaluate(() => ({
  letters: [...document.querySelectorAll('.startup-logo-letter')].map(letter => Number(getComputedStyle(letter).opacity)),
  cursor: Number(getComputedStyle(document.querySelector('.startup-logo-cursor')).opacity),
  cursorX: new DOMMatrix(getComputedStyle(document.querySelector('.startup-logo-cursor')).transform).e,
  button: Number(getComputedStyle(document.querySelector('.startup-logo-button')).opacity),
  lit: getComputedStyle(document.querySelector('.startup-logo-press [data-bevel="hi"]')).fill,
  pressY: new DOMMatrix(getComputedStyle(document.querySelector('.startup-logo-press')).transform).f,
  artwork: document.querySelector('.startup-logo-artwork').getBoundingClientRect().width,
}));

test('desktop types the logo and presses play on first launch, settles briefly afterwards, and stays usable', async () => {
  const renderer = await startRenderer();
  let native;
  try {
    native = await launchDesktop(renderer.baseUrl);
    const page = await native.app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof window.desktop?.getAppInfo === 'function');
    await expect.poll(() => page.evaluate(async () => (await window.desktop.getAppInfo()).apiStartupState)).toBe('ready');
    // The launch above played the first-run opening; forget it so this reload replays it in full.
    await page.addInitScript(freezeOpening);
    await page.evaluate(() => { localStorage.removeItem('snagthis.startupSeen'); localStorage.setItem('test.freezeStartup', '1'); });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(page.locator('.startup-logo-overlay[data-mode="full"]')).toBeVisible();

    // Real startup continues underneath the entrance; no API or library mocks.
    await expect(page.getByRole('button', { name: 'Add SnagThis to Chrome', exact: true })).toBeAttached();

    // Typing (375ms): the cursor has typed S N A G T and waits after the T; the button is not there yet.
    await page.waitForFunction(() => window.openingAnimations?.length > 0);
    await seek(page, 375);
    const typing = await openingState(page);
    expect(typing.letters).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
    expect(typing.cursor).toBe(1);
    expect(typing.cursorX).toBe(65); // The H's pen position on the 120-pixel grid.
    expect(typing.button).toBe(0);
    expect(typing.artwork).toBe(360);
    await page.screenshot({ path: test.info().outputPath('startup-typing.png') });

    // Pop (750ms): every capital is typed, the cursor has gone, and the button is growing in.
    await seek(page, 750);
    const popping = await openingState(page);
    expect(popping.letters).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(popping.cursor).toBe(0);
    expect(popping.button).toBeGreaterThan(.5);

    // Press (1100ms): the button is pushed down and its lit bevel edge swaps to the deep shade.
    await seek(page, 1100);
    const pressed = await openingState(page);
    expect(pressed.button).toBe(1);
    expect(pressed.lit).toBe('rgb(189, 63, 0)');
    expect(pressed.pressY).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('startup-press.png') });

    // Released: the bevel is lit again, then the opening continues from here.
    await seek(page, 1500);
    expect((await openingState(page)).lit).toBe('rgb(255, 178, 56)');
    await page.evaluate(() => window.openingAnimations.forEach(animation => animation.play()));

    // The logo then moves exactly onto the header artwork.
    const move = await page.waitForFunction(() => {
      const artwork = document.querySelector('.startup-logo-artwork');
      if (artwork?.dataset.phase !== 'moving') return null;
      const animation = artwork.getAnimations().at(-1);
      const end = new DOMMatrix(animation.effect.getKeyframes().at(-1).transform);
      const brand = document.querySelector('.top-bar .app-wordmark').getBoundingClientRect();
      return { left: end.e, top: end.f, width: artwork.offsetWidth * end.a, brand: { left: brand.left, top: brand.top, width: brand.width } };
    }, null, { polling: 'raf' }).then(handle => handle.jsonValue());
    expect(move.left).toBeCloseTo(move.brand.left, 3);
    expect(move.top).toBeCloseTo(move.brand.top, 3);
    expect(move.width).toBeCloseTo(move.brand.width, 3);
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);
    const brand = page.locator('.top-bar').getByRole('img', { name: 'SnagThis', exact: true });
    await expect(brand).toBeVisible();
    expect((await brand.boundingBox()).width).toBe(120);
    // The logo drags the window, so its shine plays on window focus: one sweep, clipped to the artwork.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.app-brand.shining')).toHaveCount(1);
    expect(await page.locator('.app-brand').evaluate(element => getComputedStyle(element, '::after').maskImage)).toMatch(/snagthis-logo-title\.svg|%3ctitle%3eSnagThis%3c/); // Vite may inline the small SVG.
    await expect(page.locator('.app-brand.shining')).toHaveCount(0);
    // An empty library shows the first-download steps; tabs and search arrive with the first video.
    await expect(page.getByText('Download your first video', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Filter videos' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Already installed? Connect Chrome', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('startup-complete.png') });

    // Reduced motion avoids the splash entirely, including its extra hold.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(brand).toBeVisible();
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);

    // Keyboard input dismisses an in-flight entrance and leaves the app usable.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => localStorage.removeItem('snagthis.startupSeen'));
    await page.reload();
    await expect(page.locator('.startup-logo-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.startup-logo-overlay')).toHaveCount(0);
    await expect(brand).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.target?.closest?.('.startup-logo-overlay')).length)).toBe(0);

    // Later launches: a ~600ms settle into the header, never the typing and press.
    await page.addInitScript(() => {
      window.startupOverlays = [];
      new MutationObserver(() => {
        const overlay = document.querySelector('.startup-logo-overlay');
        const last = window.startupOverlays.at(-1);
        if (overlay && (!last || last.hidden)) window.startupOverlays.push({ mode: overlay.dataset.mode, shown: performance.now() });
        else if (!overlay && last && !last.hidden) last.hidden = performance.now();
      }).observe(document, { childList: true, subtree: true });
    });
    expect(await page.evaluate(() => localStorage.getItem('snagthis.startupSeen'))).toBe('1');
    await page.reload();
    await page.waitForFunction(() => window.startupOverlays?.[0]?.hidden);
    const settle = await page.evaluate(() => window.startupOverlays);
    expect(settle).toHaveLength(1);
    expect(settle[0].mode).toBe('short');
    expect(settle[0].hidden - settle[0].shown).toBeLessThan(1400);
    await expect(brand).toBeVisible();
    expect((await brand.boundingBox()).width).toBe(120);
    expect(errors).toEqual([]);
  } finally {
    try { await native?.close(); } finally { await renderer.close(); }
  }
});
