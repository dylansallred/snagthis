const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'apps/extension');
const film = { id: 'film', title: 'Opening fixture', sourcePageTitle: 'Opening fixture',
  url: 'https://fixture.invalid/film.mp4', sourcePageUrl: 'https://fixture.invalid/watch',
  type: 'file', height: 1080, durationSeconds: 5984, contentLength: 92000000 };

async function openFixture(browser, mode, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 480, height: 650 }, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  const html = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.evaluate(({ mode, film }) => {
    const state = window.openingFixture = { items: mode === 'ready' ? [film] : [], queue: [], headers: [], animations: [], listeners: [], reads: 0, error: mode === 'error' };
    const scan = new Promise(resolve => { state.finishScan = items => { state.items = items; resolve({ ok: true }); }; });
    const health = new Promise(resolve => { state.finishHealth = () => resolve({ status: 'ok', supportedProtocolVersions: { min: 1, max: 1 } }); });
    state.emit = () => state.listeners.forEach(listener => listener({ 'vidsnag:tab:1': {} }, 'session'));
    const trackHeader = () => state.headers.push(document.getElementById('page-count').textContent);
    trackHeader(); new MutationObserver(trackHeader).observe(document.getElementById('page-count'), { childList: true, subtree: true, characterData: true });
    document.addEventListener('animationstart', event => { if (['popup-enter', 'popup-list-reveal'].includes(event.animationName)) state.animations.push(event.animationName); });
    window.chrome = {
      runtime: { getManifest: () => ({ version: '2.0.0' }), sendMessage: async message => {
        if (message.cmd === 'GET_TAB_MEDIA') { state.reads++; if (state.error) throw new Error('Fixture read failed'); return { ok: true, visit: 'fixture', items: state.items, mappings: { film: 'job' }, titles: {} }; }
        return { ok: true };
      } },
      tabs: { query: async () => [{ id: 1, url: film.sourcePageUrl, title: film.title }], sendMessage: async () => scan },
      storage: { local: { get: async () => ({ appToken: 'fixture', preferences: {} }), set: async () => {}, remove: async () => {} }, onChanged: { addListener: listener => state.listeners.push(listener) } },
    };
    window.fetch = async url => {
      const pathname = new URL(url).pathname;
      const value = pathname === '/v1/health' ? await health : pathname === '/v1/queue' ? { queue: state.queue } : { settings: {} };
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    window.VidSnagSourcePreview = { sourceFor: () => null };
  }, { mode, film });
  await page.addStyleTag({ content: fs.readFileSync(path.join(extension, 'popup.css'), 'utf8') });
  for (const relative of ['packages/contracts/src/strings.js', 'packages/contracts/src/rows.js', 'packages/contracts/src/hls.js', 'packages/contracts/src/selection.js', 'apps/extension/js/detection.js', 'apps/extension/js/browser-downloads.js', 'apps/extension/popup/titles.js', 'apps/extension/popup/model.js', 'apps/extension/popup.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, relative), 'utf8') });
  }
  return { page, errors, close: () => context.close() };
}

test('popup opens promptly and transitions from checking to rows without false empty states or replay', async ({ browser }) => {
  const ready = await openFixture(browser, 'ready');
  try {
    await expect(ready.page.locator('.video-row')).toHaveCount(1);
    await expect(ready.page.locator('#video-list')).toHaveAttribute('aria-busy', 'false');
    expect(await ready.page.evaluate(() => openingFixture.headers.includes('No videos yet'))).toBe(false);
    await expect(ready.page.locator('#connection-banner')).toBeHidden();
    await ready.page.evaluate(film => { openingFixture.queue = [{ id: 'job', queueStatus: 'downloading', progress: 12 }]; openingFixture.finishScan([film]); openingFixture.finishHealth(); }, film);
    await expect(ready.page.locator('.video-row')).toHaveAttribute('data-progress', '12');
    await expect.poll(() => ready.page.evaluate(() => openingFixture.listeners.length)).toBe(1);
    await expect.poll(() => ready.page.evaluate(() => openingFixture.animations.filter(name => name === 'popup-list-reveal').length)).toBe(1);
    await ready.page.evaluate(() => { openingFixture.queue[0].progress = 48; openingFixture.emit(); });
    await expect(ready.page.locator('.video-row')).toHaveAttribute('data-progress', '48');
    expect(await ready.page.evaluate(() => openingFixture.animations.filter(name => name === 'popup-list-reveal').length)).toBe(1);
    expect(ready.errors).toEqual([]);
  } finally { await ready.close(); }

  const loading = await openFixture(browser, 'loading');
  try {
    await expect(loading.page.locator('#video-list')).toHaveAttribute('data-view', 'loading');
    await expect(loading.page.getByText('Looking for videos…')).toBeVisible();
    const initialHeight = await loading.page.locator('#popup').evaluate(node => node.getBoundingClientRect().height);
    await loading.page.evaluate(film => openingFixture.finishScan([film]), film);
    await expect(loading.page.locator('.video-row')).toHaveCount(1);
    const finalHeight = await loading.page.locator('#popup').evaluate(node => node.getBoundingClientRect().height);
    expect(Math.abs(finalHeight - initialHeight)).toBeLessThanOrEqual(1);
    expect(await loading.page.evaluate(() => openingFixture.headers.includes('No videos yet'))).toBe(false);
    expect(loading.errors).toEqual([]);
  } finally { await loading.close(); }

  for (const mode of ['empty', 'error']) {
    const fixture = await openFixture(browser, mode);
    try {
      await fixture.page.evaluate(() => openingFixture.finishScan([]));
      await expect(fixture.page.locator('#video-list')).toHaveAttribute('data-view', mode);
      await expect(fixture.page.locator('#video-list')).toHaveAttribute('aria-busy', 'false');
      await expect(fixture.page.getByRole('button', { name: mode === 'empty' ? 'Check again' : 'Try again' })).toBeVisible();
      expect(fixture.errors).toEqual([]);
    } finally { await fixture.close(); }
  }

  const reduced = await openFixture(browser, 'loading', 'reduce');
  try {
    await expect(reduced.page.locator('#popup')).toHaveCSS('animation-name', 'none');
    await expect(reduced.page.locator('.discovery-dots .thumb-loading-dot').first()).toHaveCSS('animation-name', 'none');
    await reduced.page.evaluate(film => openingFixture.finishScan([film]), film);
    await expect(reduced.page.locator('.video-row')).toHaveCount(1);
    await expect(reduced.page.locator('#video-list')).toHaveCSS('animation-name', 'none');
    expect(reduced.errors).toEqual([]);
  } finally { await reduced.close(); }
});
