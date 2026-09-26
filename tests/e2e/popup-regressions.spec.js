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
  const startup = 'initialize().catch(error => { discoveryPending = false; discoveryError = true; renderRows(); notice(error.message); });';
  const source = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
  expect(source).toContain(startup);
  await page.addScriptTag({ content: source.replace(startup,
    `window.popupFixture = { load(items, jobs, links) { mediaItems = items; queue = jobs; mappings = links; reachable = true; compatible = true; appToken = 'fixture'; selected.clear(); renderRows(); }, pair: () => showPairing() };`,
  ) });
  return errors;
}

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
  await page.getByRole('menuitemradio').filter({ hasText: '720p' }).focus();
  await page.keyboard.press('Enter');
  await expect(trigger.locator('.resolution')).toHaveText('720p');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.originalQualityTrigger === document.querySelector('.quality-button'))).toBe(true);

  await trigger.click();
  await page.getByRole('menuitemradio').filter({ hasText: '1080p' }).click();
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

test('row extras open from a keyboard-accessible More button and return focus', async ({ page }) => {
  const errors = await loadPopup(page);
  await page.evaluate(item => window.popupFixture.load([item], [], {}), item);
  const more = page.getByRole('button', { name: /^More actions: / });
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await expect(more).toHaveCSS('opacity', '0');
  // Keyboard users reach it from the preceding row control.
  await page.getByRole('button', { name: 'Choose quality' }).focus();
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Hide', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  // Right-click opens the same menu.
  await page.locator('.video-row').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test('the store build lists YouTube pages without a download or desktop handoff', async ({ page }) => {
  const errors = await loadPopup(page, { storeBuild: true });
  const youtube = { id: 'yt', url: 'https://www.youtube.com/watch?v=abcdefghijk', type: 'file', mediaKind: 'youtube-page', contentType: 'video/youtube',
    sourcePageUrl: 'https://www.youtube.com/watch?v=abcdefghijk', sourcePageTitle: 'A real video - YouTube', youtubeMetadata: { videoId: 'abcdefghijk', title: 'A real video' } };
  await page.evaluate(value => window.popupFixture.load([value], [], {}), youtube);
  const row = page.locator('.video-row');
  await expect(row.locator('.row-status')).toHaveText('Paste this link into the SnagThis desktop app');
  await expect(row.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Download|Use desktop app)$/ })).toHaveCount(0);
  await row.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Download with desktop|Continue previous download/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rows expose status to assistive tech, open menus from the keyboard and never clip a menu', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Resume download', exact: true })).toHaveAttribute('title', 'Resume download');
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

  // Shift+F10 on a focused row opens its menu; the row reveals its More button while focused.
  await row.focus();
  await expect(row.locator('.row-more')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // The quality menu grows a short popup rather than covering the header or clipping subtitles.
  await page.evaluate(value => window.popupFixture.load([value], [], {}), film);
  await page.getByRole('button', { name: 'Choose quality' }).click();
  await expect(menu.getByRole('menuitemradio', { name: 'None', exact: true })).toBeVisible();
  const fit = await page.evaluate(() => {
    const menu = document.getElementById('menu').getBoundingClientRect(); const popup = document.getElementById('popup').getBoundingClientRect();
    const header = document.querySelector('.popup-header').getBoundingClientRect(); const node = document.getElementById('menu');
    return { top: menu.top, bottom: menu.bottom, header: header.bottom, popup: popup.bottom, height: popup.height, clipped: node.scrollHeight > node.clientHeight };
  });
  expect(fit.top).toBeGreaterThanOrEqual(fit.header);
  expect(fit.bottom).toBeLessThanOrEqual(fit.popup);
  expect(fit.height).toBeGreaterThanOrEqual(300);
  expect(fit.clipped).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#popup')).toHaveCSS('min-height', '0px');
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
  await trigger.click();
  const menu = page.locator('#menu');
  await expect(menu).toHaveClass(/\bwide\b/);
  await expect(menu.locator('.menu-title').first()).toHaveText('Quality');
  await expect(menu.locator('.menu-title').nth(1)).toHaveText('Audio 4 tracks');
  const rows = menu.locator('.atrack');
  await expect(rows).toHaveCount(4);
  await expect(rows.locator('.alabel b')).toHaveText(['Track 1', 'Track 2', 'Track 3', 'Track 4']);
  await expect(rows.locator('.alabel small')).toHaveText(['Unknown language · Default', 'Unknown language', 'Unknown language', 'Unknown language']);
  await expect(rows.nth(0).getByRole('menuitemradio')).toHaveAttribute('aria-checked', 'true');
  await expect(rows.nth(2).getByRole('menuitemradio')).toHaveAttribute('aria-label', 'Track 3, unknown language');
  await expect(menu.locator('.menu-note')).toHaveText('This site doesn’t name its tracks. Rest on one to check.');

  // Resting on a track starts one sample of that rendition.
  await rows.nth(2).hover();
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
  await expect(rows.nth(1).locator('.alabel small')).toHaveText('Sample unavailable · you can still choose it');

  // Keyboard: Space plays the focused track, the first Esc stops it, the second closes the menu.
  await page.mouse.move(5, 5);
  await rows.nth(3).getByRole('menuitemradio').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBe(3);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.samples[2].control.stopped)).toBe(1);
  await expect(menu).toBeVisible();
  await expect(page.locator('#sample-status')).toHaveText('Sample stopped.');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // Choosing a track stops any sample and names it in the trigger.
  await trigger.click();
  await rows.nth(2).hover();
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBe(4);
  await rows.nth(2).getByRole('menuitemradio').click();
  expect(await page.evaluate(() => window.samples[3].control.stopped)).toBe(1);
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveText(/1080p\s*· Track 3/);
  await trigger.click();
  await expect(menu.locator('.atrack').nth(2).getByRole('menuitemradio')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
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
  await expect(page.getByRole('menuitem', { name: /Download with desktop/ })).toHaveCount(0);
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
