#!/usr/bin/env node
'use strict';
/*
 * Chrome Web Store images for the SnagThis extension (docs/store/images/).
 *
 *   node scripts/capture-store-assets.cjs
 *
 * Needs the repository dependencies (npm ci), Playwright's Chromium
 * (npx playwright install chromium) and the `unzip` command. Run
 * `npm run build:extension:css` first if apps/extension/popup.css is missing.
 *
 * What it does:
 * 1. Serves apps/extension, site/ and a one-video showcase page from a private
 *    local server (no other server is needed).
 * 2. Captures the real popup in its demo modes (apps/extension/popup/demo.js,
 *    with &build=store so no development badge shows).
 * 3. Builds the store ZIP (scripts/package-extension.cjs), loads it into Chromium,
 *    plays an original clip on the showcase page and saves it through Chrome
 *    Downloads, then captures that real store-build popup.
 * 4. Composes 1280x800 screenshots, the 440x280 small promo tile and the
 *    1400x560 marquee with the site's fonts and brand assets, and checks each
 *    file's exact size and that it is an 8-bit RGB PNG (no alpha).
 *
 * The listing must never show or mention YouTube; the sample data uses
 * videos.example and the original pixel-art clips only.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { packageExtension } = require('./package-extension.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/store/images');
const EXT = path.join(ROOT, 'apps/extension');
const SITE = path.join(ROOT, 'site');
const MEDIA = path.join(EXT, 'popup/media');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.json': 'application/json' };

// A one-video page, so the popup's page-level title names this clip.
const SHOWCASE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Star Courier — night delivery</title>
<meta property="og:title" content="Star Courier — night delivery"></head>
<body style="margin:0;background:#07090c;color:#eee;font-family:sans-serif"><h1>Star Courier — night delivery</h1>
<video controls preload="metadata" src="star-courier.mp4" poster="poster.jpg" width="640" height="360"></video></body></html>`;

let composeHtml = '';

function send(res, status, type, body) { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }
function sendFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'text/plain', 'Not found');
  const size = fs.statSync(file).size; const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}
function inside(base, rest) { const file = path.resolve(base, '.' + decodeURIComponent(rest)); return file.startsWith(base + path.sep) ? file : null; }
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    if (p === '/compose') return send(res, 200, TYPES['.html'], composeHtml);
    if (p === '/show/' || p === '/show/index.html') return send(res, 200, TYPES['.html'], SHOWCASE);
    if (p === '/show/star-courier.mp4') return sendFile(req, res, path.join(MEDIA, 'star-courier.mp4'));
    if (p === '/show/poster.jpg') return sendFile(req, res, path.join(MEDIA, 'star-courier.jpg'));
    for (const [prefix, base] of [['/ext/', EXT], ['/site/', SITE], ['/root/', ROOT]]) {
      if (p.startsWith(prefix)) { const file = inside(base, p.slice(prefix.length - 1)); return file ? sendFile(req, res, file) : send(res, 403, 'text/plain', 'Forbidden'); }
    }
    send(res, 404, 'text/plain', 'Not found');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const dataUrl = (buffer, type = 'image/png') => `data:${type};base64,${buffer.toString('base64')}`;
const fileUrl = file => dataUrl(fs.readFileSync(file), TYPES[path.extname(file)]);

/** Screenshot the popup at its real height: Chrome sizes a popup to its document. */
async function popupShot(page, url, { wait = 1500, before } = {}) {
  await page.setViewportSize({ width: 480, height: 600 });
  if (before) await before(page);
  await page.goto(url); await page.waitForTimeout(wait);
  const height = await page.evaluate(() => {
    const popup = document.querySelector('main.popup').getBoundingClientRect().bottom;
    const menu = document.querySelector('.menu:not([hidden])');
    return Math.ceil(Math.max(popup, menu ? menu.getBoundingClientRect().bottom + 8 : 0));
  });
  await page.setViewportSize({ width: 480, height: Math.min(600, height) });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(2, 2);
  return { png: await page.screenshot(), height: Math.min(600, height) };
}

async function captureDemo(browser, base) {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const demo = mode => `${base}/ext/popup.html?demo=${mode}&build=store`;
  const shots = {
    list: await popupShot(page, demo('default')),
    quality: await popupShot(page, demo('quality')),
    pairing: await popupShot(page, demo('pairing')),
    // The accent choice is mirrored in localStorage for the first paint.
    appearance: await popupShot(page, demo('settings&tab=appearance'), { before: async p => { await p.goto(`${base}/ext/popup.html`); await p.evaluate(() => localStorage.setItem('snagthis.accent', JSON.stringify({ accent: 'violet', changedAt: Date.now() - 1000 }))); } }),
  };
  await page.evaluate(() => localStorage.removeItem('snagthis.accent'));
  await page.close();
  return shots;
}

