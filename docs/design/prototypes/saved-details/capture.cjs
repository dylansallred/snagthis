// Screenshots and motion captures for the saved-details studies. From the repository root:
//   node docs/design/prototypes/saved-details/capture.cjs [baseline a-spec-sheet b-cards c-inspector]
// Per folder: preview.png (the rich item open, 1200×800), state-<id>.png for every toolbar state,
// hover-h1/h2/h3.png (forced hover on the rich item), and for the three options motion.webp (open, hold, close,
// replayed from paused CSS animations/transitions stepped every 20ms of animation time, so timing is exact) plus
// motion-strip.png (five open frames side by side). PNGs over 240 KB are palette-reduced with Pillow (python3).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('@playwright/test');

const LIMIT = 240 * 1024;
const QUANTIZE = 'import sys\nfrom PIL import Image\nfor p in sys.argv[1:]:\n  Image.open(p).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(p, optimize=True)';
// frames: list of PNG paths; durations in ms. Writes an animated WebP scaled to 720px wide, and a 5-frame strip.
const ANIMATE = `import sys, json
from PIL import Image
cfg = json.loads(sys.argv[1])
frames = []
for p in cfg['frames']:
    im = Image.open(p).convert('RGB')
    w = cfg['width']; im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    frames.append(im)
h = max(f.height for f in frames)
canvas = []
for f in frames:
    c = Image.new('RGB', (frames[0].width, h), (18, 21, 26)); c.paste(f, (0, 0)); canvas.append(c)
canvas[0].save(cfg['out'], save_all=True, append_images=canvas[1:], duration=cfg['durations'], loop=0, quality=cfg['quality'], method=4)
picks = cfg['strip']
sw = 300
thumbs = [canvas[i].resize((sw, round(h * sw / canvas[i].width)), Image.LANCZOS) for i in picks]
strip = Image.new('RGB', (sw * len(thumbs) + 8 * (len(thumbs) - 1), thumbs[0].height), (7, 8, 10))
for n, t in enumerate(thumbs): strip.paste(t, (n * (sw + 8), 0))
strip.save(cfg['strip_out'], optimize=True)
`;
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['baseline', 'a-spec-sheet', 'b-cards', 'c-inspector'];

async function settle(page) {
  await page.evaluate(() => { window.SD.settle(); document.getAnimations().forEach((a) => { try { if (a.effect && a.effect.getComputedTiming().iterations !== Infinity) a.finish(); } catch (e) { /* infinite */ } }); });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  for (const dir of DIRS) {
    const out = (f) => path.join(__dirname, dir, f);
    await page.goto('file://' + out('index.html'));
    await page.evaluate(() => document.fonts.ready);
    const win = page.locator('#window .win');
    const states = await page.$$eval('#toolbar [data-state]', (els) => els.map((el) => el.dataset.state));
    for (const state of states) {
      await page.click(`#toolbar [data-state="${state}"]`);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(250);
      await settle(page);
      await win.screenshot({ path: out(`state-${state}.png`) });
      if (state === 'rich') await win.screenshot({ path: out('preview.png') });
    }
    if (dir !== 'baseline') {
      for (const h of ['h1', 'h2', 'h3']) {
        await page.click('#toolbar [data-state="hover"]');
        await page.click(`#toolbar [data-set="hover"][data-val="${h}"]`);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(250);
        // H3's shine is a single pass: stop it mid-sweep so the still shows it.
        await page.evaluate(() => document.getAnimations().forEach((a) => { if (a.animationName === 'px-shine') { a.pause(); a.currentTime = 260; } }));
        await win.screenshot({ path: out(`hover-${h}.png`) });
      }
      await page.click('#toolbar [data-set="hover"][data-val="h1"]');

      // Motion: step paused animations/transitions through the open and close choreography.
      await page.click('#toolbar [data-state="rich"]');
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      const clip = await page.evaluate(() => {
        const w = document.querySelector('#window .win').getBoundingClientRect();
        const it = document.querySelector('.item[data-item="rich"]').getBoundingClientRect();
        return { x: w.x, y: it.y - 86, width: w.width, height: Math.min(it.height + 86 + 16, w.bottom - (it.y - 86)) };
      });
      const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sd-'));
      const frames = [], durations = [];
      const shot = async (hold) => { const f = path.join(tmp, `f${String(frames.length).padStart(3, '0')}.png`); await page.screenshot({ path: f, clip }); frames.push(f); durations.push(hold); };
      const step = async (t) => page.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t; }), t);
      // Collapsed start.
      await page.evaluate(() => { window.SD.hold = true; const el = document.querySelector('.item[data-item="rich"]'); el.classList.remove('open', 'anim-in', 'closing'); document.getAnimations().forEach((a) => a.finish()); });
      await page.waitForTimeout(50);
      await shot(600);
      const openTotal = await page.evaluate(() => { window.SD.open('rich'); const as = document.getAnimations(); as.forEach((a) => a.pause()); return parseFloat(getComputedStyle(document.querySelector('.sdwin')).getPropertyValue('--open-total')); });
      for (let t = 20; t <= openTotal; t += 20) { await step(t); await shot(20); }
      await page.evaluate(() => { document.getAnimations().forEach((a) => a.finish()); document.querySelector('.item[data-item="rich"]').classList.remove('anim-in'); });
      await shot(1400);
      const openFrames = frames.length;
      const closeTotal = await page.evaluate(() => { window.SD.close('rich'); document.getAnimations().forEach((a) => a.pause()); return parseFloat(getComputedStyle(document.querySelector('.sdwin')).getPropertyValue('--close-total')); });
      for (let t = 20; t <= closeTotal; t += 20) { await step(t); await shot(20); }
      await page.evaluate(() => { document.getAnimations().forEach((a) => a.finish()); const el = document.querySelector('.item[data-item="rich"]'); el.classList.remove('open', 'closing'); window.SD.hold = false; });
      await shot(700);
      // Strip: collapsed, then 60 / 140 / 240ms into the open, then settled.
      const strip = [0, 3, 7, 12, openFrames - 1];
      let quality = 62;
      for (;;) {
        execFileSync('python3', ['-c', ANIMATE, JSON.stringify({ frames, durations, width: 720, quality, out: out('motion.webp'), strip, strip_out: out('motion-strip.png') })]);
        if (fs.statSync(out('motion.webp')).size < 1000 * 1024 || quality < 30) break;
        quality -= 12;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(dir, 'motion.webp', Math.round(fs.statSync(out('motion.webp')).size / 1024) + ' KB', frames.length + ' frames');
    }
    const big = fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.png')).map((f) => out(f)).filter((f) => fs.statSync(f).size > LIMIT);
    if (big.length) execFileSync('python3', ['-c', QUANTIZE, ...big]);
    console.log('captured', dir, states.join(' '), big.length ? `(${big.length} palette-reduced)` : '');
  }
  await browser.close();
})();
