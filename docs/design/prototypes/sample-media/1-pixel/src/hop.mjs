// Sky Hop — the SnagThis play button runs and leaps across floating islands above a sea of clouds.
import { W, H, TAU, hex, mix, scale, clamp, mod, rng, hash, bayer, bands, sprite, MASCOT, MASCOT_PAL, BRAND } from './lib.mjs';

const N = 300; // 10 s
const V = 2.4, P = V * N; // level scroll and period (720 px)
const HERO_X = 92;

const sky = bands(['#3aa0e0', '#5ab8ec', '#8ad0f0', '#b8e4f2', '#e2f2ee', '#fff0d8'], 14);

// Floating islands in level space [x0, x1, top].
const ISLANDS = [
  [0, 150, 132], [190, 300, 118], [350, 470, 136], [505, 640, 124], [668, 696, 110],
];
const DECOR = [ // trees and bushes on islands (level x, kind)
  [40, 'tree'], [118, 'bush'], [262, 'tree'], [220, 'bush'], [420, 'tree'], [380, 'bush'], [560, 'bush'], [610, 'tree'],
];
let islandCol, farIsles, bgClouds, gems, jumps;

function setup() {
  islandCol = new Int8Array(P).fill(-1);
  ISLANDS.forEach(([a, b], i) => { for (let x = a; x < b; x++) islandCol[x] = i; });
  // Jumps: from each island's end to the next island's start.
  jumps = ISLANDS.map(([, b, t], i) => {
    const [na, , nt] = ISLANDS[(i + 1) % ISLANDS.length];
    const xa = b - 6, xb = (i + 1 === ISLANDS.length ? na + P : na) + 8;
    return { xa, xb, ya: t, yb: nt, h: 18 + (xb - xa) * 0.12 };
  });
  // Gems: one at each jump's apex plus a few on the ground runs.
  gems = [];
  for (const j of jumps) for (const s of [0.3, 0.5, 0.7]) gems.push(mod(j.xa + (j.xb - j.xa) * s, P));
  for (const x of [60, 80, 400, 560, 580]) gems.push(x);
  const r = rng(12);
  farIsles = Array.from({ length: 2 }, (_, i) => ({ u: i * 90 + r() * 40, y: 70 + r() * 30, w: 22 + r() * 16 }));
  bgClouds = [[40, 50, 26], [150, 34, 20], [250, 58, 30], [320, 40, 18]].map(([x, y, s]) => ({ x, y, s, bumps: Array.from({ length: 6 }, () => [r() * 2 - 1, r() * 0.8, 0.35 + r() * 0.35]) }));
}

function heroY(wx) {
  wx = mod(wx, P);
  for (const j of jumps) {
    let x = wx; if (x < j.xa - 1) x += P; // the last jump crosses the wrap
    if (x >= j.xa && x <= j.xb) { const s = (x - j.xa) / (j.xb - j.xa); return { y: j.ya + (j.yb - j.ya) * s - 4 * j.h * s * (1 - s), air: true, s }; }
  }
  const i = islandCol[Math.floor(wx)]; return { y: i >= 0 ? ISLANDS[i][2] : 130, air: false };
}

function drawSky(fr, f) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fr.px(x, y, sky(y / 150, x, y));
  fr.glow(262, 26, 60, hex('#fff6d0'), 0.35, 6);
  fr.disc(262, 26, 11, hex('#fffbea'));
  // Big soft cumulus in the back.
  for (const c of bgClouds) {
    for (const [bx, by, br] of [[0, 0, 0.6], ...c.bumps]) {
      const cx = c.x + bx * c.s, cy = c.y - by * c.s * 0.6, rr = br * c.s;
      for (let y = Math.floor(cy - rr); y <= cy + rr; y++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d > rr || y > c.y + 2) continue;
        const shade = (y - (cy - rr)) / (2 * rr);
        fr.px(x, y, shade > 0.75 ? hex('#d8e6f8') : shade > 0.6 && bayer(x, y) < 0.5 ? hex('#d8e6f8') : hex('#f6fbff'));
      }
    }
  }
  // Distant floating isles, hazy.
  const o = Math.floor(0.6 * f);
  for (const is of farIsles) for (const rep of [0, 180]) {
    const sx = mod(is.u + rep - o, 360) - 40; if (sx < -50 || sx > W) continue;
    for (let i = 0; i < is.w; i++) {
      const u = i / is.w; const depth = Math.floor(2 + 11 * Math.pow(Math.sin(Math.PI * u), 0.6) * (0.85 + 0.15 * Math.sin(i * 1.7)));
      fr.px(sx + i, is.y - 1, hex('#a8dcb8'));
      for (let y = 0; y < depth; y++) fr.px(sx + i, is.y + y, y < 2 ? hex('#94c8b8') : y > depth - 3 ? hex('#98acd6') : hex('#a8bce0'));
      if (i === Math.floor(is.w * 0.35)) { fr.rect(sx + i, is.y - 4, 1, 3, hex('#8ab0a8')); fr.disc(sx + i + 0.5, is.y - 6, 2.5, hex('#94c4b0')); }
    }
  }
}

