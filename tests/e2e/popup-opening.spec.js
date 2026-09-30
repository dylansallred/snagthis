const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'apps/extension');
const film = { id: 'film', title: 'Opening fixture', sourcePageTitle: 'Opening fixture',
  url: 'https://fixture.invalid/film.mp4', sourcePageUrl: 'https://fixture.invalid/watch',
  type: 'file', height: 1080, durationSeconds: 5984, contentLength: 92000000 };

async function openFixture(browser, mode, reducedMotion = 'no-preference', beforePopup = async () => {}) {
  const context = await browser.newContext({ viewport: { width: 480, height: 650 }, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  const html = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.evaluate(({ mode, film }) => {
    const state = window.openingFixture = { items: mode === 'ready' ? [film] : [], queue: [], headers: [], views: [], animations: [], listeners: [], messages: [], reads: 0, error: mode === 'error' };
    const scan = new Promise(resolve => { state.finishScan = items => { state.items = items; resolve({ ok: true }); }; });
    // A page that answers its scan quickly never shows a passing empty state.
    if (mode === 'fast') setTimeout(() => state.finishScan([film]), 60);
    const health = new Promise(resolve => { state.finishHealth = () => resolve({ status: 'ok', supportedProtocolVersions: { min: 1, max: 1 } }); });
    state.emit = () => state.listeners.forEach(listener => listener({ 'snagthis:tab:1': {} }, 'session'));
    const trackHeader = () => state.headers.push(document.getElementById('page-count').textContent);
    trackHeader(); new MutationObserver(trackHeader).observe(document.getElementById('page-count'), { childList: true, subtree: true, characterData: true });
    const list = document.getElementById('video-list');
    new MutationObserver(() => { if (state.views.at(-1)?.view !== list.dataset.view) state.views.push({ view: list.dataset.view, at: performance.now() }); }).observe(list, { attributes: true, attributeFilter: ['data-view'] });
    document.addEventListener('animationstart', event => { if (event.target === document.getElementById('popup') || event.target === list) state.animations.push(event.animationName); });
    window.chrome = {
      runtime: { getManifest: () => ({ version: '2.0.0' }), sendMessage: async message => {
        state.messages.push(message.cmd);
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
    window.SnagThisSourcePreview = { sourceFor: () => null };
  }, { mode, film });
  await page.addStyleTag({ content: fs.readFileSync(path.join(extension, 'popup.css'), 'utf8') });
  await beforePopup(page);
  await page.evaluate(() => { openingFixture.started = performance.now(); });
  for (const relative of ['packages/contracts/src/strings.js', 'packages/contracts/src/rows.js', 'packages/contracts/src/hls.js', 'packages/contracts/src/selection.js', 'packages/contracts/src/audioTracks.js', 'apps/extension/js/detection.js', 'apps/extension/js/browser-downloads.js', 'apps/extension/popup/titles.js', 'apps/extension/popup/model.js', 'packages/contracts/src/accents.js', 'apps/extension/popup/accent.js', 'apps/extension/popup/pixel.js', 'apps/extension/popup/speed-trace.js', 'apps/extension/popup.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, relative), 'utf8') });
  }
  return { page, errors, close: () => context.close() };
}

// A page answers its scan from its own main thread; a busy site can hold that for seconds.
const SCAN_BOUND_MS = 1000;
const settledAfter = page => page.evaluate(() => { const view = openingFixture.views.find(entry => entry.view !== 'loading'); return view ? view.at - openingFixture.started : null; });

test('popup opens promptly and transitions from checking to rows without false empty states or replay', async ({ browser }) => {
  const ready = await openFixture(browser, 'ready');
  try {
    // Cached rows paint while the page scan and desktop health are still unanswered.
    await expect(ready.page.locator('.video-row')).toHaveCount(1);
    await expect(ready.page.locator('#video-list')).toHaveAttribute('aria-busy', 'false');
    expect(await settledAfter(ready.page)).toBeLessThan(SCAN_BOUND_MS);
    expect(await ready.page.evaluate(() => openingFixture.headers.includes('No videos yet'))).toBe(false);
    await expect(ready.page.locator('#connection-banner')).toBeHidden();
    // Storage changes and the pairing check start without waiting for the page.
    await expect.poll(() => ready.page.evaluate(() => openingFixture.listeners.length)).toBe(1);
    await expect.poll(() => ready.page.evaluate(() => openingFixture.messages.includes('PAIR_STATE'))).toBe(true);
    // The content is fully visible on its first frame: no popup fade and no list fade.
    await expect(ready.page.locator('#popup')).toHaveCSS('animation-name', 'none');
    await expect(ready.page.locator('#video-list')).toHaveCSS('animation-name', 'none');
    await expect(ready.page.locator('#popup')).toHaveCSS('opacity', '1');
    await ready.page.evaluate(film => { openingFixture.queue = [{ id: 'job', queueStatus: 'downloading', progress: 12 }]; openingFixture.finishScan([film]); openingFixture.finishHealth(); }, film);
    await expect(ready.page.locator('.video-row')).toHaveAttribute('data-progress', '12');
    await ready.page.evaluate(() => { openingFixture.queue[0].progress = 48; openingFixture.emit(); });
    await expect(ready.page.locator('.video-row')).toHaveAttribute('data-progress', '48');
    expect(await ready.page.evaluate(() => openingFixture.animations)).toEqual([]);
    expect(await ready.page.evaluate(() => typeof window.Hls)).toBe('undefined');
    expect(ready.errors).toEqual([]);
  } finally { await ready.close(); }

  const fast = await openFixture(browser, 'fast');
  try {
    await expect(fast.page.locator('.video-row')).toHaveCount(1);
    expect(await fast.page.evaluate(() => openingFixture.headers.includes('No videos yet'))).toBe(false);
    expect(fast.errors).toEqual([]);
  } finally { await fast.close(); }

  // SCAN_PAGE never answers and nothing is cached: the empty state still arrives within the bound.
  let skeletonHeight; let initialHeight;
  const hanging = await openFixture(browser, 'loading', 'no-preference', async page => {
    // Skeleton rows use the real row geometry, so the first row lands where its skeleton was.
    const skeletons = page.locator('.skeleton-row');
    await expect(skeletons).toHaveCount(3);
    await expect(page.getByRole('status').getByText('Looking for videos…')).toBeAttached();
    skeletonHeight = await skeletons.first().evaluate(node => node.getBoundingClientRect().height);
    initialHeight = await page.locator('#popup').evaluate(node => node.getBoundingClientRect().height);
  });
  try {
    await expect(hanging.page.locator('#video-list')).toHaveAttribute('data-view', 'empty');
    await expect(hanging.page.locator('#video-list')).toHaveAttribute('aria-busy', 'false');
    expect(await settledAfter(hanging.page)).toBeLessThan(SCAN_BOUND_MS);
    await expect(hanging.page.getByRole('button', { name: 'Check again' })).toBeVisible();
    await expect.poll(() => hanging.page.evaluate(() => openingFixture.messages.includes('PAIR_STATE'))).toBe(true);
    // The page answers late: its detections still fill in.
    await hanging.page.evaluate(film => openingFixture.finishScan([film]), film);
    await expect(hanging.page.locator('.video-row')).toHaveCount(1);
    const rowHeight = await hanging.page.locator('.video-row').evaluate(node => node.getBoundingClientRect().height);
    const finalHeight = await hanging.page.locator('#popup').evaluate(node => node.getBoundingClientRect().height);
    expect(Math.abs(rowHeight - skeletonHeight)).toBeLessThanOrEqual(1);
    expect(finalHeight).toBeLessThanOrEqual(initialHeight);
    expect(hanging.errors).toEqual([]);
  } finally { await hanging.close(); }

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

  const reduced = await openFixture(browser, 'loading', 'reduce', page => expect(page.locator('.skeleton-bar').first()).toHaveCSS('animation-name', 'none'));
  try {
    await expect(reduced.page.locator('#popup')).toHaveCSS('animation-name', 'none');
    await reduced.page.evaluate(film => openingFixture.finishScan([film]), film);
    await expect(reduced.page.locator('.video-row')).toHaveCount(1);
    await expect(reduced.page.locator('#video-list')).toHaveCSS('animation-name', 'none');
    expect(await reduced.page.locator('.video-row').evaluate(node => node.getAnimations().length)).toBe(0);
    expect(reduced.errors).toEqual([]);
  } finally { await reduced.close(); }
});
