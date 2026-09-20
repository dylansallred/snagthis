const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { runTool } = require('./fixtures/server');
const { probeFile } = require('./fixtures/engine');
const { generatePreviewAssets, isCurrentPreviewClipPath } = require('../packages/downloader-engine/src/core/PreviewClip');
const { createLocalPreviewCollector } = require('../packages/downloader-engine/src/core/LocalPreviewCollector');
const QueueManager = require('../packages/downloader-engine/src/core/QueueManager');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function decodedFrames(input, destination, ffmpeg) {
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    ...(input.endsWith('.jpg') ? ['-frames:v', '1', '-vf', 'scale=320:180,format=rgb24'] : ['-t', '2', '-vf', 'fps=1,scale=320:180,format=rgb24']),
    '-f', 'rawvideo', destination]);
  return fs.readFile(destination);
}
function marker(frame) {
  const sums = [0, 0, 0];
  let pixels = 0;
  // Interior of the fixture's colored time marker, away from codec edges.
  for (let y = 8; y < 30; y += 1) for (let x = 8; x < 30; x += 1) {
    for (let channel = 0; channel < 3; channel += 1) sums[channel] += frame[(y * 320 + x) * 3 + channel];
    pixels += 1;
  }
  return sums.map(value => value / pixels);
}

