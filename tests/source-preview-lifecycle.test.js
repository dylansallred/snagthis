const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { runTool } = require('./fixtures/server');

test('source previews cancel failed response bodies and capture cover-cropped real video posters', { timeout: 30_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-source-preview-'));
  let browser;
  let server;
  let failureTimer;
  let failureBytes = 0;
  const failureBodySize = 2 * 1024 * 1024;
  let reportFailureClosed;
  const failureClosed = new Promise(resolve => { reportFailureClosed = resolve; });
  try {
    const mediaPath = path.join(directory, 'wide-source.mp4');
    await runTool(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x270:rate=12',
      '-t', '2', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath,
    ], { timeout: 8_000 });
    const media = await fs.readFile(mediaPath);
    const sourcePreview = await fs.readFile(path.join(__dirname, '../apps/extension/popup/source-preview.js'));
    server = http.createServer((req, res) => {
      if (req.url === '/source-preview.js') {
        res.setHeader('Content-Type', 'application/javascript'); res.end(sourcePreview); return;
      }
      if (req.url === '/wide.mp4') {
        res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Content-Length', media.length); res.end(media); return;
      }
      if (req.url === '/error.mp4') {
        res.writeHead(503, { 'Content-Type': 'video/mp4', 'Content-Length': failureBodySize });
        res.flushHeaders();
        failureTimer = setInterval(() => {
          const chunk = Buffer.alloc(16 * 1024); failureBytes += chunk.length; res.write(chunk);
          if (failureBytes >= failureBodySize) { clearInterval(failureTimer); res.end(); }
        }, 5);
        res.once('close', () => {
          clearInterval(failureTimer);
          reportFailureClosed({ bytes: failureBytes, finished: res.writableFinished });
        });
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><body><script src="/source-preview.js"></script></body></html>');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, timeout: 10_000 });
    const page = await browser.newPage();
    await page.goto(origin);
    await page.evaluate(() => new Promise(resolve => {
      const video = document.createElement('video'); document.body.append(video);
      VidSnagSourcePreview.create({ item: { url: `${location.origin}/error.mp4`, type: 'file' }, video, onError: resolve });
    }));
    // Browser onError and the server observing TCP cancellation run in separate
    // processes. Measure the actual closed response, not chunks written during
    // an assumed scheduling interval between those two events.
    let closeDeadline;
    let closedResponse;
    try {
      closedResponse = await Promise.race([failureClosed, new Promise((_resolve, reject) => {
        closeDeadline = setTimeout(() => reject(new Error('The failed preview left its HTTP error response open')), 2500);
      })]);
    } finally { clearTimeout(closeDeadline); }
    assert.equal(closedResponse.finished, false, 'cancellation must close the response before its body finishes normally');
    assert.ok(closedResponse.bytes < failureBodySize, 'the failed preview must stop transfer before downloading the complete error body');

    const aspect = await page.evaluate(async () => {
      const video = document.createElement('video'); document.body.append(video);
      const captured = await new Promise((resolve, reject) => VidSnagSourcePreview.create({
        item: { url: `${location.origin}/wide.mp4`, type: 'file', durationSeconds: 2 }, video, posterOnly: true,
        onPoster: (poster, offset) => resolve({ poster, offset }), onError: () => reject(new Error('Fixture did not produce a poster')),
      }));
      const source = document.createElement('video'); source.muted = true; document.body.append(source);
      try {
        await new Promise((resolve, reject) => { source.onloadeddata = resolve; source.onerror = reject; source.src = `${location.origin}/wide.mp4`; });
        await new Promise(resolve => { source.onseeked = resolve; source.currentTime = captured.offset; });
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const image = new Image(); await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = captured.poster; });
        context.drawImage(image, 0, 0); const actual = context.getImageData(0, 0, 320, 180).data;
        context.drawImage(source, 0, 0, 320, 180); const stretched = context.getImageData(0, 0, 320, 180).data;
        const cropWidth = source.videoHeight * 16 / 9;
        context.drawImage(source, (source.videoWidth - cropWidth) / 2, 0, cropWidth, source.videoHeight, 0, 0, 320, 180);
        const covered = context.getImageData(0, 0, 320, 180).data;
        const meanAbsoluteError = expected => {
          let sum = 0;
          for (let index = 0; index < actual.length; index += 4) {
            for (let channel = 0; channel < 3; channel++) sum += Math.abs(actual[index + channel] - expected[index + channel]);
          }
          return sum / (320 * 180 * 3);
        };
        return { sourceWidth: source.videoWidth, sourceHeight: source.videoHeight, posterWidth: image.naturalWidth, posterHeight: image.naturalHeight,
          errorAgainstStretch: meanAbsoluteError(stretched), errorAgainstCover: meanAbsoluteError(covered) };
      } finally {
        source.pause(); source.removeAttribute('src'); source.load(); source.remove(); video.remove();
      }
    });
    assert.deepEqual([aspect.sourceWidth, aspect.sourceHeight], [640, 270]);
    assert.deepEqual([aspect.posterWidth, aspect.posterHeight], [320, 180]);
    assert.ok(aspect.errorAgainstCover < aspect.errorAgainstStretch / 2,
      `decoded poster matches cover cropping (${aspect.errorAgainstCover.toFixed(2)} error), not stretching (${aspect.errorAgainstStretch.toFixed(2)} error)`);
  } finally {
    try { if (browser) await browser.close(); }
    finally {
      clearInterval(failureTimer);
      server?.closeAllConnections();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});
