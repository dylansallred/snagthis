#!/usr/bin/env node
// Renders every SnagThis brand asset from the approved pixel lockup
// (docs/design/prototypes/logo-rebrand/round9-pixel-wordmark-idle.html with
// #W=w5&I=i3&B=b4&L=zover&launch=a10): "SNAGTHIS" in Jersey 15, then the
// Pixel bevel play button, one pixel taller than the capitals and centred on them.
//
// The letters are sampled from Jersey 15 onto its own pixel grid, so the
// artwork is pure pixel paths: no font ships with the apps. Needs network access
// for the Jersey 15 and Inter web fonts (generation time only). From the repo root:
//   node scripts/render-brand-assets.cjs
const { chromium } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COL = { o: '#fa5d0e', o2: '#bd3f00', amber: '#ffb238', cream: '#fff4e6', night: '#0c0e11', white: '#ffffff' };

// ── Button: Pixel bevel (b4) on a 16 × 16 grid ──────────────────────────────
const N = 16;
const T1 = [
  '................',
  '................',
  '................',
  '.....##.........',
  '.....###........',
  '.....#####......',
  '.....######.....',
  '.....########...',
  '.....########...',
  '.....######.....',
  '.....#####......',
  '.....###........',
  '.....##.........',
  '................',
  '................',
  '................'];
const key = p => `${p.x},${p.y}`;
function stepMask(n, insets) { // tile with stepped (pixel) corners
  const cells = [];
  for (let y = 0; y < n; y++) { const inset = insets[y] ?? insets[n - 1 - y] ?? 0; for (let x = inset; x < n - inset; x++) cells.push({ x, y }); }
  return cells;
}
function edgeShade(mask) { // top-left edge = light, bottom-right edge = dark
  const set = new Set(mask.map(key)), hi = [], lo = [];
  mask.forEach(p => {
    const up = !set.has(`${p.x},${p.y - 1}`), left = !set.has(`${p.x - 1},${p.y}`), down = !set.has(`${p.x},${p.y + 1}`), right = !set.has(`${p.x + 1},${p.y}`);
    if ((up || left) && !(down || right)) hi.push(p); else if ((down || right) && !(up || left)) lo.push(p);
    else if (up || left || down || right) (p.x + p.y < 15 ? hi : lo).push(p);
  });
  return { hi, lo };
}
function runsPath(cells, dx = 0, dy = 0) { // merge each row's cells into rectangles
  const rows = new Map();
  cells.forEach(p => { if (!rows.has(p.y)) rows.set(p.y, []); rows.get(p.y).push(p.x); });
  let d = '';
  [...rows.entries()].sort((a, b) => a[0] - b[0]).forEach(([y, xs]) => {
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      d += `M${xs[i] + dx} ${y + dy}h${j - i + 1}v1h${-(j - i + 1)}z`;
      i = j + 1;
    }
  });
  return d;
}
const mask = stepMask(N, [3, 1, 1]);
const { hi, lo } = edgeShade(mask);
const glyph = T1.flatMap((row, y) => [...row].map((k, x) => ({ x, y, k })).filter(p => p.k === '#'));
const glyphSet = new Set(glyph.map(key));
const shadow = glyph.map(p => ({ x: p.x + 1, y: p.y + 1 })).filter(p => !glyphSet.has(key(p)));
const BUTTON = { tile: runsPath(mask), hi: runsPath(hi), lo: runsPath(lo), shadow: runsPath(shadow), glyph: runsPath(glyph) };
// Every cell with its final colour, for pixel-exact checks of the 16px icon.
const BUTTON_CELLS = new Map(mask.map(p => [key(p), COL.o]));
hi.forEach(p => BUTTON_CELLS.set(key(p), COL.amber));
lo.forEach(p => BUTTON_CELLS.set(key(p), COL.o2));
shadow.forEach(p => BUTTON_CELLS.set(key(p), COL.o2));
glyph.forEach(p => BUTTON_CELLS.set(key(p), COL.night));

