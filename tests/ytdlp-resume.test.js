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

// A yt-dlp download merges separate video and audio formats. Quitting after
// the video format finished must resume the audio on the next launch rather
// than re-requesting the finished video (YouTube answers that with HTTP 416).
test('real yt-dlp resumes split formats after an app restart', { timeout: 180000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-ytdlp-resume-'));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const bundledYtDlp = path.join(__dirname, '../apps/desktop/bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const ytDlp = process.env.YTDLP_PATH || process.env.YT_DLP_PATH
    || (fs.existsSync(bundledYtDlp) ? bundledYtDlp : 'yt-dlp');
  let api;
  let source;
  t.after(async () => {
    await api?.stop();
    if (source) {
      source.closeAllConnections?.();
      await new Promise(resolve => source.close(resolve));
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
  });

  const videoPath = path.join(directory, 'video.mp4');
  const audioPath = path.join(directory, 'audio.m4a');
  const tool = (...args) => runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  await tool('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10', '-t', '6', '-an', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath);
  await tool('-f', 'lavfi', '-i', 'anoisesrc=sample_rate=44100:amplitude=0.5', '-t', '6', '-vn', '-c:a', 'aac',
    '-b:a', '320k', '-movflags', '+faststart', audioPath);
  const files = { '/video.mp4': fs.readFileSync(videoPath), '/audio.m4a': fs.readFileSync(audioPath) };
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT6S" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <Representation id="v" bandwidth="400000" codecs="avc1.42c01e" width="320" height="180"><BaseURL>video.mp4</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" contentType="audio">
      <Representation id="a" bandwidth="320000" codecs="mp4a.40.2" audioSamplingRate="44100"><BaseURL>audio.m4a</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
  const requests = [];
  source = http.createServer((request, response) => {
    if (request.url === '/manifest.mpd') {
      response.writeHead(200, { 'Content-Type': 'application/dash+xml' });
      response.end(manifest);
      return;
    }
    const body = files[request.url];
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    requests.push({ url: request.url, start, method: request.method });
    if (start >= body.length) {
      response.writeHead(416, { 'Content-Range': `bytes */${body.length}` });
      response.end();
      return;
    }
    response.writeHead(match ? 206 : 200, {
      'Content-Type': request.url.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}),
    });
    if (request.url !== '/audio.m4a') {
      response.end(body.subarray(start, end + 1));
      return;
    }
    // The first audio response stalls half-way so the app quits part-way
    // through it however slowly the machine runs; later responses complete.
    const stallAt = start === 0 ? Math.floor(body.length / 2) : Infinity;
    let position = start;
    const timer = setInterval(() => {
      if (position >= stallAt) return;
      if (response.destroyed || position > end) {
        clearInterval(timer);
        response.end();
        return;
      }
      const chunk = body.subarray(position, Math.min(end + 1, stallAt, position + 8192));
      position += chunk.length;
      response.write(chunk);
    }, 20);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const mediaUrl = `http://127.0.0.1:${source.address().port}/manifest.mpd`;

  const options = { dataDir: path.join(directory, 'data'), downloadDir: path.join(directory, 'downloads'), port: 0,
    ffmpegPath: ffmpeg, ffprobePath: ffprobe, ytDlpPath: ytDlp, trustBinaryPaths: true };
  api = createApiServer(options);
  let address = await api.start();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${api.getAuthToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: { url: mediaUrl, title: 'Split formats', mediaType: 'file' }, settings: {} }),
  });
  const created = await response.json();
  assert.equal(response.status, 200, JSON.stringify(created));
  const jobId = created.id || created.jobId;

  const partialBytes = () => {
    const job = api.getState().queue.find(item => item.id === jobId);
    assert.notEqual(job.queueStatus, 'failed', job.error || 'download failed before restart');
    const folder = job.outputDirectory;
    const name = folder && fs.existsSync(folder) && fs.readdirSync(folder).find(file => file.endsWith('.m4a.part'));
    return name ? fs.statSync(path.join(folder, name)).size : 0;
  };
  const deadline = Date.now() + 60000;
  while (partialBytes() < 16 * 1024 && Date.now() < deadline) await delay(10);
  assert.ok(partialBytes() >= 16 * 1024, `audio download did not start: ${JSON.stringify(requests)}`);
  // Quitting pauses the running download and keeps it queued for next launch.
  await api.stop();
  api = null;

  const storageDir = JSON.parse(fs.readFileSync(path.join(options.dataDir, 'queue.json'), 'utf8'))
    .queue.find(job => job.id === jobId).storageDir;
  const names = fs.readdirSync(storageDir);
  const partial = names.find(name => name.endsWith('.m4a.part'));
  assert.ok(partial, `audio stays partial across the restart: ${names.join(', ')}`);
  assert.ok(names.some(name => /\.mp4$/.test(name)), 'the finished video format is kept');
  const resumeFrom = fs.statSync(path.join(storageDir, partial)).size;
  assert.ok(resumeFrom > 0 && resumeFrom < files['/audio.m4a'].length);
  const videoRequestsBefore = requests.filter(request => request.url === '/video.mp4').length;

  api = createApiServer(options);
  address = await api.start();
  let job;
  const finishBy = Date.now() + 60000;
  do {
    job = api.getState().queue.find(item => item.id === jobId);
    if (['completed', 'failed'].includes(job.queueStatus)) break;
    await delay(50);
  } while (Date.now() < finishBy);
  assert.equal(job.queueStatus, 'completed', job.error || 'resumed download did not finish');

  const afterRestart = requests.slice(requests.findIndex(request => request.url === '/audio.m4a' && request.start > 0));
  assert.equal(afterRestart[0].start, resumeFrom, 'audio resumes from the kept partial bytes');
  assert.equal(requests.filter(request => request.url === '/video.mp4').length, videoRequestsBefore,
    'the finished video format is not downloaded again');

  const output = path.join(job.outputDirectory, fs.readdirSync(job.outputDirectory).find(name => name.endsWith('.mp4')));
  const merged = JSON.parse(await runTool(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json', output]));
  assert.ok(Math.abs(Number(merged.format.duration) - 6) < 0.5, `duration ${merged.format.duration}`);
  assert.ok(merged.streams.some(stream => stream.codec_type === 'video'));
  assert.ok(merged.streams.some(stream => stream.codec_type === 'audio'));
  // The resumed audio must decode end to end; a mismatched append would not.
  await runTool(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
});

test('DASH manifests with an XML declaration are sent to yt-dlp, not saved as files', () => {
  const { classifyMedia } = require('../packages/downloader-engine/src/core/MediaSelection');
  assert.equal(classifyMedia('text/plain', '<?xml version="1.0" encoding="UTF-8"?>\n<!-- packager -->\n<MPD type="static">'), 'dash');
  assert.equal(classifyMedia('', '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">'), 'dash');
  assert.equal(classifyMedia('application/dash+xml', '<?xml version="1.0"?>'), 'dash');
  assert.equal(classifyMedia('application/xml', '<?xml version="1.0"?><rss>'), 'direct');
});
