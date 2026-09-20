const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '../..');
const fixture = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { mergeRows } from '@m3u8/contracts/src/rows.mjs';
import { VideoList } from '@/components/list/VideoList';
import { SpeedChart } from '@/components/list/SpeedChart';
import { recordSpeeds, subscribeSpeedSamples } from '@/lib/speedHistory';

const root = createRoot(document.getElementById('root'));
const noop = () => {};
const asyncNoop = async () => {};
const noPreview = async () => null;
const job = { id: 'active', title: 'Download fixture', queueStatus: 'downloading', status: 'downloading', progress: 10, speedBps: 1000000 };
window.rowRenders = {};
window.commands = [];

function ListFixture() {
  const [progress, setProgress] = useState(10);
  const [revision, setRevision] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [history, setHistory] = useState(() => [
    { id: 'saved', title: 'Saved fixture', fileName: 'saved.mp4', modifiedAt: Date.now(), height: 720 },
    { id: 'saved-other', title: 'Other saved fixture', fileName: 'other.mp4', modifiedAt: Date.now() },
  ]);
  window.updateRows = patch => flushSync(() => {
    if ('progress' in patch) setProgress(patch.progress);
    if ('revision' in patch) setRevision(patch.revision);
    if (patch.metadata) setHistory(items => items.map(item => item.id === 'saved' ? { ...item, ...patch.metadata } : item));
  });
  return <VideoList rows={mergeRows([{ ...job, progress }], history, { surface: 'desktop' })}
    apiBase="http://127.0.0.1:1" folder="/fixture/videos" expandedId={expandedId} renamingId={null} busyId={null}
    hasMore={false} loadingMore={false} onLoadMore={noop} onMoveTo={noop} onRename={asyncNoop} onRefreshLink={asyncNoop}
    onRequestPreview={noPreview} onToggle={row => setExpandedId(current => current === row.id ? null : row.id)}
    onCommand={(row, command) => window.commands.push({ id: row.id, command, revision })} />;
}
window.mountRows = () => flushSync(() => root.render(<ListFixture />));

