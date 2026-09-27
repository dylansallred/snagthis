const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { toRowModel, mergeRows, formatEta, formatSize, formatWhen, formatDuration, classifyProblem } = require('../packages/contracts/src/rows');

const now = new Date(2026, 8, 19, 12).getTime();
const job = (queueStatus, extra = {}) => ({ id: 'job-1', title: 'Open film', queueStatus, status: queueStatus, progress: 34.9, createdAt: now, ...extra });

test('row copy and its only visible action match every specified state', () => {
  const examples = [
    [{ id: 'media-1', title: 'Open film', height: 1080, sizeBytes: 2100000000 }, {}, 'detected', '1080p · 2.1 GB', 'download'],
    [job('queued'), {}, 'waiting', 'Waiting', null],
    [job('queued'), { firstQueuedId: 'job-1' }, 'waiting', 'Waiting · starts next', null],
    [job('downloading', { etaSeconds: 310 }), {}, 'downloading', '34% · 5 min left', 'pause'],
    [job('downloading', { etaSeconds: null }), {}, 'downloading', '34%', 'pause'],
    [job('downloading', { status: 'Remuxing output' }), {}, 'finishing', 'Finishing up…', null],
    [job('downloading', { status: 'Verifying', progress: 100 }), {}, 'finishing', 'Finishing up…', null],
    [job('paused'), {}, 'paused', 'Paused at 34%', 'resume'],
    [job('failed', { error: 'Network unreachable' }), {}, 'problem', 'Connection lost at 34%', 'retry'],
    [job('completed', { sizeBytes: 182000000 }), { now }, 'saved', 'Saved today · 182 MB', 'play'],
    [job('completed', { fileExists: false }), {}, 'missing', 'File was moved or deleted', 'locate'],
    [job('completed'), { surface: 'popup' }, 'saved', 'Saved', 'play'],
  ];
  for (const [input, options, state, statusLine, action] of examples) {
    const row = toRowModel(input, options);
    assert.equal(row.state, state);
    assert.equal(row.statusLine, statusLine);
    assert.equal(row.action && row.action.id, action);
  }
  assert.equal(toRowModel(job('cancelled')), null);
  assert.equal(toRowModel({ id: 'unknown-size', height: 1080, sizeBytes: 0 }).statusLine, '1080p');
  assert.equal(toRowModel(job('completed'), { surface: 'popup' }).tone, 'success');
  assert.equal(toRowModel(job('completed'), { surface: 'popup' }).action.style, 'bordered');
  assert.equal(toRowModel(job('completed')).action.style, 'icon');
});

test('ETA, sizes, dates and duration use the documented boundary rules', () => {
  assert.equal(formatEta(null), '');
  assert.equal(formatEta(NaN), '');
  assert.equal(formatEta(-1), '');
  assert.equal(formatEta(0), 'under a minute left');
  assert.equal(formatEta(59.9), 'under a minute left');
  assert.equal(formatEta(60), '1 min left');
  assert.equal(formatEta(3599), '59 min left');
  assert.equal(formatEta(3600), '1 hr 0 min left');
  assert.equal(formatEta(7500), '2 hr 5 min left');
  assert.equal(formatSize(undefined), '');
  assert.equal(formatSize(0), '0 MB');
  assert.equal(formatSize(1393), '<1 MB');
  assert.equal(formatSize(182400000), '182 MB');
  assert.equal(formatSize(2100000000), '2.1 GB');
  assert.equal(formatSize(2100000000, { estimated: true }), 'about 2.1 GB');
  assert.equal(formatWhen(now, now), 'today');
  assert.equal(formatWhen(new Date(2026, 8, 18, 23), now), 'yesterday');
  assert.equal(formatWhen(new Date(2026, 8, 17), now), 'Thursday');
  assert.equal(formatWhen(new Date(2026, 8, 13), now), 'Sunday');
  assert.equal(formatWhen(new Date(2026, 8, 12), now), '12 Sep');
  assert.equal(formatWhen(null, now), '');
  assert.equal(formatWhen('invalid', now), '');
  assert.equal(formatDuration(undefined), '');
  assert.equal(formatDuration(0), '');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(60), '1:00');
  assert.equal(formatDuration(3599), '59:59');
  assert.equal(formatDuration(3600), '1:00:00');
  assert.equal(formatDuration(8406), '2:20:06');
});

