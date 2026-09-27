const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTool } = require('./fixtures/server');
const { HistoryIndexService } = require('../packages/downloader-api/src/services/historyIndex');

test('history excludes temporary preview fragments at every depth and clears stale records without changing media files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-history-preview-'));
  const downloadDir = path.join(directory, 'downloads');
  const saved = path.join(downloadDir, 'Actual movie', '0.mp4');
  try {
    await fs.mkdir(path.dirname(saved), { recursive: true });
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-t', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', saved]);
    const rootPreview = await fs.mkdtemp(path.join(downloadDir, 'local-preview-'));
    const nestedPreview = await fs.mkdtemp(path.join(path.dirname(saved), 'local-preview-'));
    await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', saved, '-c', 'copy',
      '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_time', '1',
      '-hls_fmp4_init_filename', 'part-0.mp4', '-hls_segment_filename', 'part-%d.m4s', 'candidate.m3u8'], { cwd: rootPreview });
    const rootInit = path.join(rootPreview, 'part-0.mp4');
    const nestedInit = path.join(nestedPreview, 'part-0.mp4');
    await fs.copyFile(rootInit, nestedInit);
    const removedPreview = path.join(nestedPreview, 'already-cleaned', 'part-0.mp4');
    const missingMovie = path.join(downloadDir, 'A moved movie.mp4');
    const record = (absolutePath) => ({
      id: Buffer.from(absolutePath).toString('base64url'),
      absolutePath, relativePath: path.relative(downloadDir, absolutePath), fileName: path.basename(absolutePath),
      label: path.basename(absolutePath), sizeBytes: 100, modifiedAt: Date.now(), ext: '.mp4',
    });
    const indexPath = path.join(directory, 'history-index.json');
    await fs.writeFile(indexPath, JSON.stringify({ version: 2, items: [rootInit, nestedInit, removedPreview, missingMovie].map(record), removedPaths: [] }));
    const originalMovie = await fs.readFile(saved);
    const originalInit = await fs.readFile(rootInit);
    assert.ok(originalMovie.length < 1_000_000, 'a legitimate small video must remain visible');
    assert.ok(originalInit.length > 0);

    const history = new HistoryIndexService({ downloadDir, indexDir: directory, fsPromises: fs, jobs: new Map() });
    await history.init();
    assert.deepEqual(new Set(history.items.map(item => item.absolutePath)), new Set([saved, missingMovie]));
    assert.equal(history.items.find(item => item.absolutePath === missingMovie).missing, true, 'real missing media retains Locate recovery');
    const persisted = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    assert.deepEqual(new Set(persisted.items.map(item => item.absolutePath)), new Set([saved, missingMovie]), 'incorrect fragment records are removed from the saved index');
    assert.deepEqual(await fs.readFile(saved), originalMovie);
    assert.deepEqual(await fs.readFile(rootInit), originalInit);
    assert.deepEqual(await fs.readFile(nestedInit), originalInit, 'index cleanup never deletes or alters preview bytes');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a removed list entry stays hidden, but the same title downloaded again appears', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-history-removed-'));
  const downloadDir = path.join(directory, 'downloads');
  const saved = path.join(downloadDir, 'Same Title', 'Same Title.mp4');
  try {
    await fs.mkdir(path.dirname(saved), { recursive: true });
    const encode = () => runTool(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=size=160x90:rate=10', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', saved]);
    await encode();
    const history = new HistoryIndexService({ downloadDir, indexDir: directory, fsPromises: fs, jobs: new Map() });
    await history.init();
    const item = history.items.find(entry => entry.absolutePath === saved);
    assert.ok(item);
    assert.equal(await history.removeById(item.id), true);
    await history.refreshFromDisk({ force: true });
    assert.equal(history.items.some(entry => entry.absolutePath === saved), false, 'Remove from list keeps the kept file hidden');

    // Trash, then download the same title again into the same path.
    await fs.rm(saved);
    await new Promise(resolve => setTimeout(resolve, 20));
    await encode();
    await history.refreshFromDisk({ force: true });
    assert.equal(history.items.some(entry => entry.absolutePath === saved), true, 'a new download at the old path is shown');
    await history.persistence;
    const reloaded = new HistoryIndexService({ downloadDir, indexDir: directory, fsPromises: fs, jobs: new Map() });
    await reloaded.init();
    assert.equal(reloaded.items.some(entry => entry.absolutePath === saved), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a rescan reuses its directory listing for artwork, and concurrent index writes coalesce into one complete write', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-history-writes-'));
  const downloadDir = path.join(directory, 'downloads');
  try {
    await fs.mkdir(path.join(downloadDir, 'Shelf'), { recursive: true });
    for (let i = 0; i < 6; i += 1) {
      await fs.writeFile(path.join(downloadDir, 'Shelf', `job${i}-a-Film ${i}.mp4`), 'media');
      if (i % 2) await fs.writeFile(path.join(downloadDir, 'Shelf', `job${i}-a-thumb.jpg`), 'jpeg');
    }
    let writes = 0;
    const counted = { ...fs, writeFile: (...args) => { writes += 1; return fs.writeFile(...args); } };
    const history = new HistoryIndexService({ downloadDir, indexDir: directory, fsPromises: counted, jobs: new Map() });
    await history.init();
    const artwork = Object.fromEntries(history.items.map(item => [item.fileName, item.thumbnailUrl]));
    for (let i = 0; i < 6; i += 1) {
      assert.equal(artwork[`job${i}-a-Film ${i}.mp4`], i % 2 ? `/downloads/Shelf/job${i}-a-thumb.jpg` : null);
    }

    writes = 0;
    const pending = [];
    for (const item of history.items) {
      item.title = `Renamed ${item.fileName}`;
      pending.push(history.persistIndex());
    }
    await Promise.all(pending);
    assert.equal(writes, 1, 'writes requested together share one atomic write');
    const raw = await fs.readFile(path.join(directory, 'history-index.json'), 'utf8');
    assert.doesNotMatch(raw, /\n/, 'the index is stored compactly');
    assert.ok(JSON.parse(raw).items.every(item => item.title === `Renamed ${item.fileName}`), 'the shared write includes every change made before it');
    await assert.rejects(fs.access(path.join(directory, 'history-index.json.tmp')));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
