const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const QueueManager = require('../packages/downloader-engine/src/core/QueueManager');
const { fetchText } = require('../packages/downloader-engine/src/core/PlaylistUtils');
const { inspectHlsPlaylist } = require('../packages/downloader-engine/src/core/HlsNativeDownload');
const { cleanupOldCompletedFiles, cleanupOldSegmentFiles } = require('../packages/downloader-engine/src/services/CleanupService');

async function queueFixture(runner = async () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-queue-'));
  const jobs = new Map();
  const manager = new QueueManager({ queueFilePath: path.join(directory, 'state', 'queue.json'), downloadDir: directory, fsPromises: fs.promises, jobs, runJob: runner, runDirectJob: runner, initialSettings: { autoStart: false, maxConcurrent: 1 } });
  await manager.loadQueue();
  return { manager, directory, jobs, async close() { await manager.persistence; fs.rmSync(directory, { recursive: true, force: true }); } };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));
const playlist = (token, duration = 5) => `#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:${duration},\npiece.ts?token=${token}\n#EXT-X-ENDLIST\n`;

test('a finalizing or pausing runner retains its slot until it exits', async () => {
  let release;
  let runs = 0;
  const fixture = await queueFixture(async (job) => {
    runs += 1;
    job.status = 'finalizing';
    await new Promise((resolve) => { release = resolve; });
    job.status = job.cancelled ? 'cancelled' : 'completed';
  });
  try {
    const { manager } = fixture;
    manager.addJob({ id: 'first', url: 'https://example.test/video.mp4' });
    manager.addJob({ id: 'second', url: 'https://example.test/other.mp4' });
    assert.equal(manager.startJob('first'), true);
    await turn();
    assert.equal(manager.getActiveCount(), 1);
    assert.equal(manager.startJob('second'), false);
    assert.equal(manager.pauseJob('first'), true);
    assert.equal(manager.resumeJob('first'), true);
    assert.equal(manager.startJob('first'), false);
    assert.equal(runs, 1);
    const idle = manager.waitForJobIdle('first');
    release();
    await idle;
    assert.equal(manager.getActiveCount(), 0);
    assert.equal(manager.jobs.get('first').queueStatus, 'queued');
  } finally { await fixture.close(); }
});

test('queue snapshots are atomic, retain latest state, and never persist request secrets', async () => {
  const fixture = await queueFixture();
  try {
    const job = { id: 'private-source', youtubeBrowserSession: 'chrome', title: 'First', url: 'https://media.test/video', headers: { Cookie: 'session=secret-cookie', Authorization: 'Bearer secret-auth', 'X-Token': 'secret-token', Referer: 'https://page.test/watch' } };
    fixture.manager.addJob(job);
    const firstWrite = fixture.manager.saveQueue();
    job.title = 'Latest';
    await Promise.all([firstWrite, fixture.manager.saveQueue()]);
    const text = fs.readFileSync(fixture.manager.queueFilePath, 'utf8');
    const snapshot = JSON.parse(text);
    assert.equal(snapshot.queue[0].title, 'Latest');
    assert.equal(snapshot.queue[0].requiresSourceRefresh, true);
    assert.equal(snapshot.queue[0].headers.Referer, 'https://page.test/watch');
    assert.doesNotMatch(text, /secret-cookie|secret-auth|secret-token|youtubeBrowserSession/);
    assert.equal(fixture.manager.getQueue()[0].youtubeBrowserSession, undefined);
    assert.equal(fs.existsSync(`${fixture.manager.queueFilePath}.tmp`), false);
    // Windows exposes synthetic mode bits; its ACL controls access instead.
    if (process.platform !== 'win32') assert.equal(fs.statSync(fixture.manager.queueFilePath).mode & 0o777, 0o600);
  } finally { await fixture.close(); }
});

