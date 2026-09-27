#!/usr/bin/env node
/*
 * Records the looping product clips on snagthisvid.com (site/media/ui) from the development demos.
 * Every clip is the real desktop renderer or extension popup, driven by Playwright with its built-in sample
 * data, so re-running this after the sample thumbnails or videos change refreshes everything. No clip names a
 * film: rows are found by position and role, never by title.
 *
 * 1. Use the Node version in .nvmrc and run `npm ci` (Playwright's Chromium: `npx playwright install chromium`).
 * 2. Start both demos in separate terminals from the repository root:
 *      cd apps/desktop && npx vite --port 5173 --strictPort     # desktop renderer, opened at /?gallery
 *      npx http-server apps/extension -p 5174 -s                # extension popup, opened at /popup.html?demo
 * 3. From the repository root:
 *      node scripts/capture-site-media.cjs                      # every clip
 *      node scripts/capture-site-media.cjs quality pairing      # only the named clips (see CLIPS below)
 *
 * Each clip is written as <name>-<hash>.webm (VP9), <name>-<hash>.mp4 (H.264, faststart) and <name>-<hash>.webp
 * (poster). The hash changes with the content, because site/_headers caches /media for a year; the script
 * deletes the clip's old files and points site/index.html at the new ones. Clips are recorded at
 * deviceScaleFactor 2 through the DevTools screencast, resampled to 30 fps, and joined end-to-start with a
 * short crossfade so they loop without a jump. Encoding steps up the CRF until each file is under MAX_BYTES.
 *
 * Needs ffmpeg with libvpx-vp9 and libx264 on PATH (or FFMPEG_PATH). DESKTOP_URL / POPUP_URL override the
 * demo addresses. KEEP_FRAMES=1 keeps the temporary frames and masters for inspection.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'site/media/ui');
const PAGE = path.join(ROOT, 'site/index.html');
const DESKTOP = process.env.DESKTOP_URL || 'http://localhost:5173/';
const POPUP = process.env.POPUP_URL || 'http://localhost:5174/popup.html';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || (FFMPEG.includes(path.sep) ? path.join(path.dirname(FFMPEG), 'ffprobe') : 'ffprobe');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-site-'));
const FPS = 30;
const FADE = 0.5; // Seconds of crossfade from the end of a clip back into its start.
const MAX_BYTES = 600 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- browser helpers ---------- */

/*
 * A pointer drawn into the page: screencasts have no cursor, and clips read better with one. It follows real
 * mouse events, turns into a hand over anything clickable and dips on press. Hidden until the first move.
 */
function installPointer() {
  const ARROW = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2v15.5l4.1-3.9 2.7 6.2 2.7-1.2-2.6-6h5.6z" fill="#fff" stroke="#0b0d10" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const HAND = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M8 3.2a1.4 1.4 0 0 1 2.8 0V9l.2-.8a1.4 1.4 0 0 1 2.7.6l-.1.9.3-.4a1.4 1.4 0 0 1 2.4 1.2l-.2 1 .2-.2a1.3 1.3 0 0 1 2.2 1.2l-.6 3.4a5.5 5.5 0 0 1-5.4 4.6h-1.2a5.5 5.5 0 0 1-4.3-2.1L3.6 14a1.4 1.4 0 0 1 2.1-1.8L8 14.4z" fill="#fff" stroke="#0b0d10" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const mount = () => {
    if (document.getElementById('capture-pointer')) return;
    const node = document.createElement('div');
    node.id = 'capture-pointer';
    node.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45));transition:transform 90ms ease-out';
    node.innerHTML = ARROW;
    document.documentElement.append(node);
    let hand = false;
    addEventListener('mousemove', (event) => {
      node.style.opacity = '1';
      node.style.left = `${event.clientX - (hand ? 7 : 3)}px`;
      node.style.top = `${event.clientY - 2}px`;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const wantsHand = !!target && getComputedStyle(target).cursor === 'pointer' || !!target?.closest('button, a[href], [role="radio"], [role="menuitemradio"], [role="tab"], [role="option"]');
      if (wantsHand !== hand) { hand = wantsHand; node.innerHTML = hand ? HAND : ARROW; }
    }, true);
    addEventListener('mousedown', () => { node.style.transform = 'scale(.84)'; }, true);
    addEventListener('mouseup', () => { node.style.transform = ''; }, true);
  };
  if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount);
  // Some apps replace the document element's children; keep the pointer attached.
  document.addEventListener('DOMContentLoaded', mount);
}

