const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { runTool } = require('./fixtures/server');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');

// A saved video's details (A · Spec sheet): what is inside the file, renaming it on disk, and where it came from.
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const JOB_ID = 'mf3k2x1a-ab12cd';

function tempDir(t, prefix) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }));
  return base;
}

async function connect(t, api) {
  const address = await api.start();
  t.after(() => api.stop());
  const token = api.getAuthToken();
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (route, body, { method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const items = async () => (await request('/api/history?limit=1000')).body.items;
  return { request, items, base };
}

test('media info probes the real saved file once: every audio track, the subtitle inside and the one beside it', { timeout: 120_000 }, async (t) => {
  const base = tempDir(t, 'snagthis-media-info-');
  const dataDir = path.join(base, 'data');
  const saveDir = path.join(base, 'SnagThis');
  fs.mkdirSync(saveDir, { recursive: true });
  const captions = path.join(base, 'captions.srt');
  fs.writeFileSync(captions, '1\n00:00:00,000 --> 00:00:01,500\nHello harbour\n');
  const video = path.join(saveDir, 'Harbour lights.mp4');
  // Two seconds of 640×360 H.264 at 30 fps, English stereo (default) and Japanese mono AAC, and an English timed-text track.
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-i', captions,
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-t', '2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac:a:0', '2', '-ac:a:1', '1', '-b:a:0', '128k', '-b:a:1', '64k', '-c:s', 'mov_text',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn', '-metadata:s:s:0', 'language=eng',
    '-disposition:a:0', 'default', '-disposition:a:1', '0', '-movflags', '+faststart', video]);
  fs.writeFileSync(path.join(saveDir, 'Harbour lights.es.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHola\n');
  fs.writeFileSync(path.join(saveDir, 'Something else.srt'), 'not this video');
  const api = createApiServer({
    dataDir, downloadDir: path.join(dataDir, 'downloads'), port: 0, ffmpegPath: ffmpeg, ffprobePath: ffprobe,
    initialQueueSettings: { autoStart: false }, getCompletedOutputDir: () => saveDir,
  });
  const { request, items } = await connect(t, api);
  const item = (await items()).find((entry) => entry.fileName === 'Harbour lights.mp4');
  assert.ok(item, 'the saved file is in the library');
  const route = `/api/history/${encodeURIComponent(item.id)}/media-info`;

  const first = await request(route);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const info = first.body;
  assert.equal(info.cached, false);
  assert.ok(Math.abs(info.durationSeconds - 2) < 0.2, `length ${info.durationSeconds}`);
  assert.equal(info.video.codec, 'h264');
  assert.equal(info.video.width, 640);
  assert.equal(info.video.height, 360);
  assert.equal(info.video.fps, 30);
  assert.ok(info.video.profile, 'the H.264 profile is reported');
  assert.equal(info.video.hdr, null);
  assert.deepEqual(info.audio.map((track) => [track.codec, track.language, track.channels, track.default]), [['aac', 'eng', 2, true], ['aac', 'jpn', 1, false]]);
  assert.ok(info.audio.every((track) => track.bitRate > 0));
  assert.deepEqual(info.subtitles.map((track) => [track.codec, track.language]), [['mov_text', 'eng']]);
  assert.deepEqual(info.sideSubtitles, [{ fileName: 'Harbour lights.es.srt', format: 'srt', language: 'es' }]);

  // The second look is answered from the cache; the cache holds no paths.
  const second = await request(route);
  assert.equal(second.body.cached, true);
  assert.equal(second.body.probedAt, info.probedAt);
  const cacheFile = path.join(dataDir, 'media-info-cache.json');
  const cache = fs.readFileSync(cacheFile, 'utf8');
  assert.equal(cache.includes(saveDir), false);
  assert.equal(cache.includes('Harbour lights'), false);
  // A restart reads the same cache.
  await api.stop();
  const again = createApiServer({ dataDir, downloadDir: path.join(dataDir, 'downloads'), port: 0, ffmpegPath: ffmpeg, ffprobePath: ffprobe, initialQueueSettings: { autoStart: false }, getCompletedOutputDir: () => saveDir });
  const reopened = await connect(t, again);
  const afterRestart = await reopened.request(route);
  assert.equal(afterRestart.body.cached, true);
  assert.equal(afterRestart.body.probedAt, info.probedAt);

  // A changed file (a new modification time) is probed again; side files are always read fresh.
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(video, later, later);
  fs.rmSync(path.join(saveDir, 'Harbour lights.es.srt'));
  fs.writeFileSync(path.join(saveDir, 'Harbour lights.vtt'), 'WEBVTT\n');
  const changed = await reopened.request(route);
  assert.equal(changed.body.cached, false);
  assert.notEqual(changed.body.probedAt, info.probedAt);
  assert.deepEqual(changed.body.sideSubtitles, [{ fileName: 'Harbour lights.vtt', format: 'vtt', language: null }]);

  assert.equal((await reopened.request('/api/history/bm90LWEtdmlkZW8/media-info')).status, 404, 'an unknown video');
  // /api is the desktop's own: the extension is refused whether it says so by origin or by client name.
  const token = again.getAuthToken();
  for (const headers of [{ Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }, { 'X-Client': 'snagthis-extension' }]) {
    const refused = await fetch(`${reopened.base}${route}`, { headers: { Authorization: `Bearer ${token}`, ...headers } });
    assert.equal(refused.status, 403, JSON.stringify(headers));
  }
  // A file that went missing says so.
  fs.renameSync(video, path.join(base, 'elsewhere.mp4'));
  const gone = await reopened.request(route);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, 'FILE_MISSING');
});

