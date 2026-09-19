const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createNativeProgress } = require('../packages/downloader-engine/src/core/NativeProgress');
const { inspectHlsPlaylist } = require('../packages/downloader-engine/src/core/HlsNativeDownload');
const { startScopedMediaProxy } = require('../packages/downloader-engine/src/core/MediaRequest');
const { createDownloadEta } = require('../packages/downloader-engine/src/core/DownloadEta');

function trackerFixture(text, url = 'https://media.test/list.m3u8') {
  let time = 0;
  const job = { bytesDownloaded: 0, progress: 0 };
  const tracker = createNativeProgress(job, { playlistInfo: inspectHlsPlaylist(text, url), playlistText: text, playlistUrl: url, durationSeconds: 100, now: () => time });
  return { job, tracker, advance(milliseconds) { time += milliseconds; } };
}
const text = '#EXTM3U\n#EXTINF:50,\none.ts\n#EXTINF:50,\ntwo.ts\n#EXT-X-ENDLIST\n';

test('native pieces reflect successful complete resources, never percentage or preview requests', () => {
  const { job, tracker, advance } = trackerFixture(text);
  const event = { requestId: '1', url: 'https://media.test/one.ts', consumer: 'download', totalBytes: 100 };
  tracker.onResourceEvent({ ...event, type: 'start' });
  tracker.onResourceEvent({ ...event, type: 'progress', bytesTransferred: 99 });
  assert.equal(job.segmentStates[0].status, 'downloading');
  assert.equal(job.completedSegments, 0);
  tracker.onResourceEvent({ ...event, type: 'error' });
  assert.equal(job.segmentStates[0].status, 'retrying');
  tracker.onResourceEvent({ ...event, type: 'complete', completeResource: true, consumer: 'preview' });
  assert.equal(job.completedSegments, 0);
  tracker.onResourceEvent({ ...event, type: 'complete', completeResource: true });
  tracker.onResourceEvent({ ...event, type: 'complete', completeResource: true });
  assert.equal(job.completedSegments, 1, 'a duplicate request does not count the same piece twice');
  assert.equal(job.segmentStates[0].status, 'completed');
  advance(2000);
  tracker.onFfmpegProgress('total_size', '1000000');
  tracker.onFfmpegProgress('out_time_ms', '40000000');
  tracker.onFfmpegProgress('speed', '20x');
  tracker.onFfmpegProgress('progress', 'continue');
  assert.equal(job.speedBps, 500000);
  assert.equal(job.etaSeconds, 3, '60 seconds of media at 20x takes 3 seconds, not 60');
  advance(1000);
  tracker.onFfmpegProgress('speed', '0.2x');
  tracker.onFfmpegProgress('progress', 'continue');
  assert.ok(job.etaSeconds < 10, 'a brief speed dip must not turn a few seconds into five minutes');
  assert.equal(job.completedSegments, 1, 'media time cannot color another piece');
  tracker.onFfmpegProgress('progress', 'end');
  assert.equal(job.completedSegments, 1, 'muxer completion cannot invent a resource completion');
});

test('ETA absorbs bursts, follows sustained rate changes, and resets between transfers', () => {
  let time = 0;
  const eta = createDownloadEta({ now: () => time });
  assert.equal(eta.update(3000, 10), 300);
  time += 1000;
  assert.ok(eta.update(2990, 1) < 330, 'one slow update must not jump from five minutes to fifty');
  time += 1000;
  assert.ok(eta.update(2980, 100) > 150, 'one burst must not promise completion in thirty seconds');
  for (let second = 0; second < 60; second++) {
    time += 1000;
    eta.update(2800, 2);
  }
  assert.ok(eta.update(2800, 2) > 1000, 'a sustained slowdown must still increase the estimate');
  assert.equal(eta.update(2800, null), null, 'unknown rates must not display a stale ETA');
  eta.reset();
  assert.equal(eta.update(100, 50), 2, 'the next audio track must not inherit the video rate');
  assert.equal(eta.update(0, 50), null, 'a finished transfer is not yet a completed file');

  const dense = createDownloadEta({ now: () => time });
  const sparse = createDownloadEta({ now: () => time });
  dense.update(1000, 10); sparse.update(1000, 10);
  let denseEta;
  for (let second = 0; second < 10; second++) { time += 1000; denseEta = dense.update(900, 5); }
  assert.equal(denseEta, sparse.update(900, 5), 'message frequency must not change smoothing');
});

