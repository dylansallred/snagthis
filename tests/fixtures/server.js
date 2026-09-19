const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

function runTool(executable, args, { timeout = 90_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-24_000); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(executable)} exited ${code}: ${stderr}`));
    });
  });
}

async function generateMedia(directory, ffmpegPath) {
  const ffmpeg = (...args) => runTool(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  const media = path.join(directory, 'media');
  for (const folder of ['ts', 'fmp4', 'aes', 'audio', 'subtitles', '480', '720', '1080']) {
    fs.mkdirSync(path.join(media, folder), { recursive: true });
  }
  const direct = path.join(media, 'direct.mp4');
  // One original; all representations below come from these same ten seconds.
  await ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '10', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '12', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', direct);
  await ffmpeg('-i', direct, '-frames:v', '1', '-vf', 'scale=224:126', path.join(media, 'poster.jpg'));
  await ffmpeg('-i', direct, '-t', '6', '-c', 'copy', '-movflags', '+faststart', path.join(media, 'second.mp4'));
  for (const type of ['ts', 'fmp4']) {
    const renditionDirectory = path.join(media, type);
    const args = ['-i', direct, '-c', 'copy', '-hls_time', '1', '-hls_playlist_type', 'vod'];
    if (type === 'fmp4') args.push('-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4');
    // Keep filesystem path separators out of generated HLS URIs. In particular,
    // the relative fMP4 init file must be written beside the playlist on Windows.
    args.push('-hls_segment_filename', type === 'ts' ? 'segment-%02d.ts' : 'segment-%02d.m4s', 'index.m3u8');
    await runTool(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: renditionDirectory });
    if (type === 'fmp4' && !fs.existsSync(path.join(renditionDirectory, 'init.mp4'))) {
      throw new Error('FFmpeg did not generate the fMP4 fixture init file beside its playlist');
    }
  }
  for (const height of [480, 720, 1080]) {
    await ffmpeg('-i', direct, '-an', '-vf', `scale=-2:${height}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '12',
      '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(media, String(height), 'segment-%02d.ts'), path.join(media, String(height), 'index.m3u8'));
  }
  await ffmpeg('-i', direct, '-vn', '-c:a', 'copy', '-hls_time', '1', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', path.join(media, 'audio', 'segment-%02d.ts'), path.join(media, 'audio', 'index.m3u8'));
  fs.writeFileSync(path.join(media, 'subtitles', 'english.vtt'), 'WEBVTT\n\n00:00.000 --> 00:05.000\nVidSnag fixture: first half\n\n00:05.000 --> 00:10.000\nVidSnag fixture: second half\n');
  fs.writeFileSync(path.join(media, 'subtitles', 'index.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10,\nenglish.vtt\n#EXT-X-ENDLIST\n');
  const master = ['#EXTM3U', '#EXT-X-VERSION:3',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/index.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles/index.m3u8"'];
  for (const [height, width, bandwidth] of [[1080, 1920, 4_000_000], [720, 1280, 2_000_000], [480, 854, 900_000]]) {
    master.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height},AUDIO="audio",SUBTITLES="subs"`, `${height}/index.m3u8`);
  }
  fs.writeFileSync(path.join(media, 'master.m3u8'), master.join('\n') + '\n');
  fs.writeFileSync(path.join(media, 'aes', 'key.bin'), Buffer.from('0123456789abcdef'));
  const keyInfo = path.join(media, 'aes', 'key-info.txt');
  fs.writeFileSync(keyInfo, `key.bin\n${path.join(media, 'aes', 'key.bin')}\n`);
  await ffmpeg('-i', direct, '-c', 'copy', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_key_info_file', keyInfo,
    '-hls_segment_filename', path.join(media, 'aes', 'segment-%02d.ts'), path.join(media, 'aes', 'index.m3u8'));
}

const TYPES = { '.mp4': 'video/mp4', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.m3u8': 'application/vnd.apple.mpegurl', '.aac': 'audio/aac', '.vtt': 'text/vtt', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.html': 'text/html', '.bin': 'application/octet-stream' };

async function startFixtureServer({ ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-fixtures-'));
  try { await generateMedia(directory, ffmpegPath); } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  const attempts = new Map();
  const requests = [];
  let expiresAt = Infinity;
  let baseUrl = '';
  let crossOriginUrl = '';
  const startedAt = Date.now();
  const ts = fs.readFileSync(path.join(directory, 'media/ts/index.m3u8'), 'utf8');
  const segments = ts.split('\n').filter((line) => line && !line.startsWith('#'));
  const headers = () => ({ Referer: `${baseUrl}/pages/direct.html`, Origin: baseUrl, Cookie: 'fixture=allowed' });

  const handler = (req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    const pathname = decodeURIComponent(url.pathname);
    requests.push({ pathname, at: Date.now(), range: req.headers.range || null });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const respond = (status, body, contentType = 'text/plain') => {
      res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (pathname === '/redirect.m3u8') { res.writeHead(302, { Location: '/media/ts/index.m3u8' }); res.end(); return; }
    if (pathname === '/vendor/hls.min.js') {
      respond(200, fs.readFileSync(path.resolve(__dirname, '../..', 'apps/extension/vendor/hls.min.js')), 'text/javascript'); return;
    }
    if (pathname.startsWith('/pages/')) {
      const file = path.resolve(__dirname, 'pages', pathname.slice('/pages/'.length));
      if (!file.startsWith(path.join(__dirname, 'pages') + path.sep) || !fs.existsSync(file)) { respond(404, 'Not found'); return; }
      const html = fs.readFileSync(file, 'utf8').replaceAll('{{BASE}}', baseUrl).replaceAll('{{OTHER}}', crossOriginUrl);
      respond(200, html, TYPES[path.extname(file)] || 'text/html'); return;
    }
    let filePath;
    let throttle = false;
    let ranges = true;
    let junk = false;
    let contentTypeOverride;
    if (pathname.startsWith('/cases/')) {
      const [, , scenario, name] = pathname.split('/');
      if (['native-retry', 'native-missing', 'native-expired'].includes(scenario)) {
        if (name === 'index.m3u8') {
          respond(200, fs.readFileSync(path.join(directory, 'media/fmp4/index.m3u8')), 'application/vnd.apple.mpegurl'); return;
        }
        if (name === 'segment-00.m4s') {
          const count = (attempts.get(pathname) || 0) + 1;
          attempts.set(pathname, count);
          if (scenario === 'native-expired') { respond(403, 'Fixture session expired'); return; }
          if (scenario === 'native-missing') { respond(404, 'Fixture piece is unavailable'); return; }
          if (count === 1) { respond(503, 'First piece fails once'); return; }
        }
        filePath = path.join(directory, 'media/fmp4', name || 'missing');
      } else if (scenario === 'misnamed-fmp4') {
        // Real HLS bytes behind image filenames/MIME types, including the init
        // and fMP4 fragments. No site URLs or downloaded source media are used.
        if (name === 'master.jpg') {
          respond(200, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080\nvariant.jpg\n', 'image/jpeg'); return;
        }
        if (name === 'variant.jpg') {
          const playlist = fs.readFileSync(path.join(directory, 'media/fmp4/index.m3u8'), 'utf8')
            .replaceAll('init.mp4', 'init.jpg').replace(/segment-(\d+)\.m4s/g, 'segment-$1.jpg');
          respond(200, playlist, 'image/jpeg'); return;
        }
        const originalName = name === 'init.jpg' ? 'init.mp4'
          : /^segment-\d+\.jpg$/.test(name || '') ? name.replace(/\.jpg$/, '.m4s') : 'missing';
        filePath = path.join(directory, 'media/fmp4', originalName);
        contentTypeOverride = 'image/jpeg';
      } else {
      if (scenario === 'gated') {
        const expected = headers();
        if (req.headers.referer !== expected.Referer || req.headers.origin !== expected.Origin || !String(req.headers.cookie || '').includes('fixture=allowed')) {
          respond(403, 'Fixture requires Referer, Origin and media-host cookie'); return;
        }
      }
      if (scenario === 'expired' && Date.now() >= expiresAt) { respond(403, 'Fixture link expired'); return; }
      if (name === 'index.m3u8' || name === 'manifest') {
        let playlist = ts;
        if (scenario === 'disguised' || scenario === 'junk') {
          segments.forEach((segment, index) => { playlist = playlist.replace(segment, `piece-${index}${['.jpg', '.png', ''][index % 3]}`); });
        }
        if (scenario === 'live') {
          playlist = playlist.replace('#EXT-X-ENDLIST', '').replace('#EXT-X-PLAYLIST-TYPE:VOD\n', '').replace('#EXT-X-MEDIA-SEQUENCE:0', `#EXT-X-MEDIA-SEQUENCE:${Math.floor((Date.now() - startedAt) / 1000)}`);
        }
        if (scenario === 'drm') playlist = playlist.replace('#EXTM3U', '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain,fixture",KEYFORMAT="com.widevine"');
        respond(200, playlist, 'application/vnd.apple.mpegurl'); return;
      }
      let segmentName = name;
      if (scenario === 'disguised' || scenario === 'junk') {
        const index = Number(name?.match(/^piece-(\d+)/)?.[1]);
        segmentName = segments[index];
        junk = scenario === 'junk';
      }
      const segmentIndex = segments.indexOf(segmentName);
      if (scenario === 'retry' && segmentIndex % 7 === 6) {
        const count = (attempts.get(pathname) || 0) + 1;
        attempts.set(pathname, count);
        if (count <= 2) { respond(503, 'Temporary fixture failure'); return; }
      }
      if (scenario === 'broken' && segmentIndex === 4) { respond(404, 'Permanent fixture failure'); return; }
      throttle = scenario === 'throttled';
      ranges = scenario !== 'no-range';
      filePath = name === 'direct.mp4' ? path.join(directory, 'media/direct.mp4') : path.join(directory, 'media/ts', segmentName || 'missing');
      }
    } else {
      filePath = path.resolve(directory, '.' + pathname);
    }
    if (!filePath.startsWith(directory + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { respond(404, 'Not found'); return; }
    let body = fs.readFileSync(filePath);
    if (junk) body = Buffer.concat([Buffer.from('<html>fixture-prefix</html>\n'), body]);
    let status = 200;
    let start = 0;
    let end = body.length - 1;
    if (ranges) {
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), end) : end;
        if (start > end) { res.setHeader('Content-Range', `bytes */${body.length}`); respond(416, 'Range not satisfiable'); return; }
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
      }
    }
    body = body.subarray(start, end + 1);
    res.writeHead(status, { 'Content-Type': contentTypeOverride || TYPES[path.extname(filePath)] || 'application/octet-stream', 'Content-Length': body.length });
    if (req.method === 'HEAD') { res.end(); return; }
    if (!throttle) { res.end(body); return; }
    let offset = 0;
    const timer = setInterval(() => {
      const chunk = body.subarray(offset, offset + 10_240);
      offset += chunk.length;
      res.write(chunk);
      if (offset >= body.length) { clearInterval(timer); res.end(); }
    }, 50);
    res.once('close', () => clearInterval(timer));
  };
  const server = http.createServer(handler);
  const otherServer = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => otherServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  crossOriginUrl = `http://127.0.0.1:${otherServer.address().port}`;
  return {
    baseUrl, crossOriginUrl, directory, headers: headers(), requests, attempts,
    expireAfter: (milliseconds) => { expiresAt = Date.now() + milliseconds; },
    close: async () => {
      await Promise.all([server, otherServer].map((instance) => new Promise((resolve) => { instance.closeAllConnections(); instance.close(resolve); })));
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

module.exports = { startFixtureServer, generateMedia, runTool };

if (require.main === module) {
  startFixtureServer().then((fixture) => {
    console.log(`Fixture pages: ${fixture.baseUrl}/pages/direct.html`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => fixture.close().then(() => process.exit(0)));
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
