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

// Quitting says downloads "continue the next time you open SnagThis". A
// direct file must continue from its kept bytes, and only for the same file.
for (const changed of [false, true]) {
  test(`direct download after restart ${changed ? 'starts over when the file changed' : 'continues from kept bytes'}`, { timeout: 120000 }, async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-direct-resume-'));
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
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
    const mediaPath = path.join(directory, 'clip.mp4');
    await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
      '-f', 'lavfi', '-i', 'anoisesrc=sample_rate=44100', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12',
      '-c:a', 'aac', '-movflags', '+faststart', mediaPath]);
    let media = fs.readFileSync(mediaPath);
    let etag = '"v1"';
    const requests = [];
    source = http.createServer((request, response) => {
      const range = /^bytes=(\d+)-$/.exec(request.headers.range || '');
      const honoured = range && (!request.headers['if-range'] || request.headers['if-range'] === etag);
      const start = honoured ? Number(range[1]) : 0;
      requests.push({ range: request.headers.range || null, ifRange: request.headers['if-range'] || null, start });
      response.writeHead(honoured ? 206 : 200, {
        'Content-Type': 'video/mp4', 'Content-Length': media.length - start, ETag: etag, 'Accept-Ranges': 'bytes',
        ...(honoured ? { 'Content-Range': `bytes ${start}-${media.length - 1}/${media.length}` } : {}),
      });
      let position = start;
      const timer = setInterval(() => {
        if (response.destroyed || position >= media.length) {
          clearInterval(timer);
          response.end();
          return;
        }
        response.write(media.subarray(position, position + 16384));
        position += 16384;
      }, 20);
      response.on('close', () => clearInterval(timer));
    });
    await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
    const options = { dataDir: path.join(directory, 'data'), downloadDir: path.join(directory, 'downloads'), port: 0,
      ffmpegPath: ffmpeg, ffprobePath: ffprobe, trustBinaryPaths: true };
    api = createApiServer(options);
    let address = await api.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api.getAuthToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue: { url: `http://127.0.0.1:${source.address().port}/clip.mp4`, title: 'Clip', mediaType: 'file' }, settings: {} }),
    });
    const created = await response.json();
    assert.equal(response.status, 200, JSON.stringify(created));
    const jobId = created.id || created.jobId;
    const deadline = Date.now() + 30000;
    let job;
    do {
      job = api.getState().queue.find(item => item.id === jobId);
      if (job.progress >= 30 || job.queueStatus !== 'downloading' && job.queueStatus !== 'queued') break;
      await delay(10);
    } while (Date.now() < deadline);
    assert.equal(job.queueStatus, 'downloading');
    await api.stop();
    api = null;

    const persisted = JSON.parse(fs.readFileSync(path.join(options.dataDir, 'queue.json'), 'utf8')).queue.find(item => item.id === jobId);
    const kept = fs.statSync(`${persisted.filePath}.part`).size;
    assert.ok(kept > 0 && kept < media.length, 'quitting keeps the partial file');
    if (changed) {
      // The same URL now serves a different file; kept bytes must not be reused.
      await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12',
        '-c:a', 'aac', '-movflags', '+faststart', mediaPath]);
      media = fs.readFileSync(mediaPath);
      etag = '"v2"';
    }

    api = createApiServer(options);
    address = await api.start();
    const finishBy = Date.now() + 30000;
    do {
      job = api.getState().queue.find(item => item.id === jobId);
      if (['completed', 'failed'].includes(job.queueStatus)) break;
      await delay(20);
    } while (Date.now() < finishBy);
    assert.equal(job.queueStatus, 'completed', job.error || 'resumed download did not finish');
    const resumeRequest = requests.at(-1);
    assert.equal(resumeRequest.range, `bytes=${kept}-`);
    assert.equal(resumeRequest.ifRange, '"v1"');
    assert.equal(resumeRequest.start, changed ? 0 : kept);

    const saved = path.join(job.outputDirectory, fs.readdirSync(job.outputDirectory).find(name => name.endsWith('.mp4')));
    assert.ok(fs.readFileSync(saved).equals(media), 'the saved file is byte-identical to the current source');
    const probe = JSON.parse(await runTool(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', saved]));
    assert.ok(Math.abs(Number(probe.format.duration) - (changed ? 3 : 4)) < 0.3);
    await runTool(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-i', saved, '-f', 'null', '-']);
  });
}