test('byte-range pieces complete only when successful responses cover their entire intervals', () => {
  const ranged = '#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:100@0\nall.ts\n#EXTINF:2,\n#EXT-X-BYTERANGE:100\nall.ts\n#EXT-X-ENDLIST\n';
  const { job, tracker } = trackerFixture(ranged);
  assert.equal(job.segmentProgressAvailable, true);
  const event = { type: 'complete', url: 'https://media.test/all.ts', totalBytes: 200, completeResource: false };
  tracker.onResourceEvent({ ...event, range: { start: 0, end: 49, total: 200 } });
  assert.equal(job.completedSegments, 0);
  tracker.onResourceEvent({ ...event, range: { start: 50, end: 99, total: 200 } });
  assert.equal(job.completedSegments, 1);
  tracker.onResourceEvent({ ...event, type: 'error', range: { start: 100, end: 199, total: 200 } });
  assert.equal(job.completedSegments, 1);
  tracker.onResourceEvent({ ...event, range: { start: 100, end: 199, total: 200 } });
  assert.equal(job.completedSegments, 2);
});

test('ambiguous repeated URLs leave the native pieces map unavailable', () => {
  const repeated = '#EXTM3U\n#EXTINF:2,\none.ts\n#EXTINF:2,\none.ts\n#EXT-X-ENDLIST\n';
  const { job } = trackerFixture(repeated);
  assert.equal(job.segmentProgressAvailable, false);
  assert.deepEqual(job.segmentStates, {});
  assert.equal(job.etaSeconds, null);
});

test('the real scoped proxy reports completed binary responses and distinguishes thumbnail reads', { timeout: 5000 }, async () => {
  const body = Buffer.alloc(1024, 0x47);
  const server = http.createServer((_request, response) => response.writeHead(200, { 'Content-Length': body.length }).end(body));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/one.ts`;
  const events = [];
  let notifyComplete;
  const completed = new Promise(resolve => { notifyComplete = resolve; });
  const proxy = await startScopedMediaProxy({ rootUrl: url, onResourceEvent: event => {
    events.push(event);
    if (events.filter(item => item.type === 'complete').length === 2) notifyComplete();
  } });
  try {
    assert.equal((await (await fetch(proxy.url)).arrayBuffer()).byteLength, body.length);
    assert.equal((await (await fetch(proxy.url, { headers: { 'User-Agent': 'VidSnag-Thumbnail/1.0' } })).arrayBuffer()).byteLength, body.length);
    await completed;
    const complete = events.filter(event => event.type === 'complete');
    assert.equal(complete.length, 2);
    assert.equal(complete[0].bytesTransferred, body.length);
    assert.equal(complete[0].completeResource, true);
    assert.equal(complete[0].consumer, 'download');
    assert.equal(complete[1].consumer, 'preview');
  } finally {
    await proxy.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('native finalization requires every selected track, not only completed primary pieces', async () => {
  const manifest = name => `#EXTM3U\n#EXTINF:1,\n${name}.ts\n#EXT-X-ENDLIST\n`;
  const server = http.createServer((request, response) => {
    const body = request.url.endsWith('.m3u8') ? Buffer.from(manifest(request.url.includes('audio') ? 'audio' : 'video')) : Buffer.alloc(1024, 0x47);
    response.writeHead(200, { 'Content-Type': request.url.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Content-Length': body.length }).end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const proxy = await startScopedMediaProxy({ rootUrl: `${base}/video.m3u8`, requiredPlaylistUrls: [`${base}/video.m3u8`, `${base}/audio.m3u8`] });
  const consumePlaylist = async url => {
    const playlist = await (await fetch(url)).text();
    const piece = playlist.split('\n').find(line => line && !line.startsWith('#'));
    await (await fetch(piece)).arrayBuffer();
  };
  try {
    await consumePlaylist(proxy.url);
    assert.throws(() => proxy.assertComplete(), { code: 'INCOMPLETE_HLS_DOWNLOAD' });
    await consumePlaylist(proxy.mapUrl(`${base}/audio.m3u8`));
    proxy.assertComplete();
  } finally {
    await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
});
