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

test('the same row module works as a browser script and an ESM import', async () => {
  const context = vm.createContext({});
  for (const file of ['strings.js', 'rows.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../packages/contracts/src', file), 'utf8'), context);
  }
  const expected = toRowModel(job('downloading', { etaSeconds: 600 }));
  const browserRow = context.VidSnagRows.toRowModel(job('downloading', { etaSeconds: 600 }));
  assert.deepEqual(JSON.parse(JSON.stringify(browserRow)), expected);
  const esm = await import('../packages/contracts/src/rows.mjs');
  assert.deepEqual(esm.toRowModel(job('downloading', { etaSeconds: 600 })), expected);
});
