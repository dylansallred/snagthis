#!/usr/bin/env node
/*
 * Regenerates the README screenshots and animations in docs/images from the development demos.
 * Every image shows the real desktop renderer or extension popup with their built-in sample data
 * (original pixel-art sample clips, fictional download states). No live sites, accounts or pairing secrets.
 *
 * 1. Use the Node version in .nvmrc and run `npm ci` (Playwright's Chromium: `npx playwright install chromium`).
 * 2. Start both demos in separate terminals from the repository root:
 *      cd apps/desktop && npx vite --port 5173 --strictPort     # desktop renderer, opened at /?gallery
 *      npx http-server apps/extension -p 5174 -s                # extension popup, opened at /popup.html?demo
 * 3. From the repository root:
 *      node scripts/capture-readme-media.cjs                    # everything
 *      node scripts/capture-readme-media.cjs hero picker        # only the named outputs (see JOBS below)
 *
 * Needs ffmpeg on PATH (or FFMPEG_PATH) to shrink PNGs and assemble the GIFs.
 * DESKTOP_URL / POPUP_URL override the demo addresses. header.png is separate: scripts/render-brand-assets.cjs.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/images');
const DESKTOP = process.env.DESKTOP_URL || 'http://localhost:5173/';
const POPUP = process.env.POPUP_URL || 'http://localhost:5174/popup.html';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-readme-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const desktopUrl = (query) => `${DESKTOP}?${query}`;
const popupUrl = (query) => `${POPUP}?${query}`;

/* ---------- browser helpers ---------- */

async function context(browser, width, height, scale = 2) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: 'dark' });
  // Skip the first-launch logo animation; later launches settle straight into the header.
  await ctx.addInitScript(() => { try { localStorage.setItem('snagthis.startupSeen', '1'); } catch { /* ignore */ } });
  return ctx;
}

async function openDesktop(browser, query, { width = 1040, height = 700, scale = 2, settle = 1800 } = {}) {
  const ctx = await context(browser, width, height, scale);
  const page = await ctx.newPage();
  await page.goto(desktopUrl(query));
  await page.locator('.workbench').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await sleep(settle);
  await page.mouse.move(width / 2, 1); // Park the pointer on the title bar, away from rows.
  return page;
}

/** Opens the popup and sizes the viewport to the popup itself (Chrome sizes the real popup to its content). */
async function openPopup(browser, query, { scale = 2, settle = 1400, extraHeight = 0 } = {}) {
  const ctx = await context(browser, 480, 700, scale);
  const page = await ctx.newPage();
  await page.goto(popupUrl(query));
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.video-row').first().waitFor();
  await sleep(settle);
  const height = Math.ceil(await page.locator('#popup').evaluate((node) => node.getBoundingClientRect().height)) + extraHeight;
  await page.setViewportSize({ width: 480, height });
  await sleep(200);
  return page;
}

async function visibleImages(page) {
  await page.waitForFunction(() => [...document.images].filter((img) => img.getBoundingClientRect().height > 0).every((img) => img.complete && img.naturalWidth > 0));
}

/* ---------- output helpers ---------- */

