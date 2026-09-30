#!/usr/bin/env node
/*
 * Renders the option storyboards in index.html to PNGs: preview-{a,b,c}.png (1200×800, the key
 * frame) and frames/{a,b,c}-{n}.png (every frame; regenerable, so not committed). Serves the repository over loopback HTTP so
 * the sample media paths resolve.
 *
 *   node docs/design/prototypes/pairing-simple/capture-options.js
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const here = __dirname;
const root = path.resolve(here, '../../../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/docs/design/prototypes/pairing-simple/index.html`;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    const settle = async () => { await page.evaluate(() => document.fonts.ready); await page.waitForLoadState('networkidle'); };
    await page.goto(base); await settle();
    const counts = await page.evaluate(() => window.__frames);
    fs.mkdirSync(path.join(here, 'frames'), { recursive: true });
    for (const id of Object.keys(counts)) {
      await page.goto(`${base}?shot=${id}`); await settle();
      await page.screenshot({ path: path.join(here, `preview-${id}.png`) });
      for (let frame = 0; frame < counts[id]; frame++) {
        await page.goto(`${base}?shot=${id}&frame=${frame}`); await settle();
        await page.screenshot({ path: path.join(here, 'frames', `${id}-${frame + 1}.png`) });
      }
      console.log(id, counts[id], 'frames');
    }
    // A full-page look at the hub, for review only (not kept).
    await page.setViewportSize({ width: 1320, height: 900 });
    await page.goto(base); await settle();
    await page.screenshot({ path: '/tmp/pairing-simple-hub.png', fullPage: true });
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) { console.error(errors); process.exit(1); }
})().catch(error => { console.error(error); process.exit(1); });
