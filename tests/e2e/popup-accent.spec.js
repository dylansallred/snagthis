const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const extension = path.resolve(__dirname, '../../apps/extension');

// The shipped popup (every script except the development gallery) with Chrome and the desktop bridge replaced.
async function openPopup(browser, { stored, appearance }) {
  const context = await browser.newContext({ viewport: { width: 480, height: 650 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  const html = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8');
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
  await page.addStyleTag({ content: fs.readFileSync(path.join(extension, 'popup.css'), 'utf8') });
  await page.evaluate(({ stored, appearance }) => {
    const store = { appToken: 'fixture', preferences: {}, accent: stored };
    window.accentFixture = { store, posts: [], appearance, online: true };
    window.chrome = {
      runtime: { getManifest: () => ({ version: '1.0.0' }), sendMessage: async () => ({ ok: true, visit: 'fixture', items: [], mappings: {} }) },
      tabs: { query: async () => [{ id: 1, url: 'https://fixture.invalid/watch' }], sendMessage: async () => ({ ok: true }) },
      storage: {
        local: { get: async keys => Object.fromEntries([].concat(keys).map(key => [key, store[key]])), set: async value => { Object.assign(store, value); }, remove: async () => {} },
        onChanged: { addListener() {} },
      },
    };
    window.fetch = async (url, options = {}) => {
      if (!accentFixture.online) throw new TypeError('Failed to fetch');
      const route = new URL(url).pathname;
      let body = { settings: {} };
      if (route === '/v1/health') body = { status: 'ok', supportedProtocolVersions: { min: 1, max: 1 } };
      if (route === '/v1/queue') body = { queue: [], appearance: accentFixture.appearance };
      if (route === '/v1/settings' && options.method === 'POST') {
        const input = JSON.parse(options.body); accentFixture.posts.push(input);
        if (input.accentChangedAt > accentFixture.appearance.accentChangedAt) accentFixture.appearance = { accent: input.accent, accentChangedAt: input.accentChangedAt };
        body = { ok: true, appearance: accentFixture.appearance };
      } else if (route === '/v1/settings') body = { preferredQuality: 'best', ...accentFixture.appearance };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { stored, appearance });
  for (const match of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    if (match[1] === 'popup/demo.js') continue;
    await page.addScriptTag({ content: fs.readFileSync(path.join(extension, match[1]), 'utf8') });
  }
  return { page, errors, close: () => context.close() };
}

const accentOf = page => page.evaluate(() => document.documentElement.dataset.accent);
const fill = (page, selector) => page.locator(selector).first().evaluate(node => getComputedStyle(node).fill);

test('popup accent: stored choice, desktop sync both ways, offline choice pushed on reconnect, recoloured logo', async ({ browser }) => {
  const now = Date.now();
  const { page, errors, close } = await openPopup(browser, { stored: { accent: 'mint', changedAt: now - 60_000 }, appearance: { accent: 'orange', accentChangedAt: now - 120_000 } });
  try {
    // The stored choice is newer than the desktop's, so it is applied and sent to the desktop.
    await expect.poll(() => accentOf(page)).toBe('mint');
    expect(await fill(page, '.logo-this')).toBe('rgb(38, 217, 150)');
    expect(await fill(page, '.logo-face')).toBe('rgb(31, 191, 138)');
    await expect.poll(() => page.evaluate(() => accentFixture.posts.at(-1))).toEqual({ accent: 'mint', accentChangedAt: now - 60_000 });

    // A later desktop change arrives on the next queue poll.
    await page.evaluate(at => { accentFixture.appearance = { accent: 'violet', accentChangedAt: at }; }, now - 1000);
    await expect.poll(() => accentOf(page)).toBe('violet');
    expect(await page.evaluate(() => accentFixture.store.accent.accent)).toBe('violet');

    // Settings ▸ Appearance: the same five swatches as the desktop, usable while connected or not.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const swatches = page.getByRole('radiogroup', { name: 'Accent colour' });
    await expect(swatches.getByRole('radio')).toHaveCount(5);
    await expect(swatches.getByRole('radio', { name: 'Violet' })).toBeChecked();
    await swatches.getByRole('radio', { name: 'Cobalt' }).check();
    await expect.poll(() => accentOf(page)).toBe('cobalt');
    await expect(page.locator('.accent-row .saved-mark')).toContainText('Saved');
    await expect.poll(() => page.evaluate(() => accentFixture.appearance.accent)).toBe('cobalt');

    // Offline: the choice is kept locally, then wins on reconnect because it is later.
    await page.evaluate(() => { accentFixture.online = false; });
    await expect(page.locator('#connection-banner')).toBeVisible({ timeout: 5000 });
    const posts = await page.evaluate(() => accentFixture.posts.length);
    await swatches.getByRole('radio', { name: 'Magenta' }).check();
    await expect.poll(() => accentOf(page)).toBe('magenta');
    expect(await page.evaluate(() => accentFixture.store.accent.accent)).toBe('magenta');
    expect(await page.evaluate(() => accentFixture.posts.length)).toBe(posts);
    await page.evaluate(() => { accentFixture.online = true; });
    await expect.poll(() => page.evaluate(() => accentFixture.appearance.accent), { timeout: 8000 }).toBe('magenta');
    expect(await accentOf(page)).toBe('magenta');
    expect(errors).toEqual([]);
  } finally { await close(); }
});