// A save folder laid out the way SnagThis writes it (the same as tests/library-folders.test.js).
function makeLibrary(t) {
  const base = tempDir(t, 'snagthis-rename-');
  const dataDir = path.join(base, 'data');
  const downloadDir = path.join(dataDir, 'downloads');
  const saveDir = path.join(base, 'SnagThis');
  fs.mkdirSync(downloadDir, { recursive: true });
  const write = (file, content = `fixture ${path.basename(file)}`) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
  const ember = path.join(saveDir, 'Ember Tide');
  write(path.join(ember, '.snagthis-job.json'), JSON.stringify({ version: 1, jobId: JOB_ID }));
  const video = write(path.join(ember, 'Ember Tide.mp4'), Buffer.alloc(4096, 1));
  const subtitles = write(path.join(ember, 'Ember Tide.en.srt'), 'subtitles');
  const poster = write(path.join(ember, `${JOB_ID}-thumb.jpg`), 'poster');
  write(path.join(saveDir, 'Loose clip.mp4'), Buffer.alloc(2048, 2));
  write(path.join(saveDir, 'Loose clip.en.srt'), 'subtitles');
  write(path.join(saveDir, 'Loose clip.jpg'), 'poster');
  write(path.join(saveDir, 'Other cut.mp4'), Buffer.alloc(1024, 3));
  write(path.join(saveDir, 'mf3k2x1b-zz99yy', 'Night bus.mp4'), Buffer.alloc(512, 4));
  fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: [{
    id: JOB_ID, title: 'Ember Tide — sunset crossing', status: 'completed', queueStatus: 'completed', completedAt: Date.now(),
    filePath: video, mp4Path: video, outputPath: video, thumbnailPath: poster, subtitlePath: subtitles, storageDir: ember, outputDirectory: ember,
    sourcePageUrl: 'https://www.nebula.tv/videos/ember-tide',
  }], settings: { autoStart: false, maxConcurrent: 1 } }));
  const api = createApiServer({
    dataDir, downloadDir, port: 0, ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true,
    initialQueueSettings: { autoStart: false }, getCompletedOutputDir: () => saveDir,
  });
  return { base, dataDir, saveDir, api };
}

