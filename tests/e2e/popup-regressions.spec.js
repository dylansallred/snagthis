const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'apps/extension');
const item = {
  id: 'master', url: 'https://fixture.invalid/master.m3u8', type: 'hls',
  sourcePageTitle: 'Quality fixture', sourcePageUrl: 'https://fixture.invalid/watch',
  durationSeconds: 600, height: 1080,
  variants: [
    { url: 'https://fixture.invalid/1080.m3u8', height: 1080, sizeBytes: 200000000 },
    { url: 'https://fixture.invalid/720.m3u8', height: 720, sizeBytes: 100000000 },
  ],
};

test.use({ viewport: { width: 480, height: 650 }, reducedMotion: 'reduce' });

async function loadPopup(page, flags = { storeBuild: false }) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  const html = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<link\b[^>]*>/g, '');
  await page.setContent(html);
  await page.addStyleTag({ content: fs.readFileSync(path.join(extension, 'popup.css'), 'utf8') });
  await page.evaluate(() => {
    window.chrome = { runtime: { getManifest: () => ({ version: '2.0.0' }), sendMessage: async () => ({ ok: true }) } };
    window.SnagThisSourcePreview = { sourceFor: () => null };
    window.SnagThisPagePreview = { create: () => ({ destroy() {} }) };
  });
  await page.evaluate(value => { window.SnagThisBuild = Object.freeze(value); }, flags);
  for (const relative of [
    'packages/contracts/src/strings.js', 'packages/contracts/src/rows.js',
    'packages/contracts/src/hls.js', 'packages/contracts/src/selection.js', 'packages/contracts/src/audioTracks.js',
    'apps/extension/js/detection.js', 'apps/extension/js/browser-downloads.js', 'apps/extension/popup/titles.js',
    'apps/extension/popup/model.js', 'packages/contracts/src/accents.js', 'apps/extension/popup/accent.js',
    'apps/extension/popup/pixel.js', 'apps/extension/popup/speed-trace.js',
  ]) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, relative), 'utf8') });
  }
  // Exercise the shipped renderer and menu handlers with explicit fixture state.
  // Replace only startup: no worker, desktop API, browser profile or download runs.
  const startup = 'initialize().catch(discoveryFailed);';
  const source = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
  expect(source).toContain(startup);
  await page.addScriptTag({ content: source.replace(startup,
    `window.popupFixture = { load(items, jobs, links) { mediaItems = items; queue = jobs; mappings = links; reachable = true; compatible = true; appToken = 'fixture'; selected.clear(); renderRows(); }, pair: () => showCodePairing(), settings: () => showSettings(), check(tab) { activeTab = tab; return checkAgain(); }, connection(isReachable, token) { reachable = isReachable; appToken = token; renderConnection(); } };`,
  ) });
  return errors;
}

// Row drawers slide open and shut (instantly under reduced motion); geometry is read once they settle.
const drawersSettled = page => page.waitForFunction(() => [...document.querySelectorAll('.row-drawer')].every(node => !node.getAnimations().length));

test('saved popup quality uses job metadata without inventing video quality for audio', async ({ page }) => {
  const errors = await loadPopup(page);
  for (const [label, job, quality] of [
    ['reopened 720p selection', { selection: { height: 720, variantUrl: item.variants[1].url } }, '720p'],
    ['audio-only save', { selection: { audioOnly: true } }, 'Audio only'],
    ['measured height before requested height', { height: 720, selection: { height: 1080 } }, '720p'],
    ['missing quality retains detection fallback', { selection: { subtitleLang: 'none' } }, '1080p'],
    ['invalid selected height retains detection fallback', { selection: { height: -1 } }, '1080p'],
  ]) {
    await test.step(label, async () => {
      await page.evaluate(({ item, job }) => window.popupFixture.load([item], [{
        id: 'saved', queueStatus: 'completed', progress: 100, totalBytes: 100000000, ...job,
      }], { master: 'saved' }), { item, job });
      await expect(page.locator('.row-status .resolution')).toHaveText(quality);
      if (quality === 'Audio only') await expect(page.locator('.row-status .tier-badge')).toHaveCount(0);
    });
  }
  expect(errors).toEqual([]);
});