function cloudSea(fr, f, v, base, amp, cols, seed) {
  const Pc = v * N; const o = Math.floor(v * f);
  for (let x = 0; x < W; x++) {
    const u = mod(x + o, Pc); const k = TAU / Pc;
    let top = base;
    for (let h = 1; h <= 6; h++) top -= amp * Math.abs(Math.sin(u * k * (h * 2 + 1) + hash(h, seed) * 6)) / h;
    top = Math.floor(top);
    for (let y = Math.max(0, top); y < H; y++) { const d = y - top; fr.px(x, y, d < 1 ? cols[0] : d < 3 ? cols[1] : d < 6 && bayer(x, y) < 0.5 ? cols[1] : cols[2]); }
  }
}

const GRASS = [hex('#b4f07a'), hex('#7ad957'), hex('#4fb44a')];
const DIRT = [hex('#d08a52'), hex('#b0683e'), hex('#8a4a34'), hex('#62302a')];
function drawIslands(fr, f) {
  const o = Math.floor(V * f);
  for (let x = 0; x < W; x++) {
    const u = mod(x + o, P); const i = islandCol[u]; if (i < 0) continue;
    const [a, b, t] = ISLANDS[i]; const w = b - a; const s = (u - a) / w;
    const depth = Math.floor(6 + Math.min(40, w * 0.3) * Math.pow(Math.sin(Math.PI * s), 0.7) + (hash(u >> 1, 3) - 0.5) * 3);
    const edge = u === a || u === b - 1;
    for (let y = t; y < t + depth; y++) {
      const d = y - t; let c;
      if (d === 0) c = edge ? GRASS[1] : GRASS[0];
      else if (d < 3) c = GRASS[1];
      else if (d < 4 + (hash(u, 1) < 0.4 ? 1 : 0)) c = GRASS[2];
      else { const band = Math.min(3, Math.floor((d - 4) / (depth / 4))); c = DIRT[band]; if (hash(u >> 1, y >> 1, 7) < 0.06) c = hex('#e8b07a'); }
      if (edge && d > 2) c = DIRT[Math.min(3, (d >> 3) + 1)];
      fr.px(x, y, c);
    }
    if (hash(u, 11) < 0.12 && depth > 10) { const len = 2 + Math.floor(hash(u, 12) * 6); for (let y = 0; y < len; y++) fr.px(x, t + depth + y, hex('#5a7a3a')); }
    // Flowers and grass tufts.
    const hf = hash(u, 5);
    if (!edge && hf < 0.08) { fr.px(x, t - 1, [hex('#ff7ab0'), hex('#ffffff'), hex('#ffd84a')][Math.floor(hf * 37) % 3]); }
    else if (!edge && hf < 0.3) fr.px(x, t - 1, GRASS[1]);
  }
  for (const [lx, kind] of DECOR) {
    const sx = mod(lx - o, P); const x = sx > W + 20 ? sx - P : sx; if (x < -20 || x > W + 20) continue;
    const t = ISLANDS[islandCol[lx]][2];
    if (kind === 'tree') {
      fr.rect(x, t - 10, 2, 10, hex('#7a4a32'));
      const sway = Math.round(Math.sin(TAU * 2 * f / N + lx) * 0.8);
      for (const [dx, dy, r] of [[1, -16, 7], [-4, -13, 5], [6, -12, 5]]) fr.disc(x + dx + sway, t + dy, r, hex('#3f9a4a'));
      for (const [dx, dy, r] of [[0, -18, 4.5], [-4, -15, 3]]) fr.disc(x + dx + sway, t + dy, r, hex('#62c056'));
      fr.px(x - 1 + sway, t - 20, hex('#a8e87a')); fr.px(x + sway, t - 20, hex('#a8e87a'));
    } else {
      fr.disc(x, t - 2, 3.5, hex('#3f9a4a')); fr.disc(x + 4, t - 2, 3, hex('#4fb44a')); fr.px(x - 1, t - 5, hex('#8ad86a')); fr.px(x + 3, t - 4, hex('#ff7ab0'));
    }
  }
  // Waterfall off the far edge of the third island.
  { const [a, b, t] = ISLANDS[2]; const sx = mod(b - 2 - o, P); const x0 = sx > W + 20 ? sx - P : sx;
    if (x0 > -12 && x0 < W) for (let y = t + 1; y < H; y++) for (let x = x0; x < x0 + 7; x++) {
      if (y === t + 1 && x > x0 + 3) continue;
      const band = mod(y - 3 * f + (x - x0) * 2, 9);
      fr.px(x, y, band < 2 ? hex('#ffffff') : band < 5 ? hex('#9ee4ff') : hex('#5ac0f0'));
    }
  }
}

