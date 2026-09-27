// Ember Tide — a sailboat idling on a pixel ocean while a banded sun sinks into the sea.
import { W, H, TAU, hex, mix, scale, clamp, mod, rng, hash, bayer, bands, sprite, BRAND, Layer } from './lib.mjs';

const N = 300; // 10 s
const HOR = 98;
const SUN = { x: 204, y: HOR, r: 36 };

const SKY = ['#150c38', '#2a1150', '#4a1760', '#7a2266', '#a82e62', '#d24452', '#ec5e46', '#f7784a', '#ff9450'].map(hex);
const skyRamp = bands(SKY, 18);
const skyT = (x, y) => clamp(y / HOR - 0.08 + Math.max(0, 0.26 - Math.hypot((x - SUN.x) * 0.6, y - SUN.y) / 260), 0, 1);

let clouds, stars;
function setup() {
  const r = rng(7);
  clouds = [];
  // Stratus streaks: each lives one loop, drifting and dissolving in/out with a Bayer dither.
  for (let i = 0; i < 26; i++) {
    const y = 14 + Math.floor(r() * 70);
    clouds.push({ x: r() * (W + 60) - 30, y, len: 30 + r() * 90 * (1 - y / 140), th: 2 + Math.floor(r() * 3.5), ph: Math.floor(r() * N), v: 0.06 + r() * 0.08, seed: Math.floor(r() * 1e6) });
  }
  stars = Array.from({ length: 34 }, () => ({ x: Math.floor(r() * W), y: Math.floor(r() * 34), ph: Math.floor(r() * 6), k: 1 + Math.floor(r() * 3) }));
}

function drawSky(fr, f) {
  for (let y = 0; y < HOR; y++) for (let x = 0; x < W; x++) fr.px(x, y, skyRamp(skyT(x, y), x, y));
  for (const s of stars) { const a = 0.5 + 0.5 * Math.sin(TAU * (s.k * 3 * f / N) + s.ph); fr.blend(s.x, s.y, hex('#ffe6f0'), 0.25 + a * 0.5); }
  // The sun: a banded disc, slits sliding down into the sea.
  const shift = (f / N) * 8 * 3;
  const top = SUN.y - SUN.r;
  for (let y = Math.floor(top); y < HOR; y++) {
    const dy = y + 0.5 - SUN.y; const half = Math.sqrt(Math.max(0, SUN.r * SUN.r - dy * dy));
    const t = (y - top) / SUN.r;
    const slitDepth = t > 0.42 ? mod(y - top - shift, 8) : 99;
    const slitH = Math.floor((t - 0.42) * 8) + 1;
    if (slitDepth < slitH) continue;
    for (let x = Math.ceil(SUN.x - half); x < SUN.x + half; x++) {
      const c = t < 0.35 ? mix(hex('#fffbe0'), hex('#fff0a0'), t / 0.35) : t < 0.75 ? mix(hex('#fff0a0'), hex('#ffc848'), (t - 0.35) / 0.4) : mix(hex('#ffc848'), BRAND.amber, (t - 0.75) / 0.25);
      fr.px(x, y, c.map(Math.round));
    }
  }
  fr.glow(SUN.x, SUN.y - 8, 74, hex('#ff9a4a'), 0.16, 6);
}

function drawClouds(fr, f) {
  for (const c of clouds) {
    const lt = mod(f + c.ph, N); const life = lt / N;
    const alpha = Math.min(1, Math.min(life, 1 - life) * 4.5);
    const cx = c.x + (lt - N / 2) * c.v; const near = Math.hypot((cx - SUN.x) * 0.5, c.y - SUN.y) < 60;
    const hi = c.y > 60 ? hex(near ? '#ffd08a' : '#ff9a6a') : hex('#ff7a78');
    const body = c.y > 60 ? hex(near ? '#c24a55' : '#8a2a5c') : c.y > 35 ? hex('#5e1f5c') : hex('#3a1552');
    const lo = c.y > 60 ? hex('#b83e58') : hex('#7a2a62');
    const a = alpha * alpha * (3 - 2 * alpha); const len = c.len * (0.25 + 0.75 * a), th = c.th * a;
    if (th < 0.6) continue;
    for (let dx = -len / 2; dx < len / 2; dx++) {
      const u = (2 * dx) / len; const h = th * Math.sqrt(1 - u * u) * (0.8 + 0.4 * Math.sin(dx * 0.3 + c.seed));
      const x = Math.round(cx + dx); if (x < 0 || x >= W) continue;
      const y0 = Math.round(c.y - h * 0.6), y1 = Math.round(c.y + h * 0.4);
      for (let y = y0; y <= y1; y++) {
        fr.px(x, y, y === y1 ? hi : y === y1 - 1 && y1 - y0 > 2 ? lo : body);
      }
    }
  }
}

