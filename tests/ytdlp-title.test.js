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

test('real yt-dlp metadata names completed videos while custom and resource choices survive', { timeout: 180000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-ytdlp-title-'));
  const mediaPath = path.join(directory, 'sample.mp4');
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const bundledYtDlp = path.join(__dirname, '../apps/desktop/bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ytDlp = process.env.YTDLP_PATH || process.env.YT_DLP_PATH
    || (fs.existsSync(bundledYtDlp) ? bundledYtDlp : 'yt-dlp');
  let api;
  let source;
  t.after(async () => {
    await api?.stop();
    if (source) await new Promise(resolve => source.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
  });
  await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-movflags', '+faststart', mediaPath]);
  const title = 'A "quoted" café & Bright Video';
  const media = fs.readFileSync(mediaPath);
  source = http.createServer((request, response) => {
    if (request.url === '/sample.mp4') {
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': media.length });
      response.end(media);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>A &quot;quoted&quot; café &amp; Bright Video</title></head><body><video controls src="/sample.mp4"></video></body></html>');
    }
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const sourceBase = `http://127.0.0.1:${source.address().port}`;
  const dataDir = path.join(directory, 'data');
  const downloadDir = path.join(directory, 'downloads');
  api = createApiServer({ dataDir, downloadDir, port: 0, ffmpegPath: ffmpeg, ffprobePath: ffprobe, ytDlpPath: ytDlp,
    trustBinaryPaths: true, initialQueueSettings: { autoStart: false } });
  const address = await api.start();
  const apiBase = `http://127.0.0.1:${address.port}`;
  const post = async (route, body) => {
    const response = await fetch(`${apiBase}${route}`, { method: 'POST', headers: {
      Authorization: `Bearer ${api.getAuthToken()}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) });
    const value = await response.json();
    assert.equal(response.status, 200, JSON.stringify(value));
    return value;
  };
  // The generic HTML5 extractor labels its first embedded video "(1)".
  // Preserve that actual extractor title just as the YouTube path does.
  for (const [mode, expected] of [['title', `${title} (1)`], ['custom', 'My chosen clip'], ['resource', 'Original resource']]) {
    const settings = { fileNaming: mode, customName: mode === 'custom' ? expected : '' };
    const url = `${sourceBase}/${mode}`;
    const result = mode === 'custom'
      ? await post('/v1/jobs', { mediaUrl: url, title: 'video', resourceName: 'Original resource', mediaType: 'file', settings })
      : await post('/api/jobs', { queue: { url, title: 'video', name: 'Original resource', mediaType: 'file' }, settings });
    const id = result.jobId || result.id;
    const initial = api.getState().queue.find(job => job.id === id);
    assert.equal(initial.manualTitleOverride, mode === 'custom');
    await post(`/api/queue/${id}/start`, {});
    let job;
    // A bundled yt-dlp executable can spend several seconds starting before
    // its first request. Keep the fixture alive for that bounded startup too.
    const deadline = Date.now() + 45000;
    do {
      job = api.getState().queue.find(value => value.id === id);
      if (['completed', 'failed'].includes(job.queueStatus)) break;
      await delay(50);
    } while (Date.now() < deadline);
    assert.equal(job.queueStatus, 'completed', job.error || 'The local fixture did not finish');
    assert.equal(job.title, expected);
    const safeName = expected.replaceAll('"', ' ').replace(/\s+/g, ' ').trim();
    assert.equal(path.basename(job.outputDirectory), safeName);
    const output = path.join(job.outputDirectory, `${safeName}.mp4`);
    assert.equal(fs.existsSync(output), true, 'completion keeps the chosen title in the actual filename');
    const metadata = JSON.parse(await runTool(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output]));
    assert.ok(Number(metadata.format.duration) >= 1);
    assert.ok(metadata.streams.some(stream => stream.codec_type === 'video'));
    assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio'));
  }
  await api.stop();
  api = null;
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'queue.json'), 'utf8')).queue;
  assert.deepEqual(persisted.map(job => job.fileNaming), ['title', 'custom', 'resource']);
  assert.deepEqual(persisted.map(job => job.manualTitleOverride), [false, true, false]);
});