const buttonGroup = (x = 0, y = 0) => `<g transform="translate(${x} ${y})"><path fill="${COL.o}" d="${BUTTON.tile}"/><path fill="${COL.amber}" d="${BUTTON.hi}"/><path fill="${COL.o2}" d="${BUTTON.lo}"/><path fill="${COL.o2}" d="${BUTTON.shadow}"/><path fill="${COL.night}" d="${BUTTON.glyph}"/></g>`;
const buttonSvg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${buttonGroup()}</svg>`;

// ── Lockup geometry, in Jersey 15 pixels ────────────────────────────────────
// Jersey 15 has 15-pixel capitals on a 27-pixel em, so one font pixel is one
// button pixel: capitals 15 tall, button 16 tall, centred (half a pixel of
// overshoot above the capital line and below the baseline).
const WORD = 'SNAGTHIS';
const CAP = 15;
const LETTER_SPACING = 1; // .05em in the prototype, rounded to the grid.
const GAP = 8; // Last capital to button: .26em plus side bearings in the prototype (7.7px).
const HEIGHT = 22; // The header slot; the 16px lockup sits centred in it.
const BUTTON_Y = (HEIGHT - N) / 2;
const CAP_TOP = BUTTON_Y + (N - CAP) / 2;
const CURSOR_WIDTH = 10; // .52em typing block.

function layout(glyphs) {
  let pen = -(glyphs[0].left); // The first capital's ink starts at x = 0.
  const letters = glyphs.map(g => {
    const letter = { char: g.char, pen, left: pen + g.left, right: pen + g.right, cells: g.cells.map(c => ({ x: c.x + pen, y: c.y + CAP_TOP })) };
    pen += g.advance + LETTER_SPACING;
    return letter;
  });
  const buttonX = letters.at(-1).right + GAP;
  const width = buttonX + N;
  return { letters, buttonX, width };
}

function lockupSvg(geo, fg, { height = HEIGHT, top = 0, scale = 1 } = {}) {
  const snag = geo.letters.slice(0, 4).flatMap(l => l.cells), thisPart = geo.letters.slice(4).flatMap(l => l.cells);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.width * scale}" height="${height * scale}" viewBox="0 ${top} ${geo.width} ${height}" shape-rendering="crispEdges">` +
    `<title>SnagThis</title><path fill="${fg}" d="${runsPath(snag)}"/><path fill="${COL.o}" d="${runsPath(thisPart)}"/>${buttonGroup(geo.buttonX, BUTTON_Y)}</svg>`;
}

function moduleSource(geo) {
  const letters = geo.letters.map(l => `    { char: '${l.char}', pen: ${l.pen}, left: ${l.left}, right: ${l.right}, d: '${runsPath(l.cells)}' },`).join('\n');
  return `// Generated by scripts/render-brand-assets.cjs. Do not edit by hand.
// The SnagThis lockup on its pixel grid: Jersey 15 capitals, then the Pixel bevel button.
export const SNAGTHIS_LOGO = {
  width: ${geo.width},
  height: ${HEIGHT},
  capTop: ${CAP_TOP},
  capHeight: ${CAP},
  cursorWidth: ${CURSOR_WIDTH},
  colors: { snag: '${COL.white}', orange: '${COL.o}', deep: '${COL.o2}', amber: '${COL.amber}', night: '${COL.night}' },
  letters: [
${letters}
  ],
  button: {
    x: ${geo.buttonX},
    y: ${BUTTON_Y},
    size: ${N},
    tile: '${BUTTON.tile}',
    hi: '${BUTTON.hi}',
    lo: '${BUTTON.lo}',
    shadow: '${BUTTON.shadow}',
    glyph: '${BUTTON.glyph}',
  },
} as const;
`;
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Jersey+15&family=Inter:wght@400;500;700&display=block';
const blank = `<!doctype html><html><head><link rel="stylesheet" href="${FONTS}"><style>html,body{margin:0;background:transparent}</style></head><body></body></html>`;

// Sample each capital of Jersey 15 onto its pixel grid (8 screen pixels per font pixel).
async function sampleLetters(browser) {
  const tab = await browser.newPage();
  await tab.setContent(blank);
  const glyphs = await tab.evaluate(async ({ word, cap }) => {
    await document.fonts.load("400 27px 'Jersey 15'", word);
    if (!document.fonts.check("400 27px 'Jersey 15'")) throw new Error('Jersey 15 did not load');
    const S = 8, pad = 3, font = `400 ${27 * S}px 'Jersey 15'`;
    return [...word].map(char => {
      const canvas = document.createElement('canvas'), g = canvas.getContext('2d');
      g.font = font;
      const metrics = g.measureText(char), advance = metrics.width / S;
      if (Math.abs(advance - Math.round(advance)) > .01 || Math.abs(metrics.actualBoundingBoxAscent / S - cap) > .01) throw new Error(`Jersey 15 ${char} is off its pixel grid`);
      const cols = Math.round(advance) + pad * 2, rows = cap + pad * 2;
      canvas.width = cols * S; canvas.height = rows * S;
      g.font = font; g.fillStyle = '#000'; g.fillText(char, pad * S, (pad + cap) * S);
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data, cells = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const alpha = data[(((y * S) + S / 2) * canvas.width + x * S + S / 2) * 4 + 3];
        if (alpha > 127) {
          if (y < pad || y >= pad + cap) throw new Error(`Jersey 15 ${char} has ink outside its capitals`);
          cells.push({ x: x - pad, y: y - pad });
        }
      }
      const xs = cells.map(c => c.x);
      return { char, advance: Math.round(advance), left: Math.min(...xs), right: Math.max(...xs) + 1, cells };
    });
  }, { word: WORD, cap: CAP });
  await tab.close();
  return glyphs;
}

