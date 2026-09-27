const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const QueueManager = require('../packages/downloader-engine/src/core/QueueManager');

function createQueueManagerFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-manager-'));
  const queueFilePath = path.join(tempRoot, 'queue.json');
  const jobs = new Map();
  const queueManager = new QueueManager({
    queueFilePath,
    fsPromises: fs.promises,
    jobs,
    runJob: async () => {},
    runDirectJob: async () => {},
    initialSettings: { autoStart: false, maxConcurrent: 1 },
  });

  return {
    tempRoot,
    queueFilePath,
    jobs,
    queueManager,
  };
}

test('queue recovery clears partial-segment resume state for interrupted downloads', async () => {
  const { queueFilePath, jobs, queueManager, tempRoot } = createQueueManagerFixture();
  try {
    const persistedJob = {
      id: 'job-recover',
      queueStatus: 'downloading',
      status: 'downloading',
      resumePartialSegments: true,
      filePath: path.join(tempRoot, 'job-recover', 'job-recover.ts'),
    };
    fs.writeFileSync(queueFilePath, JSON.stringify({
      queue: [persistedJob],
      settings: { autoStart: false, maxConcurrent: 1 },
    }), 'utf8');

    await queueManager.loadQueue();

    const recovered = jobs.get('job-recover');
    assert.ok(recovered);
    assert.equal(recovered.queueStatus, 'queued');
    assert.equal(recovered.status, 'pending');
    assert.equal(recovered.resumePartialSegments, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});

test('explicit resume preserves partial segments for the same paused job', async () => {
  const { queueManager, jobs, tempRoot } = createQueueManagerFixture();
  try {
    const job = {
      id: 'job-resume',
      queueStatus: 'paused',
      status: 'pending',
      resumePartialSegments: false,
      filePath: path.join(tempRoot, 'job-resume', 'job-resume.ts'),
    };

    queueManager.queue = [job];
    jobs.set(job.id, job);

    const resumed = queueManager.resumeJob(job.id);

    assert.equal(resumed, true);
    assert.equal(job.queueStatus, 'queued');
    assert.equal(job.status, 'pending');
    assert.equal(job.resumePartialSegments, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});

test('app shutdown stops active downloads and saves them queued for the next launch', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-suspend-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const queueFilePath = path.join(tempRoot, 'queue.json');
  const jobs = new Map();
  let runs = 0;
  const runDirectJob = async (job) => {
    runs += 1;
    while (!job.cancelled) await new Promise(resolve => setTimeout(resolve, 5));
    job.status = 'cancelled';
  };
  const queueManager = new QueueManager({ queueFilePath, fsPromises: fs.promises, jobs, runJob: runDirectJob, runDirectJob,
    initialSettings: { autoStart: true, maxConcurrent: 1 } });
  await queueManager.ready;
  const make = id => ({ id, url: `https://example.org/${id}.mp4`, mediaType: 'file', title: id, status: 'pending', queueStatus: 'queued' });
  for (const job of [make('running'), make('waiting')]) { jobs.set(job.id, job); queueManager.queue.push(job); }
  queueManager.processQueue();
  assert.equal(jobs.get('running').queueStatus, 'downloading');

  await queueManager.suspendActiveJobs({ timeoutMs: 1000 });
  assert.equal(runs, 1, 'shutdown does not start the next queued download');
  assert.equal(queueManager.getActiveCount(), 0);
  const saved = JSON.parse(fs.readFileSync(queueFilePath, 'utf8')).queue;
  assert.deepEqual(saved.map(job => [job.id, job.queueStatus]), [['running', 'queued'], ['waiting', 'queued']]);
});

test('a paused direct download with expired credentials accepts a refreshed source', async () => {
  const { queueManager, jobs, tempRoot } = createQueueManagerFixture();
  try {
    // Pause marks every job resumable, but a direct file has no playlist to
    // compare. Refresh must not demand one, or the job can never continue.
    const job = { id: 'job-direct', url: 'https://media.example/old.mp4', mediaType: 'file', queueStatus: 'paused', status: 'paused',
      resumePartialSegments: true, requiresSourceRefresh: true, errorCode: 'SOURCE_EXPIRED', filePath: path.join(tempRoot, 'job-direct.mp4') };
    queueManager.queue = [job];
    jobs.set(job.id, job);
    const result = await queueManager.refreshJobSource(job.id, { url: 'https://media.example/new.mp4', headers: { cookie: 'a=b' } });
    assert.deepEqual(result, { ok: true, resumable: false });
    assert.equal(job.url, 'https://media.example/new.mp4');
    assert.equal(job.queueStatus, 'queued');
    assert.equal(job.requiresSourceRefresh, false);
  } finally {
    await queueManager.persistence;
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});

test('pause and quit let finalization finish instead of discarding downloaded pieces', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-finalize-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const jobs = new Map();
  let finish;
  const runJob = async (job) => {
    job.status = 'finalizing';
    await new Promise(resolve => { finish = resolve; });
    // A cancelled finalizer deletes the pieces it was merging.
    job.status = job.cancelled ? 'cancelled' : 'completed';
  };
  const queueManager = new QueueManager({ queueFilePath: path.join(tempRoot, 'queue.json'), fsPromises: fs.promises, jobs,
    runJob, runDirectJob: runJob, initialSettings: { autoStart: true, maxConcurrent: 1 } });
  await queueManager.ready;
  const job = { id: 'merging', url: 'https://example.org/a.m3u8', mediaType: 'hls', title: 'a', status: 'pending', queueStatus: 'queued' };
  jobs.set(job.id, job); queueManager.queue.push(job);
  queueManager.processQueue();
  await new Promise(setImmediate);
  assert.equal(job.status, 'finalizing');
  assert.equal(queueManager.pauseJob(job.id), false);
  const suspended = queueManager.suspendActiveJobs({ timeoutMs: 1000 });
  finish();
  await suspended;
  assert.equal(job.cancelled, false);
  assert.equal(job.queueStatus, 'completed');
});