test('cleanup retains completed media and paused pieces regardless of age', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-cleanup-'));
  try {
    const video = path.join(directory, 'saved.mp4');
    const paused = path.join(directory, 'temp-source-job-paused');
    fs.writeFileSync(video, 'user media');
    fs.mkdirSync(paused);
    fs.writeFileSync(path.join(paused, 'seg-0.ts'), 'retained pieces');
    const old = new Date(0);
    fs.utimesSync(video, old, old);
    fs.utimesSync(paused, old, old);
    await cleanupOldCompletedFiles({ fsPromises: fs.promises, downloadDir: directory, maxAgeHours: 1 });
    await cleanupOldSegmentFiles({ fsPromises: fs.promises, downloadDir: directory, maxAgeHours: 1, protectedJobIds: ['job-paused'] });
    assert.equal(fs.readFileSync(video, 'utf8'), 'user media');
    assert.equal(fs.existsSync(path.join(paused, 'seg-0.ts')), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cross-origin redirects preserve page context without forwarding credentials', async () => {
  let observed;
  const target = http.createServer((request, response) => { observed = request.headers; response.end('done'); });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const source = http.createServer((_request, response) => response.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/video` }).end());
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  try {
    await fetchText(`http://127.0.0.1:${source.address().port}/redirect`, { Cookie: 'private=1', Authorization: 'Bearer private', 'X-Site-Token': 'private', Referer: 'https://page.test/watch', Origin: 'https://page.test' });
    assert.equal(observed.cookie, undefined);
    assert.equal(observed.authorization, undefined);
    assert.equal(observed['x-site-token'], undefined);
    assert.equal(observed.referer, 'https://page.test/watch');
    assert.equal(observed.origin, 'https://page.test');
  } finally { await Promise.all([new Promise((resolve) => source.close(resolve)), new Promise((resolve) => target.close(resolve))]); }
});

test('refresh accepts only the same VOD topology, preserving partial files on mismatch', async () => {
  let duration = 5;
  const source = http.createServer((_request, response) => response.end(playlist('fresh', duration)));
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${source.address().port}/playlist`;
  const fixture = await queueFixture();
  try {
    const job = { id: 'refresh', url, queueStatus: 'paused', status: 'paused', completedSegments: 1, resumePartialSegments: true, playlistTopology: inspectHlsPlaylist(playlist('expired'), url).topologyFingerprint };
    fixture.manager.queue.push(job);
    fixture.jobs.set(job.id, job);
    assert.equal((await fixture.manager.refreshJobSource(job.id, { url })).ok, true);
    duration = 4;
    const result = await fixture.manager.refreshJobSource(job.id, { url });
    assert.equal(result.ok, false);
    assert.equal(job.completedSegments, 1);
  } finally { await fixture.close(); await new Promise((resolve) => source.close(resolve)); }
});


test('a pause during media sniffing stops before starting another manifest request', async () => {
  const { createJobProcessor } = require('../packages/downloader-engine/src/core/JobProcessor');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-pause-sniff-'));
  let requestCount = 0;
  let finishResponse;
  let notifyRequest;
  const requested = new Promise((resolve) => { notifyRequest = resolve; });
  const source = http.createServer((_request, response) => {
    requestCount += 1;
    finishResponse = () => response.end(playlist('current'));
    notifyRequest();
    // A second request must finish too, so a regression fails its assertion
    // instead of depending on a timeout to complete the test.
    if (requestCount > 1) finishResponse();
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  try {
    const job = { id: 'pause-sniff', url: `http://127.0.0.1:${source.address().port}/video`, filePath: path.join(directory, 'video.ts'), downloadNameMp4: 'video.mp4', headers: {} };
    const processor = createJobProcessor({ downloadDir: directory, fsPromises: fs.promises });
    const running = processor.runJob(job);
    await requested;
    job.cancelled = true;
    job.pauseRequested = true;
    finishResponse();
    await running;
    assert.equal(job.status, 'cancelled');
    assert.equal(requestCount, 1, 'the pausing runner must not fetch the manifest again');
  } finally {
    await new Promise((resolve) => source.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('Chrome browser access requires an explicit per-job choice and a real YouTube URL', () => {
  const { buildYouTubeBrowserSessionArgs } = require('../packages/downloader-engine/src/core/JobProcessor').__test;
  assert.deepEqual(buildYouTubeBrowserSessionArgs({ url: 'https://www.youtube.com/watch?v=example' }), []);
  assert.deepEqual(buildYouTubeBrowserSessionArgs({ url: 'https://www.youtube.com/watch?v=example', youtubeBrowserSession: 'chrome' }), ['--cookies-from-browser', 'chrome']);
  assert.deepEqual(buildYouTubeBrowserSessionArgs({ url: 'https://youtu.be/example', youtubeBrowserSession: 'chrome' }), ['--cookies-from-browser', 'chrome']);
  assert.deepEqual(buildYouTubeBrowserSessionArgs({ url: 'https://www.youtube.com/watch?v=example', youtubeBrowserSession: true }), []);
  for (const url of ['https://youtube.com.example.org/watch', 'https://example.org/video', 'file://youtube.com/watch', 'https://name:password@youtube.com/watch']) {
    assert.throws(() => buildYouTubeBrowserSessionArgs({ url, youtubeBrowserSession: 'chrome' }), { code: 'UNSUPPORTED_AUTH_SOURCE' });
  }
});

test('yt-dlp uses the app Node runtime without launching a second Electron app', () => {
  const { buildYtDlpRuntimeOptions } = require('../packages/downloader-engine/src/core/JobProcessor').__test;
  const originalEnvironment = { PATH: '/runtime', ELECTRON_RUN_AS_NODE: '0' };
  const desktop = buildYtDlpRuntimeOptions({ execPath: '/Applications/VidSnag App/Contents/MacOS/VidSnag', electron: true, env: originalEnvironment });
  assert.deepEqual(desktop.args, ['--js-runtimes', 'node:/Applications/VidSnag App/Contents/MacOS/VidSnag']);
  assert.equal(desktop.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(desktop.env.PATH, originalEnvironment.PATH);
  assert.equal(originalEnvironment.ELECTRON_RUN_AS_NODE, '0', 'only the yt-dlp child receives the Electron runtime flag');
  const standalone = buildYtDlpRuntimeOptions({ execPath: process.execPath, electron: false, env: { PATH: '/runtime' } });
  assert.deepEqual(standalone.args, ['--js-runtimes', `node:${process.execPath}`]);
  assert.equal(standalone.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.ok(!desktop.args.includes('--cookies-from-browser'), 'runtime support must not enable browser access');
});

test('yt-dlp child receives trusted CA certificates and removes its temporary bundle', async () => {
  const { createYtDlpTrustOptions, getYtDlpTransportError } = require('../packages/downloader-engine/src/core/JobProcessor').__test;
  const originalEnvironment = { PATH: '/runtime' };
  const trust = await createYtDlpTrustOptions(originalEnvironment);
  try {
    const pem = await fs.promises.readFile(trust.env.SSL_CERT_FILE, 'utf8');
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    assert.ok(certificates.length > 0);
    for (const certificate of certificates) assert.ok(new (require('node:crypto').X509Certificate)(certificate).ca);
    assert.equal(trust.env.PATH, '/runtime');
    assert.equal(originalEnvironment.SSL_CERT_FILE, undefined, 'trust setup changes only the child environment');
  } finally { await trust.cleanup(); }
  assert.equal(fs.existsSync(trust.env.SSL_CERT_FILE), false);
  const custom = { SSL_CERT_FILE: '/managed/certificates.pem' };
  const preserved = await createYtDlpTrustOptions(custom);
  assert.equal(preserved.env, custom, 'an explicitly configured trust store remains authoritative');
  await preserved.cleanup();
  const error = getYtDlpTransportError('[tls] error:0A000086:SSL routines::certificate verify failed');
  assert.equal(error.code, 'TLS_CERTIFICATE_ERROR');
  assert.match(error.message, /security certificate could not be verified/);
  assert.equal(getYtDlpTransportError('ERROR: ffmpeg exited with code 251'), null);
});

test('a saved queue cannot restore consent to read a browser session', async () => {
  const fixture = await queueFixture();
  try {
    fs.mkdirSync(path.dirname(fixture.manager.queueFilePath), { recursive: true });
    fs.writeFileSync(fixture.manager.queueFilePath, JSON.stringify({ queue: [{ id: 'restored-consent', url: 'https://www.youtube.com/watch?v=example', queueStatus: 'paused', status: 'paused', youtubeBrowserSession: 'chrome' }], settings: { autoStart: false } }));
    await fixture.manager.loadQueue();
    assert.equal(fixture.jobs.get('restored-consent').youtubeBrowserSession, undefined);
  } finally { await fixture.close(); }
});


test('YouTube auxiliary page audio resolves to the selected video instead of a channel tab', () => {
  const { resolveYouTubeVideoUrl } = require('../packages/downloader-engine/src/core/JobProcessor').__test;
  const canonical = 'https://www.youtube.com/watch?v=0SerEuqAlAA';
  assert.equal(resolveYouTubeVideoUrl({
    url: 'https://www.youtube.com/s/search/audio/no_input.mp3',
    sourcePageUrl: canonical,
    youtubeMetadata: { videoId: '0SerEuqAlAA' },
  }), canonical);
  assert.equal(resolveYouTubeVideoUrl({ url: 'https://youtu.be/0SerEuqAlAA?si=sharing', sourcePageUrl: 'https://www.youtube.com/' }), canonical);
  assert.equal(resolveYouTubeVideoUrl({ url: 'https://www.youtube.com/shorts/0SerEuqAlAA' }), canonical);
  assert.equal(resolveYouTubeVideoUrl({ url: 'https://www.youtube.com/watch?v=B0_13LSguRc&list=playlist', sourcePageUrl: canonical }), 'https://www.youtube.com/watch?v=B0_13LSguRc', 'an explicit video URL takes priority over stale page metadata');
  assert.throws(() => resolveYouTubeVideoUrl({ url: 'https://www.youtube.com/s/search/audio/no_input.mp3' }), { code: 'INVALID_VIDEO_URL' });
  assert.throws(() => resolveYouTubeVideoUrl({ url: 'https://www.youtube.com/playlist?list=playlist' }), { code: 'INVALID_VIDEO_URL' });
  assert.equal(resolveYouTubeVideoUrl({ url: 'https://media.example/video.mp4', sourcePageUrl: canonical }), 'https://media.example/video.mp4');
});