test('Rename… renames a saved video on disk with its own folder and side files, suffixes a clash and refuses bad names', async (t) => {
  const { dataDir, saveDir, api } = makeLibrary(t);
  const { request, items } = await connect(t, api);
  const find = async (pattern) => (await items()).find((item) => pattern.test(item.title || item.fileName));
  const rename = (id, name) => request('/api/library/rename-video', { id, name });
  const listing = (directory) => fs.readdirSync(directory).sort();

  // Its own folder: the folder, the video and the subtitles that share its name take the new name; the job's files keep theirs.
  const ember = await find(/Ember Tide/);
  const renamed = await rename(ember.id, 'Sunset crossing');
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  const folder = path.join(saveDir, 'Sunset crossing');
  assert.deepEqual(listing(folder), ['.snagthis-job.json', 'Sunset crossing.en.srt', 'Sunset crossing.mp4', `${JOB_ID}-thumb.jpg`]);
  assert.equal(fs.existsSync(path.join(saveDir, 'Ember Tide')), false);
  let item = (await items()).find((entry) => entry.id === ember.id);
  assert.equal(item.title, 'Sunset crossing', 'the library index follows, with the same identity');
  assert.equal(item.absolutePath, path.join(folder, 'Sunset crossing.mp4'));
  assert.equal(item.missing, false);
  assert.equal(item.folder, '');
  const job = JSON.parse(fs.readFileSync(path.join(dataDir, 'queue.json'), 'utf8')).queue.find((entry) => entry.id === JOB_ID);
  assert.equal(job.title, 'Sunset crossing');
  assert.equal(job.mp4Path, path.join(folder, 'Sunset crossing.mp4'));
  assert.equal(job.subtitlePath, path.join(folder, 'Sunset crossing.en.srt'));
  assert.equal(job.thumbnailPath, path.join(folder, `${JOB_ID}-thumb.jpg`));
  assert.equal(job.storageDir, folder);

  // A loose video whose new name is taken: it and its side files all get the same " (2)".
  const loose = await find(/^Loose clip/);
  assert.equal((await rename(loose.id, 'Other cut')).status, 200);
  assert.deepEqual(listing(saveDir).filter((name) => name.startsWith('Other cut')), ['Other cut (2).en.srt', 'Other cut (2).jpg', 'Other cut (2).mp4', 'Other cut.mp4']);
  assert.equal(fs.existsSync(path.join(saveDir, 'Loose clip.mp4')), false);
  item = (await items()).find((entry) => entry.id === loose.id);
  assert.equal(item.absolutePath, path.join(saveDir, 'Other cut (2).mp4'));
  assert.equal(item.fileName, 'Other cut (2).mp4');

  // A change of case only is a rename, not a clash with itself.
  assert.equal((await rename(loose.id, 'other cut (2)')).status, 200);
  assert.ok(listing(saveDir).includes('other cut (2).mp4'));
  assert.ok(listing(saveDir).includes('other cut (2).en.srt'));

  // A legacy job-ID folder is the video's own folder too.
  const night = await find(/Night bus/);
  assert.equal((await rename(night.id, 'Night ride')).status, 200);
  assert.deepEqual(listing(path.join(saveDir, 'Night ride')), ['Night ride.mp4']);
  assert.equal(fs.existsSync(path.join(saveDir, 'mf3k2x1b-zz99yy')), false);
  assert.equal((await items()).find((entry) => entry.id === night.id).absolutePath, path.join(saveDir, 'Night ride', 'Night ride.mp4'));

  // Names the folder rules refuse leave everything as it was.
  const before = listing(saveDir);
  for (const name of ['', '   ', 'a/b', 'back\\slash', 'what?', 'CON', '.hidden', 'dot.', 'temp-1']) {
    const refused = await rename(ember.id, name);
    assert.equal(refused.status, 400, `refuses ${JSON.stringify(name)}`);
    assert.ok(refused.body.error, 'with words to show');
  }
  assert.equal((await rename(ember.id, 'a/b')).body.error, 'Video names can’t contain / or \\');
  assert.deepEqual(listing(saveDir), before);
  assert.equal((await rename('bm90LWEtdmlkZW8', 'Anything')).status, 404);
});

test('a rename that the file system refuses leaves every file with its old name', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async (t) => {
  const { saveDir, api } = makeLibrary(t);
  const { request, items } = await connect(t, api);
  const loose = (await items()).find((item) => item.fileName === 'Loose clip.mp4');
  const before = fs.readdirSync(saveDir).sort();
  fs.chmodSync(saveDir, 0o555);
  let failed;
  try { failed = await request('/api/library/rename-video', { id: loose.id, name: 'Renamed' }); } finally { fs.chmodSync(saveDir, 0o755); }
  assert.equal(failed.status, 409);
  assert.equal(failed.body.code, 'permission');
  assert.deepEqual(fs.readdirSync(saveDir).sort(), before);
  assert.equal((await items()).find((item) => item.id === loose.id).fileName, 'Loose clip.mp4');
});

