// Real-media reproductions of failures seen in the FMHY site survey
// (compat/reports/fmhy-video-survey.md). Each scenario runs the production
// JobProcessor against a loopback server that reproduces one CDN behaviour, and
// the saved file is checked with ffprobe. No site URLs or site media are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { runTool } = require('./fixtures/server');
const { probeFile } = require('./fixtures/engine');
const { describeAudioTracks } = require('../packages/contracts/src/audioTracks');
const { parseHlsManifest } = require('../packages/contracts/src/hls');

process.env.LOG_LEVEL = 'error';
process.env.DISABLE_FILE_LOGS = '1';
// Prefer the FFmpeg build the desktop app ships (its HLS byte-range handling
// differs from older system builds).
const BUNDLED = path.resolve(__dirname, '../apps/desktop/bin');
const FFMPEG = process.env.FFMPEG_PATH || (fs.existsSync(path.join(BUNDLED, 'ffmpeg')) ? path.join(BUNDLED, 'ffmpeg') : 'ffmpeg');
const FFPROBE = process.env.FFPROBE_PATH || (fs.existsSync(path.join(BUNDLED, 'ffprobe')) ? path.join(BUNDLED, 'ffprobe') : 'ffprobe');

async function generate(directory) {
  const ffmpeg = (args, cwd) => runTool(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd });
  const source = path.join(directory, 'source.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-g', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '48k', source]);
  for (const height of [360, 240]) {
    const folder = path.join(directory, `v${height}`);
    fs.mkdirSync(folder);
    await ffmpeg(['-i', source, '-an', '-vf', `scale=-2:${height}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-g', '12',
      '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', 'seg-%02d.m4s', 'index.m3u8'], folder);
  }
  for (const [name, frequency] of [['a1', 440], ['a2', 880]]) {
    const folder = path.join(directory, name);
    fs.mkdirSync(folder);
    await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100`, '-t', '6', '-c:a', 'aac', '-b:a', '48k',
      '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
      '-hls_segment_filename', 'seg-%02d.m4s', 'index.m3u8'], folder);
  }
  // Muxed single-file CMAF addressed only by EXT-X-BYTERANGE (arte.tv style).
  const single = path.join(directory, 'single');
  fs.mkdirSync(single);
  await ffmpeg(['-i', source, '-c', 'copy', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_flags', 'single_file', '-hls_segment_filename', 'media.mp4', 'index.m3u8'], single);
  if (!fs.readFileSync(path.join(single, 'index.m3u8'), 'utf8').includes('#EXT-X-BYTERANGE')) throw new Error('FFmpeg did not write a byte-range playlist');
  const muxed = path.join(directory, 'muxed');
  fs.mkdirSync(muxed);
  await ffmpeg(['-i', source, '-c', 'copy', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', 'seg-%02d.m4s', 'index.m3u8'], muxed);
}

const AUDIO = [
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Track 1",DEFAULT=YES,AUTOSELECT=YES,URI="/a1/index.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Track 2",DEFAULT=NO,AUTOSELECT=YES,URI="/a2/index.m3u8"',
];
const MASTERS = {
  // cinejoy.pk: the top rendition's objects are gone from the CDN (502).
  '/dead-top/master.m3u8': ['#EXTM3U', ...AUDIO,
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="audio"', '/dead/v360/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240,CODECS="avc1.64001e,mp4a.40.2",AUDIO="audio"', '/v240/index.m3u8'],
  // rutube: two attribute-identical copies of one rendition on different CDNs.
  '/redundant/master.m3u8': ['#EXTM3U', ...AUDIO,
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="audio"', '/dead/v360/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="audio"', '/v360/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240,CODECS="avc1.64001e,mp4a.40.2",AUDIO="audio"', '/v240/index.m3u8'],
};

async function startServer(directory) {
  const requests = [];
  const counts = new Map();
  const handler = (req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    let pathname = url.pathname;
    requests.push({ pathname, method: req.method, origin: req.headers.origin || null, referer: req.headers.referer || null, range: req.headers.range || null, at: Date.now() });
    const count = (counts.get(pathname) || 0) + 1;
    counts.set(pathname, count);
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body), ...headers });
      res.end(body);
    };
    if (MASTERS[pathname]) { send(200, MASTERS[pathname].join('\n') + '\n', { 'Content-Type': 'application/vnd.apple.mpegurl' }); return; }
    if (pathname.startsWith('/dead/')) {
      // Playlist exists; its init and pieces deterministically return the same 502.
      if (pathname.endsWith('.m3u8')) pathname = pathname.slice('/dead'.length);
      else { send(502, 'origin unavailable'); return; }
    }
    if (pathname.startsWith('/origin-sensitive/')) {
      // P-Stream upstream: refuses any request that carries an Origin header.
      if (req.headers.origin) { send(403, 'Forbidden origin'); return; }
      pathname = pathname.slice('/origin-sensitive'.length);
    }
    if (pathname.startsWith('/rate-limited/')) {
      // Wikimedia: 429 with Retry-After: 1 on the first request of each resource.
      if (count === 1) { send(429, 'Too many requests', { 'Retry-After': '1' }); return; }
      pathname = pathname.slice('/rate-limited'.length);
    }
    if (pathname === '/api/stream/m3u8') {
      // cineby: the playlist is only returned to a POST; a GET replay is refused.
      send(400, '{"error":"Provide either \'url\' or \'m3u8Text\'"}', { 'Content-Type': 'application/json' });
      return;
    }
    if (pathname.startsWith('/forbidden-init/')) {
      if (/init\.mp4$/.test(pathname)) { send(403, 'Forbidden'); return; }
      pathname = pathname.slice('/forbidden-init'.length);
    }
    const filePath = path.resolve(directory, '.' + pathname);
    if (!filePath.startsWith(directory + path.sep) || !fs.existsSync(filePath)) { send(404, 'Not found'); return; }
    let body = fs.readFileSync(filePath);
    let status = 200;
    const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' };
    const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${body.length}`;
      body = body.subarray(start, end + 1);
      status = 206;
    }
    res.writeHead(status, { ...headers, 'Content-Length': body.length });
    res.end(body);
  };
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests, counts,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

// Windows cannot execute a `#!` script (spawn fails with EFTYPE), and the
// engine rightly spawns FFMPEG_PATH as a real executable without a shell. Build
// a real .exe with the C# compiler every Windows .NET Framework install ships;
// it forwards FFmpeg's `-i` input to the Node script and returns its exit code.
async function windowsLauncher(directory, script) {
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const verbatim = (value) => `@"${value.replace(/"/g, '""')}"`;
  const source = path.join(directory, 'ffmpeg-exits-cleanly.cs');
  const executable = path.join(directory, 'ffmpeg-exits-cleanly.exe');
  fs.writeFileSync(source, `using System;
using System.Diagnostics;
static class Launcher {
  static int Main(string[] args) {
    int input = Array.IndexOf(args, "-i");
    var info = new ProcessStartInfo(${verbatim(process.execPath)}, "\\"" + ${verbatim(script)} + "\\" -i \\"" + args[input + 1] + "\\"");
    info.UseShellExecute = false;
    using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
  }
}
`);
  await runTool(csc, ['/nologo', '/target:exe', `/out:${executable}`, source]);
  return executable;
}

async function runJob(directory, fields) {
  const { createJobProcessor } = require('../packages/downloader-engine/src/core/JobProcessor');
  const id = randomUUID();
  const output = path.join(directory, 'outputs', id);
  fs.mkdirSync(output, { recursive: true });
  const processor = createJobProcessor({ downloadDir: path.join(directory, 'outputs'), FFMPEG_PATH: FFMPEG, FFPROBE_PATH: FFPROBE,
    fsPromises: fs.promises, DEFAULT_MAX_CONCURRENT: 3, DEFAULT_MAX_SEGMENT_ATTEMPTS: 30,
    getJobTempDirForUrl: (_url, jobId) => path.join(directory, `temp-${jobId}`) });
  const job = { id, mediaType: 'hls', headers: {}, title: 'Compat fixture', status: 'pending', queueStatus: 'downloading',
    progress: 0, bytesDownloaded: 0, completedSegments: 0, failedSegments: [],
    filePath: path.join(output, 'fixture.ts'), storageDir: output, downloadName: 'fixture.ts', downloadNameMp4: 'fixture.mp4',
    skipThumbnailGeneration: true, earlyThumbnailAttempted: true, ...fields };
  const timer = setTimeout(() => { job.cancelled = true; }, 90_000);
  const started = Date.now();
  try { await processor.runJob(job); } finally { clearTimeout(timer); }
  job.elapsedMs = Date.now() - started;
  return job;
}

test('site-compatibility reproductions download real media', { timeout: 300_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-compat-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await generate(directory);
  const server = await startServer(directory);
  t.after(() => server.close());
  const base = server.baseUrl;

  await t.test('a dead default rendition falls back to the next lower one and keeps the chosen audio track', async () => {
    const master = parseHlsManifest(MASTERS['/dead-top/master.m3u8'].join('\n'), `${base}/dead-top/master.m3u8`);
    const track2 = describeAudioTracks(master.audio).find((track) => track.title.startsWith('Track 2'));
    assert.ok(track2, 'fixture exposes a second nameless audio track');
    const job = await runJob(directory, { url: `${base}/dead-top/master.m3u8`, selection: { variantUrl: `${base}/dead/v360/index.m3u8`, height: 360, audioTrack: track2.key } });
    assert.equal(job.status, 'completed', job.error);
    assert.deepEqual(job.qualityFallback, { from: 360, to: 240 });
    const media = await probeFile(job.mp4Path, FFPROBE);
    assert.equal(media.height, 240);
    assert.equal(media.hasAudio, true);
    assert.ok(Math.abs(media.durationSeconds - 6) <= 1, `duration ${media.durationSeconds}`);
    assert.ok(server.requests.some((request) => request.pathname.startsWith('/a2/')), 'the chosen Track 2 was downloaded');
    assert.ok(!server.requests.some((request) => request.pathname.startsWith('/a1/')), 'the default track was not substituted');
    // Identical 502 answers are permanent after a few tries, not ~30 attempts over minutes.
    const deadAttempts = server.requests.filter((request) => request.pathname === '/dead/v360/seg-00.m4s' || request.pathname === '/dead/v360/init.mp4').length;
    assert.ok(deadAttempts <= 8, `dead pieces were requested ${deadAttempts} times`);
    assert.ok(job.elapsedMs < 30_000, `fallback took ${job.elapsedMs} ms`);
  });

  await t.test('when every lower rendition is also dead the original failure is reported as an unavailable quality', async () => {
    const job = await runJob(directory, { url: `${base}/dead/v360/index.m3u8` });
    assert.equal(job.status, 'error');
    assert.match(job.error, /status 502/);
    const { classifyProblem } = require('../packages/contracts/src/rows');
    assert.equal(classifyProblem(job.error).code, 'quality');
  });

  await t.test('an attribute-identical failover copy is used before any lower quality', async () => {
    const job = await runJob(directory, { url: `${base}/redundant/master.m3u8`, selection: { variantUrl: `${base}/dead/v360/index.m3u8`, height: 360 } });
    assert.equal(job.status, 'completed', job.error);
    assert.equal(job.qualityFallback, null);
    assert.equal((await probeFile(job.mp4Path, FFPROBE)).height, 360);
  });

  await t.test('no Origin is invented for a CDN that refuses one', async () => {
    const job = await runJob(directory, { url: `${base}/origin-sensitive/muxed/index.m3u8`, sourcePageUrl: 'https://site.example/watch/1' });
    assert.equal(job.status, 'completed', job.error);
    assert.ok(server.requests.filter((request) => request.pathname.startsWith('/origin-sensitive/')).every((request) => !request.origin));
    assert.equal((await probeFile(job.mp4Path, FFPROBE)).hasAudio, true);
  });

  await t.test('an observed Origin refused with 403 is retried once without it', async () => {
    const before = server.requests.length;
    const job = await runJob(directory, { url: `${base}/origin-sensitive/v240/index.m3u8`, sourcePageUrl: 'https://site.example/watch/1',
      headers: { origin: 'https://site.example', referer: 'https://site.example/watch/1' } });
    assert.equal(job.status, 'completed', job.error);
    const refused = server.requests.slice(before).filter((request) => request.origin);
    assert.equal(refused.length, 1, 'only the first request carries the refused Origin; the host is then remembered');
    assert.equal((await probeFile(job.mp4Path, FFPROBE)).height, 240);
  });

  await t.test('Retry-After on 429 is honored for playlists and pieces', async () => {
    const job = await runJob(directory, { url: `${base}/rate-limited/muxed/index.m3u8` });
    assert.equal(job.status, 'completed', job.error);
    const master = server.requests.filter((request) => request.pathname === '/rate-limited/muxed/index.m3u8');
    assert.ok(master.length >= 2 && master[1].at - master[0].at >= 900, 'the playlist was retried after the announced second');
    assert.ok(Math.abs((await probeFile(job.mp4Path, FFPROBE)).durationSeconds - 6) <= 1);
  });

  await t.test('a playlist only available from a POST response downloads from its captured text', async () => {
    const text = fs.readFileSync(path.join(directory, 'muxed/index.m3u8'), 'utf8')
      .replace(/^(init\.mp4|seg-\d+\.m4s)$/gm, (name) => `${base}/muxed/${name}`).replace(/URI="init\.mp4"/, `URI="${base}/muxed/init.mp4"`);
    const job = await runJob(directory, { url: `${base}/api/stream/m3u8`, manifestText: text });
    assert.equal(job.status, 'completed', job.error);
    assert.ok(!server.requests.some((request) => request.pathname === '/api/stream/m3u8'), 'the non-replayable URL is never requested');
    const media = await probeFile(job.mp4Path, FFPROBE);
    assert.equal(media.height, 360);
    assert.equal(media.hasAudio, true);
  });

  await t.test('a single-file byte-range playlist completes (full and bounded probe)', async () => {
    const before = server.requests.length;
    const full = await runJob(directory, { url: `${base}/single/index.m3u8` });
    // FFmpeg 9 otherwise requests "piece to end of file" for every piece; on a
    // multi-gigabyte arte.tv rendition a bounded job then never finishes.
    const declared = [...fs.readFileSync(path.join(directory, 'single/index.m3u8'), 'utf8').matchAll(/(?:BYTERANGE[:=]"?)(\d+)@(\d+)/g)]
      .map((match) => ({ start: Number(match[2]), end: Number(match[2]) + Number(match[1]) - 1 }));
    const ranged = server.requests.slice(before).filter((request) => request.pathname === '/single/media.mp4');
    assert.ok(ranged.length >= declared.length);
    for (const request of ranged) {
      const [, start, end] = String(request.range).match(/^bytes=(\d+)-(\d+)$/) || [];
      assert.ok(declared.some((piece) => piece.start <= Number(start) && Number(end) <= piece.end), `request ${request.range} stays inside one declared piece`);
    }
    assert.equal(full.status, 'completed', full.error);
    const media = await probeFile(full.mp4Path, FFPROBE);
    assert.ok(Math.abs(media.durationSeconds - 6) <= 1, `duration ${media.durationSeconds}`);
    assert.equal(media.hasAudio, true);
    const probe = await runJob(directory, { url: `${base}/single/index.m3u8`, probe: { seconds: 3 } });
    assert.equal(probe.status, 'completed', probe.error);
    assert.ok(probe.elapsedMs < 20_000, `probe took ${probe.elapsedMs} ms`);
    assert.ok((await probeFile(probe.mp4Path, FFPROBE)).durationSeconds <= 4);
  });

  await t.test('FFmpeg exiting without output reports the upstream refusal, not ENOENT', async () => {
    const job = await runJob(directory, { url: `${base}/forbidden-init/muxed/index.m3u8` });
    assert.equal(job.status, 'error');
    assert.doesNotMatch(job.error, /ENOENT|rename/);
    assert.match(job.error, /403/);
    // Some FFmpeg builds exit 0 after every input request failed (P-Stream
    // 2160p). Reproduce exactly that: read the playlist and its init through
    // the relay, get the real 403, then exit 0 without writing the output.
    const fake = path.join(directory, 'ffmpeg-exits-cleanly.js');
    fs.writeFileSync(fake, `#!/usr/bin/env node
const input = process.argv[process.argv.indexOf('-i') + 1];
(async () => {
  const playlist = await (await fetch(input)).text();
  const init = playlist.match(/URI="([^"]+)"/);
  if (init) await fetch(init[1]).catch(() => {});
  process.exit(0);
})();
`, { mode: 0o755 });
    const executable = process.platform === 'win32' ? await windowsLauncher(directory, fake) : fake;
    const { createJobProcessor } = require('../packages/downloader-engine/src/core/JobProcessor');
    const output = path.join(directory, 'outputs', 'no-output');
    fs.mkdirSync(output, { recursive: true });
    const processor = createJobProcessor({ downloadDir: path.join(directory, 'outputs'), FFMPEG_PATH: executable, FFPROBE_PATH: FFPROBE, fsPromises: fs.promises,
      DEFAULT_MAX_CONCURRENT: 1, DEFAULT_MAX_SEGMENT_ATTEMPTS: 3, getJobTempDirForUrl: (_url, jobId) => path.join(directory, `temp-${jobId}`) });
    const clean = { id: 'no-output', url: `${base}/forbidden-init/muxed/index.m3u8`, mediaType: 'hls', headers: {}, status: 'pending', queueStatus: 'downloading',
      progress: 0, filePath: path.join(output, 'fixture.ts'), storageDir: output, downloadName: 'fixture.ts', downloadNameMp4: 'fixture.mp4',
      skipThumbnailGeneration: true, earlyThumbnailAttempted: true, failedSegments: [] };
    await processor.runJob(clean);
    assert.equal(clean.status, 'error');
    assert.doesNotMatch(clean.error, /ENOENT|rename/);
    assert.match(clean.error, /status 403/);
  });
});