/** The packaged store build, loaded unpacked, saving a real file through Chrome Downloads. */
async function captureStoreBuild(base, work) {
  const zip = path.join(work, 'snagthis-extension.zip'); const dir = path.join(work, 'extension');
  packageExtension({ output: zip });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
  if (!fs.readFileSync(path.join(dir, 'js/build-config.js'), 'utf8').includes('storeBuild: true')) throw new Error('The ZIP is not the store build');
  const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(work, 'downloads'), deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const source = await context.newPage();
    await source.goto(`${base}/show/`); await source.waitForTimeout(800);
    await source.evaluate(() => { const video = document.querySelector('video'); video.muted = true; return video.play(); });
    await source.waitForTimeout(2500);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, `${base}/show/*`);
    const popup = await context.newPage();
    const url = `chrome-extension://${id}/popup.html?tab=${tabId}`;
    await popup.setViewportSize({ width: 480, height: 600 });
    await popup.goto(url); await popup.waitForTimeout(2500);
    await popup.click('.video-row .action[aria-label="Download"]');
    await popup.waitForFunction(() => /Saved in Chrome/.test(document.body.innerText), null, { timeout: 20000 });
    const downloads = await worker.evaluate(async () => (await chrome.downloads.search({})).map(item => ({ state: item.state, mime: item.mime, bytes: item.totalBytes })));
    if (!downloads.some(item => item.state === 'complete' && item.mime === 'video/mp4')) throw new Error(`Chrome download did not complete: ${JSON.stringify(downloads)}`);
    return await popupShot(popup, url, { wait: 3000 });
  } finally { await context.close(); }
}

const FONTS = base => `@font-face{font-family:"Inter";src:url("${base}/site/fonts/inter-latin.woff2") format("woff2");font-weight:100 900}
@font-face{font-family:"Jersey 15";src:url("${base}/site/fonts/jersey15-latin.woff2") format("woff2")}`;
const BRAND_CSS = `*{box-sizing:border-box;margin:0}html,body{background:#07090c;overflow:hidden}
body{position:relative;font-family:"Inter",sans-serif;color:hsl(20 20% 93%);-webkit-font-smoothing:antialiased}
.dots{position:absolute;inset:0;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='1' height='1' fill='%23ffffff' fill-opacity='.06'/%3E%3C/svg%3E")}
.scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 2px,#ffffff05 2px 3px)}
.glow{position:absolute;border-radius:50%;filter:blur(10px)}
.pixel{font-family:"Jersey 15",monospace;text-transform:uppercase;letter-spacing:.04em}
.wordmark{display:block;image-rendering:pixelated}
.mark{display:block;image-rendering:pixelated}`;

// A browser window with the toolbar icon and the popup anchored under it, like the site's demo.
// accentId picks the toolbar icon the way js/accent-icon.js does: the packaged PNG for orange,
// the shared pixel-button geometry (shared/accents.js) for the other accents.
function screenshotHtml(base, assets, { eyebrow, title, sub, shot, poster, url, badge = '', accentId = 'orange', accent = '#fa5d0e', note = '' }) {
  const scale = 1.3; const w = Math.round(480 * scale); const h = Math.round(shot.height * scale);
  const windowLeft = 540; const popupRight = 1240; const popupLeft = popupRight - w;
  const windowTop = Math.round(Math.max(36, (800 - (48 + 8 + h)) / 2 - 6));
  const iconLeft = popupRight - 40 - windowLeft;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS(base)}${BRAND_CSS}
