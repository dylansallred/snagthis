const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { runTool } = require('./fixtures/server');

test('bounded source previews choose later real scenes and prepare small posters before full hover probes', { timeout: 60_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-preview-scenes-'));
  const timers = new Set();
  const requests = [];
  let browser;
  let server;
  try {
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const short = path.join(directory, 'short.mp4');
    const large = path.join(directory, 'large.mp4');
    const tail = path.join(directory, 'tail.mp4');
    await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12',
      '-t', '8', '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,1.5)'", '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', short]);
    await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', short, '-c', 'copy', '-hls_time', '2', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(directory, 'segment-%03d.ts'), path.join(directory, 'short.m3u8')]);
    await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12',
      '-t', '120', '-vf', "drawbox=x=120:y=60:w=80:h=60:color=red:t=fill:enable='lt(t,30)',drawbox=x=120:y=60:w=80:h=60:color=lime:t=fill:enable='gte(t,30)'", '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '1M', '-minrate', '1M', '-maxrate', '1M', '-bufsize', '1M',
      '-x264-params', 'nal-hrd=cbr', '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', large]);
    // A bounded complete file with its MP4 index at the end exercises the
    // small-poster-probe fallback without any full large-video download.
    await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', large, '-t', '25', '-c', 'copy', tail]);
    const media = new Map(await Promise.all((await fs.readdir(directory)).map(async name => [name, await fs.readFile(path.join(directory, name))])));
    assert.ok(media.get('large.mp4').length > 8 * 1024 * 1024);
    assert.ok(media.get('tail.mp4').length > 2 * 1024 * 1024 && media.get('tail.mp4').length < 8 * 1024 * 1024);
    const sourceScript = await fs.readFile(path.join(__dirname, '../apps/extension/popup/source-preview.js'));
    const hlsScript = await fs.readFile(path.join(__dirname, '../apps/extension/vendor/hls.min.js'));
    server = http.createServer((req, res) => {
      const name = req.url.slice(1);
      if (name === 'source-preview.js' || name === 'hls.js') {
        res.setHeader('Content-Type', 'application/javascript'); res.end(name === 'hls.js' ? hlsScript : sourceScript); return;
      }
      const data = media.get(name);
      if (!data) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body><script src="/hls.js"></script><script src="/source-preview.js"></script>'); return; }
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      const entry = { name, start, end, bytes: 0 }; requests.push(entry);
      res.writeHead(range ? 206 : 200, { 'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : name.endsWith('.ts') ? 'video/mp2t' : 'video/mp4',
        'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) });
      let position = start;
      const timer = setInterval(() => {
        const chunk = data.subarray(position, Math.min(position + 65536, end + 1)); position += chunk.length; entry.bytes += chunk.length; res.write(chunk);
        if (position > end) { clearInterval(timer); timers.delete(timer); res.end(); }
      }, 4);
      timers.add(timer); res.on('close', () => { clearInterval(timer); timers.delete(timer); });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const capture = options => page.evaluate(options => new Promise((resolve, reject) => {
      const video = document.createElement('video');
      if (options.posterOnly) { video.className = 'poster-probe'; video.hidden = true; video.tabIndex = -1; video.setAttribute('aria-hidden', 'true'); }
      document.body.append(video);
      const startedAt = performance.now();
      let controller;
      let frame;
      const finish = async () => {
        if (!frame) return;
        const elapsedMs = performance.now() - startedAt;
        const currentTime = video.currentTime;
        controller.destroy(); video.remove();
        const image = new Image(); await new Promise((done, failed) => { image.onload = done; image.onerror = failed; image.src = frame.poster; });
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 18;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 32, 18);
        const useful = VidSnagSourcePreview.nonblack(context.getImageData(0, 0, 32, 18).data);
        const center = [...context.getImageData(16, 9, 1, 1).data].slice(0, 3);
        resolve({ offset: frame.offset, scope: frame.scope, elapsedMs, currentTime, useful, center });
      };
      controller = VidSnagSourcePreview.create({ item: { url: `${location.origin}/${options.file}`, type: options.hls ? 'hls' : 'file', durationSeconds: options.duration || 0 },
        video, posterOnly: options.posterOnly, sceneOffset: options.sceneOffset, sceneScope: options.sceneScope,
        onPoster: (poster, offset, scope) => { frame = { poster, offset, scope }; if (options.posterOnly) finish().catch(reject); },
        onPlaying: () => { if (!options.posterOnly) finish().catch(reject); },
        onError: () => { video.remove(); reject(new Error(`Preview failed for ${options.file}`)); },
      });
    }), options);
    const shortClip = await capture({ file: 'short.mp4', duration: 8, sceneOffset: 0, posterOnly: false });
    assert.ok(shortClip.offset >= 2.7 && shortClip.offset <= 3.2, 'short clips and stale opening offsets still select35%');
    assert.equal(shortClip.useful, true); assert.equal(shortClip.scope, 'source');
    const hls = await capture({ file: 'short.m3u8', hls: true, duration: 0, posterOnly: true });
    assert.ok(hls.offset >= 2.7 && hls.offset <= 3.2, 'unknown-duration HLS selects35% before showing media');
    assert.equal(hls.useful, true);
    assert.equal(requests.some(request => request.name === 'segment-000.ts'), false, 'the opening HLS fragment is never fetched');
    const poster = await capture({ file: 'large.mp4', duration: 120, posterOnly: true });
    assert.equal(poster.scope, 'prefix'); assert.ok(poster.offset > 5, 'a partial prefix chooses later buffered footage instead of zero');
    assert.equal(poster.useful, true);
    assert.ok(poster.offset < 30 ? poster.center[0] > poster.center[1] * 2 : poster.center[1] > poster.center[0] * 2,
      'the decoded poster scene must agree with its source timestamp, not a stale opening frame');
    assert.equal(requests.filter(request => request.name === 'large.mp4').length, 1);
    assert.equal(requests.find(request => request.name === 'large.mp4').bytes, 2 * 1024 * 1024, 'the usable poster probe stops at2MiB');
    const hover = await capture({ file: 'large.mp4', duration: 120, posterOnly: false, sceneOffset: 60, sceneScope: 'prefix' });
    assert.ok(hover.offset >= 41.9 && hover.offset <= 42.5, 'a prefix-scoped offset cannot replace the full-source35% candidate');
    assert.equal(hover.useful, true);
    assert.ok(hover.center[1] > hover.center[0] * 2, 'the hover really decodes the green middle scene, not red opening footage');
    const fallback = await capture({ file: 'tail.mp4', duration: 25, posterOnly: true });
    assert.ok(fallback.offset >= 8.7 && fallback.offset <= 9.2); assert.equal(fallback.scope, 'source');
    assert.equal(requests.filter(request => request.name === 'tail.mp4').length, 2, 'an undecodable2MiB prefix retries within the existing8MiB limit');
    for (const file of ['large.mp4', 'tail.mp4']) assert.ok(requests.filter(request => request.name === file).reduce((sum, request) => sum + request.bytes, 0) <= 16 * 1024 * 1024);
    t.diagnostic(JSON.stringify({ shortClip, hls, poster, hover, fallback, transferBytes: requests.filter(request => request.name.endsWith('.mp4')).map(({ name, bytes }) => ({ name, bytes })) }));
  } finally {
    try { if (browser) await browser.close(); }
    finally {
      for (const timer of timers) clearInterval(timer);
      server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});
