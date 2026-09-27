const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { QueueManager } = require('../packages/downloader-engine');
const { HistoryIndexService } = require('../packages/downloader-api/src/services/historyIndex');
const { createApiServer } = require('../packages/downloader-api/src');
const { adoptLegacyUserData, MIGRATION_MARKER } = require('../apps/desktop/electron/legacyData');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = () => {};

async function tempDir(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function corruptCopies(directory, name) {
  return (await fs.readdir(directory)).filter((entry) => entry.startsWith(`${name}.corrupt-`));
}

function busyReads(file) {
  const error = Object.assign(new Error('resource busy'), { code: 'EBUSY' });
  return { ...fs, readFile: (target, ...args) => (path.resolve(String(target)) === file ? Promise.reject(error) : fs.readFile(target, ...args)) };
}

function newQueueManager(queueFilePath, fsPromises = fs) {
  return new QueueManager({ queueFilePath, downloadDir: path.dirname(queueFilePath), fsPromises, jobs: new Map(),
    runJob: async () => {}, runDirectJob: async () => {}, initialSettings: { autoStart: false } });
}

test('an unparseable or newer history index is set aside, never overwritten, and the library is rescanned', async (t) => {
  for (const contents of ['{"version":2,"items":[', JSON.stringify({ version: 99, items: [{ fileName: 'future.mp4' }] })]) {
    const directory = await tempDir(t, 'snagthis-history-safety-');
    const downloadDir = path.join(directory, 'downloads');
    await fs.mkdir(downloadDir);
    await fs.writeFile(path.join(downloadDir, 'job1-a-Film.mp4'), 'media');
    const indexFile = path.join(directory, 'history-index.json');
    await fs.writeFile(indexFile, contents);

    const history = new HistoryIndexService({ downloadDir, indexDir: directory, fsPromises: fs, jobs: new Map() });
    await history.init();
    await history.persistIndex();

    const preserved = await corruptCopies(directory, 'history-index.json');
    assert.equal(preserved.length, 1, 'the unreadable index is kept beside the new one');
    assert.equal(await fs.readFile(path.join(directory, preserved[0]), 'utf8'), contents, 'the preserved copy is byte-identical');
    assert.deepEqual(history.items.map((item) => item.fileName), ['job1-a-Film.mp4'], 'saved files are rediscovered');
    assert.equal(JSON.parse(await fs.readFile(indexFile, 'utf8')).version, 2);
  }
});

test('a history index that cannot be read right now is not replaced this session', async (t) => {
  const directory = await tempDir(t, 'snagthis-history-busy-');
  const downloadDir = path.join(directory, 'downloads');
  await fs.mkdir(downloadDir);
  await fs.writeFile(path.join(downloadDir, 'job1-a-Film.mp4'), 'media');
  const indexFile = path.join(directory, 'history-index.json');
  const original = JSON.stringify({ version: 2, items: [{ fileName: 'kept.mp4', title: 'Kept metadata' }], removedPaths: ['gone.mp4'] });
  await fs.writeFile(indexFile, original);

  const history = new HistoryIndexService({ downloadDir, indexDir: directory, fsPromises: busyReads(indexFile), jobs: new Map() });
  await history.init();
  await history.persistIndex();
  assert.equal(await fs.readFile(indexFile, 'utf8'), original, 'the locked index keeps its contents');
  assert.deepEqual(await corruptCopies(directory, 'history-index.json'), []);
  assert.ok(history.items.some((item) => item.fileName === 'job1-a-Film.mp4'), 'the session still lists files from disk');
});

test('an unparseable or newer queue is set aside and a locked queue is never overwritten', async (t) => {
  for (const contents of ['{"queue":[{"id":"a"', JSON.stringify({ version: 99, queue: [{ id: 'future' }] })]) {
    const directory = await tempDir(t, 'snagthis-queue-safety-');
    const queueFile = path.join(directory, 'queue.json');
    await fs.writeFile(queueFile, contents);
    const manager = newQueueManager(queueFile);
    await manager.ready;
    await manager.saveQueue();
    const preserved = await corruptCopies(directory, 'queue.json');
    assert.equal(preserved.length, 1, 'the unreadable queue is kept');
    assert.equal(await fs.readFile(path.join(directory, preserved[0]), 'utf8'), contents);
    assert.equal(JSON.parse(await fs.readFile(queueFile, 'utf8')).version, 1, 'a fresh versioned queue is written beside it');
  }

  const directory = await tempDir(t, 'snagthis-queue-busy-');
  const queueFile = path.join(directory, 'queue.json');
  const original = JSON.stringify({ queue: [{ id: 'job-1', title: 'Paused film', status: 'paused', queueStatus: 'paused' }] });
  await fs.writeFile(queueFile, original);
  const manager = newQueueManager(queueFile, busyReads(queueFile));
  await manager.ready;
  await manager.saveQueue();
  assert.equal(await fs.readFile(queueFile, 'utf8'), original, 'the locked queue keeps its jobs');
  assert.deepEqual(await corruptCopies(directory, 'queue.json'), []);
});

test('partial downloads survive temp cleanup when the queue cannot be restored, and crash scratch is swept', { timeout: 15000 }, async (t) => {
  const directory = await tempDir(t, 'snagthis-unrestored-queue-');
  const downloadDir = path.join(directory, 'downloads');
  const partialDir = path.join(downloadDir, 'temp-cdn.example_video-lost1-abc123');
  const ytDlpFolder = path.join(downloadDir, 'lost2-def456');
  const jobFolder = path.join(downloadDir, 'Some Movie');
  const scratch = [path.join(jobFolder, 'native-pieces-Ab12Cd'), path.join(jobFolder, 'local-preview-Xy34Zw'), path.join(downloadDir, 'local-preview-Qq11Rr')];
  await fs.mkdir(partialDir, { recursive: true });
  await fs.mkdir(ytDlpFolder, { recursive: true });
  await fs.writeFile(path.join(partialDir, 'seg-0.ts'), 'downloaded piece');
  await fs.writeFile(path.join(ytDlpFolder, 'lost2-def456-video.mp4.part'), 'partial yt-dlp download');
  for (const folder of scratch) {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, '0.piece'), 'scratch');
  }
  await fs.writeFile(path.join(jobFolder, 'keep.mp4'), 'a saved video');
  // Older than the automatic cleanup age.
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(partialDir, old, old);
  await fs.writeFile(path.join(directory, 'queue.json'), '{"version":1,"queue":[{"id":"lost1-abc123"');

  const startApi = async () => {
    const api = createApiServer({ dataDir: directory, downloadDir, port: 0,
      ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath,
      trustBinaryPaths: true, initialQueueSettings: { autoStart: false } });
    const { port } = await api.start();
    t.after(() => api.stop());
    await sleep(200); // The cleanup scheduler runs once immediately on start.
    return { api, port };
  };
  const clearTemp = async ({ api, port }) => fetch(`http://127.0.0.1:${port}/api/maintenance/clear-temp-downloads`, {
    method: 'POST', headers: { Authorization: `Bearer ${api.getAuthToken()}` } });

  const first = await startApi();
  assert.equal((await corruptCopies(directory, 'queue.json')).length, 1, 'the damaged queue is set aside');
  assert.equal(fsSync.existsSync(path.join(partialDir, 'seg-0.ts')), true, 'automatic cleanup keeps pieces of an unknown owner');
  const refused = await clearTemp(first);
  assert.equal(refused.status, 409);
  assert.equal(fsSync.existsSync(path.join(ytDlpFolder, 'lost2-def456-video.mp4.part')), true, 'Clear temporary data keeps partials too');
  for (const folder of scratch) assert.equal(fsSync.existsSync(folder), false, `${path.basename(folder)} left by a crash is removed`);
  assert.equal(fsSync.existsSync(path.join(jobFolder, 'keep.mp4')), true, 'saved videos next to scratch folders are untouched');
  await first.api.stop();

  // The next launch finds no queue.json, but the set-aside copy still owns them.
  const second = await startApi();
  assert.equal(fsSync.existsSync(path.join(partialDir, 'seg-0.ts')), true);
  assert.equal((await clearTemp(second)).status, 409);
});