/** Pauses CSS animations until release(), so a clip can start at the very first frame of an entrance. */
function installHold() {
  const style = document.createElement('style');
  style.id = 'capture-hold';
  style.textContent = '*, *::before, *::after { animation-play-state: paused !important; }';
  const add = () => document.documentElement && !document.getElementById('capture-hold') && document.documentElement.append(style);
  add(); document.addEventListener('DOMContentLoaded', add);
}
const release = (page) => page.evaluate(() => document.getElementById('capture-hold')?.remove());

async function context(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'dark', bypassCSP: true, reducedMotion: 'no-preference' });
  // Skip the first-launch logo animation; later launches settle straight into the header.
  await ctx.addInitScript(() => { try { localStorage.setItem('snagthis.startupSeen', '1'); } catch { /* ignore */ } });
  await ctx.addInitScript(installPointer);
  return ctx;
}

async function openDesktop(ctx, query, { hold = false } = {}) {
  const page = await ctx.newPage();
  if (hold) await page.addInitScript(installHold);
  await page.goto(`${DESKTOP}?${query}`);
  await page.locator('.workbench').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function openPopup(ctx, query, { hold = false } = {}) {
  const page = await ctx.newPage();
  if (hold) await page.addInitScript(installHold);
  await page.goto(`${POPUP}?${query}`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** The popup sizes itself to its content in Chrome; measure the popup plus anything hanging off it (menus). */
async function popupHeight(page) {
  return Math.ceil(await page.evaluate(() => {
    const boxes = [document.getElementById('popup'), ...document.querySelectorAll('[role="menu"]')].filter(Boolean).map((node) => node.getBoundingClientRect());
    return Math.max(...boxes.filter((box) => box.height > 0).map((box) => box.bottom)) + 8;
  }));
}

const blur = (page) => page.evaluate(() => document.activeElement?.blur());

/* Pointer choreography: eased glides with real mouse events, so hover states and previews react. */
const pointers = new WeakMap();
async function park(page, x, y) { pointers.set(page, { x, y }); await page.mouse.move(x, y); }
async function glide(page, x, y, ms = 520) {
  const from = pointers.get(page) || { x, y };
  const began = Date.now();
  for (let t = 0; t < 1;) {
    await sleep(16);
    t = Math.min(1, (Date.now() - began) / ms); // Timed by the clock, so glides take `ms` however slow each move is.
    const e = t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
  }
  pointers.set(page, { x, y });
}
async function centre(locator, dx = 0, dy = 0) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Not visible: ${locator}`);
  return [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy];
}
async function glideTo(page, locator, ms, dx, dy) { const [x, y] = await centre(locator, dx, dy); await glide(page, x, y, ms); }
async function click(page, locator, ms = 520) { await glideTo(page, locator, ms); await sleep(140); await page.mouse.down(); await sleep(90); await page.mouse.up(); }

/* ---------- recording ---------- */

/** Records the page through the DevTools screencast (full device resolution, every composited frame). */
async function cast(page) {
  const { width, height } = page.viewportSize();
  const dir = fs.mkdtempSync(path.join(TMP, 'cast-'));
  const cdp = await page.context().newCDPSession(page);
  const frames = []; const writes = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.png`);
    frames.push({ t: metadata.timestamp, file });
    writes.push(fs.promises.writeFile(file, Buffer.from(data, 'base64')));
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: width * 2, maxHeight: height * 2, everyNthFrame: 1 });
  await sleep(120); // The first frame arrives as soon as the page is composited.
  const start = Date.now() / 1000;
  return {
    async stop() {
      const end = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      // Keep the frame that was on screen at `start`, then everything after it.
      const firstIndex = Math.max(0, frames.findIndex((frame) => frame.t > start) - 1);
      const kept = frames.slice(firstIndex === -1 ? frames.length - 1 : firstIndex);
      if (!kept.length) throw new Error('The screencast produced no frames.');
      return { frames: kept, start, end };
    },
  };
}

