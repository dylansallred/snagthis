const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { folderNameProblem, groupSaved, sortSaved, viewLabel, normalizeView } = require('../packages/contracts');
const { moveDirectorySync } = require('../packages/downloader-engine/src/utils/moveFile');

// Saved videos laid out the way SnagThis writes them, with real files in a temporary save folder:
// a marked video folder with its poster and subtitles, a legacy job-ID folder, and a loose video
// with side files that share its name.
const JOB_ID = 'mf3k2x1a-ab12cd';
function makeLibrary(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-folders-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dataDir = path.join(base, 'data');
  const downloadDir = path.join(dataDir, 'downloads');
  const saveDir = path.join(base, 'SnagThis');
  const trashDir = path.join(base, 'Trash');
  for (const directory of [downloadDir, saveDir, trashDir]) fs.mkdirSync(directory, { recursive: true });
  const write = (file, content = `fixture ${path.basename(file)}`) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
  const ember = path.join(saveDir, 'Ember Tide');
  write(path.join(ember, '.snagthis-job.json'), JSON.stringify({ version: 1, jobId: JOB_ID }));
  const video = write(path.join(ember, 'Ember Tide.mp4'), Buffer.alloc(4096, 1));
  const subtitles = write(path.join(ember, 'Ember Tide.en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
  const poster = write(path.join(ember, `${JOB_ID}-thumb.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  write(path.join(saveDir, 'Loose clip.mp4'), Buffer.alloc(2048, 2));
  write(path.join(saveDir, 'Loose clip.en.srt'), 'subtitles');
  write(path.join(saveDir, 'Loose clip.jpg'), 'poster');
  write(path.join(saveDir, 'Loose clip (other cut).mp4'), Buffer.alloc(1024, 3));
  write(path.join(saveDir, 'mf3k2x1b-zz99yy', 'Night bus.mp4'), Buffer.alloc(512, 4));
  fs.mkdirSync(path.join(saveDir, 'Road trips'));
  fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: [{
    id: JOB_ID, title: 'Ember Tide — sunset crossing', status: 'completed', queueStatus: 'completed', completedAt: Date.now(),
    filePath: video, mp4Path: video, outputPath: video, thumbnailPath: poster, subtitlePath: subtitles, storageDir: ember, outputDirectory: ember,
    sourcePageUrl: 'https://www.nebula.tv/videos/ember-tide',
  }], settings: { autoStart: false, maxConcurrent: 1 } }));
  const trashed = [];
  const api = createApiServer({
    dataDir, downloadDir, port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true,
    initialQueueSettings: { autoStart: false },
    getCompletedOutputDir: () => saveDir,
    // Only the operating system's Trash is replaced; everything else is the real file system.
    onTrashFile: async (file) => { trashed.push(file); fs.renameSync(file, path.join(trashDir, path.basename(file))); },
  });
  return { base, dataDir, downloadDir, saveDir, trashDir, trashed, api, write };
}

// Rescans run at most once a second; wait that long before expecting an outside change.
const nextRescan = () => new Promise((resolve) => setTimeout(resolve, 1100));

async function connect(t, library) {
  const address = await library.api.start();
  t.after(() => library.api.stop());
  const token = library.api.getAuthToken();
  const request = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const items = async (query = '') => (await request(`/api/history?limit=1000${query}`)).body.items;
  const byTitle = async (pattern) => (await items()).find((item) => pattern.test(item.title || item.fileName));
  return { request, items, byTitle };
}

test('folders are real subfolders: create, rename, move a video with its side files in and back, name clashes get a suffix', async (t) => {
  const library = makeLibrary(t);
  const { saveDir } = library;
  const { request, items, byTitle } = await connect(t, library);

  let info = (await request('/api/library')).body;
  assert.equal(info.root.name, 'SnagThis');
  assert.deepEqual(info.folders.map((folder) => folder.path), ['Road trips'], 'video folders (marked, job-ID and legacy) are part of their video, not user folders');
  const ember = await byTitle(/Ember Tide/);
  assert.equal(ember.folder, '');
  assert.equal((await byTitle(/Night bus/)).folder, '', 'a legacy job-ID folder is the video, so it sits at the top level');

  // Create, including a nested folder, and refuse names the file system (or Windows) would not keep.
  assert.equal((await request('/api/library/folders', { parent: '', name: 'Watch later' })).status, 200);
  assert.equal((await request('/api/library/folders', { parent: 'Road trips', name: '2024' })).status, 200);
  assert.ok(fs.statSync(path.join(saveDir, 'Road trips', '2024')).isDirectory());
  for (const name of ['CON', 'lpt1.txt', 'a<b', 'what?', 'nested/name', 'back\\slash', 'dot.', 'space ', '', '   ', '.hidden', '..', 'temp-1', '__previews']) {
    const refused = await request('/api/library/folders', { parent: '', name });
    assert.equal(refused.status, 400, `refuses ${JSON.stringify(name)}`);
  }
  const duplicate = await request('/api/library/folders', { parent: '', name: 'road TRIPS' });
  if (process.platform === 'darwin' || process.platform === 'win32') assert.equal(duplicate.status, 400, 'names differing only in case clash on macOS and Windows');
  assert.equal((await request('/api/library/folders', { parent: '../outside', name: 'x' })).status, 400);
  assert.equal(fs.existsSync(path.join(library.base, 'outside')), false);

  // Move the marked video folder into Road trips: the whole folder moves, with poster and subtitles.
  let moved = (await request('/api/library/move', { ids: [ember.id], to: 'Road trips' })).body;
  assert.deepEqual(moved.results.map((result) => result.ok), [true]);
  const inRoadTrips = path.join(saveDir, 'Road trips', 'Ember Tide');
  assert.deepEqual(fs.readdirSync(inRoadTrips).sort(), ['.snagthis-job.json', 'Ember Tide.en.srt', 'Ember Tide.mp4', `${JOB_ID}-thumb.jpg`]);
  assert.equal(fs.existsSync(path.join(saveDir, 'Ember Tide')), false);
  let movedEmber = (await items()).find((item) => item.id === ember.id);
  assert.equal(movedEmber.folder, 'Road trips', 'the library index follows the move and keeps the same identity');
  assert.equal(movedEmber.absolutePath, path.join(inRoadTrips, 'Ember Tide.mp4'));
  assert.equal(movedEmber.missing, false);
  assert.equal((await items('&folder=Road%20trips')).map((item) => item.id).join(), ember.id);
  assert.equal((await items('&folder=')).some((item) => item.id === ember.id), false);
  assert.deepEqual((await request('/api/history?folder=')).body.savedJobIds, [JOB_ID], 'a folder list still says which finished downloads are saved elsewhere');
  assert.deepEqual((await items('&sort=size')).map((item) => item.sizeBytes), [4096, 2048, 1024, 512], 'the whole library in the Largest order');
  const job = (await request('/api/queue')).body.queue.find((entry) => entry.id === JOB_ID);
  assert.ok(job, 'the finished job is still known');
  const persistedQueue = JSON.parse(fs.readFileSync(path.join(library.dataDir, 'queue.json'), 'utf8')).queue.find((entry) => entry.id === JOB_ID);
  assert.equal(persistedQueue.subtitlePath, path.join(inRoadTrips, 'Ember Tide.en.srt'), 'the job points at the moved side files');
  assert.equal(persistedQueue.thumbnailPath, path.join(inRoadTrips, `${JOB_ID}-thumb.jpg`));
  info = (await request('/api/library')).body;
  const roadTrips = info.folders.find((folder) => folder.path === 'Road trips');
  assert.equal(roadTrips.videoCount, 1);
  assert.equal(roadTrips.sizeBytes, 4096);

  // A loose video moves with the files that share its name, and not with a different video that merely starts the same.
  const loose = await byTitle(/^Loose clip\.mp4$/);
  moved = (await request('/api/library/move', { ids: [loose.id], to: 'Road trips/2024' })).body;
  assert.equal(moved.results[0].ok, true);
  assert.deepEqual(fs.readdirSync(path.join(saveDir, 'Road trips', '2024')).sort(), ['Loose clip.en.srt', 'Loose clip.jpg', 'Loose clip.mp4']);
  assert.ok(fs.existsSync(path.join(saveDir, 'Loose clip (other cut).mp4')), 'another video is never taken along');
  assert.equal((await items()).find((item) => item.id === loose.id).folder, 'Road trips/2024');

  // A clash across folders: a second "Loose clip" arriving gets " (2)" on the video and its side files alike.
  library.write(path.join(saveDir, 'Loose clip.mp4'), Buffer.alloc(100, 9));
  library.write(path.join(saveDir, 'Loose clip.en.srt'), 'other subtitles');
  await nextRescan();
  const second = (await items()).find((item) => item.fileName === 'Loose clip.mp4' && item.folder === '');
  assert.ok(second, 'a file added in Finder shows up after a rescan');
  assert.notEqual(second.id, loose.id, 'a new file at a moved video’s old path is a different video');
  moved = (await request('/api/library/move', { ids: [second.id], to: 'Road trips/2024' })).body;
  assert.equal(moved.results[0].ok, true);
  const names = fs.readdirSync(path.join(saveDir, 'Road trips', '2024')).sort();
  assert.deepEqual(names, ['Loose clip (2).en.srt', 'Loose clip (2).mp4', 'Loose clip.en.srt', 'Loose clip.jpg', 'Loose clip.mp4']);
  assert.equal(fs.readFileSync(path.join(saveDir, 'Road trips', '2024', 'Loose clip.mp4')).length, 2048, 'nothing was overwritten');

  // And back to the top level.
  moved = (await request('/api/library/move', { ids: [ember.id, loose.id], to: '' })).body;
  assert.deepEqual(moved.results.map((result) => result.ok), [true, true]);
  assert.ok(fs.existsSync(path.join(saveDir, 'Ember Tide', 'Ember Tide.mp4')));
  assert.ok(fs.existsSync(path.join(saveDir, 'Loose clip.en.srt')));
  movedEmber = (await items()).find((item) => item.id === ember.id);
  assert.equal(movedEmber.folder, '');

  // Rename a folder with videos inside: the index and nested folders follow.
  await request('/api/library/move', { ids: [ember.id], to: 'Road trips/2024' });
  const renamed = await request('/api/library/folders/rename', { path: 'Road trips', name: 'Coast roads' });
  assert.equal(renamed.body.path, 'Coast roads');
  assert.ok(fs.existsSync(path.join(saveDir, 'Coast roads', '2024', 'Ember Tide', 'Ember Tide.mp4')));
  assert.equal((await items()).find((item) => item.id === ember.id).folder, 'Coast roads/2024');
  assert.deepEqual((await request('/api/library')).body.folders.map((folder) => folder.path).sort(), ['Coast roads', 'Coast roads/2024', 'Watch later']);
  assert.equal((await request('/api/library/folders/rename', { path: 'Coast roads', name: 'Watch later' })).status, 400, 'renaming onto a sibling is refused');
  assert.equal((await request('/api/library/folders/rename', { path: '', name: 'x' })).status, 400, 'the save folder itself is not renamed here');
});

test('a move that fails leaves the original intact, including a partly moved video', async (t) => {
  const library = makeLibrary(t);
  const { saveDir } = library;
  const { request, byTitle } = await connect(t, library);
  const loose = await byTitle(/^Loose clip\.mp4$/);
  const original = ['Loose clip.mp4', 'Loose clip.en.srt', 'Loose clip.jpg'].map((name) => [name, fs.readFileSync(path.join(saveDir, name))]);

  // A side file refuses to move after the video has already gone: the video comes back.
  const rename = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (String(from).endsWith('Loose clip.jpg') && String(to).includes('Road trips')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return rename.apply(this, arguments);
  };
  let result;
  try { result = (await request('/api/library/move', { ids: [loose.id], to: 'Road trips' })).body; } finally { fs.renameSync = rename; }
  assert.deepEqual(result.results[0], { id: loose.id, ok: false, code: 'in-use' });
  for (const [name, content] of original) assert.deepEqual(fs.readFileSync(path.join(saveDir, name)), content, `${name} is back where it was`);
  assert.deepEqual(fs.readdirSync(path.join(saveDir, 'Road trips')), []);
  const after = await byTitle(/^Loose clip\.mp4$/);
  assert.equal(after.folder, '');
  assert.equal(after.missing, false);

  // A destination SnagThis may not write to (POSIX permissions).
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    fs.chmodSync(path.join(saveDir, 'Road trips'), 0o500);
    try {
      const denied = (await request('/api/library/move', { ids: [loose.id], to: 'Road trips' })).body;
      assert.equal(denied.results[0].code, 'permission');
      assert.ok(fs.existsSync(path.join(saveDir, 'Loose clip.mp4')));
    } finally { fs.chmodSync(path.join(saveDir, 'Road trips'), 0o700); }
  }

  // A destination that disappeared, and a video whose file is gone.
  assert.equal((await request('/api/library/move', { ids: [loose.id], to: 'Gone' })).status, 404);
  fs.renameSync(path.join(saveDir, 'Loose clip (other cut).mp4'), path.join(library.base, 'elsewhere.mp4'));
  await nextRescan();
  const other = await byTitle(/other cut/);
  assert.equal(other.missing, true, 'a file moved away in Finder keeps the File was moved or deleted state');
  const missing = (await request('/api/library/move', { ids: [other.id], to: 'Road trips' })).body;
  assert.deepEqual(missing.results[0], { id: other.id, ok: false, code: 'missing' });
});

test('moving across volumes copies, verifies and only then removes the original folder', async (t) => {
  const library = makeLibrary(t);
  const source = path.join(library.saveDir, 'Ember Tide');
  const target = path.join(library.saveDir, 'Road trips', 'Ember Tide');
  const rename = fs.renameSync;
  const copy = fs.copyFileSync;
  // The first rename of the folder crosses a "volume"; the copy of the video then fails once.
  let crossed = false;
  let failCopy = true;
  fs.renameSync = function (from) {
    if (!crossed && path.resolve(from) === source) { crossed = true; throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); }
    return rename.apply(this, arguments);
  };
  fs.copyFileSync = function (from) {
    if (failCopy && String(from).endsWith('Ember Tide.mp4')) { failCopy = false; throw Object.assign(new Error('full'), { code: 'ENOSPC' }); }
    return copy.apply(this, arguments);
  };
  try {
    assert.throws(() => moveDirectorySync(source, target), { code: 'ENOSPC' });
    assert.ok(fs.existsSync(path.join(source, 'Ember Tide.mp4')), 'the original folder is untouched');
    assert.deepEqual(fs.readdirSync(path.join(library.saveDir, 'Road trips')), [], 'no partial copy is left behind');
    crossed = false;
    const before = fs.statSync(path.join(source, 'Ember Tide.mp4'));
    moveDirectorySync(source, target);
    assert.equal(fs.existsSync(source), false);
    const after = fs.statSync(path.join(target, 'Ember Tide.mp4'));
    assert.equal(after.size, before.size);
    assert.equal(Math.round(after.mtimeMs / 1000), Math.round(before.mtimeMs / 1000), 'the saved date survives the copy');
    assert.deepEqual(fs.readdirSync(target).sort(), ['.snagthis-job.json', 'Ember Tide.en.srt', 'Ember Tide.mp4', `${JOB_ID}-thumb.jpg`]);
  } finally {
    fs.renameSync = rename;
    fs.copyFileSync = copy;
  }
});

test('deleting a folder: empty goes at once, Keep the videos moves everything up, Move folder to Trash uses the trash path', async (t) => {
  const library = makeLibrary(t);
  const { saveDir, trashed } = library;
  const { request, items, byTitle } = await connect(t, library);

  // Empty (apart from system clutter): deleted without a choice.
  fs.writeFileSync(path.join(saveDir, 'Road trips', '.DS_Store'), 'clutter');
  assert.deepEqual((await request('/api/library/folders/delete', { path: 'Road trips' })).body, { ok: true, deleted: 'empty', moved: 0 });
  assert.equal(fs.existsSync(path.join(saveDir, 'Road trips')), false);
  assert.equal(trashed.length, 0);

  // Keep the videos: videos (with their side files), a subfolder and a file SnagThis didn't save all move up.
  await request('/api/library/folders', { parent: '', name: 'Trips' });
  await request('/api/library/folders', { parent: 'Trips', name: 'Old' });
  const ember = await byTitle(/Ember Tide/);
  const loose = await byTitle(/^Loose clip\.mp4$/);
  const nightBus = await byTitle(/Night bus/);
  await request('/api/library/move', { ids: [ember.id, loose.id], to: 'Trips' });
  await request('/api/library/move', { ids: [nightBus.id], to: 'Trips/Old' });
  library.write(path.join(saveDir, 'Trips', 'route.gpx'), '<gpx/>');
  // Something already at the top level with a clashing name.
  library.write(path.join(saveDir, 'route.gpx'), '<gpx>older</gpx>');
  await nextRescan();
  const info = (await request('/api/library')).body.folders.find((folder) => folder.path === 'Trips');
  assert.equal(info.videoCount, 3, 'counts include subfolders');
  assert.deepEqual(info.otherFiles, { count: 1, names: ['route.gpx'] }, 'files SnagThis didn’t save are named for the confirmation');
  assert.equal((await request('/api/library/folders/delete', { path: 'Trips' })).status, 409, 'a folder with contents needs a choice');
  const kept = (await request('/api/library/folders/delete', { path: 'Trips', mode: 'keep' })).body;
  assert.equal(kept.deleted, 'keep');
  assert.equal(fs.existsSync(path.join(saveDir, 'Trips')), false);
  assert.ok(fs.existsSync(path.join(saveDir, 'Ember Tide', 'Ember Tide.en.srt')));
  assert.ok(fs.existsSync(path.join(saveDir, 'Loose clip.en.srt')));
  assert.ok(fs.existsSync(path.join(saveDir, 'Old', 'mf3k2x1b-zz99yy', 'Night bus.mp4')));
  assert.equal(fs.readFileSync(path.join(saveDir, 'route.gpx'), 'utf8'), '<gpx>older</gpx>');
  assert.equal(fs.readFileSync(path.join(saveDir, 'route (2).gpx'), 'utf8'), '<gpx/>', 'a clashing name gets a suffix instead of overwriting');
  const after = await items();
  assert.equal(after.find((item) => item.id === ember.id).folder, '');
  assert.equal(after.find((item) => item.id === nightBus.id).folder, 'Old');
  assert.equal(trashed.length, 0, 'keeping the videos never uses the Trash');

  // Move folder to Trash: through the trash path, and its videos leave the list.
  const trashedFolder = path.join(saveDir, 'Old');
  const result = (await request('/api/library/folders/delete', { path: 'Old', mode: 'trash' })).body;
  assert.deepEqual(result, { ok: true, deleted: 'trash', moved: 1 });
  assert.deepEqual(trashed, [trashedFolder]);
  assert.ok(fs.existsSync(path.join(library.trashDir, 'Old', 'mf3k2x1b-zz99yy', 'Night bus.mp4')), 'the files are in the Trash, not deleted');
  assert.equal((await items()).some((item) => item.id === nightBus.id), false);
  assert.equal((await request('/api/library/folders/delete', { path: 'Old', mode: 'trash' })).status, 404);
});

test('changes made in Finder or Explorer are picked up by a rescan', async (t) => {
  const library = makeLibrary(t);
  const { saveDir } = library;
  const { request, byTitle } = await connect(t, library);
  const ember = await byTitle(/Ember Tide/);

  // A folder made outside SnagThis, a video filed into it by hand, and a folder renamed there.
  fs.mkdirSync(path.join(saveDir, 'Made in Finder', 'Inside'), { recursive: true });
  fs.renameSync(path.join(saveDir, 'Ember Tide'), path.join(saveDir, 'Made in Finder', 'Ember Tide'));
  fs.renameSync(path.join(saveDir, 'Road trips'), path.join(saveDir, 'Coast'));
  library.write(path.join(saveDir, 'Coast', 'Dropped in.webm'), Buffer.alloc(300, 5));
  await nextRescan();
  const info = (await request('/api/library')).body;
  assert.deepEqual(info.folders.map((folder) => folder.path).sort(), ['Coast', 'Made in Finder', 'Made in Finder/Inside']);
  const coast = info.folders.find((folder) => folder.path === 'Coast');
  assert.equal(coast.videoCount, 1);
  const dropped = await byTitle(/Dropped in/);
  assert.equal(dropped.folder, 'Coast');
  // The moved video folder is a new file path; the old record stays as missing so it can be located.
  const relocated = (await request('/api/history?limit=100&folder=Made%20in%20Finder')).body.items;
  assert.equal(relocated.length, 1);
  assert.equal(relocated[0].absolutePath, path.join(saveDir, 'Made in Finder', 'Ember Tide', 'Ember Tide.mp4'));
  const old = (await request('/api/history?limit=100')).body.items.find((item) => item.id === ember.id);
  assert.equal(old.missing, true);
});

test('shared folder-name rules, sort orders and groups', () => {
  const windows = ['CON', 'prn.txt', 'Aux', 'NUL', 'COM1', 'lpt9', 'a:b', 'a*b', 'a"b', 'a|b', 'a?b', 'a<b>', 'tab\tname', 'trailing.', 'trailing ', 'x/y', 'x\\y'];
  for (const name of windows) assert.ok(folderNameProblem(name), `${JSON.stringify(name)} is refused`);
  assert.equal(folderNameProblem('Road trips'), null);
  assert.equal(folderNameProblem('Été 2024 — 🎬'), null);
  assert.equal(folderNameProblem('Console'), null, 'only whole device names are reserved');
  assert.equal(folderNameProblem('road trips', { siblings: ['Road trips'], caseInsensitive: true }).code, 'nameDuplicate');
  assert.equal(folderNameProblem('road trips', { siblings: ['Road trips'], caseInsensitive: false }), null);
  assert.equal(folderNameProblem('Road Trips', { siblings: ['Road trips'], caseInsensitive: true, current: 'Road trips' }), null, 'a folder can change only its case');
  assert.equal(folderNameProblem('x'.repeat(201)).code, 'nameTooLong');

  const day = 86_400_000;
  const now = new Date(2026, 8, 24, 12).getTime(); // Thursday 24 September 2026
  const items = [
    { id: 'a', title: 'The Zebra', sizeBytes: 5, modifiedAt: now, sourcePageUrl: 'https://www.nebula.tv/a', selection: { height: 1080 }, youtubeMetadata: { durationSeconds: 60 } },
    { id: 'b', title: 'apple', sizeBytes: 50, modifiedAt: now - day, sourcePageUrl: 'https://archive.org/b', selection: { height: 2160 } },
    { id: 'c', title: 'Mango 10', sizeBytes: 20, modifiedAt: now - 3 * day, sourcePageUrl: 'https://archive.org/c', youtubeMetadata: { durationSeconds: 600 } },
    { id: 'd', title: 'Mango 9', sizeBytes: 0, modifiedAt: now - 40 * day },
  ];
  const ids = (list) => list.map((item) => item.id).join('');
  assert.equal(ids(sortSaved(items, 'newest')), 'abcd');
  assert.equal(ids(sortSaved(items, 'oldest')), 'dcba');
  assert.equal(ids(sortSaved(items, 'name')), 'bdca', 'names sort A–Z, numerically, ignoring a leading "The"');
  assert.equal(ids(sortSaved(items, 'size')), 'bcad', 'unknown sizes go last');
  assert.equal(ids(sortSaved(items, 'length')), 'cabd', 'unknown lengths go last');
  assert.equal(ids(sortSaved(items, 'site')), 'bcad', 'sites A–Z, unknown last');
  const bySite = groupSaved(sortSaved(items, 'newest'), 'site', { sort: 'newest' });
  assert.deepEqual(bySite.map((group) => [group.label, group.count, group.sizeBytes]), [['archive.org', 2, 70], ['nebula.tv', 1, 5], ['Unknown site', 1, 0]]);
  assert.deepEqual(groupSaved(items, 'date', { now }).map((group) => group.label), ['Today', 'Yesterday', 'This week', 'August']);
  assert.deepEqual(groupSaved(items, 'date', { now, sort: 'oldest' }).map((group) => group.label), ['August', 'This week', 'Yesterday', 'Today']);
  assert.deepEqual(groupSaved(items, 'quality').map((group) => group.label), ['4K · 2160p', 'FHD · 1080p', 'Unknown quality']);
  assert.equal(viewLabel({ sort: 'size', group: 'none' }), 'Largest');
  assert.equal(viewLabel({ sort: 'newest', group: 'site' }), 'Site · Newest');
  assert.deepEqual(normalizeView({ sort: 'bogus', group: 'folder' }), { sort: 'newest', group: 'none' });
});
