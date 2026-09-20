const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Writable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');

process.env.DISABLE_FILE_LOGS = '1';
process.env.LOG_LEVEL = 'error';
const { downloadSegment } = require('../packages/downloader-engine/src/core/SegmentDownloader');
const { createTransferMetrics } = require('../packages/downloader-engine/src/core/TransferMetrics');
const { createJobProcessor } = require('../packages/downloader-engine/src/core/JobProcessor');
const QueueManager = require('../packages/downloader-engine/src/core/QueueManager');

async function fixture(t, handler) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-segment-lifecycle-'));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const processor = createJobProcessor({ downloadDir: directory, FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
    FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe', fsPromises: fs.promises,
    DEFAULT_MAX_CONCURRENT: 1, DEFAULT_MAX_SEGMENT_ATTEMPTS: 3,
    getJobTempDirForUrl: () => path.join(directory, 'segments') });
  return { directory, processor, base: `http://127.0.0.1:${server.address().port}` };
}

function jobFor(fixture, resource, mediaType = 'hls') {
  return { id: 'local-lifecycle-fixture', url: fixture.base + resource, mediaType, title: 'Lifecycle fixture',
    filePath: path.join(fixture.directory, 'output', mediaType === 'hls' ? 'fixture.ts' : 'fixture.mp4'),
    storageDir: path.join(fixture.directory, 'output'), downloadName: 'fixture.ts', downloadNameMp4: 'fixture.mp4',
    status: 'pending', queueStatus: 'downloading', bytesDownloaded: 0, completedSegments: 0, failedSegments: [],
    progress: 0, maxConcurrent: 1, earlyThumbnailAttempted: true, skipThumbnailGeneration: true };
}

test('segment completion waits for the writable, and disk errors reject instead of losing finish', { timeout: 5000 }, async t => {
  const fixtureData = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'Content-Length': 1024, 'Content-Type': 'video/mp2t' });
    response.end(Buffer.alloc(1024));
  });
  let finishWrite;
  let writing;
  const started = new Promise(resolve => { writing = resolve; });
  const delayedSink = new Writable({ write(_chunk, _encoding, callback) { finishWrite = callback; writing(); } });
  const delayedJob = { url: fixtureData.base, bytesDownloaded: 0 };
  let completed = false;
  const complete = downloadSegment(`${fixtureData.base}/piece.ts`, {}, delayedSink, delayedJob).then(() => { completed = true; });
  await started;
  await delay(20);
  assert.equal(completed, false, 'a completed HTTP body must not outrun disk writes');
  finishWrite();
  await complete;
  assert.equal(delayedSink.writableFinished, true);

  const failedSink = new Writable({ write(_chunk, _encoding, callback) {
    callback(Object.assign(new Error('Fixture disk is full'), { code: 'ENOSPC' }));
  } });
  const failedJob = { url: fixtureData.base, bytesDownloaded: 0 };
  failedJob._transferMetrics = createTransferMetrics(failedJob);
  await assert.rejects(downloadSegment(`${fixtureData.base}/failed.ts`, {}, failedSink, failedJob), { code: 'ENOSPC' });
  assert.equal(failedSink.destroyed, true);
  assert.equal(failedJob.activeConnections, 0);
});

test('pause aborts silent segmented and direct HTTP responses without waiting for another byte', { timeout: 7000 }, async t => {
  for (const mode of ['hls', 'file']) await t.test(mode, async subtest => {
    let bodyStarted;
    let bodyClosed;
    const started = new Promise(resolve => { bodyStarted = resolve; });
    const closed = new Promise(resolve => { bodyClosed = resolve; });
    let directRequests = 0;
    const fixtureData = await fixture(subtest, (request, response) => {
      if (request.url === '/index.m3u8') {
        response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        response.end('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\npiece.ts\n#EXT-X-ENDLIST\n');
        return;
      }
      if (mode === 'file' && ++directRequests === 1) {
        response.writeHead(200, { 'Content-Type': 'video/mp4' }); response.end(Buffer.alloc(4096)); return;
      }
      response.writeHead(200, { 'Content-Type': mode === 'file' ? 'video/mp4' : 'video/mp2t' });
      response.write(Buffer.alloc(1024));
      response.on('close', bodyClosed);
      bodyStarted();
      // Intentionally never send another byte or an end marker.
    });
    const job = jobFor(fixtureData, mode === 'file' ? '/movie.mp4' : '/index.m3u8', mode);
    const manager = new QueueManager({ queueFilePath: path.join(fixtureData.directory, 'queue.json'),
      downloadDir: fixtureData.directory, fsPromises: fs.promises, jobs: new Map([[job.id, job]]),
      runJob: fixtureData.processor.runJob, runDirectJob: fixtureData.processor.runDirectJob,
      initialSettings: { autoStart: false, maxConcurrent: 1 } });
    manager.queue = [job];
    const running = fixtureData.processor.runJob(job);
    await started;
    assert.equal(manager.pauseJob(job.id), true);
    await Promise.race([Promise.all([running, closed]), delay(750).then(() => assert.fail('Pause left a silent HTTP request open'))]);
    await manager.persistence;
    assert.equal(job.status, 'cancelled');
    assert.equal(job.activeConnections, 0);
    assert.equal(job._downloadAbort, undefined, 'the ended attempt releases its abort controller');
    assert.equal(fs.existsSync(`${job.filePath}.part`), false);
    if (mode === 'hls') assert.ok(fs.readdirSync(path.join(fixtureData.directory, 'segments')).every(name => !name.endsWith('.tmp')));
  });
});

test('a segment disk error ends the job once without network retries or fallback downloads', { timeout: 5000 }, async t => {
  let pieceRequests = 0;
  let fallbackRequests = 0;
  const fixtureData = await fixture(t, (request, response) => {
    if (request.url === '/index.m3u8') {
      response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      response.end('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\npiece.ts\n#EXT-X-ENDLIST\n');
    } else if (request.url === '/piece.ts') {
      pieceRequests += 1; response.writeHead(200, { 'Content-Type': 'video/mp2t' }); response.end(Buffer.alloc(1024));
    } else {
      fallbackRequests += 1; response.writeHead(500); response.end('Unexpected fallback request');
    }
  });
  const job = jobFor(fixtureData, '/index.m3u8');
  job.fallbackUrl = `${fixtureData.base}/fallback.mp4`;
  const original = fs.createWriteStream;
  fs.createWriteStream = function(file, ...options) {
    if (String(file).startsWith(fixtureData.directory) && String(file).endsWith('.tmp')) {
      return new Writable({ write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error('Fixture disk is full'), { code: 'ENOSPC' }));
      } });
    }
    return original.call(this, file, ...options);
  };
  try { await fixtureData.processor.runJob(job); }
  finally { fs.createWriteStream = original; }
  assert.equal(job.status, 'error');
  assert.equal(job.errorCode, 'ENOSPC');
  assert.equal(pieceRequests, 1);
  assert.equal(fallbackRequests, 0);
  assert.equal(job.activeConnections, 0);
  assert.equal(job._downloadAbort, undefined);
});