async function shoot(browser, html, file, { width, height, scale = 1 }) {
  const tab = await browser.newPage({ deviceScaleFactor: scale, viewport: { width, height } });
  await tab.setContent(`<!doctype html><html><head><link rel="stylesheet" href="${FONTS}"><style>html,body{margin:0;background:transparent}</style></head><body>${html}</body></html>`);
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width, height } });
  await tab.close();
}

// A square icon: the button on whole-pixel cells, centred, with an optional soft shadow.
async function icon(browser, file, size, cell, shadowed = false) {
  const body = cell * N, offset = (size - body) / 2;
  const filter = shadowed ? `filter:drop-shadow(0 ${size / 64}px ${size / 40}px rgba(0,0,0,.35));` : '';
  await shoot(browser, `<div style="position:absolute;left:${offset}px;top:${offset}px;${filter}">${buttonSvg(body)}</div>`, file, { width: size, height: size });
}
// macOS keeps the body at about 824/1024; small sizes stay on whole pixel cells.
const macCell = size => Math.max(1, Math.round(size * 824 / 1024 / N));
// The macOS app icon fills Apple's rounded-square body: macOS 26 shrinks icons of any
// other shape onto a plain light tile. The bevel becomes the tile's edges (amber top
// and left, deep orange bottom and right) around the pixel play button and its shadow.
async function macIcon(browser, file, size) {
  const body = Math.round(size * 824 / 1024), offset = Math.round((size - body) / 2);
  const radius = Math.round(body * 185 / 824), edge = Math.max(1, Math.round(body / N));
  const drop = size > 64 ? `filter:drop-shadow(0 ${size / 100}px ${size / 50}px rgba(0,0,0,.3));` : '';
  const glyph = `<svg xmlns="http://www.w3.org/2000/svg" width="${body}" height="${body}" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" style="position:absolute;inset:0"><path fill="${COL.o2}" d="${BUTTON.shadow}"/><path fill="${COL.night}" d="${BUTTON.glyph}"/></svg>`;
  await shoot(browser, `<div style="position:absolute;left:${offset}px;top:${offset}px;width:${body}px;height:${body}px;border-radius:${radius}px;background:${COL.o};overflow:hidden;${drop}
    box-shadow:inset 0 ${edge}px 0 ${COL.amber},inset ${edge}px 0 0 ${COL.amber},inset 0 -${edge}px 0 ${COL.o2},inset -${edge}px 0 0 ${COL.o2}">${glyph}</div>`, file, { width: size, height: size });
}

// The 16px toolbar icon must be the 16 × 16 grid, one pixel per cell.
async function assertPixelExact(browser, file) {
  const tab = await browser.newPage();
  await tab.setContent(blank);
  const pixels = await tab.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const g = canvas.getContext('2d'); g.drawImage(image, 0, 0);
    return [image.width, image.height, [...g.getImageData(0, 0, image.width, image.height).data]];
  }, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);
  await tab.close();
  const [w, h, data] = pixels;
  if (w !== N || h !== N) throw new Error(`${file} is ${w}×${h}`);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, want = BUTTON_CELLS.get(`${x},${y}`);
    const got = data[i + 3] === 0 ? null : `#${data.slice(i, i + 3).map(v => v.toString(16).padStart(2, '0')).join('')}`;
    if ((want ?? null) !== got || (want && data[i + 3] !== 255)) throw new Error(`${file} pixel ${x},${y} is ${got} (alpha ${data[i + 3]}), expected ${want}`);
  }
}

