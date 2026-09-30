const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';

const { HistoryIndexService } = require('../packages/downloader-api/src/services/historyIndex');

// A general save folder, as when someone picks all of Downloads: thousands of folders of other
// files, package and app folders, TypeScript projects, and a few videos.
function makeGeneralFolder(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-general-folder-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }));
  const downloadDir = path.join(base, 'app-data', 'downloads');
  const saveDir = path.join(base, 'Downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  const write = (relative, content = 'x') => {
    const file = path.join(saveDir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  // 40 × 50 folders of documents, two levels deep: 2,000 folders and 4,000 files, none a video.
  for (let group = 0; group < 40; group += 1) {
    for (let folder = 0; folder < 50; folder += 1) {
      write(`Archive ${group}/Folder ${folder}/notes.txt`);
      write(`Archive ${group}/Folder ${folder}/scan.pdf`);
    }
  }
  // Folders never entered: packages, version control, hidden, app bundles.
  for (let index = 0; index < 300; index += 1) write(`project/node_modules/pkg-${index}/index.js`);
  write('project/node_modules/pkg-0/demo.mp4', Buffer.alloc(4096, 1));
  write('project/.git/objects/ab/cdef', 'object');
  write('.cache/clip.mp4', Buffer.alloc(4096, 1));
  write('Player.app/Contents/Resources/intro.mp4', Buffer.alloc(4096, 1));
  // TypeScript sources, large enough that size alone can't rule them out.
  const source = `export const value = ${JSON.stringify('x'.repeat(2000))};\n`;
  write('project/src/index.ts', source);
  write('project/src/components/Button.ts', source);
  // The videos: a transport stream (188-byte packets starting 0x47), MP4s at several depths.
  const packet = Buffer.alloc(188, 0xff);
  packet[0] = 0x47;
  write('Recordings/stream.ts', Buffer.concat(Array.from({ length: 20 }, () => packet)));
  write('Trips/2024/Coast/beach.mp4', Buffer.alloc(2048, 2));
  write('Movie night.mkv', Buffer.alloc(1024, 3));
  // A folder made in SnagThis earlier, still empty.
  fs.mkdirSync(path.join(saveDir, 'Watch later'));
  return { base, downloadDir, saveDir };
}

test('a general save folder shows only folders with videos or made in SnagThis, within a bounded scan', async (t) => {
  const { base, downloadDir, saveDir } = makeGeneralFolder(t);
  const index = new HistoryIndexService({
    downloadDir, indexDir: path.join(base, 'app-data'), fsPromises: fs.promises, getLibraryRoot: () => saveDir,
  });
  index.keepFolder(path.join(saveDir, 'Watch later'));

  const started = Date.now();
  await index.init();
  const elapsed = Date.now() - started;
  const library = await index.library();

  assert.deepEqual(library.folders.map((folder) => folder.path).sort(), [
    'Recordings', 'Trips', 'Trips/2024', 'Trips/2024/Coast', 'Watch later',
  ], 'no folder of documents, packages or apps appears');
  assert.equal(library.folders.find((folder) => folder.path === 'Trips').videoCount, 1, 'a folder counts the videos inside it at any depth');
  assert.equal(library.folders.find((folder) => folder.path === 'Watch later').videoCount, 0, 'an empty folder made in SnagThis still shows');

  const names = index.items.map((item) => path.relative(saveDir, item.absolutePath).split(path.sep).join('/')).sort();
  assert.deepEqual(names, ['Movie night.mkv', 'Recordings/stream.ts', 'Trips/2024/Coast/beach.mp4'],
    'TypeScript .ts files and videos inside package, hidden and app folders are not saved videos');
  assert.ok(elapsed < 10_000, `the first scan took ${elapsed} ms`);

  // A kept folder deleted outside SnagThis is forgotten, and the index remembers the rest.
  fs.rmdirSync(path.join(saveDir, 'Watch later'));
  await index.refreshFromDisk({ force: true });
  assert.equal(index.folders.some((folder) => folder.path === 'Watch later'), false);
  assert.equal(index.keptFolders.size, 0);
});

test('a rescan stops at its entry and time limits and keeps what it already knew', async (t) => {
  const { base, downloadDir, saveDir } = makeGeneralFolder(t);
  const open = new HistoryIndexService({
    downloadDir, indexDir: path.join(base, 'app-data'), fsPromises: fs.promises, getLibraryRoot: () => saveDir,
  });
  await open.init();
  assert.equal(open.lastScanTruncated, false);
  assert.equal(open.items.length, 3);

  // The same library with limits far below its size: the scan stops early, videos it found
  // before stay listed (not reported missing), and they stay reachable in Saved.
  const limited = new HistoryIndexService({
    downloadDir, indexDir: path.join(base, 'app-data'), fsPromises: fs.promises, getLibraryRoot: () => saveDir,
    scanLimits: { maxEntries: 200 },
  });
  const started = Date.now();
  await limited.init();
  const elapsed = Date.now() - started;
  assert.equal(limited.lastScanTruncated, true);
  assert.ok(elapsed < 2_000, `a limited scan took ${elapsed} ms`);
  assert.equal(limited.items.length, 3);
  assert.equal(limited.items.every((item) => !item.missing), true, 'videos beyond the limit are not reported missing');
  const shown = new Set(['', ...limited.folders.map((folder) => folder.path)]);
  for (const item of limited.items) assert.ok(shown.has(item.folder), `${item.fileName} is in a folder Saved shows`);

  const timed = new HistoryIndexService({
    downloadDir, indexDir: path.join(base, 'app-data'), fsPromises: fs.promises, getLibraryRoot: () => saveDir,
    scanLimits: { maxMs: 1 },
  });
  await timed.init();
  assert.equal(timed.lastScanTruncated, true, 'the time limit stops a scan too');
});
