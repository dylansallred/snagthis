const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { runTool } = require('./fixtures/server');
const { probeFile } = require('./fixtures/engine');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { generatePreviewClip } = require('../packages/downloader-engine/src/core/VideoConverter');

test('local preview clips are short silent H.264, privately served, shared with history and reusable after restart', { timeout: 60000 }, async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-clips-'));
  const source = path.join(dataDir, 'source.mp4');
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  await runTool(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '40',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', source,
  ]);
  // Queue posters live in the managed downloads directory; the source remains
  // outside it to exercise generation from a known local saved file.
  await fs.mkdir(path.join(dataDir, 'downloads'), { recursive: true });
  const poster = path.join(dataDir, 'downloads', 'poster.jpg');
  await runTool(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-frames:v', '1', '-vf', 'scale=224:126', poster]);
  await fs.writeFile(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: [{
    id: 'clip-video', title: 'Local fixture', filePath: source, mp4Path: source, thumbnailPath: poster,
    status: 'completed', queueStatus: 'completed', completedAt: Date.now(), durationSeconds: 40,
  }, {
    id: 'waiting-video', title: 'Not downloaded', url: 'https://example.invalid/video.mp4',
    status: 'pending', queueStatus: 'queued',
  }], settings: { autoStart: false, maxConcurrent: 1 } }));
  const makeApi = () => createApiServer({ dataDir, port: 0, ffmpegPath, ffprobePath, ytDlpPath: process.execPath, trustBinaryPaths: true });
  let api = makeApi();
  let address = await api.start();
  let base = `http://127.0.0.1:${address.port}`;
  const request = async (route, method = 'GET', authenticated = true) => {
    const response = await fetch(`${base}${route}`, { method, headers: authenticated ? { Authorization: `Bearer ${api.getAuthToken()}` } : {} });
    return { status: response.status, body: await response.json() };
  };
  try {
    await assert.rejects(generatePreviewClip('https://example.invalid/full-video.mp4', path.join(dataDir, 'remote.mp4'), { FFMPEG_PATH: ffmpegPath, FFPROBE_PATH: ffprobePath }), /local files/);
    const initial = (await request('/v1/queue')).body.queue.find((job) => job.id === 'clip-video');
    assert.equal(initial.previewClipUrl, null);
    assert.ok(initial.thumbnailUrls.length, 'the existing poster remains available');
    assert.equal((await request('/v1/jobs/clip-video/preview', 'POST', false)).status, 401);
    assert.equal((await request('/v1/jobs/missing/preview', 'POST')).status, 404);
    assert.equal((await request('/v1/jobs/waiting-video/preview', 'POST')).body.status, 'unavailable');
    const historyId = (await request('/api/history')).body.items[0].id;
    const [jobRequest, historyRequest] = await Promise.all([
      request('/v1/jobs/clip-video/preview', 'POST'),
      request(`/api/history/${historyId}/preview`, 'POST'),
    ]);
    assert.equal(jobRequest.status, 200);
    assert.equal(historyRequest.status, 200);
    assert.ok(['pending', 'ready'].includes(jobRequest.body.status));
    let ready;
    const deadline = Date.now() + 20000;
    do {
      ready = (await request('/v1/queue')).body.queue.find((job) => job.id === 'clip-video');
      if (ready.previewClipUrl || Date.now() >= deadline) break;
      await delay(100);
    } while (true);
    assert.match(ready.previewClipUrl || '', /^\/downloads\/__previews\/[a-f0-9]{32}\.mp4\?expires=\d+&signature=/);
    assert.ok(ready.thumbnailUrls.length, 'encoding does not replace or delete the fallback poster');
    const clipPathname = new URL(ready.previewClipUrl, base).pathname;
    const clipPath = path.join(dataDir, 'downloads', '__previews', path.basename(clipPathname));
    const metadata = await probeFile(clipPath, ffprobePath);
    assert.ok(metadata.durationSeconds >= 9.5 && metadata.durationSeconds <= 10.5);
    assert.equal(metadata.hasAudio, false);
    assert.equal(metadata.height, 180);
    assert.equal(metadata.streams[0].codec_name, 'h264');
    assert.equal(metadata.streams[0].pix_fmt, 'yuv420p');
    assert.ok(Number(metadata.streams[0].nb_frames) >= 100, 'the preview contains moving video frames');
    assert.ok((await fs.stat(clipPath)).size < 1_000_000);
    assert.equal((await fetch(`${base}${clipPathname}`)).status, 401);
    const playback = await fetch(`${base}${ready.previewClipUrl}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(playback.status, 206);
    assert.equal((await playback.arrayBuffer()).byteLength, 100);
    const history = (await request('/api/history')).body.items;
    assert.equal(history.length, 1, 'derived clips are not saved-library entries');
    assert.equal(new URL(history[0].previewClipUrl, base).pathname, clipPathname);
    assert.equal((await fs.readdir(path.join(dataDir, 'downloads', '__previews'))).filter((file) => file.endsWith('.mp4')).length, 1, 'job and history share the same excerpt');
    const modifiedAt = (await fs.stat(clipPath)).mtimeMs;
    await api.stop();
    api = makeApi();
    address = await api.start();
    base = `http://127.0.0.1:${address.port}`;
    const reused = await request('/v1/jobs/clip-video/preview', 'POST');
    assert.equal(reused.body.status, 'ready');
    assert.equal(new URL(reused.body.previewClipUrl, base).pathname, clipPathname);
    assert.equal((await fs.stat(clipPath)).mtimeMs, modifiedAt);
  } finally {
    await api.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