/** Writes an ffconcat list for one or more recorded segments, each timed from its own start to end. */
function concatList(segments) {
  const lines = ['ffconcat version 1.0'];
  let total = 0; let last = null;
  for (const { frames, start, end } of segments) {
    frames.forEach((frame, index) => {
      const from = Math.max(frame.t, start);
      const to = Math.min(frames[index + 1]?.t ?? end, end);
      if (to <= from) return;
      lines.push(`file '${frame.file}'`, `duration ${(to - from).toFixed(4)}`);
      total += to - from; last = frame.file;
    });
  }
  lines.push(`file '${last}'`); // The concat demuxer needs the last file repeated for its duration to count.
  const list = path.join(TMP, `list-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(list, lines.join('\n'));
  return { list, total };
}

const ff = (args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

/**
 * Resamples the segments to a constant 30 fps at the output width and joins the end back into the start:
 * the clip plays from FADE seconds in, and its last FADE seconds dissolve into its first, so the loop is seamless.
 */
function master(segments, width, name) {
  const { list } = concatList(segments);
  const raw = path.join(TMP, `${name}-raw.mkv`);
  const out = path.join(TMP, `${name}-master.mkv`);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},scale=${width}:-2:flags=lanczos,format=yuv444p`, '-c:v', 'ffv1', raw]);
  const frames = Number(execFileSync(FFPROBE, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', raw]).toString().trim());
  const f = Math.round(FADE * FPS);
  const graph = [
    '[0]split[a][b]',
    `[a]select='gte(n,${f})',setpts=N/${FPS}/TB[body]`,
    `[b]select='lt(n,${f})',setpts=N/${FPS}/TB[head]`,
    `[body][head]xfade=transition=fade:duration=${FADE}:offset=${((frames - 2 * f) / FPS).toFixed(4)}[v]`,
  ].join(';');
  ff(['-i', raw, '-filter_complex', graph, '-map', '[v]', '-c:v', 'ffv1', out]);
  return { file: out, seconds: (frames - f) / FPS };
}

/** Encodes WebM and MP4 under MAX_BYTES, raising the CRF until each fits. */
function encode(source, base) {
  const webm = `${base}.webm`; const mp4 = `${base}.mp4`;
  const common = ['-an', '-pix_fmt', 'yuv420p', '-g', String(FPS * 4)];
  for (const crf of [34, 37, 40, 43, 46, 50]) {
    ff(['-i', source, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1', '-tile-columns', '2', '-deadline', 'good', '-cpu-used', '1', ...common, webm]);
    if (fs.statSync(webm).size <= MAX_BYTES) break;
  }
  for (const crf of [25, 27, 29, 31, 33, 36]) {
    ff(['-i', source, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-movflags', '+faststart', ...common, mp4]);
    if (fs.statSync(mp4).size <= MAX_BYTES) break;
  }
  return { webm, mp4 };
}

/** Exports one frame of the finished loop as a WebP poster (Chromium's encoder; ffmpeg builds often lack one). */
async function poster(browser, source, seconds, file) {
  const png = path.join(TMP, `${path.basename(file)}.png`);
  ff(['-ss', seconds.toFixed(3), '-i', source, '-frames:v', '1', png]);
  const page = await browser.newPage();
  const webp = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
    return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); });
  }, fs.readFileSync(png).toString('base64')).catch(() => null);
  await page.close();
  if (!webp) throw new Error('Could not encode the WebP poster.');
  fs.writeFileSync(file, Buffer.from(webp, 'base64'));
}

const probe = (file, entry) => execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entry, '-of', 'csv=p=0', file]).toString().trim();

/** Writes the clip's files with a content hash, removes its previous files and repoints index.html. */
async function publish(browser, name, clip, segments) {
  const { file, seconds } = master(segments, clip.width, name);
  const stage = path.join(TMP, name);
  const { webm, mp4 } = encode(file, stage);
  const still = `${stage}.webp`;
  await poster(browser, file, Math.min(seconds - 0.05, Math.max(0, (clip.poster ?? 0) - FADE)), still);
  const hash = crypto.createHash('sha256');
  for (const part of [webm, mp4, still]) hash.update(fs.readFileSync(part));
  const id = `${name}-${hash.digest('hex').slice(0, 8)}`;
  fs.mkdirSync(OUT, { recursive: true });
  for (const old of fs.readdirSync(OUT)) if (new RegExp(`^${name}-[0-9a-f]{8}\\.(webm|mp4|webp)$`).test(old)) fs.rmSync(path.join(OUT, old));
  for (const [from, ext] of [[webm, 'webm'], [mp4, 'mp4'], [still, 'webp']]) fs.copyFileSync(from, path.join(OUT, `${id}.${ext}`));
  if (fs.existsSync(PAGE)) {
    const html = fs.readFileSync(PAGE, 'utf8');
    const next = html.replace(new RegExp(`media/ui/${name}(?:-[0-9a-f]{8})?\\.(webm|mp4|webp)`, 'g'), `media/ui/${id}.$1`);
    if (next !== html) fs.writeFileSync(PAGE, next);
  }
  const [w, h] = probe(path.join(OUT, `${id}.mp4`), 'stream=width,height').split(',');
  const kb = (ext) => Math.round(fs.statSync(path.join(OUT, `${id}.${ext}`)).size / 1024);
  console.log(`wrote site/media/ui/${id}.{webm,mp4,webp}  ${w}×${h}  ${seconds.toFixed(1)} s  webm ${kb('webm')} KB · mp4 ${kb('mp4')} KB · poster ${kb('webp')} KB`);
}