test('a finished download keeps its source page, title, site and finish time in the library, and never its request headers', { timeout: 120_000 }, async (t) => {
  const base = tempDir(t, 'snagthis-source-');
  const mediaPath = path.join(base, 'sample.mp4');
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-movflags', '+faststart', mediaPath]);
  const media = fs.readFileSync(mediaPath);
  const source = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': media.length });
    response.end(media);
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => source.close(resolve)));
  const dataDir = path.join(base, 'data');
  const saveDir = path.join(base, 'SnagThis');
  const api = createApiServer({ dataDir, downloadDir: path.join(dataDir, 'downloads'), port: 0, ffmpegPath: ffmpeg, ffprobePath: ffprobe,
    initialQueueSettings: { autoStart: false }, getCompletedOutputDir: () => saveDir });
  const { request, items } = await connect(t, api);
  const mediaUrl = `http://127.0.0.1:${source.address().port}/clip.mp4`;
  const pageUrl = 'https://videos.example/harbour-lights';
  const secret = 'session=do-not-keep-this-cookie';
  // As the Chrome extension sends it (with the page's cookie), and as a pasted link does.
  const created = [
    await request('/v1/jobs', { mediaUrl, mediaType: 'file', title: 'Harbour lights', sourcePageUrl: pageUrl, sourcePageTitle: 'Harbour lights — Videos Example', headers: { Cookie: secret, Referer: pageUrl } }),
    await request('/api/jobs', { queue: { url: `${mediaUrl}?pasted=1`, mediaType: 'file', title: 'Pasted clip', sourcePageUrl: `${mediaUrl}?pasted=1`, siteName: 'Local clips', uploader: 'Pixel Worlds Studio', headers: { Cookie: secret } } }),
  ];
  for (const result of created) assert.equal(result.status, 200, JSON.stringify(result.body));
  const ids = created.map((result) => result.body.jobId || result.body.id);
  const startedAt = Date.now();
  for (const id of ids) {
    await request(`/api/queue/${id}/start`, {});
    const deadline = Date.now() + 60_000;
    let job;
    do {
      job = api.getState().queue.find((entry) => entry.id === id);
      if (['completed', 'failed'].includes(job.queueStatus)) break;
      await delay(50);
    } while (Date.now() < deadline);
    assert.equal(job.queueStatus, 'completed', job.error || 'the local download did not finish');
  }
  let saved;
  const deadline = Date.now() + 10_000;
  do {
    saved = (await items()).filter((item) => ids.includes(item.jobId));
    if (saved.length === 2) break;
    await delay(100);
  } while (Date.now() < deadline);
  const extension = saved.find((item) => item.jobId === ids[0]);
  const pasted = saved.find((item) => item.jobId === ids[1]);
  assert.equal(extension.sourcePageUrl, pageUrl);
  assert.deepEqual(extension.sourceInfo, { pageTitle: 'Harbour lights — Videos Example', siteName: '', uploader: '' });
  assert.equal(pasted.sourcePageUrl, `${mediaUrl}?pasted=1`);
  assert.deepEqual(pasted.sourceInfo, { pageTitle: '', siteName: 'Local clips', uploader: 'Pixel Worlds Studio' });
  for (const item of saved) {
    assert.ok(item.completedAt >= startedAt && item.completedAt <= Date.now(), 'the finish time, not the file’s');
    assert.equal(item.headers, undefined);
  }
  // Once the finished jobs are gone, the library still knows (it was written to the index).
  await api.stop();
  const index = fs.readFileSync(path.join(dataDir, 'history-index.json'), 'utf8');
  assert.equal(index.includes('do-not-keep-this-cookie'), false, 'no cookie in the library index');
  const stored = JSON.parse(index).items.find((item) => item.jobId === ids[0]);
  assert.equal(stored.sourcePageUrl, pageUrl);
  assert.equal(stored.sourceInfo.pageTitle, 'Harbour lights — Videos Example');
  assert.equal(stored.completedAt, extension.completedAt);
  fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: [], settings: { autoStart: false } }));
  const reopened = createApiServer({ dataDir, downloadDir: path.join(dataDir, 'downloads'), port: 0, ffmpegPath: ffmpeg, ffprobePath: ffprobe, initialQueueSettings: { autoStart: false }, getCompletedOutputDir: () => saveDir });
  const after = await connect(t, reopened);
  const kept = (await after.items()).find((item) => item.id === extension.id);
  assert.equal(kept.sourcePageUrl, pageUrl);
  assert.equal(kept.sourceInfo.pageTitle, 'Harbour lights — Videos Example');
  assert.equal(kept.completedAt, extension.completedAt);
  assert.equal(fs.readFileSync(path.join(dataDir, 'queue.json'), 'utf8').includes('do-not-keep-this-cookie'), false);
});