test('quality selection retains keyboard focus without forcing pointer focus', async ({ page }) => {
  const errors = await loadPopup(page);
  await page.evaluate(item => window.popupFixture.load([item], [], {}), item);
  await page.evaluate(() => { window.originalQualityTrigger = document.querySelector('.quality-button'); });
  const trigger = page.getByRole('button', { name: 'Choose quality' });
  await trigger.click();
  await page.getByRole('radio').filter({ hasText: '720p' }).focus();
  await page.keyboard.press('Enter');
  await expect(trigger.locator('.resolution')).toHaveText('720p');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.originalQualityTrigger === document.querySelector('.quality-button'))).toBe(true);

  await trigger.click();
  await page.getByRole('radio').filter({ hasText: '1080p' }).click();
  await expect(trigger.locator('.resolution')).toHaveText('1080p');
  await expect(trigger).not.toBeFocused();
  expect(errors).toEqual([]);
});

test('grouped popup jobs prefer unfinished mapped copies and preserve variant isolation', async ({ page }) => {
  const errors = await loadPopup(page);
  const jobs = await page.evaluate(() => {
    const completed = { id: 'older-copy', queueStatus: 'completed', status: 'completed' };
    const item = { id: 'master', detectedStreams: [{ id: 'mirror' }] };
    const active = { id: 'new-copy', queueStatus: 'downloading', status: 'downloading', selection: { height: 720 } };
    const mappings = { master: completed.id, mirror: active.id };
    return {
      lifecycle: ['downloading', 'queued', 'paused'].map(queueStatus => ({
        queueStatus,
        jobId: SnagThisPopupModel.jobFor(item, mappings, [completed, { ...active, queueStatus, status: queueStatus }]).id,
      })),
      standaloneVariant: SnagThisPopupModel.jobFor({ id: 'master' }, mappings, [completed, active]).id,
      unmapped: SnagThisPopupModel.jobFor(item, { master: completed.id }, [completed, active]).id,
      completedBeforeFailed: SnagThisPopupModel.jobFor(item, { master: active.id, mirror: completed.id }, [
        { ...active, queueStatus: 'failed', status: 'error' }, completed,
      ]).id,
    };
  });
  expect(jobs).toEqual({
    lifecycle: ['downloading', 'queued', 'paused'].map(queueStatus => ({ queueStatus, jobId: 'new-copy' })),
    standaloneVariant: 'older-copy', unmapped: 'older-copy', completedBeforeFailed: 'older-copy',
  });
  expect(errors).toEqual([]);
});