/* ---------- clips ---------- */

/*
 * Each clip: `size` is the CSS viewport (the UI is cropped to exactly this), `width` the encoded pixel width
 * (twice the size it is shown at on the site), `poster` the moment (seconds into the recording) used as the
 * still, and `record(browser)` returns the recorded segments. Start and end each recording in the same state,
 * with the pointer parked in the same spot, so the crossfade back to the start is invisible.
 */
const CLIPS = {
  /** Desktop: speed traces drawing, a download landing in Saved, a hover preview, then the segment details. */
  download: {
    size: [960, 560], width: 1440, poster: 6.4,
    async record(browser) {
      const ctx = await context(browser, ...this.size);
      const page = await openDesktop(ctx, 'gallery&snag=1');
      await park(page, 610, 548);
      // The gallery's sample row that keeps downloading (keyed by its state, not by its film).
      const row = page.locator('[data-row-key="downloading"]');
      const body = async () => { const box = await row.boundingBox(); return [box.x + 420, box.y + box.height / 2]; };
      const recording = await cast(page);
      await sleep(2800); // Traces start drawing; the finishing download lands in Saved (+1).
      await glideTo(page, row, 600, -(await row.boundingBox()).width / 2 + 64, 0);
      await sleep(1700); // Hover preview.
      const press = async (ms) => { await glide(page, ...(await body()), ms); await sleep(140); await page.mouse.down(); await sleep(90); await page.mouse.up(); };
      await press(450);
      await sleep(2300); // Details: speed, connections and every piece.
      await press(300);
      await sleep(300);
      await glide(page, 610, 548, 550);
      await sleep(500);
      const segment = await recording.stop();
      await ctx.close();
      return [segment];
    },
  },

  /** Desktop: ⌘K, type "saved", Enter to the Saved shelf, then back to All. */
  palette: {
    size: [960, 560], width: 1440, poster: 2.6,
    async record(browser) {
      const ctx = await context(browser, ...this.size);
      const page = await openDesktop(ctx, 'gallery');
      await park(page, 610, 548);
      await sleep(1200);
      const recording = await cast(page);
      await sleep(900);
      await page.keyboard.press('Meta+k');
      await sleep(800);
      await page.keyboard.type('saved', { delay: 130 });
      await sleep(900);
      await page.keyboard.press('Enter'); // "Show Saved as a shelf".
      await sleep(1100);
      const tile = page.locator('.shelf-tile .shelf-poster').first();
      if (await tile.count()) { await glideTo(page, tile, 700); await sleep(1800); } // Hover preview on the shelf.
      await click(page, page.locator('.list-tabs button').first(), 700); // Back to All.
      await sleep(900);
      await glide(page, 610, 548, 600);
      await sleep(600);
      const segment = await recording.stop();
      await ctx.close();
      return [segment];
    },
  },

  /** Popup: a hover preview, then the quality menu: pick 720p, and back to 1080p. */
  quality: {
    size: [480, 0], width: 960, poster: 3.4,
    async record(browser) {
      const ctx = await context(browser, 480, 700);
      const page = await openPopup(ctx, 'demo=quality');
      await page.locator('[role="menu"]').waitFor();
      this.size[1] = await popupHeight(page); // Tall enough for the open menu.
      await page.setViewportSize({ width: 480, height: this.size[1] });
      await page.keyboard.press('Escape');
      await blur(page);
      await park(page, 300, 24);
      await sleep(900);
      const row = page.locator('.video-row').first();
      const button = row.locator('.quality-button');
      const option = (index) => page.locator('[role="menu"] [role="menuitemradio"]').nth(index);
      const recording = await cast(page);
      await sleep(300);
      await glideTo(page, row, 600, -(await row.boundingBox()).width / 2 + 64, 0);
      await sleep(1500); // Hover preview.
      await click(page, button, 500);
      await sleep(500);
      await glideTo(page, option(2), 520);
      await sleep(260);
      await click(page, option(1), 260);
      await sleep(1000); // The row now shows the smaller size.
      await click(page, button, 450);
      await sleep(450);
      await click(page, option(0), 380);
      await sleep(500);
      await glide(page, 300, 24, 550);
      await blur(page);
      await sleep(400);
      const segment = await recording.stop();
      await ctx.close();
      return [segment];
    },
  },

  /** Popup: a download finishes, a hover preview, then a new snag filling its pieces with a live speed trace. */
  snag: {
    size: [480, 0], width: 960, poster: 8.6,
    async record(browser) {
      const ctx = await context(browser, 480, 700);
      const page = await openPopup(ctx, 'demo=snag');
      await page.locator('.video-row').first().waitFor();
      this.size[1] = await popupHeight(page);
      await page.setViewportSize({ width: 480, height: this.size[1] });
      await park(page, 300, 24);
      // Let the demo's sample downloads advance, as a real transfer would (the demo holds progress still).
      await page.evaluate(() => {
        setInterval(() => {
          for (const job of window.SnagThisDemo.state.queue) {
            if (job.queueStatus !== 'downloading') continue;
            job.speedBps ||= 5_400_000;
            const step = job.progress < 20 ? 7 : 1.2;
            job.progress = Math.min(96, (job.progress || 0) + step);
            job.etaSeconds = Math.max(20, Math.round((100 - job.progress) * 4));
          }
        }, 1000);
      });
      const rows = page.locator('.video-row');
      const recording = await cast(page);
      await sleep(3100); // The nearly finished download completes.
      const ready = rows.filter({ has: page.locator('button.action.primary') }).first();
      await glideTo(page, ready, 600, -(await ready.boundingBox()).width / 2 + 64, 0);
      await sleep(1600); // Hover preview.
      await click(page, ready.locator('button.action.primary'), 550);
      await sleep(3300); // Pieces fill; the speed trace draws.
      await glide(page, 300, 24, 600);
      await sleep(300);
      const segment = await recording.stop();
      await ctx.close();
      return [segment];
    },
  },

  /** Desktop Settings → Appearance: every accent in turn, back to orange, recolouring the whole window. */
  accent: {
    size: [960, 560], width: 1080, poster: 2.2,
    async record(browser) {
      const ctx = await context(browser, ...this.size);
      const page = await openDesktop(ctx, 'gallery&sheet=settings&section=appearance');
      const radios = page.getByRole('radio');
      await radios.first().waitFor();
      const [x, y] = await centre(radios.first(), 0, 46);
      await park(page, x, y);
      await sleep(1200);
      const count = await radios.count();
      const recording = await cast(page);
      await sleep(600);
      for (let index = 1; index <= count; index++) {
        await click(page, radios.nth(index % count), 420);
        await sleep(820);
      }
      await glide(page, x, y, 500);
      await sleep(500);
      const segment = await recording.stop();
      await ctx.close();
      return [segment];
    },
  },

  /** Popup: Connect, the four digits flip in and the countdown ticks, then the connected celebration. */
  pairing: {
    size: [480, 440], width: 960, poster: 2.8,
    async record(browser) {
      const ctx = await context(browser, ...this.size);
      const page = await openPopup(ctx, 'demo=settings&tab=connection&conn=unpaired&build=store');
      const connect = page.getByRole('tabpanel').getByRole('button', { name: 'Connect', exact: true });
      await connect.waitFor();
      await blur(page);
      await park(page, 240, 400);
      await sleep(900);
      const first = await cast(page);
      await sleep(700);
      await click(page, connect, 700);
      await page.locator('.pair-digits').waitFor();
      await blur(page);
      await sleep(3000); // Digits flip in; the countdown pips tick.
      const waiting = await first.stop();
      const { x, y } = pointers.get(page);
      const done = await openPopup(ctx, 'demo=pairing&pair=connected&build=store', { hold: true });
      await done.locator('.pair-yay').waitFor();
      await blur(done);
      await park(done, x, y);
      await sleep(300);
      const second = await cast(done);
      await release(done);
      await sleep(2400);
      await glide(done, 240, 400, 600);
      await sleep(400);
      const connected = await second.stop();
      await ctx.close();
      return [waiting, connected];
    },
  },
};

(async () => {
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((name) => !CLIPS[name]);
  if (unknown.length) throw new Error(`Unknown clip(s): ${unknown.join(', ')}. Choose from: ${Object.keys(CLIPS).join(', ')}`);
  const browser = await chromium.launch();
  try {
    for (const [name, clip] of Object.entries(CLIPS)) {
      if (wanted.length && !wanted.includes(name)) continue;
      const segments = await clip.record(browser);
      await publish(browser, name, clip, segments);
    }
  } finally {
    await browser.close();
    if (process.env.KEEP_FRAMES) console.log(`kept ${TMP}`); else fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
