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

async function loadPopup(page) {
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
    window.VidSnagSourcePreview = { sourceFor: () => null };
  });
  for (const relative of [
    'packages/contracts/src/strings.js', 'packages/contracts/src/rows.js',
    'packages/contracts/src/hls.js', 'packages/contracts/src/selection.js',
    'apps/extension/js/detection.js', 'apps/extension/js/browser-downloads.js', 'apps/extension/popup/titles.js',
    'apps/extension/popup/model.js',
  ]) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, relative), 'utf8') });
  }
  // Exercise the shipped renderer and menu handlers with explicit fixture state.
  // Replace only startup: no worker, desktop API, browser profile or download runs.
  const startup = 'initialize().catch(error => { discoveryPending = false; discoveryError = true; renderRows(); notice(error.message); });';
  const source = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
  expect(source).toContain(startup);
  await page.addScriptTag({ content: source.replace(startup,
    `window.popupFixture = { load(items, jobs, links) { mediaItems = items; queue = jobs; mappings = links; reachable = true; compatible = true; appToken = 'fixture'; selected.clear(); renderRows(); } };`,
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
        jobId: VidSnagPopupModel.jobFor(item, mappings, [completed, { ...active, queueStatus, status: queueStatus }]).id,
      })),
      standaloneVariant: VidSnagPopupModel.jobFor({ id: 'master' }, mappings, [completed, active]).id,
      unmapped: VidSnagPopupModel.jobFor(item, { master: completed.id }, [completed, active]).id,
      completedBeforeFailed: VidSnagPopupModel.jobFor(item, { master: active.id, mirror: completed.id }, [
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