test('row extras open an inline drawer from a keyboard-accessible More button and return focus', async ({ page }) => {
  const errors = await loadPopup(page);
  await page.evaluate(item => window.popupFixture.load([item], [], {}), item);
  const more = page.getByRole('button', { name: /^More actions: / });
  // A disclosure, not a popup menu: no native title either.
  await expect(more).not.toHaveAttribute('aria-haspopup');
  await expect(more).not.toHaveAttribute('title');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toHaveCSS('opacity', '0');
  // Keyboard users reach it from the preceding row control.
  await page.getByRole('button', { name: 'Choose quality' }).focus();
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  const keys = page.getByRole('toolbar', { name: 'Actions for Quality fixture' });
  await expect(keys).toBeVisible();
  // The drawer opens inside the row it belongs to, and nothing is drawn as a floating menu.
  await expect(page.locator('.video-row').locator('.row-drawer')).toHaveCount(1);
  await expect(page.locator('#menu')).toBeHidden();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(more).toHaveAttribute('aria-controls', await page.locator('.row-drawer').getAttribute('id'));
  await expect(keys.getByRole('button')).toHaveText(['Preview', 'Copy video address', 'Copy page address', 'Rename', 'Hide', 'Show all detected streams']);
  await expect(keys.getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
  // One Tab stop; arrows move through the 3-column grid.
  await expect(keys.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(keys.getByRole('button', { name: 'Copy video address', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(keys.getByRole('button', { name: 'Hide', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(keys.getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(keys.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(keys).toBeHidden();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  // Right-click opens the same drawer; a click outside the row closes it.
  await page.locator('.video-row').click({ button: 'right' });
  await expect(keys.getByRole('button', { name: 'Rename', exact: true })).toBeVisible();
  await page.locator('.popup-header').click();
  await expect(keys).toBeHidden();
  // Tab past the drawer closes it too.
  await page.locator('.video-row').click({ button: 'right' });
  await page.keyboard.press('Tab');
  await expect(keys).toBeHidden();
  expect(errors).toEqual([]);
});

test('the row drawer copies the video and page addresses, and the store build never offers a YouTube page', async ({ page }) => {
  const errors = await loadPopup(page);
  await page.evaluate(() => {
    window.copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copied.push(text); } } });
  });
  await page.evaluate(value => window.popupFixture.load([value], [], {}), item);
  const row = page.locator('.video-row');
  await row.click({ button: 'right' });
  await page.getByRole('toolbar').getByRole('button', { name: 'Copy video address', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('Video address copied');
  await row.click({ button: 'right' });
  await page.getByRole('toolbar').getByRole('button', { name: 'Copy page address', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Page address copied');
  expect(await page.evaluate(() => window.copied)).toEqual([item.url, item.sourcePageUrl]);
  // Addresses that only work inside the page aren't offered.
  await page.evaluate(value => window.popupFixture.load([{ ...value, id: 'sw', serviceWorkerServed: true }, { ...value, id: 'blob', url: 'blob:https://fixture.invalid/1' }], [], {}), item);
  for (const index of [0, 1]) {
    await page.locator('.video-row').nth(index).click({ button: 'right' });
    await expect(page.getByRole('toolbar').getByRole('button', { name: 'Copy page address', exact: true })).toBeVisible();
    await expect(page.getByRole('toolbar').getByRole('button', { name: 'Copy video address', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});

test('the store build never copies a YouTube page address, even for another video on it', async ({ page }) => {
  const errors = await loadPopup(page, { storeBuild: true });
  const embedded = { ...item, id: 'embedded', url: 'https://cdn.fixture.invalid/ad.mp4', type: 'file', sourcePageUrl: 'https://www.youtube.com/watch?v=abcdefghijk' };
  await page.evaluate(value => window.popupFixture.load([value], [], {}), embedded);
  await page.locator('.video-row').click({ button: 'right' });
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Copy page address', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the store build lists YouTube pages without a download or desktop handoff', async ({ page }) => {
  const errors = await loadPopup(page, { storeBuild: true });
  const youtube = { id: 'yt', url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'file', mediaKind: 'youtube-page', contentType: 'video/youtube',
    sourcePageUrl: 'https://www.youtube.com/watch?v=abcdefghijk', sourcePageTitle: 'A real video - YouTube', youtubeMetadata: { videoId: 'abcdefghijk', title: 'A real video' } };
  await page.evaluate(value => window.popupFixture.load([value], [], {}), youtube);
  const row = page.locator('.video-row');
  // Chrome Web Store policy: no download, no copy-link hand-off and no mention of the desktop app.
  await expect(row.locator('.row-status')).toHaveText("SnagThis doesn't save videos from this site");
  await expect(row.getByRole('button', { name: /Copy link|Download|Use desktop app/ })).toHaveCount(0);
  await row.click({ button: 'right' });
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  await expect(page.getByRole('toolbar').getByRole('button', { name: /Copy|Download with desktop|Continue previous download|Preview|Rename/ })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('desktop app');
  expect(errors).toEqual([]);
});

test('rows expose status to assistive tech, open drawers from the keyboard and never clip a drawer', async ({ page }) => {
  const errors = await loadPopup(page);
  const film = { ...item, subtitles: [{ url: 'https://fixture.invalid/en.vtt', language: 'en', name: 'English' }] };
  const paused = { id: 'paused', url: 'https://fixture.invalid/paused.mp4', type: 'file', sourcePageTitle: 'Paused fixture', sourcePageUrl: 'https://fixture.invalid/other', durationSeconds: 300 };
  const expired = { id: 'expired', url: 'https://fixture.invalid/expired.m3u8', type: 'hls', sourcePageTitle: 'Expired fixture', sourcePageUrl: 'https://fixture.invalid/third', durationSeconds: 200 };
  const jobs = [{ id: 'job-paused', queueStatus: 'paused', progress: 40 }, { id: 'job-expired', queueStatus: 'failed', error: 'SOURCE_EXPIRED', progress: 34 }, { id: 'job-other', queueStatus: 'downloading', progress: 5 }];
  await page.evaluate(({ values, jobs }) => window.popupFixture.load(values, jobs, { paused: 'job-paused', expired: 'job-expired' }), { values: [film, paused, expired], jobs });

  const row = page.locator('.video-row[data-row-key="master"]');
  await expect(row).toHaveAttribute('aria-label', /^Quality fixture\. 1080p · 200 MB$/);
  await expect(page.locator('#open-app')).toHaveAccessibleName('Open SnagThis, 1 active download');
  // Resume never borrows the Play icon or name.
  await expect(page.getByRole('button', { name: 'Resume download', exact: true })).toHaveAttribute('data-tip', 'Resume download');
  // Expired links explain the next step on two lines, with the duration beside the title.
  const problem = page.locator('.video-row[data-row-key="expired"]');
  await expect(problem.locator('.row-status')).toHaveText('Link expired at 34%. Play the video, then click Download to continue.');
  expect(await problem.locator('.row-status').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(30);
  await expect(problem.locator('.row-title-duration')).toBeVisible();
  await expect(problem.locator('.row-duration-meta')).toBeHidden();
  // Hovering one row dims the others slightly, but never a row that needs attention.
  await row.hover();
  await expect(page.locator('.video-row[data-row-key="paused"]')).toHaveCSS('opacity', '0.72');
  await expect(problem).toHaveCSS('opacity', '1');

  // No native titles on the row: the title and status are in the row's name, and a clamped one uses the in-popup tooltip.
  await expect(page.locator('.video-row [title]')).toHaveCount(0);

  // Shift+F10 on a focused row opens its drawer; the row reveals its More button while focused.
  await row.focus();
  await expect(row.locator('.row-more')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Shift+F10');
  await expect(row.getByRole('toolbar').getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('toolbar')).toHaveCount(0);

  // The quality drawer grows a short popup by its own height only (no floor): nothing is covered or clipped,
  // and the header and the row's own content never move.
  await page.evaluate(value => window.popupFixture.load([value], [], {}), film);
  const measure = () => page.evaluate(() => {
    const box = selector => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect && { top: rect.top, bottom: rect.bottom, height: rect.height }; };
    return { popup: box('#popup'), header: box('.popup-header'), thumb: box('.video-row .thumb'), title: box('.video-row .row-title'), drawer: box('.row-drawer'), footer: box('.popup-footer'), minHeight: document.getElementById('popup').style.minHeight };
  });
  // The earlier rows collapse away first.
  await page.waitForFunction(() => document.querySelectorAll('.video-row').length === 1);
  await drawersSettled(page);
  const closed = await measure();
  await page.getByRole('button', { name: 'Choose quality' }).click();
  const drawer = page.getByRole('group', { name: 'Quality for Quality fixture' });
  await expect(drawer.getByRole('radiogroup', { name: 'Subtitles' }).getByRole('radio', { name: 'None', exact: true })).toBeVisible();
  await expect(drawer.getByRole('radio', { name: /^1080p/ })).toBeFocused();
  await drawersSettled(page);
  const open = await measure();
  expect(open.minHeight).toBe('');
  expect(open.header).toEqual(closed.header);
  expect(open.thumb).toEqual(closed.thumb);
  expect(open.title).toEqual(closed.title);
  expect(open.drawer.top).toBeGreaterThanOrEqual(closed.thumb.bottom);
  expect(open.drawer.bottom).toBeLessThanOrEqual(open.footer.top);
  expect(Math.abs(open.popup.height - closed.popup.height - open.drawer.height)).toBeLessThanOrEqual(1);
  // ←/→ move within a line, ↑/↓ between lines.
  await page.keyboard.press('ArrowDown');
  await expect(drawer.getByRole('radio', { name: 'None', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(drawer.getByRole('radio', { name: 'English', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(drawer.getByRole('radio', { name: /^1080p/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose quality' })).toBeFocused();
  await expect.poll(async () => (await measure()).popup).toEqual(closed.popup);
  await expect(page.locator('.row-drawer')).toHaveCount(0);
  // Reduced motion opens and closes the drawer at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Choose quality' }).click();
  expect(await page.locator('.row-drawer').evaluate(node => ({ running: node.getAnimations().length, rows: getComputedStyle(node).gridTemplateRows }))).toEqual({ running: 0, rows: expect.not.stringMatching(/^0px$/) });
  await page.keyboard.press('Escape');
  await expect(page.locator('.row-drawer')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(errors).toEqual([]);
});

test('a clamped title shows an in-popup tooltip, a title that fits shows none, and icon buttons name themselves', async ({ page }) => {
  const errors = await loadPopup(page);
  const long = { ...item, id: 'long', sourcePageTitle: 'The Very Long Crossing — Director’s Extended Harbour Edition, Remastered with Commentary and Every Deleted Scene Restored' };
  const short = { ...item, id: 'short', url: 'https://fixture.invalid/short.m3u8', sourcePageTitle: 'Short fixture', durationSeconds: 60, variants: undefined };
  await page.evaluate(values => window.popupFixture.load(values, [], {}), [long, short]);
  const tip = page.getByRole('tooltip');
  await page.locator('.video-row[data-row-key="short"] .row-title').hover();
  await page.waitForTimeout(800);
  await expect(tip).toHaveCount(0);
  await page.locator('.video-row[data-row-key="long"] .row-title').hover();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(long.sourcePageTitle);
  const box = await tip.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(480);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  // Keyboard focus on the row shows it at once; the Download button's name comes from the same element.
  await page.locator('.popup-header').hover();
  await page.getByRole('button', { name: 'Choose quality' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.video-row[data-row-key="long"]')).toBeFocused();
  await expect(tip).toHaveText(long.sourcePageTitle);
  await page.locator('.video-row[data-row-key="short"]').getByRole('button', { name: 'Download', exact: true }).hover();
  await expect(tip).toHaveText('Download');
  expect(errors).toEqual([]);
});

test('a pasted connection code with spaces or dashes is normalised and submits itself', async ({ page }) => {
  const errors = await loadPopup(page);
  await page.evaluate(() => window.popupFixture.pair());
  const input = page.getByLabel('Connection code', { exact: true });
  await input.fill('12 34-56');
  await expect(input).toHaveValue('123456');
  // The fixture has no desktop app, so the automatic submission reports that plainly.
  await expect(page.locator('.sheet-error')).toContainText('Could not reach SnagThis');
  expect(errors).toEqual([]);
});

test('popup Settings tabs: arrow keys, Home/End and Tab into the panel; every tab fits without scrolling at a stable height', async ({ page }) => {
  const errors = await loadPopup(page);
  await page.setViewportSize({ width: 480, height: 560 });
  // The harness skips startup wiring, so the fixture opens Settings as the gear button does.
  await page.evaluate(() => { window.popupFixture.load([], [], {}); window.popupFixture.settings(); });
  const sheet = page.locator('#sheet');
  const tabs = sheet.getByRole('tablist', { name: 'Settings sections' });
  const tab = name => tabs.getByRole('tab', { name, exact: true });
  const panel = sheet.getByRole('tabpanel');
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tab('Downloads')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Downloads')).toBeFocused();
  await expect(sheet.getByRole('button', { name: 'SnagThis settings', exact: true })).toBeVisible();
  await expect(panel).toHaveAttribute('aria-labelledby', 'settings-tab-downloads');
  // Roving tabindex: only the chosen tab is in the Tab order; arrows move and select.
  await expect(tabs.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(tab('Appearance')).toBeFocused();
  await expect(tab('Appearance')).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('radiogroup', { name: 'Accent colour' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Connection, Connected')).toBeFocused();
  await expect(panel).toContainText('Connected to SnagThis');
  await page.keyboard.press('End');
  await expect(tab('About')).toBeFocused();
  await expect(panel).toContainText('for Chrome v2.0.0');
  await page.keyboard.press('ArrowRight');
  await expect(tab('Downloads')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('About')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab('Downloads')).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.locator('[role="tab"][tabindex="0"]')).toHaveAttribute('id', 'settings-tab-downloads');
  await page.keyboard.press('Tab');
  await expect(panel).toBeFocused();
  // Reopening in the same popup session returns to the last tab used.
  await tab('Connection, Connected').click();
  await page.evaluate(() => { document.getElementById('sheet').close(); window.popupFixture.settings(); });
  await expect(tab('Connection, Connected')).toHaveAttribute('aria-selected', 'true');

  for (const [reachable, token, status] of [[true, 'fixture', 'Connected'], [false, 'fixture', 'SnagThis not open'], [true, '', 'Not connected']]) {
    await page.evaluate(([isReachable, value]) => window.popupFixture.connection(isReachable, value), [reachable, token]);
    await expect(tabs.getByRole('tab', { name: `Connection, ${status}`, exact: true })).toBeVisible();
    const heights = new Set();
    for (const name of ['Downloads', 'Appearance', `Connection, ${status}`, 'About']) {
      await tab(name).click();
      const fit = await page.evaluate(() => { const pane = document.getElementById('settings-panel'); return { overflow: pane.scrollHeight - pane.clientHeight, popup: document.getElementById('popup').getBoundingClientRect().height }; });
      expect(fit.overflow, `${status} · ${name} scrolls`).toBeLessThanOrEqual(0);
      expect(fit.popup).toBeLessThanOrEqual(560);
      heights.add(fit.popup);
    }
    expect(heights.size, `${status}: switching tabs keeps the popup height`).toBe(1);
    await tab('Downloads').click();
    const quality = panel.getByLabel('Preferred quality', { exact: true });
    if (status === 'Connected') { await expect(quality).toBeEnabled(); await expect(sheet.getByRole('note')).toHaveCount(0); }
    else {
      // One explanation with the fix replaces per-row notes; disabled controls point at it.
      await expect(quality).toBeDisabled();
      await expect(quality).toHaveAttribute('aria-describedby', 'settings-gate-text');
      await expect(sheet.getByRole('note')).toContainText(reachable ? 'Connect Chrome to SnagThis' : 'SnagThis isn’t open');
      await expect(sheet.getByRole('note').getByRole('button', { name: reachable ? 'Connect' : 'Open SnagThis', exact: true })).toBeVisible();
    }
  }
  await tab('Connection, Not connected').click();
  await expect(panel.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Use a code instead', exact: true }).click();
  await expect(page.getByLabel('Connection code', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('audio tracks: plain-language labels, DEFAULT preselected, hover to hear, Esc stops first, choosing updates the trigger', async ({ page }) => {
  const errors = await loadPopup(page);
  // cinejoy.pk shape: four nameless renditions, only Track 1 DEFAULT=YES.
  const tracks = { ...item, audio: [1, 2, 3, 4].map(n => ({ url: `https://fixture.invalid/audio_${n}.m3u8`, groupId: 'audio', name: `Track ${n}`, language: null, default: n === 1 })) };
  await page.evaluate(() => {
    window.samples = [];
    window.SnagThisSourcePreview.createAudioSample = options => {
      const control = { stopped: 0, stop() { control.stopped++; } };
      window.samples.push({ options, control });
      return control;
    };
  });
  await page.evaluate(value => window.popupFixture.load([value], [], {}), tracks);
  const trigger = page.locator('.quality-button');
  await expect(trigger).toHaveText(/1080p\s*· Track 1/);
  await trigger.click(); await drawersSettled(page);
  const drawer = page.getByRole('group', { name: 'Quality for Quality fixture' });
  await expect(drawer.locator('.qline-label')).toHaveText(['Quality', 'Audio']);
  const rows = drawer.getByRole('radiogroup', { name: 'Audio' }).locator('.atrack');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('.alabel')).toHaveText(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
  // The line under the chips describes the chosen track until another is pointed at or focused.
  const note = drawer.locator('.track-note');
  await expect(note).toHaveText('Unknown language · Default');
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(rows.nth(2)).toHaveAttribute('role', 'radio');
  await expect(rows.nth(2)).toHaveAttribute('aria-label', 'Track 3, unknown language');
  await expect(drawer.locator('.menu-note')).toHaveText('This site doesn’t name its tracks. Rest on one to check.');

  // Resting on a track starts one sample of that rendition.
  await rows.nth(2).hover();
  await expect(note).toHaveText('Unknown language');
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBe(1);
  expect(await page.evaluate(() => window.samples[0].options.rendition.url)).toBe('https://fixture.invalid/audio_3.m3u8');
  await expect(rows.nth(2)).toHaveClass(/is-loading/);
  await page.evaluate(() => window.samples[0].options.onPlaying());
  await expect(rows.nth(2)).toHaveClass(/is-playing/);
  await expect(page.locator('#sample-status')).toHaveText(/Playing a sample of Track 3 from 25% in/);
  // Moving to another track stops the first: only one at a time.
  await rows.nth(1).hover();
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBe(2);
  expect(await page.evaluate(() => window.samples[0].control.stopped)).toBe(1);
  await expect(rows.nth(2)).not.toHaveClass(/is-playing|is-loading/);
  // A failed sample says so; the track can still be chosen.
  await page.evaluate(() => window.samples[1].options.onError());
  await expect(rows.nth(1)).toHaveClass(/is-failed/);
  await expect(note).toHaveText('Sample unavailable · you can still choose it');

  // Keyboard: Space plays the focused track, the first Esc stops it, the second closes the drawer.
  await page.mouse.move(5, 5);
  await rows.nth(3).focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBe(3);
  await expect(rows.nth(3)).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.samples[2].control.stopped)).toBe(1);
  await expect(drawer).toBeVisible();
  await expect(page.locator('#sample-status')).toHaveText('Sample stopped.');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Choosing a track stops any sample and names it in the trigger. With tracks the drawer stays open
  // (quality and audio can both change); the chosen chip keeps focus and doesn't replay its sample.
  await trigger.click(); await drawersSettled(page);
  await rows.nth(2).hover();
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBe(4);
  await rows.nth(2).click();
  expect(await page.evaluate(() => window.samples[3].control.stopped)).toBe(1);
  await expect(trigger).toHaveText(/1080p\s*· Track 3/);
  await expect(drawer).toBeVisible();
  await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'true');
  await expect(rows.nth(2)).toBeFocused();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.samples.length)).toBe(4);
  // Choosing a quality in the same drawer keeps the track.
  await drawer.getByRole('radio', { name: /^720p/ }).click();
  await expect(trigger).toHaveText(/720p\s*· Track 3/);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a tall quality drawer in a full popup stays inside it: the list scrolls and every audio track is reachable', async ({ page }) => {
  const errors = await loadPopup(page);
  const tracks = { ...item, audio: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ url: `https://fixture.invalid/audio_${n}.m3u8`, groupId: 'audio', name: `Track ${n}`, language: null, default: n === 1 })),
    subtitles: ['en', 'es', 'fr', 'de'].map(language => ({ url: `https://fixture.invalid/${language}.vtt`, language, name: language.toUpperCase() })), durationSeconds: 30 };
  const others = [1, 2, 3, 4].map(n => ({ ...item, id: `other-${n}`, url: `https://fixture.invalid/other-${n}.m3u8`, sourcePageTitle: `Other fixture ${n}`, durationSeconds: 600 + n, variants: undefined }));
  await page.evaluate(values => window.popupFixture.load(values, [], {}), [...others, tracks]);
  // The shortest video is listed last, below the fold of a 560px popup.
  const row = page.locator('.video-row[data-row-key="master"]');
  await row.getByRole('button', { name: /Choose quality/ }).click();
  const chips = row.locator('.atrack');
  await expect(chips).toHaveCount(8);
  await drawersSettled(page);
  const geometry = () => page.evaluate(() => {
    const list = document.getElementById('video-list'); const popup = document.getElementById('popup').getBoundingClientRect();
    const row = document.querySelector('.video-row[data-row-key="master"]').getBoundingClientRect(); const bounds = list.getBoundingClientRect();
    return { popup: popup.height, scrolls: list.scrollHeight > list.clientHeight, rowTop: row.top, rowBottom: row.bottom, listTop: bounds.top, listBottom: bounds.bottom };
  });
  // The opened row and its drawer are scrolled fully into view.
  await expect.poll(async () => { const fit = await geometry(); return fit.rowBottom <= fit.listBottom + 1 && fit.rowTop >= fit.listTop - 1; }).toBe(true);
  const fit = await geometry();
  expect(fit.popup).toBeLessThanOrEqual(560);
  expect(fit.scrolls).toBe(true);
  const last = chips.last();
  await expect(last).toBeInViewport();
  expect(await last.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(fit.listBottom);
  expect(errors).toEqual([]);
});
test('a video only its page Service Worker can serve says so and offers no download', async ({ page }) => {
  const errors = await loadPopup(page);
  const served = { id: 'sw', url: 'https://storage.fixture.invalid/132201720.mp4#mp4/chunk/1', type: 'file', mediaKind: 'video', contentType: 'video/mp4',
    sourcePageUrl: 'https://fixture.invalid/watch', sourcePageTitle: 'Episode 1', durationSeconds: 1420, serviceWorkerServed: true };
  await page.evaluate(value => window.popupFixture.load([value], [], {}), served);
  const row = page.locator('.video-row');
  await expect(row.locator('.row-status')).toHaveText('This video only plays inside its own player');
  await expect(row.getByRole('button', { name: /^(Download|Use desktop app)$/ })).toHaveCount(0);
  await row.click({ button: 'right' });
  await expect(page.getByRole('toolbar').getByRole('button', { name: /Download with desktop/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('desktop rows show a speed trace; a watched save leaves a quiet dot under reduced motion; loading shows the pixel button', async ({ page }) => {
  const errors = await loadPopup(page);
  const film = { ...item, id: 'film', variants: undefined, title: 'Short' };
  const jobs = [{ id: 'job', queueStatus: 'downloading', progress: 40, speedBps: 4_000_000, title: 'Short' }];
  await page.evaluate(({ film, jobs }) => { window.popupFixture.load([film], jobs, { film: 'job' }); SnagThisSpeedTrace.record(jobs); }, { film, jobs });
  const row = page.locator('.video-row');
  await expect(row.locator('.row-body')).toHaveClass(/has-trace/);
  const trace = row.locator('.speed-trace');
  await expect(trace).toHaveAttribute('data-trace-state', 'downloading');
  await expect(trace).toHaveAttribute('aria-hidden', 'true');
  // Two samples start the line (one per 650ms step).
  await expect(trace).toHaveClass(/ready/, { timeout: 4000 });
  const bounds = await row.evaluate(node => ({ title: node.querySelector('.row-title').getBoundingClientRect().right, trace: node.querySelector('.speed-trace-plot').getBoundingClientRect(), action: node.querySelector(':scope > .action').getBoundingClientRect().left }));
  expect(bounds.trace.left).toBeGreaterThan(bounds.title);
  expect(bounds.trace.right).toBeLessThanOrEqual(bounds.action);
  await page.evaluate(({ film }) => window.popupFixture.load([film], [{ id: 'job', queueStatus: 'paused', progress: 40, title: 'Short' }], { film: 'job' }), { film });
  await expect(trace).toHaveAttribute('data-trace-state', 'paused');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(({ film }) => window.popupFixture.load([film], [{ id: 'job', queueStatus: 'downloading', progress: 99, title: 'Short' }], { film: 'job' }), { film });
  await page.evaluate(({ film }) => window.popupFixture.load([film], [{ id: 'job', queueStatus: 'completed', progress: 100, title: 'Short' }], { film: 'job' }), { film });
  await expect(row.locator('.row-status')).toContainText('Saved');
  await expect(page.locator('#open-app')).toHaveClass(/snag-pip/);
  await expect(page.locator('.snag-pixel')).toHaveCount(0);
  await expect(row.locator('.speed-trace')).toHaveCount(0, { timeout: 3000 });
  await page.evaluate(() => window.popupFixture.load([], [], {}));
  // Still checking this page: the first skeleton thumbnail holds the pixel button, hidden from assistive tech.
  await expect(page.locator('.discovery-state .skeleton-mascot .pixel-button')).toBeVisible();
  await expect(page.locator('.discovery-state .skeleton-mascot')).toHaveAttribute('aria-hidden', 'true');
  expect(errors).toEqual([]);
});

test('a DRM-protected title is one explanatory row with no download; unprotected media keeps its Download', async ({ page }) => {
  const errors = await loadPopup(page);
  const locked = { id: 'protected:0', url: 'https://play.fixture.invalid/video/watch/1', type: 'protected', mediaKind: 'protected', drm: true, keySystem: 'widevine', drmSite: 'Stream Service',
    sourcePageUrl: 'https://play.fixture.invalid/video/watch/1', sourcePageTitle: 'Bad Optics • Stream Service', durationSeconds: 3206, variants: [], audio: [], subtitles: [],
    detectedStreams: [{ id: 'mpd', url: 'https://cdn.fixture.invalid/manifest.mpd', drm: true }] };
  const trailer = { id: 'trailer', url: 'https://trailers.fixture.invalid/trailer.mp4', type: 'file', mediaKind: 'video', contentType: 'video/mp4',
    sourcePageUrl: locked.sourcePageUrl, sourcePageTitle: 'Bad Optics trailer', durationSeconds: 120, contentLength: 30000000 };
  await page.evaluate(values => window.popupFixture.load(values, [], {}), [locked, trailer]);
  await expect(page.locator('#page-count')).toHaveText('2 videos on this page');
  const rowsWithDrm = page.locator('.video-row[data-state="protected"]');
  await expect(rowsWithDrm).toHaveCount(1);
  const row = rowsWithDrm.first();
  await expect(row.locator('.row-status')).toHaveText("Protected by Stream Service (DRM) — SnagThis can't save it");
  await expect(row.getByRole('button', { name: /^(Download|Use desktop app|Starting download)$/ })).toHaveCount(0);
  await row.click({ button: 'right' });
  await expect(page.getByRole('toolbar').getByRole('button', { name: /Download with desktop|Preview|Quality/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await row.getByRole('button', { name: 'Why?' }).click();
  await expect(page.locator('#sheet-title')).toHaveText('Protected video');
  await expect(page.locator('#sheet-content')).toContainText('never records, unlocks or saves protected video');
  await page.locator('#close-sheet').click();
  const clear = page.locator('.video-row').filter({ hasText: 'Bad Optics trailer' });
  await expect(clear.getByRole('button', { name: 'Download' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Check again scans every frame and asks for a reload when the top frame has no SnagThis', async ({ page }) => {
  const errors = await loadPopup(page);
  const run = async (prepareOk) => page.evaluate(async (prepareOk) => {
    const scanned = [];
    let injected = false;
    window.chrome.webNavigation = { getAllFrames: async () => [{ frameId: 0 }, { frameId: 5 }] };
    window.chrome.tabs = { sendMessage: async (tabId, message, options) => {
      scanned.push(options?.frameId);
      // A tab opened before install: only a later ad iframe has the content
      // script, and Chrome answers an untargeted message with that frame.
      if (options?.frameId === 0 && !injected) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { ok: true };
    } };
    window.chrome.runtime.sendMessage = async (message) => {
      if (message.cmd === 'PREPARE_PAGE') { injected = prepareOk; return { ok: prepareOk }; }
      if (message.cmd === 'GET_TAB_MEDIA') return { ok: true, visit: 1, items: [], mappings: {} };
      return { ok: true };
    };
    await window.popupFixture.check({ id: 7, url: 'https://site.example/watch' });
    return scanned;
  }, prepareOk);

  const refused = await run(false);
  expect(refused).toEqual(expect.arrayContaining([0, 5]));
  expect(refused).not.toContain(undefined);
  await expect(page.getByRole('heading', { name: 'Refresh this page to find videos' })).toBeVisible();

  await run(true);
  await expect(page.getByRole('heading', { name: 'Refresh this page to find videos' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
