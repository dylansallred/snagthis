const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { QueueManager, allocateJobStorageDir, sanitizeJobFolderName, isOwnedJobStorageDir } = require('../packages/downloader-engine/src');

test('new jobs use owned title folders with atomic collision suffixes throughout their lifecycle', { timeout: 20000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-named-folders-'));
  const downloadDir = path.join(dataDir, 'downloads');
  const api = createApiServer({ dataDir, downloadDir, port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true,
    initialQueueSettings: { autoStart: false } });
  const address = await api.start();
  t.after(async () => { await api.stop(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }); });
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (route, body) => {
    const response = await fetch(`${base}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${api.getAuthToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  await request('/api/jobs', { queue: { url: 'https://example.org/one.mp4', title: 'Family Movie', mediaType: 'file' } });
  await Promise.all([2, 3].map(number => request('/v1/jobs', { mediaUrl: `https://example.org/${number}.mp4`, title: 'Family Movie', mediaType: 'file' })));
  const queue = api.getState().queue;
  const folders = queue.map(job => job.outputDirectory);
  assert.deepEqual(folders.map(folder => path.basename(folder)).sort(), ['Family Movie', 'Family Movie (2)', 'Family Movie (3)']);
  for (const job of queue) assert.equal(isOwnedJobStorageDir(downloadDir, job.id, job.outputDirectory), true);
  assert.equal(sanitizeJobFolderName('../CON.mp4'), 'Video CON');
  assert.equal(sanitizeJobFolderName('__previews'), 'Video __previews');
  assert.equal(sanitizeJobFolderName('temp-important'), 'Video temp-important');
  assert.ok(Buffer.byteLength(sanitizeJobFolderName('电影'.repeat(100))) <= 180);
  assert.equal(sanitizeJobFolderName('A / B: Movie.mp4'), 'A B Movie');
  const occupied = path.join(downloadDir, 'Already there');
  fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied, 'keep.txt'), 'keep');
  assert.equal(path.basename(allocateJobStorageDir(downloadDir, 'collision-owner', 'Already there')), 'Already there (2)');
  assert.equal(fs.readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(isOwnedJobStorageDir(downloadDir, 'other-owner', folders[0]), false);
  if (process.platform !== 'win32') {
    const link = path.join(downloadDir, 'linked-folder');
    fs.symlinkSync(folders[0], link, 'dir');
    assert.equal(isOwnedJobStorageDir(downloadDir, queue[0].id, link), false);
  }

  const jobs = new Map();
  const manager = new QueueManager({ queueFilePath: path.join(dataDir, 'lifecycle-queue.json'), downloadDir,
    fsPromises: fs.promises, jobs, runJob: async () => {}, runDirectJob: async () => {}, initialSettings: { autoStart: false } });
  await manager.ready;
  const makeCompleted = (id, directory, title) => {
    const filePath = path.join(directory, `${id}-source.mp4`);
    const thumbnailPath = path.join(directory, `${id}-thumb.jpg`);
    fs.writeFileSync(filePath, 'local fixture media'); fs.writeFileSync(thumbnailPath, 'local fixture poster');
    return { id, title, filePath, mp4Path: filePath, storageDir: directory, thumbnailPath, thumbnailPaths: [thumbnailPath], status: 'completed', queueStatus: 'completed' };
  };
  const completed = makeCompleted(queue[1].id, folders[1], 'Family Movie');
  manager.relocateCompletedArtifact(completed);
  assert.equal(completed.storageDir, folders[1], 'completion must not allocate another suffix for its own named folder');
  assert.equal(path.basename(completed.mp4Path), 'Family Movie.mp4');
  assert.equal(completed.thumbnailPaths[0], completed.thumbnailPath);
  assert.equal(fs.existsSync(completed.mp4Path), true);

  const unknownFolder = allocateJobStorageDir(downloadDir, 'resolved-later', 'video');
  const resolved = makeCompleted('resolved-later', unknownFolder, 'Resolved Movie');
  manager.relocateCompletedArtifact(resolved);
  assert.equal(path.basename(resolved.storageDir), 'Resolved Movie');
  assert.equal(fs.existsSync(unknownFolder), false, 'the newly allocated placeholder folder is removed after relocation');
  assert.equal(path.dirname(resolved.thumbnailPath), resolved.storageDir);
  assert.equal(resolved.thumbnailPaths[0], resolved.thumbnailPath);
  const legacyFolder = path.join(downloadDir, 'legacy-job');
  fs.mkdirSync(legacyFolder);
  const legacy = makeCompleted('legacy-job', legacyFolder, 'Legacy Movie');
  manager.relocateCompletedArtifact(legacy);
  assert.equal(legacy.storageDir, legacyFolder, 'existing ID folders are not migrated');

  const external = path.join(dataDir, 'chosen-output');
  fs.mkdirSync(path.join(external, 'Resolved Movie'), { recursive: true });
  fs.writeFileSync(path.join(external, 'Resolved Movie', 'keep.txt'), 'existing movie');
  manager.getCompletedOutputDir = () => external;
  manager.relocateCompletedArtifact(resolved);
  assert.equal(path.basename(resolved.storageDir), 'Resolved Movie (2)');
  const chosenFolder = resolved.storageDir;
  manager.relocateCompletedArtifact(resolved);
  assert.equal(resolved.storageDir, chosenFolder, 'repeated finalization keeps its owned destination');
  assert.equal(fs.readFileSync(path.join(external, 'Resolved Movie', 'keep.txt'), 'utf8'), 'existing movie');

  const pausedDir = allocateJobStorageDir(downloadDir, 'paused-job', 'Paused video');
  const paused = { id: 'paused-job', url: 'https://example.org/paused.mp4', title: 'Paused video', storageDir: pausedDir,
    filePath: path.join(pausedDir, 'paused.mp4'), status: 'paused', queueStatus: 'paused' };
  fs.writeFileSync(`${paused.filePath}.part`, 'partial');
  manager.queue.push(paused); jobs.set(paused.id, paused);
  assert.equal(manager.resumeJob(paused.id), true);
  assert.equal(paused.storageDir, pausedDir, 'resume reuses its existing directory');
  assert.equal(manager.removeJob(paused.id), true);
  await manager.persistence;
  assert.equal(fs.existsSync(pausedDir), false, 'removing the queued partial also removes its owned folder and marker');
  assert.equal(fs.existsSync(completed.mp4Path), true, 'removal cannot affect a different completed folder');
});