window.mountChart = () => {
  flushSync(() => root.render(null));
  recordSpeeds([{ id: 'chart', speedBps: 1000000 }]);
  const counts = { scheduledFrames: 0, frames: 0, samples: 0, pathWrites: 0 };
  const originalRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = callback => {
    counts.scheduledFrames++;
    return originalRAF(now => { counts.frames++; callback(now); });
  };
  const stopSamples = subscribeSpeedSamples(() => { counts.samples++; });
  const observer = new MutationObserver(records => {
    counts.pathWrites += records.filter(record => record.attributeName === 'd').length;
  });
  observer.observe(document.getElementById('root'), { attributes: true, subtree: true });
  flushSync(() => root.render(<SpeedChart jobId="chart" />));
  window.chartCounts = () => ({ ...counts });
  window.chartVisible = visible => {
    if (visible) delete document.visibilityState;
    else Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  window.unmountChart = () => flushSync(() => root.render(null));
  window.cleanupChart = () => {
    flushSync(() => root.render(null));
    observer.disconnect();
    stopSamples();
    recordSpeeds([]);
    window.requestAnimationFrame = originalRAF;
    delete document.visibilityState;
  };
};
`;

let bundle;
let stylesheet;
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: fixture, loader: 'tsx', resolveDir: root }, write: false,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@': path.join(root, 'apps/desktop/src') },
    plugins: [{ name: 'count-row-renders', setup(builder) {
      builder.onLoad({ filter: /components[\\/]list[\\/]VideoRow\.tsx$/ }, async ({ path: filename }) => {
        const source = await fs.readFile(filename, 'utf8');
        const marker = '  const [menuOpen, setMenuOpen]';
        if (!source.includes(marker)) throw new Error('Update the VideoRow render-counter injection point');
        return {
          contents: source.replace(marker, '  window.rowRenders[row.id] = (window.rowRenders[row.id] || 0) + 1;\n' + marker),
          loader: 'tsx', resolveDir: path.dirname(filename),
        };
      });
    } }],
  });
  bundle = result.outputFiles[0].text;
  stylesheet = (await fs.readFile(path.join(root, 'apps/desktop/src/globals.css'), 'utf8'))
    .replace(/^@import[^;]+;/gm, '').replace(/^@custom-variant[^;]+;/gm, '').replace('@theme {', ':root {');
});

test('queue updates skip unchanged saved rows while keeping actions, focus and metadata current', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.mountRows());
  const before = await page.evaluate(() => ({ ...window.rowRenders }));
  await page.evaluate(() => window.updateRows({ progress: 20, revision: 1 }));
  expect(await page.evaluate(() => ({ ...window.rowRenders }))).toEqual({ ...before, active: before.active + 1 });
  await expect(page.locator('[data-row-key="active"]').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');

  const saved = page.locator('[data-row-key="saved"]');
  await saved.getByRole('button', { name: 'Play: Saved fixture', exact: true }).click();
  expect(await page.evaluate(() => window.commands.at(-1))).toEqual({ id: 'saved', command: 'play', revision: 1 });
  const savedRenders = await page.evaluate(() => window.rowRenders.saved);
  await page.evaluate(() => window.updateRows({ revision: 2 }));
  expect(await page.evaluate(() => window.rowRenders.saved)).toBe(savedRenders);
  await saved.getByRole('button', { name: 'Play: Saved fixture', exact: true }).click();
  expect(await page.evaluate(() => window.commands.at(-1).revision)).toBe(2);

  await saved.focus();
  await saved.press('Enter');
  await expect(page.locator('#details-saved')).toBeVisible();
  await expect(saved.locator('.folder-action')).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.updateRows({ metadata: { title: 'Updated saved fixture', height: 1080 } }));
  await expect(saved.locator('.row-title')).toHaveText('Updated saved fixture');
  await expect(saved.locator('.quality-mark')).toContainText('1080p');
});

test('reduced-motion charts follow samples without RAF and stop hidden or unmounted work', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFixture(page);
  await page.evaluate(() => window.mountChart());
  try {
    const initial = await page.evaluate(() => window.chartCounts());
    await expect.poll(() => page.evaluate(() => window.chartCounts().samples)).toBeGreaterThan(initial.samples);
    let counts = await page.evaluate(() => window.chartCounts());
    expect(counts.scheduledFrames).toBe(0);
    expect(counts.pathWrites - initial.pathWrites).toBe((counts.samples - initial.samples) * 2);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => page.evaluate(() => window.chartCounts().frames)).toBeGreaterThan(0);
    await page.evaluate(() => window.chartVisible(false));
    const hidden = await page.evaluate(() => window.chartCounts());
    await expect.poll(() => page.evaluate(() => window.chartCounts().samples)).toBeGreaterThan(hidden.samples);
    counts = await page.evaluate(() => window.chartCounts());
    expect(counts.frames).toBe(hidden.frames);
    expect(counts.scheduledFrames).toBe(hidden.scheduledFrames);
    expect(counts.pathWrites).toBe(hidden.pathWrites);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.chartVisible(true));
    const resumed = await page.evaluate(() => window.chartCounts());
    await expect.poll(() => page.evaluate(() => window.chartCounts().samples)).toBeGreaterThan(resumed.samples);
    counts = await page.evaluate(() => window.chartCounts());
    expect(counts.scheduledFrames).toBe(resumed.scheduledFrames);
    expect(counts.pathWrites).toBeGreaterThan(resumed.pathWrites);

    await page.evaluate(() => window.unmountChart());
    const unmounted = await page.evaluate(() => window.chartCounts());
    await expect.poll(() => page.evaluate(() => window.chartCounts().samples)).toBeGreaterThan(unmounted.samples);
    counts = await page.evaluate(() => window.chartCounts());
    expect(counts.frames).toBe(unmounted.frames);
    expect(counts.scheduledFrames).toBe(unmounted.scheduledFrames);
    expect(counts.pathWrites).toBe(unmounted.pathWrites);
  } finally {
    await page.evaluate(() => window.cleanupChart());
  }
});

async function openFixture(page) {
  await page.setViewportSize({ width: 820, height: 700 });
  await page.route('http://desktop-render.test/**', route => route.fulfill(route.request().url().endsWith('/bundle.js')
    ? { contentType: 'application/javascript', body: bundle }
    : { contentType: 'text/html', body: `<html><head><style>${stylesheet}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>` }));
  await page.goto('http://desktop-render.test/');
}