body{width:1280px;height:800px}
.copy{position:absolute;left:84px;top:0;bottom:0;width:410px;display:flex;flex-direction:column;justify-content:center}
.copy .wordmark{position:absolute;top:64px;left:0;width:180px;height:33px}
.eyebrow{font-size:30px;line-height:1;color:${accent};margin-bottom:16px}
h1{font-size:50px;line-height:1.06;font-weight:640;letter-spacing:-.025em;margin-bottom:22px}
.sub{font-size:21px;line-height:1.5;color:hsl(20 6% 68%)}
.note{position:absolute;left:84px;bottom:56px;font-size:15px;color:hsl(20 5% 55%)}
.window{position:absolute;left:${windowLeft}px;top:${windowTop}px;width:800px;height:900px;border:1px solid hsl(215 15% 18%);border-radius:14px;background:hsl(215 22% 6%);box-shadow:0 30px 80px #000c;overflow:hidden}
.toolbar{height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;background:hsl(215 22% 8%);border-bottom:1px solid hsl(215 14% 13.5%)}
.dot{width:11px;height:11px;border-radius:50%;background:hsl(215 14% 22%)}
.url{margin-left:14px;height:28px;flex:0 0 400px;border-radius:14px;background:hsl(215 22% 4%);display:flex;align-items:center;padding:0 14px;font-size:14px;color:hsl(20 6% 64%)}
.icon{position:absolute;left:${iconLeft}px;top:8px;width:32px;height:32px;border-radius:8px;background:hsl(215 22% 13.5%);display:grid;place-items:center}
.icon img,.icon canvas{width:16px;height:16px;image-rendering:pixelated}
.badge{position:absolute;right:-4px;bottom:-3px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:${accent};color:#fff;font:600 10px/15px "Inter";text-align:center}
.page{position:absolute;left:28px;top:84px;width:560px}
.page img{display:block;width:560px;height:315px;object-fit:cover;border-radius:8px;opacity:.5;image-rendering:pixelated}
.bar{height:12px;border-radius:6px;background:hsl(215 14% 13%);margin-top:18px}
.popup{position:absolute;left:${popupLeft}px;top:${windowTop + 48 + 8}px;width:${w}px;height:${h}px;border-radius:10px;overflow:hidden;border:1px solid hsl(215 15% 22%);box-shadow:0 24px 60px #000e,0 0 0 1px #0006}
.popup img{display:block;width:100%;height:100%}
</style>${accentId === 'orange' ? '' : `<script src="${base}/ext/shared/accents.js"></script>`}</head><body><div class="dots"></div><div class="scan"></div>
<div class="glow" style="left:720px;top:20px;width:700px;height:600px;background:radial-gradient(closest-side,${accent}38,transparent)"></div>
<div class="copy"><img class="wordmark" src="${assets.wordmark}" alt=""><div class="eyebrow pixel">${eyebrow}</div><h1>${title}</h1><p class="sub">${sub}</p></div>
${note ? `<p class="note">${note}</p>` : ''}
<div class="window"><div class="toolbar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">${url}</span>
<span class="icon">${accentId === 'orange' ? `<img src="${assets.icon}" alt="">` : '<canvas width="16" height="16"></canvas>'}${badge ? `<span class="badge">${badge}</span>` : ''}</span></div>
<div class="page"><img src="${poster}" alt=""><div class="bar" style="width:70%"></div><div class="bar" style="width:45%"></div></div></div>
<div class="popup"><img src="${dataUrl(shot.png)}" alt=""></div>
${accentId === 'orange' ? '' : `<script>{const art=SnagThisAccents.buttonIconPixels(${JSON.stringify(accentId)},1);const c=document.querySelector('.icon canvas');c.width=art.width;c.height=art.height;c.getContext('2d').putImageData(new ImageData(art.data,art.width,art.height),0,0);}</script>`}
</body></html>`;
}

// The wordmark SVG ends with its own small play button (x 100-116 of 120). Next to the large
// bevel button, the promo images show only the lettering (x 0-96).
const WORD_TEXT = 97 / 120;

function promoHtml(base, assets) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS(base)}${BRAND_CSS}
body{width:440px;height:280px}
.glow{left:-80px;top:-60px;width:360px;height:360px;background:radial-gradient(closest-side,#fa5d0e40,transparent)}
.mark{position:absolute;left:36px;top:78px;width:124px;height:124px}
.crop{position:absolute;left:182px;top:92px;width:${Math.round(WORD_TEXT * 240)}px;height:44px;overflow:hidden}.crop .wordmark{width:240px;height:44px}
.tag{position:absolute;left:186px;top:146px;width:230px;font-size:19px;line-height:1.3;font-weight:560;color:hsl(20 20% 93%)}
</style></head><body><div class="dots"></div><div class="scan"></div><div class="glow"></div>
<img class="mark" src="${assets.mark}" alt=""><div class="crop"><img class="wordmark" src="${assets.wordmark}" alt=""></div>
<p class="tag">Save the video<br>you’re watching.</p></body></html>`;
}

function marqueeHtml(base, assets, shot) {
  const scale = 1.08; const w = Math.round(480 * scale); const h = Math.round(shot.height * scale);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS(base)}${BRAND_CSS}
body{width:1400px;height:560px}
.glow{left:760px;top:-120px;width:760px;height:760px;background:radial-gradient(closest-side,#fa5d0e33,transparent)}
.mark{position:absolute;left:96px;top:118px;width:96px;height:96px}
.crop{position:absolute;left:218px;top:140px;width:${Math.round(WORD_TEXT * 288)}px;height:53px;overflow:hidden}.crop .wordmark{width:288px;height:53px}
h1{position:absolute;left:96px;top:254px;width:640px;font-size:54px;line-height:1.06;font-weight:640;letter-spacing:-.025em}
h1 span{color:#fa5d0e}
.sub{position:absolute;left:98px;top:392px;width:620px;font-size:20px;line-height:1.5;color:hsl(20 6% 68%)}
.popup{position:absolute;left:${1320 - w}px;top:${(560 - h) / 2}px;width:${w}px;height:${h}px;border-radius:10px;overflow:hidden;border:1px solid hsl(215 15% 22%);box-shadow:0 24px 60px #000e}
.popup img{display:block;width:100%;height:100%}
</style></head><body><div class="dots"></div><div class="scan"></div><div class="glow"></div>
<img class="mark" src="${assets.mark}" alt=""><div class="crop"><img class="wordmark" src="${assets.wordmark}" alt=""></div>
<h1>Save the video<br>you’re <span>watching.</span></h1>
<p class="sub">MP4 and WebM straight to Chrome Downloads. Add the free desktop app for streams and more.</p>
<div class="popup"><img src="${dataUrl(shot.png)}" alt=""></div></body></html>`;
}

/** Store images must be exactly sized, 24-bit, with no alpha channel. */
function checkPng(file, width, height) {
  const data = fs.readFileSync(file);
  if (data.toString('latin1', 12, 16) !== 'IHDR') throw new Error(`${file} is not a PNG`);
  const w = data.readUInt32BE(16); const h = data.readUInt32BE(20); const depth = data[24]; const color = data[25];
  if (w !== width || h !== height || depth !== 8 || color !== 2) throw new Error(`${file}: ${w}x${h}, depth ${depth}, colour type ${color}; expected ${width}x${height} 8-bit RGB`);
  return `${path.relative(ROOT, file)} ${w}x${h} RGB`;
}

async function render(browser, base, html, file, width, height) {
  composeHtml = html;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`${base}/compose`); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
  await page.screenshot({ path: file, type: 'png' });
  await page.close();
  return checkPng(file, width, height);
}

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-store-'));
  const browser = await chromium.launch();
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const assets = {
      wordmark: fileUrl(path.join(SITE, 'img/snagthis-logo-title.svg')),
      mark: fileUrl(path.join(EXT, 'img/snagthis-logo-mark.png')),
      icon: fileUrl(path.join(EXT, 'img/icon-16.png')),
    };
    const poster = name => fileUrl(path.join(MEDIA, `${name}.jpg`));
    const demo = await captureDemo(browser, base);
    const chrome = await captureStoreBuild(base, work);
    const frames = [
      ['1-finds-videos.png', { eyebrow: 'Find', title: 'Finds the videos on the page.', sub: 'Open SnagThis on a page to see each video with its quality, size and length.', shot: demo.list, poster: poster('ember-tide'), url: 'pixelworlds.example/ember-tide', badge: '3' }],
      ['2-saves-to-chrome.png', { eyebrow: 'Save', title: 'Saves MP4 and WebM to Chrome Downloads.', sub: 'One click, no account, no extra app. Chrome handles the download.', shot: chrome, poster: poster('star-courier'), url: 'pixelworlds.example/star-courier', badge: '1', note: 'For videos you own or have permission to save.' }],
      ['3-quality-subtitles.png', { eyebrow: 'Choose', title: 'Pick the quality and subtitles.', sub: 'With the free SnagThis desktop app, when the site offers them.', shot: demo.quality, poster: poster('neon-rain'), url: 'pixelworlds.example/neon-rain', badge: '1' }],
      ['4-pair-desktop.png', { eyebrow: 'Connect', title: 'Pairs with the desktop app in one click.', sub: 'Match the code and choose Allow. The free app adds streams, subtitles and a saved library.', shot: demo.pairing, poster: poster('sky-hop'), url: 'pixelworlds.example/sky-hop' }],
      ['5-your-colour.png', { eyebrow: 'Yours', title: 'Make it your colour.', sub: 'Five accents for buttons, the logo and the toolbar icon.', shot: demo.appearance, poster: poster('neon-rain'), url: 'pixelworlds.example/neon-rain', accentId: 'violet', accent: '#8b5cf6' }],
    ];
    const results = [];
    for (const [name, options] of frames) results.push(await render(browser, base, screenshotHtml(base, assets, options), path.join(OUT, name), 1280, 800));
    results.push(await render(browser, base, promoHtml(base, assets), path.join(OUT, 'promo-small-440x280.png'), 440, 280));
    results.push(await render(browser, base, marqueeHtml(base, assets, demo.list), path.join(OUT, 'promo-marquee-1400x560.png'), 1400, 560));
    console.log(results.join('\n'));
  } finally {
    await browser.close(); server.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