function drawLand(fr, f) {
  // Hazy headland on the right horizon, rocky islet with a lighthouse on the left.
  for (let x = 0; x < W; x++) {
    const hr = x > 236 ? Math.max(0, 6 + 4 * Math.sin(x * 0.07) + 3 * Math.sin(x * 0.19) - (x < 250 ? (250 - x) * 0.6 : 0)) : 0;
    for (let y = HOR - Math.floor(hr); y < HOR; y++) fr.px(x, y, hex('#9a3a5a'));
    const hl = x < 90 ? Math.max(0, 12 + 5 * Math.sin(x * 0.09 + 1) + 2 * Math.sin(x * 0.31) - Math.max(0, x - 50) * 0.35) : 0;
    for (let y = HOR - Math.floor(hl); y < HOR; y++) fr.px(x, y, y === HOR - Math.floor(hl) ? hex('#6a2658') : hex('#4a1a4e'));
  }
  const lx = 30, ly = HOR - 13;
  for (let y = 0; y < 26; y++) { const w = 7 - Math.floor(y / 9); for (let x = 0; x < w; x++) fr.px(lx + x + Math.floor(y / 9 / 2 + 0.5) - 3, ly - y, mod(Math.floor(y / 5), 2) ? hex('#e8d8e0') : hex('#b02a48')); }
  fr.rect(lx - 3, ly - 30, 6, 4, hex('#2a0f2e'));
  fr.rect(lx - 2, ly - 29, 4, 2, hex('#fff2b0'));
  fr.rect(lx - 4, ly - 31, 8, 1, hex('#2a0f2e'));
  fr.px(lx, ly - 32, hex('#2a0f2e'));
  // Rotating beam: two opposite rays seen side-on.
  const th = TAU * 2 * f / N; const c = Math.cos(th), s = Math.sin(th);
  const bx = lx, by = ly - 28;
  for (const dir of [1, -1]) {
    const len = 150 * Math.abs(c) + 8; const side = Math.sign(c * dir) || 1; const facing = Math.max(0, -s * dir);
    for (let i = 3; i < len; i++) { const spread = 1 + i * 0.05;
      for (let dy = -spread; dy <= spread; dy++) fr.add(bx + side * i, by + dy, hex('#fff0c0'), (0.12 + facing * 0.08) * (1 - i / len) * (Math.abs(dy) < spread * 0.5 ? 1.4 : 0.7)); }
    if (facing > 0.6) fr.glow(bx, by, 6 + facing * 10, hex('#fff6d0'), facing * 0.6, 4);
  }
}

// Water colour: the sky, mirrored and deepened toward the viewer.
const waterRamp = bands(['#ffb24e', '#f07a44', '#c24658', '#7e2a62', '#4a1b58', '#2a1246', '#190c34'], 16);

function drawWater(fr, f) {
  for (let y = HOR; y < H; y++) {
    const d = (y - HOR) / (H - HOR); const dd = Math.pow(d, 0.7);
    const L = Math.max(1, Math.round(1 + d * 10)); // glint dash length grows with nearness
    const colW = 8 + (y - HOR) * 0.62; // sun column half-width
    for (let x = 0; x < W; x++) {
      const near = Math.abs(x - SUN.x) < colW * 1.8 ? 1 - Math.abs(x - SUN.x) / (colW * 1.8) : 0;
      let c = waterRamp(clamp(dd - near * 0.35 * (1 - d * 0.5), 0, 1), x, y);
      // Blinking glint dashes on every row.
      const cell = Math.floor((x + (y * 7) % L) / L); const hsh = hash(cell, y);
      const inCol = Math.abs(x + 0.5 - SUN.x) < colW * (0.75 + 0.35 * Math.sin(y * 1.7 + TAU * 2 * f / N));
      const k = 4 + Math.floor(hsh * 5);
      const blink = Math.sin(TAU * (k * f / N) + hsh * 40);
      if (inCol) {
        if (hsh < 0.75 && blink > -0.2) c = blink > 0.55 ? hex('#fff3b8') : hsh < 0.4 ? BRAND.amber : hex('#ff8a3a');
      } else if (hsh < 0.16 && blink > 0.5) c = d < 0.3 ? hex('#ffc27a') : hex(dd < 0.6 ? '#e2605a' : '#5e2a6e');
      fr.px(x, y, c);
    }
  }
}