// This single real-media fixture exercises full-file selection, local HLS
// replacement, silent motion, and serialization that permits persisted repair.
test('previews replace a 30-second interim scene with the actual 35% scene using only captured media', { timeout: 60000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-preview-selection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const options = { FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe };
  const source = path.join(directory, 'source.mp4');
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '200',
    '-vf', "drawbox=x=0:y=0:w=80:h=90:color=red:t=fill:enable='lt(t,60)',drawbox=x=0:y=0:w=80:h=90:color=blue:t=fill:enable='gte(t,60)'",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '12', '-pix_fmt', 'yuv420p', '-threads', '1',
    '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart', source]);
  assert.equal((await probeFile(source, ffprobe)).hasAudio, true, 'the source really contains audio to strip');

  let baselineMs;
  if (process.env.PREVIEW_BASELINE_MODULE) {
    const baseline = require(path.resolve(process.env.PREVIEW_BASELINE_MODULE));
    const started = performance.now();
    const poster = await baseline.generateRepresentativePoster(source, path.join(directory, 'before.jpg'), options);
    const clip = await baseline.generatePreviewClip(source, path.join(directory, 'before.mp4'), { ...options, offsetSeconds: poster.offsetSeconds });
    baselineMs = performance.now() - started;
    assert.equal(clip.offsetSeconds, 70);
  }
  const started = performance.now();
  const assets = await generatePreviewAssets(source, path.join(directory, 'after.mp4'), path.join(directory, 'after.jpg'), options);
  const afterMs = performance.now() - started;
  assert.equal(assets.poster.offsetSeconds, 70);
  assert.equal(assets.clip.offsetSeconds, 70, '35% means the entire 200-second source');
  t.diagnostic(`Full local media preview: ${baselineMs === undefined ? '' : `before=${baselineMs.toFixed(0)}ms, `}after=${afterMs.toFixed(0)}ms, selected=70s/200s`);
  const fullFrames = await decodedFrames(assets.clip.path, path.join(directory, 'full.rgb'), ffmpeg);
  const fullMarker = marker(fullFrames);
  assert.ok(fullMarker[2] > fullMarker[0] + 100, 'decoded output depicts the later blue scene');
  const posterPixels = await decodedFrames(assets.poster.path, path.join(directory, 'poster.rgb'), ffmpeg);
  assert.ok(marker(posterPixels)[2] > marker(posterPixels)[0] + 100, 'the tested poster and clip depict the same later scene');

  const media = path.join(directory, 'media');
  const storageDir = path.join(directory, 'download');
  const previewDirectory = path.join(directory, '__previews');
  await fs.mkdir(media); await fs.mkdir(storageDir);
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-c', 'copy',
    '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', 'segment-%03d.ts', 'index.m3u8'], { cwd: media });
  const playlistText = await fs.readFile(path.join(media, 'index.m3u8'), 'utf8');
  const names = playlistText.trim().split('\n').filter(line => !line.startsWith('#'));
  const job = { id: 'offset-fixture', storageDir, status: 'downloading' };
  const collector = createLocalPreviewCollector({ job, playlistText, playlistUrl: 'https://fixture.invalid/index.m3u8',
    directory: storageDir, previewDirectory, ...options });
  t.after(() => collector.close());
  const openingStarted = performance.now();
  for (const name of names.slice(0, 40)) await collector.captureFile(name, path.join(media, name));
  const deadline = Date.now() + 15000;
  while (!job.previewClipPath && Date.now() < deadline) await pause(25);
  assert.match(job.previewClipPath || '', /\.opening-v2\.mp4$/);
  t.diagnostic(`Interim from already-downloaded first40s: ${(performance.now() - openingStarted).toFixed(0)}ms; desired source offset=30s`);
  const interimPath = job.previewClipPath;
  const interimFrames = await decodedFrames(interimPath, path.join(directory, 'opening.rgb'), ffmpeg);
  const interimMarker = marker(interimFrames);
  assert.ok(interimMarker[0] > interimMarker[2] + 100, 'interim is real footage available before the middle arrives');
  assert.ok(isCurrentPreviewClipPath(interimPath, { allowInterim: true }));
  assert.equal(isCurrentPreviewClipPath(interimPath), false, 'an interim is never mistaken for a representative saved-file preview');
  const serialize = QueueManager.prototype.buildPreviewClipUrl;
  assert.match(serialize.call({ downloadDir: directory }, job), /opening-v2/);
  assert.equal(serialize.call({ downloadDir: directory }, { ...job, status: 'completed' }), null,
    'a saved interim advertises no final clip so on-demand generation repairs it');

  const middleStarted = performance.now();
  for (const name of names.slice(40)) await collector.captureFile(name, path.join(media, name));
  await collector.close();
  assert.match(job.previewClipPath || '', /\.cover-v2\.mp4$/);
  assert.notEqual(job.previewClipPath, interimPath, 'the replacement has a new URL, so an active hover cannot retain the cached opening');
  const metadata = await probeFile(job.previewClipPath, ffprobe);
  assert.equal(metadata.hasAudio, false);
  assert.equal(metadata.height, 180);
  assert.equal(metadata.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264');
  assert.ok(metadata.durationSeconds >= 9.8 && metadata.durationSeconds <= 10.2);
  const middleFrames = await decodedFrames(job.previewClipPath, path.join(directory, 'middle.rgb'), ffmpeg);
  const middleMarker = marker(middleFrames);
  assert.ok(middleMarker[2] > middleMarker[0] + 100, 'the HLS excerpt is selected at35% of the original video, not35% of its first window');
  const frameBytes = 320 * 180 * 3;
  assert.equal(middleFrames.length, frameBytes * 2);
  assert.notDeepEqual(middleFrames.subarray(0, frameBytes), middleFrames.subarray(frameBytes), 'the silent excerpt actually moves');
  assert.deepEqual((await fs.readdir(previewDirectory)).sort().map(name => name.slice(32)), ['.cover-v2.mp4', '.opening-v2.mp4']);
  assert.ok((await fs.readdir(storageDir)).every(name => !name.startsWith('local-preview-')), 'all observed-source temporary media is removed');
  t.diagnostic(`Representative from captured middle + cleanup: ${(performance.now() - middleStarted).toFixed(0)}ms; clip=${metadata.durationSeconds}s, silent=true`);

  const cancelledDir = path.join(directory, 'cancelled');
  await fs.mkdir(cancelledDir);
  const downloadAbort = new AbortController();
  const cancelledJob = { id: 'cancelled-fixture', storageDir: cancelledDir, _downloadAbort: downloadAbort };
  const cancelledCollector = createLocalPreviewCollector({ job: cancelledJob, playlistText, playlistUrl: 'https://fixture.invalid/index.m3u8',
    directory: cancelledDir, previewDirectory, ...options });
  for (const name of names.slice(0, 40)) await cancelledCollector.captureFile(name, path.join(media, name));
  const closing = cancelledCollector.close();
  cancelledJob.cancelled = true;
  const cancelledStarted = performance.now();
  downloadAbort.abort();
  await closing;
  assert.ok(performance.now() - cancelledStarted < 1500, 'cancellation interrupts a preview encoder even after normal close has begun');
  assert.equal(cancelledJob.previewClipPath, undefined, 'cancelled generation never publishes derived assets');
  assert.deepEqual(await fs.readdir(cancelledDir), [], 'cancelled local media windows are cleaned');
});