test('the popup turns an expired link into an on-page continue step without changing desktop copy', () => {
  const failed = job('failed', { error: 'SOURCE_EXPIRED' });
  const popup = toRowModel(failed, { surface: 'popup' });
  assert.equal(popup.statusLine, 'Link expired at 34%. Play the video, then click Download to continue.');
  assert.deepEqual(popup.action, { id: 'continue', label: 'Download', style: 'primary' });
  assert.equal(popup.problem.code, 'expired');
  const desktop = toRowModel(failed, { surface: 'desktop' });
  assert.equal(desktop.statusLine, 'Link expired. Reopen the page to continue from 34%.');
  assert.equal(desktop.action.id, 'open-page');
});

test('every problem has exactly the approved sentence and labelled recovery action', () => {
  const examples = [
    ['ERROR: [youtube] B0_13LSguRc: Sign in to confirm your age. Use --cookies-from-browser or --cookies for the authentication.', 'authentication', 'Sign-in required to download this video.', 'Details'],
    ['Manifest HTTP 403', 'expired', 'Link expired. Reopen the page to continue from 34%.', 'Open page'],
    [{ statusCode: 410 }, 'expired', 'Link expired. Reopen the page to continue from 34%.', 'Open page'],
    ['Retries exhausted', 'network', 'Connection lost at 34%', 'Try again'],
    [new Error('getaddrinfo ENOTFOUND'), 'network', 'Connection lost at 34%', 'Try again'],
    ['ENOSPC: disk full', 'disk', 'Not enough space in Videos', 'Choose folder'],
    ['EACCES: permission denied', 'disk', 'Not enough space in Videos', 'Choose folder'],
    ['DRM: Widevine', 'unsupported', "This video can't be downloaded", 'Details'],
    ['Live playlist unsupported', 'unsupported', "This video can't be downloaded", 'Details'],
    ['FILE_MISSING', 'missing', 'File was moved or deleted', 'Locate'],
    ['Unexpected response', 'unknown', 'Something went wrong at 34%', 'Try again'],
  ];
  for (const [error, code, message, label] of examples) {
    const problem = classifyProblem(error, { progress: 34.9, folder: 'Videos' });
    assert.equal(problem.code, code);
    assert.equal(problem.message, message);
    assert.equal(problem.action.label, label);
    assert.equal(problem.action.style, 'bordered');
  }
  assert.notEqual(classifyProblem('Segment HTTP 403').code, 'expired');
});

test('YouTube sign-in is the visible desktop recovery action, with other sources kept in Details', () => {
  const failed = job('failed', {
    error: 'ERROR: [youtube] B0_13LSguRc: Sign in to confirm your age.',
    sourcePageUrl: 'https://www.youtube.com/watch?v=B0_13LSguRc',
  });
  assert.deepEqual(toRowModel(failed, { surface: 'desktop' }).action, {
    id: 'use-chrome-session', label: 'Use Chrome sign-in', style: 'bordered',
  });
  assert.equal(toRowModel(failed, { surface: 'popup' }).action.id, 'details', 'the popup cannot read Chrome credentials');
  for (const url of ['https://youtube.com.evil.example/watch?v=B0_13LSguRc', 'https://www.youtube.com:8443/watch?v=B0_13LSguRc', 'https://user:secret@www.youtube.com/watch?v=B0_13LSguRc']) {
    assert.equal(toRowModel({ ...failed, url }, { surface: 'desktop' }).action.id, 'details');
  }
  assert.equal(toRowModel({ ...failed, error: 'Network unreachable' }, { surface: 'desktop' }).action.id, 'retry');
});

test('row progress changes state without resetting when artwork arrives', () => {
  const before = toRowModel(job('downloading'));
  const after = toRowModel(job('downloading', { thumbnailUrls: ['https://example.com/frame.jpg'] }));
  assert.equal(before.thumbnailUrl, null);
  assert.equal(after.thumbnailUrl, 'https://example.com/frame.jpg');
  assert.equal(before.progress, after.progress);
  assert.equal(after.fill.scanLine, true);
  assert.equal(toRowModel(job('paused')).fill.dimmed, true);
  assert.equal(toRowModel(job('paused')).fill.scanLine, false);
  assert.equal(toRowModel(job('queued')).progress, 0);
  assert.equal(toRowModel(job('downloading', { status: 'Converting', progress: 12 })).progress, 97);
  assert.equal(toRowModel(job('downloading', { progress: 100 })).state, 'finishing');
  assert.equal(toRowModel(job('downloading', { progress: 99.99 })).statusLine, '99%');
  assert.equal(toRowModel(job('completed')).progress, 100);
});

