const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { runTool } = require('./fixtures/server');
const { probeFile } = require('./fixtures/engine');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { generatePreviewClip } = require('../packages/downloader-engine/src/core/VideoConverter');

test('local previews crop to fill, replace padded clips, skip black scenes, and remain private and reusable', { timeout: 60000 }, async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-clips-'));
  const source = path.join(dataDir, 'source.mp4');
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  await runTool(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x200:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '40',
    // The 35% and 50% poster candidates are black; later footage is usable.
    '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,25)'",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', source,
  ]);
  // Queue posters live in the managed downloads directory; the source remains
  // outside it to exercise generation from a known local saved file.
  await fs.mkdir(path.join(dataDir, 'downloads'), { recursive: true });
  const poster = path.join(dataDir, 'downloads', 'clip-video-thumb.jpg');
  await runTool(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-frames:v', '1', '-vf', 'scale=224:126', poster]);
  const sourceStat = await fs.stat(source);
  const oldKey = createHash('sha256').update(`${await fs.realpath(source)}:${sourceStat.size}:${sourceStat.mtimeMs}`).digest('hex').slice(0, 32);
  const oldClip = path.join(dataDir, 'downloads', '__previews', `${oldKey}.cover-v1.mp4`);
  await fs.mkdir(path.dirname(oldClip), { recursive: true });
  await runTool(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '26', '-i', source, '-t', '1', '-an',
    '-vf', 'scale=320:180:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=320:180:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', oldClip]);
  await fs.copyFile(poster, path.join(path.dirname(oldClip), `${oldKey}.jpg`));
  const oldClipBytes = await fs.readFile(oldClip);
  await fs.writeFile(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: [{
    id: 'clip-video', title: 'Local fixture', filePath: source, mp4Path: source, thumbnailPath: poster,
    previewClipPath: oldClip, previewClipDurationSeconds: 1,
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
  const frameLuminance = async (input, label) => {
    const pixelsPath = path.join(dataDir, `${label}.gray`);
    await runTool(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-frames:v', '1', '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', pixelsPath]);
    const pixels = await fs.readFile(pixelsPath);
    assert.equal(pixels.length, 64 * 36);
    const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
    const variance = pixels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels.length;
    const edgeMean = indices => indices.reduce((sum, index) => sum + pixels[index], 0) / indices.length;
    const top = edgeMean(Array.from({ length: 64 }, (_, index) => index));
    const bottom = edgeMean(Array.from({ length: 64 }, (_, index) => 35 * 64 + index));
    return { mean, variance, top, bottom };
  };
  try {
    await assert.rejects(generatePreviewClip('https://example.invalid/full-video.mp4', path.join(dataDir, 'remote.mp4'), { FFMPEG_PATH: ffmpegPath, FFPROBE_PATH: ffprobePath }), /local files/);
    const initial = (await request('/v1/queue')).body.queue.find((job) => job.id === 'clip-video');
    assert.equal(initial.previewClipUrl, null, 'old padded clips are regenerated on demand');
    assert.ok(initial.thumbnailUrls.length, 'the existing poster remains available');
    assert.ok((await frameLuminance(poster, 'opening-frame')).mean < 5, 'the fixture starts with a genuinely black frame');
    const oldFrame = await frameLuminance(oldClip, 'old-padded-frame');
    assert.ok(oldFrame.top < 5 && oldFrame.bottom < 5, 'the old clip has baked-in black bars');
    assert.equal((await request('/v1/jobs/clip-video/preview', 'POST', false)).status, 401);
    assert.equal((await request('/v1/jobs/missing/preview', 'POST')).status, 404);
    assert.equal((await request('/v1/jobs/waiting-video/preview', 'POST')).body.status, 'unavailable');
    const initialHistory = (await request('/api/history')).body.items[0];
    assert.equal(initialHistory.previewClipUrl, null, 'history also stops offering the padded clip');
    const historyId = initialHistory.id;
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
    assert.match(ready.previewClipUrl || '', /^\/downloads\/__previews\/[a-f0-9]{32}\.cover-v2\.mp4\?expires=\d+&signature=/);
    assert.ok(ready.thumbnailUrls.length, 'the useful video frame is published as a poster');
    assert.notEqual(new URL(ready.thumbnailUrls[0], base).pathname, new URL(initial.thumbnailUrls[0], base).pathname,
      'the generated scene replaces the black opening poster in the API');
    const servedPoster = await fetch(new URL(ready.thumbnailUrls[0], base));
    assert.equal(servedPoster.status, 200);
    assert.match(servedPoster.headers.get('content-type') || '', /^image\//);
    const publishedPoster = path.join(dataDir, 'published-poster.jpg');
    await fs.writeFile(publishedPoster, Buffer.from(await servedPoster.arrayBuffer()));
    const luminance = await frameLuminance(publishedPoster, 'published-frame');
    assert.ok(luminance.mean > 35 && luminance.mean < 230, 'the API poster contains a visible scene after skipping black candidates');
    assert.ok(luminance.variance > 100, 'the poster contains picture detail, not a blank colored frame');
    assert.ok((await fs.stat(poster)).isFile(), 'the original fallback file remains available');
    const clipPathname = new URL(ready.previewClipUrl, base).pathname;
    const clipPath = path.join(dataDir, 'downloads', '__previews', path.basename(clipPathname));
    const metadata = await probeFile(clipPath, ffprobePath);
    assert.ok(metadata.durationSeconds >= 9.5 && metadata.durationSeconds <= 10.5);
    assert.equal(metadata.hasAudio, false);
    assert.equal(metadata.height, 180);
    assert.equal(metadata.streams[0].codec_name, 'h264');
    assert.equal(metadata.streams[0].pix_fmt, 'yuv420p');
    assert.ok(Number(metadata.streams[0].nb_frames) >= 100, 'the preview contains moving video frames');
    const clipFrame = await frameLuminance(clipPath, 'clip-frame');
    assert.ok(clipFrame.mean > 35, 'the clip starts at useful footage instead of the black intro');
    assert.ok(clipFrame.top > 35 && clipFrame.bottom > 35, 'decoded video fills the frame instead of adding letterbox bars');
    assert.ok((await fs.stat(clipPath)).size < 1_000_000);
    assert.equal((await fetch(`${base}${clipPathname}`)).status, 401);
    const playback = await fetch(`${base}${ready.previewClipUrl}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(playback.status, 206);
    assert.equal((await playback.arrayBuffer()).byteLength, 100);
    const history = (await request('/api/history')).body.items;
    assert.equal(history.length, 1, 'derived clips are not saved-library entries');
    assert.equal(new URL(history[0].previewClipUrl, base).pathname, clipPathname);
    const posterPathname = new URL(ready.thumbnailUrls[0], base).pathname;
    assert.equal(new URL(history[0].thumbnailUrl, base).pathname, posterPathname, 'history uses the generated scene');
    assert.equal((await fs.readdir(path.join(dataDir, 'downloads', '__previews'))).filter((file) => file.endsWith('.cover-v2.mp4')).length, 1, 'job and history share the same cropped excerpt');
    assert.deepEqual(await fs.readFile(oldClip), oldClipBytes, 'regeneration leaves existing media files untouched');
    const modifiedAt = (await fs.stat(clipPath)).mtimeMs;
    await api.stop();
    api = makeApi();
    address = await api.start();
    base = `http://127.0.0.1:${address.port}`;
    const reused = await request('/v1/jobs/clip-video/preview', 'POST');
    assert.equal(reused.body.status, 'ready');
    assert.equal(new URL(reused.body.previewClipUrl, base).pathname, clipPathname);
    assert.equal((await fs.stat(clipPath)).mtimeMs, modifiedAt);
    const restoredHistory = (await request('/api/history')).body.items;
    assert.equal(new URL(restoredHistory[0].thumbnailUrl, base).pathname, posterPathname,
      'a history refresh after restart does not restore the older black poster');
  } finally {
    await api.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