test('queue and history writes flush the file before replacing the saved copy', async (t) => {
  const directory = await tempDir(t, 'snagthis-flush-');
  const flushed = [];
  const recording = { ...fs, writeFile: (file, data, options) => { flushed.push([path.basename(String(file)), Boolean(options && options.flush)]); return fs.writeFile(file, data, options); } };
  const manager = newQueueManager(path.join(directory, 'queue.json'), recording);
  await manager.ready;
  await manager.saveQueue();
  const history = new HistoryIndexService({ downloadDir: path.join(directory, 'downloads'), indexDir: directory, fsPromises: recording, jobs: new Map() });
  await history.init();
  await history.persistIndex();
  assert.deepEqual(flushed, [['queue.json.tmp', true], ['history-index.json.tmp', true]]);
});

test('startup does not announce earlier sessions\' saved videos, and a restarted server resumes WebSocket updates', { timeout: 15000 }, async (t) => {
  const directory = await tempDir(t, 'snagthis-restart-');
  await fs.writeFile(path.join(directory, 'queue.json'), JSON.stringify({
    settings: { autoStart: false, maxConcurrent: 1 },
    queue: [{ id: 'old-job', title: 'Saved last week', url: 'https://example.invalid/a.mp4', status: 'completed', queueStatus: 'completed', mediaType: 'file', progress: 100, updatedAt: Date.now() }],
  }));
  const announced = [];
  const api = createApiServer({ dataDir: directory, port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath,
    trustBinaryPaths: true, initialQueueSettings: { autoStart: false }, onDownloadComplete: (job) => announced.push(job.id) });
  let running = false;
  t.after(() => running && api.stop());

  // The desktop creates the server before starting it; nothing may broadcast in between.
  await sleep(700);
  await api.start();
  running = true;
  await sleep(700);
  assert.deepEqual(announced, [], 'no "Video saved" for a job finished in an earlier session');

  await api.stop();
  running = false;
  const { port } = await api.start();
  running = true;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, ['snagthis', `snagthis-auth.${api.getAuthToken()}`]);
  t.after(() => socket.terminate());
  const updates = [];
  socket.on('message', (message) => { const parsed = JSON.parse(message); if (parsed.type === 'queue:update') updates.push(parsed.data); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'subscribe', channel: 'queue' }));
  const deadline = Date.now() + 3000;
  while (updates.length === 0 && Date.now() < deadline) await sleep(25);
  assert.ok(updates.length > 0, 'a restarted server accepts subscriptions and sends queue updates');
  assert.deepEqual(announced, []);
});