test('merged rows preserve queue order, prioritise problems and never duplicate a job at completion', () => {
  const queue = [
    job('queued', { id: 'waiting-b' }), job('queued', { id: 'waiting-a' }),
    job('completed'), job('paused', { id: 'paused' }),
    job('downloading', { id: 'active' }), job('failed', { id: 'problem', error: 'Connection lost' }),
    job('cancelled', { id: 'cancelled' }),
  ];
  const history = [
    { id: 'history-1', jobId: 'job-1', title: 'Open film', fileName: 'film.mp4', modifiedAt: now },
    { id: 'history-2', jobId: 'old-job', title: 'Older film', fileName: 'old.mp4', modifiedAt: now - 86400000 },
  ];
  assert.deepEqual(mergeRows(queue, history, { now }).map(row => row.id), ['problem', 'active', 'paused', 'waiting-b', 'waiting-a', 'job-1', 'old-job']);
  assert.equal(mergeRows(queue, history)[3].statusLine, 'Waiting · starts next');
  for (const state of ['queued', 'downloading', 'completed']) {
    const rows = mergeRows([job(state)], state === 'completed' ? history.slice(0, 1) : []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'job-1');
  }
  const retry = mergeRows([job('downloading')], history.slice(0, 1));
  assert.equal(retry.length, 1);
  assert.equal(retry[0].state, 'downloading');
});

test('merged rows match the straightforward merge on a large randomized library', () => {
  // The original quadratic merge, kept as the reference for the indexed version.
  const reference = (queue, history, options) => {
    const firstWaiting = queue.find(item => item.queueStatus === 'queued');
    const rowOptions = { ...options, firstQueuedId: options.firstQueuedId || (firstWaiting && firstWaiting.id) };
    const queueById = new Map(queue.map(item => [String(item.id), item]));
    const historyJobIds = new Set(history.filter(item => item.jobId).map(item => String(item.jobId)));
    const rows = [];
    for (const item of queue) {
      if (item.queueStatus === 'completed' && historyJobIds.has(String(item.id))) continue;
      const row = toRowModel(item, rowOptions);
      if (row) rows.push(row);
    }
    for (const item of history) {
      const active = item.jobId && queueById.get(String(item.jobId));
      if (active && active.queueStatus !== 'completed' && active.queueStatus !== 'cancelled') continue;
      const row = toRowModel(item, { ...rowOptions, kind: 'history' });
      if (row && !rows.some(existing => existing.id === row.id)) rows.push(row);
    }
    const rank = { problem: 0, missing: 0, downloading: 1, finishing: 1, paused: 2, waiting: 3, detected: 3, saved: 4 };
    const date = row => new Date(row.source.completedAt ?? row.source.modifiedAt ?? row.source.updatedAt ?? row.source.createdAt ?? 0).getTime();
    return rows.sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'saved' && b.state === 'saved' ? date(b) - date(a) : 0));
  };
  let seed = 20260926;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = values => values[Math.floor(random() * values.length)];
  const stamp = () => pick([undefined, now - Math.floor(random() * 30) * 86400000, new Date(now - Math.floor(random() * 5) * 3600000).toISOString(), 'not a date']);
  const statuses = ['queued', 'downloading', 'paused', 'failed', 'completed', 'cancelled'];
  const queue = Array.from({ length: 80 }, (_, i) => job(pick(statuses), { id: `job-${i % 70}`, progress: Math.floor(random() * 100), completedAt: stamp() }));
  const history = Array.from({ length: 3000 }, (_, i) => ({
    id: `saved-${i % 2800}`, jobId: random() < 0.1 ? `job-${Math.floor(random() * 90)}` : random() < 0.5 ? `old-${i % 2500}` : undefined,
    title: `Saved ${i}`, fileName: `saved-${i}.mp4`, sizeBytes: Math.floor(random() * 2e9),
    completedAt: stamp(), modifiedAt: stamp(), createdAt: stamp(), missing: random() < 0.05,
  }));
  const options = { surface: 'desktop', now };
  assert.deepEqual(mergeRows(queue, history, options), reference(queue, history, options));
});