function drawGems(fr, f) {
  const o = V * f;
  for (const g of gems) {
    let sx = mod(g - o, P); if (sx > W + 20) sx -= P;
    const gy = heroY(g).y - 12;
    const since = (HERO_X + 10 - sx) / V; // frames since collected (negative = still waiting)
    if (since < 0) {
      if (sx > W + 6) continue;
      const ph = mod(Math.floor(f / 5) + Math.floor(g), 6); const hwMax = [3, 3, 2, 1, 2, 3][ph];
      const bobY = gy + Math.round(Math.sin(TAU * 3 * f / N + g) * 1.5);
      fr.glow(sx + 0.5, bobY + 0.5, 8, hex('#ffd060'), 0.4, 3);
      for (let dy = -4; dy <= 4; dy++) {
        const hw = Math.round(hwMax * (1 - Math.abs(dy) / 4.6));
        for (let dx = -hw; dx <= hw; dx++) {
          const edge = Math.abs(dx) === hw && hw > 0;
          fr.px(sx + dx, bobY + dy, hwMax === 0 ? hex('#fff2b0') : edge ? BRAND.o2 : dy < 0 ? (dx < 0 ? hex('#fff2b0') : BRAND.amber) : dx <= 0 ? BRAND.o : hex('#e04a08'));
        }
      }
    } else if (since < 14) {
      const cx = HERO_X + 8, cy = gy - since * 0.5;
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + g; const d = 2 + since * 1.2; fr.px(cx + Math.cos(a) * d, cy + Math.sin(a) * d, since < 7 ? hex('#fffbe0') : BRAND.amber); }
    }
  }
}

function drawHero(fr, f) {
  const wx = V * f + HERO_X + 8; const st = heroY(wx);
  const top = Math.round(st.y) - 19;
  const x = HERO_X;
  // Shadow on the ground below while airborne is skipped (islands float); dust on landing.
  for (const j of jumps) {
    const since = (mod(wx - j.xb, P)) / V; if (since > 10) continue;
    const bx = x + 8 - since * V; for (const d of [-1, 1]) { const px = x + 8 + d * (3 + since); fr.px(px, j.yb - 1 - (since > 4 ? 1 : 0), since < 5 ? hex('#ffffff') : hex('#e8f0ff')); fr.px(px + d, j.yb - 2, hex('#ffffff')); }
    void bx;
  }
  // Legs.
  const night = BRAND.night;
  if (st.air) {
    fr.rect(x + 4, top + 16, 3, 2, night); fr.rect(x + 10, top + 15, 3, 2, night);
  } else {
    const ph = mod(Math.floor(wx / 5), 4);
    const L = [[0, 2], [1, 1], [2, 0], [1, 1]][ph];
    fr.rect(x + 3 + L[0], top + 16, 3, 3 - (ph === 1 ? 1 : 0), night); fr.rect(x + 10 - L[1], top + 16, 3, 3 - (ph === 3 ? 1 : 0), night);
  }
  const bounce = !st.air && mod(Math.floor(wx / 5), 2) === 1 ? -1 : 0;
  sprite(fr, MASCOT, x, top + bounce, MASCOT_PAL);
  // Speed puffs behind while running.
  if (!st.air) for (let k = 0; k < 3; k++) { const age = mod(f + k * 4, 12); fr.blend(x - 2 - age * 1.5, Math.round(st.y) - 2 - (age >> 2), hex('#ffffff'), 0.7 - age * 0.05); }
}

const BIRD = [['x...x', '.x.x.', '..x..'], ['.....', 'xx.xx', '..x..']];
function drawBirds(fr, f) {
  [[0, 44], [14, 38], [26, 47]].forEach(([dx, y], i) => {
    const x = mod(40 + dx + 1.2 * f, 360) - 30;
    sprite(fr, BIRD[mod(Math.floor(f / 6) + i, 2)], x, y + Math.round(2 * Math.sin(TAU * 3 * f / N + i)), { x: hex('#3a6a9a') });
  });
}

function render(fr, f) {
  drawSky(fr, f);
  drawBirds(fr, f);
  cloudSea(fr, f, 1.2, 158, 7, [hex('#ffffff'), hex('#e6ecfb'), hex('#c9d4f2')], 1);
  drawIslands(fr, f);
  drawGems(fr, f);
  drawHero(fr, f);
  cloudSea(fr, f, 3.6, 184, 9, [hex('#ffffff'), hex('#f2f5ff'), hex('#dfe6fa')], 2);
}

export default { id: 'sky-hop', frames: N, poster: 34, kbps: 640, setup, render };
