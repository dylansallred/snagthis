const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runTool } = require('./fixtures/server');
const { HistoryIndexService } = require('../packages/downloader-api/src/services/historyIndex');

test('history excludes temporary preview fragments at every depth and clears stale records without changing media files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-history-preview-'));
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