function legacyFixture(root) {
  const legacy = path.join(root, 'VidSnag');
  const target = path.join(root, 'SnagThis');
  fsSync.mkdirSync(path.join(legacy, 'data', 'downloads'), { recursive: true });
  const saved = path.join(legacy, 'data', 'downloads', 'film.mp4');
  fsSync.writeFileSync(saved, 'media');
  fsSync.writeFileSync(path.join(legacy, 'data', 'queue.json'), JSON.stringify({ queue: [{ id: 'a', filePath: saved }] }));
  fsSync.writeFileSync(path.join(legacy, 'data', 'history-index.json'), JSON.stringify({ version: 2, items: [{ fileName: 'film.mp4', absolutePath: saved }] }));
  return { legacy, target };
}

function failingOnce(match, code) {
  let failed = false;
  return {
    ...fsSync,
    renameSync: (from, to) => {
      if (!failed && match(String(from), String(to))) {
        failed = true;
        throw Object.assign(new Error(code), { code });
      }
      return fsSync.renameSync(from, to);
    },
  };
}

function assertAdopted(target, legacy) {
  assert.equal(fsSync.existsSync(legacy), false);
  const queue = fsSync.readFileSync(path.join(target, 'data', 'queue.json'), 'utf8');
  assert.equal(JSON.parse(queue).queue[0].filePath, path.join(target, 'data', 'downloads', 'film.mp4'));
  assert.ok(!fsSync.readFileSync(path.join(target, 'data', 'history-index.json'), 'utf8').includes('VidSnag'));
  assert.equal(JSON.parse(fsSync.readFileSync(path.join(target, MIGRATION_MARKER), 'utf8')).state, 'complete');
}

test('legacy VidSnag data is adopted once, and a locked folder is retried without creating an empty SnagThis folder', async (t) => {
  const root = await tempDir(t, 'snagthis-legacy-');
  const { legacy, target } = legacyFixture(root);
  const locked = failingOnce((from, to) => from === legacy && to === target, 'EBUSY');
  const first = adoptLegacyUserData(target, legacy, { fs: locked, log: quiet });
  assert.deepEqual(first, { userData: legacy, state: 'deferred' }, 'this session keeps using the intact legacy folder');
  assert.equal(fsSync.existsSync(target), false, 'no SnagThis folder blocks the next attempt');

  const second = adoptLegacyUserData(target, legacy, { log: quiet });
  assert.deepEqual(second, { userData: target, state: 'complete' });
  assertAdopted(target, legacy);
  assert.deepEqual(adoptLegacyUserData(target, legacy, { log: quiet }), { userData: target, state: 'complete' }, 'later launches do nothing');
});

test('a failed path rewrite does not stop startup and finishes on the next launch', async (t) => {
  const root = await tempDir(t, 'snagthis-legacy-rewrite-');
  const { legacy, target } = legacyFixture(root);
  const failing = failingOnce((from, to) => to === path.join(target, 'data', 'queue.json'), 'EPERM');
  const first = adoptLegacyUserData(target, legacy, { fs: failing, log: quiet });
  assert.deepEqual(first, { userData: target, state: 'rewrite-pending' });
  assert.equal(JSON.parse(fsSync.readFileSync(path.join(target, MIGRATION_MARKER), 'utf8')).state, 'rewrite-pending');

  assert.deepEqual(adoptLegacyUserData(target, legacy, { log: quiet }), { userData: target, state: 'complete' });
  assertAdopted(target, legacy);
});

test('legacy data on another volume is copied, verified and then removed', async (t) => {
  const root = await tempDir(t, 'snagthis-legacy-exdev-');
  const { legacy, target } = legacyFixture(root);
  const crossDevice = failingOnce((from, to) => from === legacy && to === target, 'EXDEV');
  assert.deepEqual(adoptLegacyUserData(target, legacy, { fs: crossDevice, log: quiet }), { userData: target, state: 'complete' });
  assertAdopted(target, legacy);
  assert.equal(fsSync.readFileSync(path.join(target, 'data', 'downloads', 'film.mp4'), 'utf8'), 'media');
  assert.equal(fsSync.existsSync(`${target}.migrating`), false);
});
