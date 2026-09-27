// Tiny software pixel renderer: a 320 × 180 RGB frame buffer, drawn with integer
// pixels only (no anti-aliasing anywhere), upscaled 4× nearest-neighbour by ffmpeg.
export const W = 320, H = 180;
export const FPS = 30;
export const TAU = Math.PI * 2;

export const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (t) => t * t * (3 - 2 * t);
export const mod = (a, n) => ((a % n) + n) % n;

// Brand colours
export const BRAND = { o: hex('#fa5d0e'), amber: hex('#ffb238'), o2: hex('#bd3f00'), night: hex('#0c0e11') };

export class Frame {
  constructor() { this.d = new Uint8Array(W * H * 3); }
  clear(c) { for (let i = 0; i < W * H; i++) { this.d[i * 3] = c[0]; this.d[i * 3 + 1] = c[1]; this.d[i * 3 + 2] = c[2]; } }
  px(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2];
  }
  get(x, y) {
    x = clamp(Math.floor(x), 0, W - 1); y = clamp(Math.floor(y), 0, H - 1);
    const i = (y * W + x) * 3; return [this.d[i], this.d[i + 1], this.d[i + 2]];
  }
  blend(x, y, c, a) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 3; const d = this.d;
    d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a;
  }
  add(x, y, c, a) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 3; const d = this.d;
    d[i] = Math.min(255, d[i] + c[0] * a); d[i + 1] = Math.min(255, d[i + 1] + c[1] * a); d[i + 2] = Math.min(255, d[i + 2] + c[2] * a);
  }
  rect(x, y, w, h, c) {
    x = Math.floor(x); y = Math.floor(y);
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * W + xx) * 3; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; }
  }
  blendRect(x, y, w, h, c, a) { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.blend(x + xx, y + yy, c, a); }
  // Dithered fill: pixel drawn only where the Bayer threshold is under `a`.
  ditherPx(x, y, c, a) { if (a > bayer(x, y)) this.px(x, y, c); }
  line(x0, y0, x1, y1, c, a = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      if (a >= 1) this.px(x0, y0, c); else this.blend(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  disc(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy <= r * r) this.px(x, y, c);
    }
  }
  // Soft additive glow with a stepped (posterised) falloff so it stays pixel-art.
  glow(cx, cy, r, c, a, steps = 4) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r; if (d >= 1) continue;
      const k = Math.ceil((1 - d) * steps) / steps; this.add(x, y, c, a * k * k);
    }
  }
}

const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x, y) => B4[((y & 3) << 2) | (x & 3)];

// Palette ramp: a list of colours; sample(t, x, y) dithers between neighbouring
// entries so gradients read as crisp stepped pixel bands.
export function ramp(colors) {
  const cs = colors.map((c) => (typeof c === 'string' ? hex(c) : c));
  const n = cs.length - 1;
  return (t, x, y) => {
    const v = clamp(t, 0, 1) * n; let i = Math.floor(v); if (i >= n) return cs[n];
    const f = v - i; return f > bayer(x, y) ? cs[i + 1] : cs[i];
  };
}
// A ramp interpolated to `steps` flat bands between colour stops.
export function bands(stops, steps) {
  const cs = stops.map((c) => (typeof c === 'string' ? hex(c) : c));
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * (cs.length - 1); const j = Math.min(cs.length - 2, Math.floor(t));
    out.push(mix(cs[j], cs[j + 1], t - j).map(Math.round));
  }
  return ramp(out);
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(...n) {
  let h = 2166136261;
  for (const v of n) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); }
  h ^= h >>> 15; return (h >>> 0) / 4294967296;
}
// Periodic 1-D value noise (period p, integer lattice).
export function pnoise(x, p, seed = 0) {
  const i = Math.floor(x), f = x - i; const a = hash(mod(i, p), seed), b = hash(mod(i + 1, p), seed);
  return a + (b - a) * smooth(f);
}

// Sprites: array of strings, one char per pixel, '.' transparent.
export function sprite(frame, rows, x, y, pal, flip = false) {
  x = Math.round(x); y = Math.round(y);
  for (let r = 0; r < rows.length; r++) { const row = rows[r];
    for (let c = 0; c < row.length; c++) { const ch = row[flip ? row.length - 1 - c : c]; if (ch === '.' || ch === ' ') continue; const col = pal[ch]; if (col) frame.px(x + c, y + r, col); } }
}

// The SnagThis pixel bevel play button (16 × 16), from scripts/render-brand-assets.cjs geometry.
export const MASCOT = (() => {
  const g = Array.from({ length: 16 }, () => Array(16).fill('.'));
  const run = (ch, y, x0, x1) => { for (let x = x0; x <= x1; x++) g[y][x] = ch; };
  run('o', 0, 3, 12); run('o', 1, 1, 14); run('o', 2, 1, 14); for (let y = 3; y <= 12; y++) run('o', y, 0, 15); run('o', 13, 1, 14); run('o', 14, 1, 14); run('o', 15, 3, 12);
  run('a', 0, 3, 12); run('a', 1, 1, 2); run('a', 1, 13, 13); run('a', 2, 1, 1); for (let y = 3; y <= 12; y++) run('a', y, 0, 0); run('a', 13, 1, 1);
  run('d', 1, 14, 14); run('d', 2, 14, 14); for (let y = 3; y <= 12; y++) run('d', y, 15, 15); run('d', 13, 14, 14); run('d', 14, 1, 2); run('d', 14, 13, 14); run('d', 15, 3, 12);
  run('d', 8, 13, 13); run('d', 9, 11, 13); run('d', 10, 10, 11); run('d', 11, 8, 10); run('d', 12, 7, 8); run('d', 13, 6, 7);
  [[3, 5, 6], [4, 5, 7], [5, 5, 9], [6, 5, 10], [7, 5, 12], [8, 5, 12], [9, 5, 10], [10, 5, 9], [11, 5, 7], [12, 5, 6]].forEach(([y, a, b]) => run('n', y, a, b));
  return g.map((r) => r.join(''));
})();
export const MASCOT_PAL = { o: BRAND.o, a: BRAND.amber, d: BRAND.o2, n: BRAND.night };

// 3 × 5 pixel font (original), enough for HUD text.
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', K: '101101110101101', L: '100100100100111', M: '101111111101101',
  N: '110101101101101', O: '010101101101010', P: '110101110100100', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110',
  6: '011100110101010', 7: '111001010010010', 8: '010101010101010', 9: '010101011001110', '+': '000010111010000', '-': '000000111000000',
  ':': '000010000010000', '.': '000000000000010', ' ': '000000000000000', '!': '010010010000010', x: '000101010101000',
};
export function text(frame, s, x, y, c, shadow) {
  for (const ch of s) { const g = FONT[ch] || FONT[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') { if (shadow) frame.px(x + (i % 3) + 1, y + ((i / 3) | 0) + 1, shadow); }
    for (let i = 0; i < 15; i++) if (g[i] === '1') frame.px(x + (i % 3), y + ((i / 3) | 0), c);
    x += 4; }
}

// Off-screen RGBA pixel layer, stamped onto a frame (optionally mirrored for reflections).
export class Layer {
  constructor(w, h) { this.w = w; this.h = h; this.c = new Array(w * h).fill(null); }
  px(x, y, c) { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = c; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.c[y * this.w + x] : null; }
  stamp(fr, x, y, alpha = 1) {
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) { const c = this.c[j * this.w + i]; if (!c) continue; if (alpha >= 1) fr.px(x + i, y + j, c); else fr.blend(x + i, y + j, c, alpha); }
  }
}