const banner = geo => `<div style="position:relative;width:1440px;height:400px;box-sizing:border-box;border-radius:24px;border:1px solid #2a2d33;overflow:hidden;
  background:radial-gradient(90% 120% at 100% 100%, rgba(250,93,14,.10), transparent 55%),#0c0e11;color:#fff;font-family:Inter,sans-serif">
  <div style="position:absolute;right:80px;top:42px;font:500 12px Inter;letter-spacing:.2em;color:#9aa1ab">CHROME + DESKTOP</div>
  <div style="position:absolute;left:80px;top:80px;display:flex;align-items:center;gap:12px;font:500 15px Inter;letter-spacing:.16em;color:#c3c8cf"><i style="width:7px;height:7px;border-radius:50%;background:${COL.o}"></i>YOUR VIDEO LIBRARY, SIMPLIFIED</div>
  <div style="position:absolute;left:80px;top:116px">${lockupSvg(geo, COL.white, { scale: 4 })}</div>
  <div style="position:absolute;left:80px;top:224px;font:400 18px Inter;color:#c3c8cf">Find a video. Choose a quality. Make it yours.</div>
  <div style="position:absolute;left:762px;top:115px;width:1px;height:158px;background:#2a2d33"></div>
  <div style="position:absolute;left:817px;top:116px;font:700 30px/44px Inter;letter-spacing:-.01em">From the web<br>to your computer.</div>
  <div style="position:absolute;left:817px;top:215px;font:400 18px/31px Inter;color:#c3c8cf">Save supported videos.<br>Keep everything in view.</div>
  <div style="position:absolute;left:80px;right:80px;top:353px;height:1px;background:linear-gradient(90deg,#3a3d44,#2a2d33 70%,transparent)"></div>
</div>`;

(async () => {
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-brand-'));
  const write = (target, data) => { fs.writeFileSync(path.join(ROOT, target), data); console.log(`wrote ${target}`); };
  const copy = (from, target) => { fs.copyFileSync(from, path.join(ROOT, target)); console.log(`wrote ${target}`); };
  try {
    const geo = layout(await sampleLetters(browser));

    // Header artwork (desktop and extension): white SNAG for the dark UI, 1 unit = 1 CSS pixel.
    const header = lockupSvg(geo, COL.white);
    write('apps/desktop/src/assets/snagthis-logo-title.svg', `${header}\n`);
    write('apps/extension/img/snagthis-logo-title.svg', `${header}\n`);
    // The same geometry for the desktop startup animation, which moves the pieces separately.
    write('apps/desktop/src/components/layout/snagthisLogo.ts', moduleSource(geo));

    // Logo files for other uses: tight crops at 8× (8 image pixels per logo pixel).
    const tight = fg => lockupSvg(geo, fg, { height: N, top: BUTTON_Y, scale: 8 });
    await shoot(browser, tight(COL.white), path.join(ROOT, 'logos/Logo Title-white.png'), { width: geo.width * 8, height: N * 8 });
    await shoot(browser, tight(COL.night), path.join(ROOT, 'logos/Logo Title.png'), { width: geo.width * 8, height: N * 8 });
    console.log(`wrote logos/Logo Title.png and Logo Title-white.png (${geo.width * 8}×${N * 8})`);

    // The mark alone, full bleed, and the app icon with the macOS body and shadow.
    const mark = path.join(tmp, 'mark.png');
    await icon(browser, mark, 1024, 64);
    for (const target of ['apps/desktop/src/assets/snagthis-logo-mark.png', 'apps/extension/img/snagthis-logo-mark.png', 'logos/Just Logo.png']) copy(mark, target);
    const app = path.join(tmp, 'app.png');
    await macIcon(browser, app, 1024);
    for (const target of ['apps/extension/img/snagthis-app-icon.png', 'logos/App Icon.png']) copy(app, target);

    // Chrome: 16px is the grid 1:1; 48px is 3 per cell; 128px keeps the recommended 16px padding (96px body).
    await icon(browser, path.join(ROOT, 'apps/extension/img/icon-16.png'), 16, 1);
    await assertPixelExact(browser, path.join(ROOT, 'apps/extension/img/icon-16.png'));
    await icon(browser, path.join(ROOT, 'apps/extension/img/icon-48.png'), 48, 3);
    await icon(browser, path.join(ROOT, 'apps/extension/img/icon-128.png'), 128, 6);
    console.log('wrote apps/extension/img/icon-16.png (pixel-exact), icon-48.png, icon-128.png');

    // Desktop build icons.
    await macIcon(browser, path.join(ROOT, 'apps/desktop/build/icon.png'), 256);
    const iconset = path.join(tmp, 'icon.iconset');
    fs.mkdirSync(iconset);
    for (const px of [16, 32, 128, 256, 512]) {
      await macIcon(browser, path.join(iconset, `icon_${px}x${px}.png`), px);
      await macIcon(browser, path.join(iconset, `icon_${px}x${px}@2x.png`), px * 2);
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(ROOT, 'apps/desktop/build/icon.icns')]);
    console.log('wrote apps/desktop/build/icon.png and icon.icns');

    // README banner.
    await shoot(browser, banner(geo), path.join(ROOT, 'docs/images/header.png'), { width: 1440, height: 400 });
    console.log(`wrote docs/images/header.png; lockup ${geo.width}×${N} (header slot ${geo.width}×${HEIGHT})`);
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