// Sailboat (original), 34 × 40 layer: hull, mast, mainsail and jib.
function buildBoat(f) {
  const L = new Layer(48, 56);
  const dark = hex('#2a0f2e'), sail = hex('#44173f'), rim = hex('#ff9a5a'), rim2 = hex('#ffcf7a'), hull = hex('#1e0a22'), hullHi = hex('#ff7a4a');
  const mastX = 21;
  for (let y = 2; y < 46; y++) L.px(mastX, y, dark);
  // Mainsail: a curved triangle from masthead to boom, trailing left.
  for (let y = 4; y < 43; y++) { const t = (y - 4) / 39; const w = Math.floor(19 * Math.pow(t, 0.85)) + 1; for (let x = mastX - w; x < mastX; x++) L.px(x, y, x === mastX - w ? hex('#6a2656') : x === mastX - 1 ? hex('#34112f') : sail); }
  // Jib: forward of the mast, rim-lit by the sun on its leading edge.
  for (let y = 9; y < 43; y++) { const w = Math.floor((y - 9) * 0.55) + 1; for (let x = mastX + 1; x <= mastX + w; x++) L.px(x, y, x === mastX + w ? (y % 4 ? rim : rim2) : x === mastX + w - 1 ? hex('#8a2e4a') : sail); }
  for (let x = mastX - 20; x < mastX; x++) L.px(x, 43, dark); // boom
  // Hull.
  for (let y = 45; y < 52; y++) { const inset = y - 45; for (let x = 2 + inset; x < 46 - Math.floor(inset * 0.5); x++) L.px(x, y, y === 45 ? hullHi : y === 46 ? hex('#c24a4a') : hull); }
  for (let x = 38; x < 47; x++) L.px(x, 45 - Math.floor((x - 38) / 4), hullHi);
  // Pennant: a three-pixel orange flag flapping at the masthead.
  const flap = mod(Math.floor(f / 4), 3);
  L.px(mastX + 1, 2, BRAND.o); L.px(mastX + 2, 2 + (flap === 1 ? 1 : 0), BRAND.o); L.px(mastX + 1, 3, BRAND.o2); if (flap !== 2) L.px(mastX + 3, 2 + (flap === 0 ? 0 : 1), BRAND.amber);
  return L;
}

function drawBoats(fr, f) {
  const bob = Math.round(Math.sin(TAU * 2 * f / N) * 1.4);
  const bx = 72, wl = 142 + bob;
  const boat = buildBoat(f);
  // Reflection first (wobbly, dim), then the boat.
  for (let j = 0; j < 40; j++) {
    const rip = Math.round(Math.sin(j * 0.9 + TAU * 3 * f / N) * (1 + j * 0.05));
    for (let i = 0; i < 48; i++) { const c = boat.get(i, 51 - j); if (!c) continue; const y = wl + j - 1; if ((j & 1) && j > 10) continue; fr.blend(bx + i + rip, y, hex('#1a0a26'), 0.55 - j * 0.012); }
  }
  boat.stamp(fr, bx, wl - 52);
  for (let x = bx + 4; x < bx + 46; x++) if (mod(x + Math.floor(f / 3), 5) < 2) fr.px(x, wl + 1, hex('#ffc27a')); // wake sparkle
  // Far fishing boat with a lantern, and a distant sail on the horizon.
  const fb = Math.round(Math.sin(TAU * 3 * f / N + 1) * 0.8);
  const fx = 262, fy = 112 + fb;
  fr.rect(fx, fy, 14, 2, hex('#2a0f2e')); fr.rect(fx + 1, fy + 2, 12, 1, hex('#2a0f2e')); fr.rect(fx + 8, fy - 4, 4, 4, hex('#2a0f2e'));
  fr.rect(fx + 3, fy - 9, 1, 9, hex('#2a0f2e'));
  const lamp = 0.7 + 0.3 * Math.sin(TAU * 6 * f / N);
  fr.px(fx + 3, fy - 10, hex('#fff0b0')); fr.glow(fx + 3.5, fy - 9.5, 7, hex('#ffcf7a'), 0.5 * lamp, 3);
  for (let j = 2; j < 12; j += 2) fr.blend(fx + 3 + Math.round(Math.sin(j + TAU * 10 * f / N)), fy + 2 + j, hex('#ffcf7a'), 0.5 - j * 0.04);
  const sx = 128, sy = HOR;
  for (let y = 0; y < 6; y++) for (let x = 0; x <= Math.floor(y / 2); x++) fr.px(sx + x, sy - 6 + y, hex('#8a2e55'));
  fr.rect(sx - 1, sy, 5, 1, hex('#8a2e55'));
}

const GULL = [
  ['x.....x', '.x...x.', '..xxx..'],
  ['.......', 'xxx.xxx', '...x...'],
  ['.......', '.xx.xx.', 'x..x..x'],
  ['.......', 'xxx.xxx', '...x...'],
];
function drawGulls(fr, f) {
  const gulls = [[0, 30, 0], [70, 42, 7], [150, 22, 13], [240, 52, 3]];
  gulls.forEach(([x0, y0, ph], i) => {
    const x = mod(x0 + (360 / N) * f, 360) - 20;
    const y = y0 + Math.round(3 * Math.sin(TAU * (2 * f / N) + i));
    const fr_ = GULL[mod(Math.floor((f + ph) / 5), 4)];
    sprite(fr, fr_, x, y, { x: hex('#2a0f2e') });
  });
}

function render(fr, f) {
  drawSky(fr, f);
  drawClouds(fr, f);
  drawLand(fr, f);
  drawWater(fr, f);
  drawBoats(fr, f);
  drawGulls(fr, f);
}

export default { id: 'ember-tide', frames: N, poster: 60, kbps: 640, setup, render };
