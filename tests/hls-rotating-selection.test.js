const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { runTool } = require('./fixtures/server');
const { downloadMedia } = require('./fixtures/engine');
const { resolveHlsSelection } = require('../packages/downloader-engine/src/core/MediaSelection');

process.env.LOG_LEVEL = 'error';
process.env.DISABLE_FILE_LOGS = '1';

test('rotating HLS URLs retain the selected quality through nested masters and save real media', { timeout: 90_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-rotating-selection-'));
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const media = path.join(directory, 'media');
  fs.mkdirSync(media);
  await runTool(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '12', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-hls_time', '1', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', 'segment-%02d.ts', 'index.m3u8'], { cwd: media });

  let generation = 0;
  let deniedRequests = 0;
  const requestedMedia = [];
  const headers = { Authorization: 'Bearer fixture-media-session' };
  const master = (...urls) => '#EXTM3U\n' + urls.map(url => `#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n${url}\n`).join('');
  server = http.createServer((request, response) => {
    if (request.headers.authorization !== headers.Authorization) {
      deniedRequests += 1;
      response.writeHead(401); response.end('Fixture authentication required'); return;
    }
    const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
    const playlist = body => { response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); response.end(body); };
    if (pathname === '/master.m3u8') { playlist(master(`/fresh/${++generation}/nested.m3u8`)); return; }
    if (/^\/fresh\/\d+\/nested\.m3u8$/.test(pathname)) { playlist(master('/media/index.m3u8')); return; }
    if (pathname === '/ambiguous.m3u8') { playlist(master('/media/index.m3u8', '/other/index.m3u8')); return; }
    if (pathname === '/media/index.m3u8' || /^\/media\/segment-\d+\.ts$/.test(pathname)) {
      const file = path.join(media, path.basename(pathname));
      if (fs.existsSync(file)) {
        requestedMedia.push(pathname);
        const body = fs.readFileSync(file);
        response.writeHead(200, { 'Content-Type': pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Content-Length': body.length });
        response.end(body); return;
      }
    }
    response.writeHead(404); response.end('Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/master.m3u8`;
  // Capture the browser's first child URL, then let the downloader fetch a
  // fresh master which contains a newly issued URL for that same resolution.
  const firstMaster = await (await fetch(url, { headers })).text();
  const capturedChild = new URL(firstMaster.trim().split('\n').at(-1), base).href;
  const result = await downloadMedia({ url, directory: path.join(directory, 'output'), headers,
    selection: { variantUrl: capturedChild, height: 360, subtitleLang: 'none' }, skipEarlyThumbnail: true });
  assert.ok(generation >= 2, 'the source must issue a new child URL before downloading');
  assert.match(result.metadata.format, /mp4/);
  assert.equal(result.metadata.height, 360, 'the saved video must match the selected resolution');
  assert.equal(result.metadata.hasAudio, true, 'real audio must survive nested selection');
  assert.ok(Math.abs(result.metadata.durationSeconds - 6) <= 1, `saved duration was ${result.metadata.durationSeconds}`);
  assert.ok(requestedMedia.some(value => value.endsWith('.ts')), 'the test must transfer real media');

  for (const [source, selection] of [
    [url, { variantUrl: capturedChild, height: 720 }],
    [url, { variantUrl: capturedChild }],
    [`${base}/ambiguous.m3u8`, { variantUrl: capturedChild, height: 360 }],
  ]) {
    await assert.rejects(resolveHlsSelection({ url: source, headers, selection }), { code: 'SELECTION_UNAVAILABLE' });
  }
  const exact = await resolveHlsSelection({ url: `${base}/ambiguous.m3u8`, headers,
    selection: { variantUrl: `${base}/media/index.m3u8`, height: 360 } });
  assert.equal(exact.selectedHeight, 360, 'an exact URL remains authoritative when two renditions share a height');
  await assert.rejects(resolveHlsSelection({ url, selection: { variantUrl: capturedChild, height: 360 } }), /401/);
  assert.equal(deniedRequests, 1, 'selection recovery must not bypass media authentication');
});