test('the same row module works as a browser script and an ESM import', async () => {
  const context = vm.createContext({});
  for (const file of ['strings.js', 'rows.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../packages/contracts/src', file), 'utf8'), context);
  }
  const expected = toRowModel(job('downloading', { etaSeconds: 600 }));
  const browserRow = context.SnagThisRows.toRowModel(job('downloading', { etaSeconds: 600 }));
  assert.deepEqual(JSON.parse(JSON.stringify(browserRow)), expected);
  const esm = await import('../packages/contracts/src/rows.mjs');
  assert.deepEqual(esm.toRowModel(job('downloading', { etaSeconds: 600 })), expected);
});

test('a dead rendition is a quality problem, not an expired link, and a fallback is labelled', () => {
  assert.equal(classifyProblem('Video piece 1 is unavailable from the source (status 502).').code, 'quality');
  assert.equal(classifyProblem({ code: 'VARIANT_UNAVAILABLE', message: 'This quality is unavailable from the source (status 502). Choose another quality.' }).code, 'quality');
  assert.equal(classifyProblem('Segment 4 failed with status 403').code, 'quality');
  assert.equal(classifyProblem('Video piece 40 could not be downloaded after 1 attempt (status 403).', { progress: 40 }).code, 'expired', 'mid-download refusals are expiry');
  assert.equal(classifyProblem('Media request failed with status 403.').code, 'expired', 'a refused playlist still means the link expired');
  const row = toRowModel(job('downloading', { selection: { height: 2160 }, qualityFallback: { from: 2160, to: 1080 }, etaSeconds: null }));
  assert.equal(row.qualityLabel, '1080p');
  assert.equal(row.qualityNote, '1080p — 2160p unavailable');
  assert.match(row.statusLine, /1080p — 2160p unavailable/);
});

test('DRM-protected rows use plain shared copy naming the site, never a download', () => {
  const { strings, interpolate } = require('../packages/contracts/src/strings');
  const { withProtectedRow, markProtected, protectedSiteName } = require('../apps/extension/js/detection');
  assert.equal(interpolate('drmProtected', { site: 'HBO Max' }), "Protected by HBO Max (DRM) — SnagThis can't save it");
  assert.equal(strings.drmWhy, 'Why?');
  assert.match(interpolate('drmHelpBody', { site: 'HBO Max' }), /never records, unlocks or saves protected video/);

  // A protected frame's script-fed pieces and unparsed manifest join one row;
  // a parsed clear playlist and a directly played file stay their own rows.
  const contexts = { 0: { sourcePageUrl: 'https://play.example/watch/1', sourcePageTitle: 'Episode', protection: { keySystem: 'widevine', siteName: 'Example+', durationSeconds: 3000 } } };
  const items = markProtected([
    { id: 'mpd', url: 'https://cdn.example/m.mpd', type: 'file', mediaKind: 'dash-manifest', streamType: 'dash', frameId: 0 },
    { id: 'piece', url: 'https://cdn.example/v/12.mp4', mediaKind: 'video', delivery: 'script', frameId: 0 },
    { id: 'trailer', url: 'https://cdn.example/t.m3u8', type: 'hls', mediaKind: 'hls-manifest', streamType: 'hls', frameId: 0, manifest: { isMaster: false, isDrm: false, segmentUrls: [] } },
    { id: 'clip', url: 'https://cdn.example/clip.mp4', mediaKind: 'video', delivery: 'element', frameId: 0 },
  ], contexts);
  assert.deepEqual(items.map(item => Boolean(item.drm)), [true, true, false, false]);
  const rows = withProtectedRow(items.map(item => ({ ...item, detectedStreams: [item] })), { contexts, url: 'https://play.example/watch/1' });
  assert.deepEqual(rows.map(row => row.id), ['protected:0', 'trailer', 'clip']);
  assert.equal(rows[0].durationSeconds, 3000);
  assert.equal(protectedSiteName(rows[0]), 'Example+');
  assert.deepEqual(rows[0].detectedStreams.map(stream => stream.id), ['mpd', 'piece']);
  // Rows on the desktop surface are unaffected: DRM errors stay "unsupported".
  assert.equal(toRowModel({ id: 'j', queueStatus: 'failed', error: { code: 'DRM_PROTECTED' } }).problem.code, 'unsupported');
});
