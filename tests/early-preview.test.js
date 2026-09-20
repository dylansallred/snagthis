const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { runTool } = require('./fixtures/server');
const { probeFile } = require('./fixtures/engine');

process.env.DISABLE_FILE_LOGS = '1';
process.env.LOG_LEVEL = 'error';

const waitFor = async (condition, timeout = 25000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error('The early local preview was not published');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

test('native HLS publishes a real local poster and silent clip before its final piece finishes', { timeout: 65000 }, async (t) => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-early-preview-'));
  const media = path.join(directory, 'media');
  const output = path.join(directory, 'output');
  fs.mkdirSync(media); fs.mkdirSync(output);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }));
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '12', '-pix_fmt', 'yuv420p', '-threads', '1',
    '-c:a', 'aac', '-b:a', '32k', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', 'segment-%02d.m4s', 'index.m3u8'], { cwd: media });
  const playlist = fs.readFileSync(path.join(media, 'index.m3u8'), 'utf8');
  const lastPiece = playlist.trim().split('\n').filter(line => !line.startsWith('#')).at(-1);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let finalRequested = false;
  const requests = [];
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, 'http://fixture.invalid').pathname.slice(1);
    requests.push(name);
    if (name === lastPiece) { finalRequested = true; await held; }
    if (res.destroyed) return;
    const localPath = path.join(media, path.basename(name));
    if (!fs.existsSync(localPath)) { res.writeHead(404).end(); return; }
    const body = fs.readFileSync(localPath);
    res.writeHead(200, { 'Content-Length': body.length, 'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' });
    res.end(body);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { release(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const { createJobProcessor } = require('../packages/downloader-engine/src/core/JobProcessor');
  const processor = createJobProcessor({ downloadDir: directory, FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe,
    fsPromises: fs.promises, DEFAULT_MAX_CONCURRENT: 3, DEFAULT_MAX_SEGMENT_ATTEMPTS: 3,
    getJobTempDirForUrl: () => path.join(directory, 'temp-pieces') });
  const job = { id: 'early-preview', url: `http://127.0.0.1:${server.address().port}/index.m3u8`,
    status: 'queued', mediaType: 'hls', headers: {}, filePath: path.join(output, 'video.ts'), storageDir: output,
    downloadName: 'video.ts', downloadNameMp4: 'video.mp4', skipThumbnailGeneration: true };
  const running = processor.runJob(job);
  try {
    await waitFor(() => finalRequested && Boolean(job.previewClipPath));
    assert.equal(job.status, 'downloading', 'the preview must appear while source bytes are still outstanding');
    assert.equal(job.connectionCountAvailable, true);
    assert.ok(job.activeConnections > 0 && job.activeConnections <= 3, 'connections count actual outstanding upstream transfers');
    assert.equal(job.maxConnections, 3);
    assert.ok(job.completedSegments < job.totalSegments);
    assert.ok(fs.statSync(job.thumbnailPath).size > 100);
    const clip = await probeFile(job.previewClipPath, ffprobe);
    assert.equal(clip.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264');
    assert.equal(clip.hasAudio, false);
    assert.ok(clip.durationSeconds >= 9.8 && clip.durationSeconds <= 10.2, `early clip duration: ${clip.durationSeconds}`);
    assert.ok(requests.filter(name => name === 'init.mp4').length <= 2, 'previews must reuse local initialization bytes');
    assert.equal(new Set(requests.filter(name => name.endsWith('.m4s'))).size, 20);
  } finally { release(); await running; }
  assert.equal(job.status, 'completed', job.error);
  assert.equal(job.activeConnections, 0);
  assert.equal(job.completedSegments, job.totalSegments);
  assert.ok(fs.readdirSync(output).every(name => !name.startsWith('local-preview-') && !name.startsWith('native-pieces-')));
});