/** Writes a PNG, palettising it with ffmpeg when that is meaningfully smaller. */
function savePng(buffer, name) {
  const target = path.join(OUT, name);
  const raw = path.join(TMP, `raw-${name}`);
  const pal = path.join(TMP, `pal-${name}`);
  fs.writeFileSync(raw, buffer);
  try {
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', raw, '-vf', 'split[a][b];[a]palettegen=max_colors=256:reserve_transparent=1[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=128', '-pix_fmt', 'pal8', pal]);
  } catch { /* ffmpeg missing: keep the full-colour file. */ }
  const best = fs.existsSync(pal) && fs.statSync(pal).size < fs.statSync(raw).size * 0.8 ? pal : raw;
  fs.copyFileSync(best, target);
  console.log(`wrote docs/images/${name} (${Math.round(fs.statSync(target).size / 1024)} KB${best === pal ? ', palettised' : ''})`);
}

const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

/**
 * Presents screenshots on a dark backdrop with a faint accent glow, rounded window corners and a soft shadow.
 * `layers`: [{ image, width (CSS px), left, top, radius }]. Transparent outside the rounded canvas.
 */
async function compose(browser, { width, height, layers, radius = 18 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <div style="position:relative;width:${width}px;height:${height}px;border-radius:${radius}px;overflow:hidden;
      background:radial-gradient(90% 70% at 12% 0%, rgba(250,93,15,.20), transparent 60%),
                 radial-gradient(70% 60% at 100% 100%, rgba(250,93,15,.12), transparent 60%),
                 linear-gradient(160deg,#16181d,#0b0c0f)">
      ${layers.map((layer) => `<img src="${dataUrl(layer.image)}" style="position:absolute;left:${layer.left}px;top:${layer.top}px;width:${layer.width}px;
        border-radius:${layer.radius ?? 12}px;box-shadow:0 0 0 1px rgba(255,255,255,.09),0 24px 60px rgba(0,0,0,.55),0 6px 18px rgba(0,0,0,.4)">`).join('')}
    </div></body></html>`;
  await page.setContent(html);
  await visibleImages(page);
  const buffer = await page.screenshot({ omitBackground: true });
  await ctx.close();
  return buffer;
}

/** A feature tile: one screenshot centred on the standard backdrop, scaled to fit. */
async function tile(browser, image, cssWidth, cssHeight) {
  const W = 720; const H = 480; const PAD = 44;
  const scale = Math.min(1, (W - PAD * 2) / cssWidth, (H - PAD * 2) / cssHeight);
  const width = Math.round(cssWidth * scale); const height = Math.round(cssHeight * scale);
  return compose(browser, { width: W, height: H, layers: [{ image, width, left: Math.round((W - width) / 2), top: Math.round((H - height) / 2) }] });
}

/** Screenshots an element's box (optionally padded) in CSS px, returning the buffer and size. */
async function crop(page, box, pad = 0) {
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
  return { image: await page.screenshot({ clip }), width: clip.width, height: clip.height };
}

/* ---------- animation helpers ---------- */

/** Screenshots `page` continuously while `script` runs; returns timestamped frames. */
async function record(page, script) {
  const frames = []; let running = true;
  const loop = (async () => {
    while (running) { const t = Date.now(); frames.push({ t, image: await page.screenshot() }); }
  })();
  try { await script(); } finally { running = false; await loop; }
  return frames;
}

/** Assembles frames (using their real timing) into a looping GIF with a shared palette. */
function saveGif(frames, name, { fps = 12, width }) {
  const dir = fs.mkdtempSync(path.join(TMP, 'frames-'));
  const lines = ['ffconcat version 1.0'];
  frames.forEach((frame, index) => {
    const file = path.join(dir, `f${String(index).padStart(4, '0')}.png`);
    fs.writeFileSync(file, frame.image);
    const next = frames[index + 1]?.t ?? frame.t + 1000; // Hold the last frame for a second before looping.
    lines.push(`file '${file}'`, `duration ${((next - frame.t) / 1000).toFixed(3)}`);
  });
  lines.push(`file '${path.join(dir, `f${String(frames.length - 1).padStart(4, '0')}.png`)}'`);
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, lines.join('\n'));
  const target = path.join(OUT, name);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf',
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    '-loop', '0', target]);
  console.log(`wrote docs/images/${name} (${Math.round(fs.statSync(target).size / 1024)} KB, ${frames.length} captured frames)`);
}

/* ---------- outputs ---------- */

const JOBS = {
  /** Plain desktop window (also used by docs/design/ui-design-spec.md). */
  async desktop(browser) {
    const page = await openDesktop(browser, 'gallery');
    await visibleImages(page);
    savePng(await page.screenshot(), 'desktop.png');
    await page.context().close();
  },

  /** Plain popup (also used by docs/design/ui-design-spec.md). */
  async popup(browser) {
    const page = await openPopup(browser, 'demo');
    savePng(await page.screenshot(), 'chrome-extension.png');
    await page.context().close();
  },

  /** Desktop window with the Chrome popup in front of it. */
  async hero(browser) {
    const desktop = await openDesktop(browser, 'gallery');
    await visibleImages(desktop);
    const window = await desktop.screenshot();
    await desktop.context().close();
    const popup = await openPopup(browser, 'demo');
    const popupSize = popup.viewportSize();
    const panel = await popup.screenshot();
    await popup.context().close();
    const W = 1280; const H = 830;
    savePng(await compose(browser, { width: W, height: H, layers: [
      { image: window, width: 1040, left: 56, top: 56 },
      { image: panel, width: popupSize.width, left: W - popupSize.width - 40, top: H - Math.round(popupSize.height) - 40 },
    ] }), 'hero.png');
  },

  /** Desktop quality picker with the Spanish sample playing. */
  async picker(browser) {
    const page = await openDesktop(browser, 'gallery&picker');
    await page.getByText('Spanish', { exact: true }).hover();
    await sleep(2600);
    const box = await page.locator('.quality-picker').boundingBox();
    const shot = await crop(page, box, 1);
    savePng(await tile(browser, shot.image, shot.width, shot.height), 'feature-picker.png');
    await page.context().close();
  },

  /** Popup pairing: the four digits to match in the desktop app. */
  async pairing(browser) {
    const ctx = await context(browser, 480, 440);
    const page = await ctx.newPage();
    await page.goto(popupUrl('demo=pairing&build=store'));
    await page.getByText('Waiting for Allow').waitFor();
    await sleep(1500);
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(470, 430);
    await sleep(300);
    savePng(await tile(browser, await page.screenshot(), 480, 440), 'feature-pairing.png');
    await ctx.close();
  },

  /** Saved shelf after three sample downloads finish. */
  async shelf(browser) {
    const page = await openDesktop(browser, 'gallery&snag=3', { width: 900, height: 340, settle: 4200 });
    await page.getByRole('button', { name: 'Saved', exact: true }).or(page.getByRole('tab', { name: 'Saved', exact: true })).first().click();
    await sleep(600);
    await page.getByRole('button', { name: /shelf/i }).first().click();
    await sleep(1200);
    await page.mouse.move(450, 1);
    await visibleImages(page);
    savePng(await tile(browser, await page.screenshot(), 900, 340), 'feature-shelf.png');
    await page.context().close();
  },

  /** ⌘K command palette. */
  async palette(browser) {
    const page = await openDesktop(browser, 'gallery&palette', { width: 780, height: 520 });
    const box = await page.getByRole('dialog').first().boundingBox();
    const shot = await crop(page, box, 0);
    savePng(await tile(browser, shot.image, shot.width, shot.height), 'feature-palette.png');
    await page.context().close();
  },

  /** Download details: speed, segmented progress. */
  async details(browser) {
    const page = await openDesktop(browser, 'gallery&details=1', { width: 780, height: 560 });
    await visibleImages(page);
    savePng(await tile(browser, await page.screenshot(), 780, 560), 'feature-details.png');
    await page.context().close();
  },

  /** Desktop Settings → Appearance with Cobalt chosen: the accent the extension shares. */
  async accents(browser) {
    const page = await openDesktop(browser, 'gallery&sheet=settings&section=appearance', { width: 780, height: 440 });
    await page.getByRole('radio', { name: 'Cobalt' }).click();
    await page.mouse.move(779, 439);
    await sleep(1200);
    await visibleImages(page);
    savePng(await tile(browser, await page.screenshot(), 780, 440), 'feature-accents.png');
    await page.context().close();
  },

  /** Desktop animation: live progress, a finished snag, hover preview, details, ⌘K and the Saved shelf. */
  async 'desktop-demo'(browser) {
    const width = 960; const height = 600;
    const page = await openDesktop(browser, 'gallery&snag=1', { width, height, scale: 2, settle: 300 });
    const row = (key) => page.locator(`[data-row-key="${key}"]`);
    const frames = await record(page, async () => {
      await sleep(3000); // Speed traces move; Ember Tide finishes.
      const neon = await row('downloading').boundingBox();
      await page.mouse.move(neon.x + 64, neon.y + neon.height / 2, { steps: 12 });
      await sleep(2000); // Hover preview loop.
      await page.mouse.move(neon.x + 360, neon.y + neon.height / 2 - 10, { steps: 8 });
      await sleep(300);
      await row('downloading').getByText('Neon Rain — night drive').click();
      await sleep(2200); // Details: speed, segments.
      await page.keyboard.press('Escape');
      await sleep(500);
      await page.keyboard.press('Meta+k');
      await sleep(900);
      await page.keyboard.type('saved', { delay: 110 });
      await sleep(700);
      await page.keyboard.press('Enter'); // Show Saved as a shelf.
      await sleep(600);
      await page.mouse.move(width - 4, height - 150, { steps: 6 });
      await sleep(1500);
    });
    saveGif(frames, 'desktop-demo.gif', { width: 880, fps: 10 });
    await page.context().close();
  },

  /** Popup animation: live speed traces, a download finishing, hover preview, a new download and an accent change. */
  async 'extension-demo'(browser) {
    const page = await openPopup(browser, 'demo=snag', { settle: 200 });
    const rows = page.locator('.video-row');
    const frames = await record(page, async () => {
      await sleep(3600); // Ember Tide finishes.
      const third = await rows.nth(2).boundingBox();
      await page.mouse.move(third.x + 64, third.y + third.height / 2, { steps: 10 });
      await sleep(2200); // Hover preview loop.
      await rows.nth(2).locator('button.action').last().hover();
      await sleep(300);
      await rows.nth(2).locator('button.action').last().click();
      await sleep(2000);
      await page.locator('#settings-button').click();
      await sleep(500);
      await page.getByRole('tab', { name: 'Appearance' }).click();
      await sleep(700);
      await page.getByRole('radio', { name: 'Cobalt' }).click();
      await sleep(1100);
      await page.locator('#close-sheet').click();
      await page.mouse.move(470, 10, { steps: 4 });
      await sleep(1800);
    });
    saveGif(frames, 'extension-demo.gif', { width: 560, fps: 10 });
    await page.context().close();
  },
};

(async () => {
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((name) => !JOBS[name]);
  if (unknown.length) throw new Error(`Unknown output(s): ${unknown.join(', ')}. Choose from: ${Object.keys(JOBS).join(', ')}`);
  const browser = await chromium.launch();
  try {
    for (const [name, job] of Object.entries(JOBS)) if (!wanted.length || wanted.includes(name)) await job(browser);
  } finally {
    await browser.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
