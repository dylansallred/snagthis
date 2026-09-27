// Neon Rain — a side-scrolling night drive through a rain-soaked pixel city.
import { W, H, TAU, hex, mix, scale, clamp, mod, rng, hash, bayer, bands, sprite, text, MASCOT, MASCOT_PAL, BRAND, Layer } from './lib.mjs';

const N = 300; // 10 s
const V0 = 0.6, V1 = 1.2, V2 = 2.4, V3 = 3.6; // parallax px/frame; V*N is each layer's period
const HOR = 132; // street line
const ROAD = 138; // road surface starts
const NEON = ['#ff3d8b', '#39e6ff', '#fa5d0e', '#ffb238', '#a06bff', '#ff3d8b', '#39e6ff'].map(hex);

const sky = bands(['#05031a', '#0d0930', '#1d1046', '#3a1553', '#66205c', '#92305f'], 12);

function genBuildings(P, seed, wmin, wmax, hmin, hmax, gapMax) {
  const r = rng(seed); const list = []; let u = 0;
  while (u < P - wmin) {
    let w = Math.floor(wmin + r() * (wmax - wmin)); if (u + w > P) w = P - u;
    list.push({ x: u, w, h: Math.floor(hmin + r() * (hmax - hmin)), roof: Math.floor(r() * 4), seed: Math.floor(r() * 1e6) });
    u += w + Math.floor(r() * (gapMax + 1));
  }
  const col = new Int16Array(P).fill(-1);
  list.forEach((b, i) => { for (let x = b.x; x < b.x + b.w && x < P; x++) col[x] = i; });
  return { P, list, col };
}

let L0, L1, L2, signs, board, bumps;
function setup() {
  L0 = genBuildings(V0 * N, 11, 7, 17, 44, 92, 1);
  L1 = genBuildings(V1 * N, 22, 14, 30, 50, 100, 3);
  L2 = genBuildings(V2 * N, 33, 30, 58, 38, 84, 22);
  const rc = rng(5); bumps = [];
  for (const [base, n] of [[14, 22]]) for (let i = 0; i < n; i++) bumps.push({ layer: base === 14 ? 0 : 1, cx: rc() * (W + 40) - 20, cy: base + rc() * 6, r: 8 + rc() * 12 });
  // Neon signs on the near buildings.
  const r = rng(99); signs = [];
  L2.list.forEach((b, i) => {
    if (i === 3) return; // billboard building
    const n = r() < 0.4 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const vertical = n === 2 ? true : r() < 0.65;
      const w = vertical ? 7 : 18 + Math.floor(r() * 10), h = vertical ? Math.min(b.h - 22, 22 + Math.floor(r() * 14)) : 7;
      const half = n === 2 ? Math.floor((b.w - 6) / 2) : b.w - 6;
      const x = b.x + 3 + (k === 1 ? half : 0) + Math.floor(r() * Math.max(1, half - w));
      const top = HOR - b.h;
      const y = top + 6 + Math.floor(r() * Math.max(1, b.h - h - 20));
      signs.push({ x, y, w, h, c: NEON[Math.floor(r() * NEON.length)], seed: Math.floor(r() * 1e6), flick: r() < 0.3 });
    }
  });
  const bb = L2.list[3];
  board = { x: bb.x + Math.floor((bb.w - 56) / 2), y: HOR - bb.h - 27, w: 56, h: 24 };
}

const tower = { x: 206, w: 22, top: 20 };

function drawSky(fr, f) {
  for (let y = 0; y < HOR; y++) for (let x = 0; x < W; x++) fr.px(x, y, sky(y / HOR + (Math.sin(x * 0.05 + y * 0.2) * 0.01), x, y));
  // Low overcast ceiling: scalloped cloud undersides, lit from the city below.
  for (const layer of [0]) for (let x = 0; x < W; x++) {
    let yb = layer === 0 ? 10 : -1;
    for (const bm of bumps) if (bm.layer === layer && Math.abs(x + 0.5 - bm.cx) < bm.r) yb = Math.max(yb, bm.cy + Math.sqrt(bm.r * bm.r - (x + 0.5 - bm.cx) ** 2) * 0.3);
    if (yb < 0) continue;
    for (let y = 0; y < yb; y++) fr.px(x, y, y >= Math.floor(yb) - 1 ? hex('#2e1852') : y >= Math.floor(yb) - 3 && bayer(x, y) < 0.35 ? hex('#1e1040') : hex('#0a0620'));
  }
  // Searchlights sweeping from the megatower.
  for (const [ph, spd] of [[0, 1], [0.37, -1]]) {
    const a = -Math.PI / 2 + Math.sin(TAU * (spd * f / N + ph)) * 0.55;
    const ox = tower.x + tower.w / 2, oy = HOR - 30;
    for (let y = 0; y < oy; y++) for (let x = 0; x < W; x++) {
      const dx = x - ox, dy = y - oy; const ang = Math.atan2(dy, dx); let da = Math.abs(ang - a); if (da > Math.PI) da = TAU - da;
      if (da < 0.05) fr.add(x, y, hex('#b9a4ff'), (da < 0.025 ? 0.14 : 0.07) * (1 - y / oy * 0.3));
    }
  }
  // Megatower silhouette (static, distant).
  const { x: tx, w: tw, top } = tower;
  for (let y = top; y < HOR; y++) {
    const inset = y < top + 6 ? 6 : y < top + 14 ? 3 : 0;
    for (let x = tx + inset; x < tx + tw - inset; x++) fr.px(x, y, hex('#1b1338'));
    if (y > top + 16 && y % 3 === 0) { fr.px(tx + 4, y, hex('#3c3a86')); fr.px(tx + tw - 5, y, hex('#3c3a86')); }
  }
  for (let y = top - 14; y < top; y++) fr.px(tx + tw / 2, y, hex('#2a2150'));
  if (mod(f, 50) < 25) { fr.px(tx + tw / 2, top - 15, hex('#ff3040')); fr.glow(tx + tw / 2 + 0.5, top - 14.5, 5, hex('#ff3040'), 0.35); }
}

function drawLayer(fr, f, L, v, draw) {
  const o = Math.floor(v * f);
  for (let x = 0; x < W; x++) {
    const u = mod(x + o, L.P); const bi = L.col[u]; if (bi < 0) continue;
    draw(x, u - L.list[bi].x, L.list[bi]);
  }
}
const roofTop = (b, lu) => {
  let t = HOR - b.h;
  if (b.roof === 1 && (lu < 2 || lu >= b.w - 2)) t += 3;
  if (b.roof === 2 && (lu < b.w / 3)) t += 5;
  return t;
};

function drawCity(fr, f) {
  // Far skyline.
  const c0 = hex('#34205a'), w0 = [hex('#5e4592'), hex('#a0684a'), hex('#6f58a8')];
  drawLayer(fr, f, L0, V0, (x, lu, b) => {
    const t = roofTop(b, lu);
    for (let y = t; y < HOR; y++) {
      let c = c0;
      if (lu % 3 === 1 && y % 4 === 1 && y > t + 2) { const h = hash(b.seed, lu, y); if (h < 0.28) c = w0[Math.floor(h * 10) % 3]; }
      fr.px(x, y, c);
    }
  });
  // Mid city.
  const c1 = hex('#1f1540'), rim = hex('#452a70');
  const w1 = [hex('#8fa8ff'), hex('#ffc27a'), hex('#6fe3ff'), hex('#ff8fb8')];
  drawLayer(fr, f, L1, V1, (x, lu, b) => {
    const t = roofTop(b, lu);
    if (b.roof === 3 && lu === (b.w >> 1)) { for (let y = t - 9; y < t; y++) fr.px(x, y, c1); if (mod(f + b.seed, 50) < 25) fr.px(x, t - 10, hex('#ff3848')); }
    for (let y = t; y < HOR; y++) {
      let c = lu === 0 ? rim : c1;
      if (lu > 1 && lu < b.w - 2 && lu % 4 !== 0 && y % 5 > 1 && y > t + 3) {
        const h = hash(b.seed, lu >> 2, (y / 5) | 0); if (h < 0.3) c = scale(w1[Math.floor(h * 13) % 4], 0.62);
      }
      fr.px(x, y, c);
    }
  });
  // Elevated rail and a night train running the other way.
  const o1 = Math.floor(V1 * f);
  for (let x = 0; x < W; x++) { fr.px(x, 101, hex('#2a1f46')); fr.px(x, 102, hex('#140e26')); if (mod(x + o1, 60) < 3) for (let y = 103; y < HOR; y++) fr.px(x, y, hex('#171030')); }
  const tx = mod(420 - 5 * f, 1500) - 200;
  if (tx > -170 && tx < W) for (let car = 0; car < 4; car++) {
    const x0 = tx + car * 38;
    for (let y = 90; y < 101; y++) for (let x = x0; x < x0 + 36; x++) {
      const nose = car === 0 && x - x0 < 4 && y < 90 + (4 - (x - x0)) * 2;
      if (nose) continue;
      let c = y === 90 ? hex('#4a3d78') : y === 100 ? hex('#120c22') : hex('#262044');
      if (y >= 93 && y <= 95 && mod(x - x0, 5) < 4 && x - x0 > 2 && x - x0 < 34) c = hex('#ffdc9a');
      if (y === 97) c = hex('#39e6ff');
      fr.px(x, y, c);
    }
    for (let x = x0; x < x0 + 36; x++) fr.add(x, 103, hex('#ffdc9a'), 0.12);
  }
  if (tx > -170 && tx < W) fr.glow(tx + 1, 96, 8, hex('#fff1c4'), 0.5, 3);
  // Near buildings, windows and neon.
  const c2 = hex('#0c0819'), e2 = hex('#1e1436');
  const w2 = [hex('#ffcf8a'), hex('#9fb8ff'), hex('#ffd9a8')];
  drawLayer(fr, f, L2, V2, (x, lu, b) => {
    const t = roofTop(b, lu);
    for (let y = t; y < HOR; y++) {
      let c = lu === 0 || y === t ? e2 : c2;
      if (lu > 3 && lu < b.w - 4 && lu % 6 > 2 && y % 8 > 3 && y > t + 5 && y < HOR - 6) {
        const h = hash(b.seed, (lu / 6) | 0, (y / 8) | 0); if (h < 0.22) c = scale(w2[Math.floor(h * 17) % 3], 0.5 + (lu % 6 === 3 ? 0.2 : 0));
      }
      fr.px(x, y, c);
    }
  });
  const o2 = Math.floor(V2 * f);
  const place = (u) => { let sx = mod(u - o2, L2.P); if (sx > W + 40) sx -= L2.P; return sx; };
  for (const s of signs) {
    const sx = place(s.x); if (sx < -40 || sx > W + 40) continue;
    const on = !(s.flick && hash(s.seed, mod(Math.floor(f / 3), N / 3)) < 0.18);
    const c = on ? s.c : scale(s.c, 0.3);
    if (on) for (let y = s.y - 7; y < s.y + s.h + 7; y++) for (let x = sx - 7; x < sx + s.w + 7; x++) {
      const dx = Math.max(sx - x, 0, x - (sx + s.w - 1)), dy = Math.max(s.y - y, 0, y - (s.y + s.h - 1)); const d = Math.hypot(dx, dy) / 7;
      if (d < 1 && d > 0) fr.add(x, y, s.c, 0.28 * Math.ceil((1 - d) * 3) / 3 * (1 - d));
    }
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const edge = x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1;
      let px = edge ? c : hex('#140a1c');
      if (!edge && x > 1 && y > 1 && x < s.w - 2 && y < s.h - 2) {
        const gx = s.w > s.h ? Math.floor((x - 2) / 4) : 0, gy = s.w > s.h ? 0 : Math.floor((y - 2) / 5);
        const lx = s.w > s.h ? (x - 2) % 4 : x - 2, ly = s.w > s.h ? y - 2 : (y - 2) % 5;
        if (lx < 3 && ly < 3 && hash(s.seed, gx, gy, lx, ly) < 0.62) px = on ? mix(c, [255, 255, 255], 0.35) : c;
      }
      fr.px(sx + x, s.y + y, px);
    }
  }
  // Rooftop billboard: the SnagThis pixel button.
  const bx = place(board.x);
  if (bx > -70 && bx < W + 10) {
    const { y: by, w: bw, h: bh } = board;
    for (let k = 0; k < 3; k++) fr.rect(bx + 8 + k * 18, by + bh, 2, 4, hex('#1e1436'));
    fr.glow(bx + bw / 2, by + bh / 2, 40, BRAND.o, 0.22, 5);
    fr.rect(bx - 1, by - 1, bw + 2, bh + 2, hex('#2a1a3c'));
    fr.rect(bx, by, bw, bh, hex('#160c1c'));
    const pulse = mod(f, 100) < 8 ? 1 : 0;
    sprite(fr, MASCOT, bx + 4, by + 4 + pulse, MASCOT_PAL);
    text(fr, 'SNAG', bx + 24, by + 6, hex('#fff4ea'));
    text(fr, 'THIS', bx + 24, by + 13, BRAND.o);
    for (let x = 0; x < bw; x += 2) fr.px(bx + x, by - 1, mod(x / 2 + Math.floor(f / 5), 6) < 3 ? BRAND.amber : hex('#3a2230'));
  }
}

function drawLamps(fr, f) {
  for (let k = 0; k < 6; k++) {
    const sx = mod(k * 180 - Math.floor(V3 * f), 1080) - 60; if (sx < -40 || sx > W + 20) continue;
    const top = 70;
    // Cone of light, stepped and dithered.
    for (let y = top + 5; y < ROAD + 6; y++) {
      const t = (y - top - 5) / (ROAD + 6 - top - 5); const half = 2 + t * 17;
      for (let x = Math.floor(sx + 13 - half); x < sx + 13 + half; x++) {
        const e = 1 - Math.abs(x - (sx + 13)) / half; fr.add(x, y, hex('#ffc27a'), e > 0.5 ? 0.15 : 0.07);
      }
    }
    fr.rect(sx, top, 2, HOR - top + 4, hex('#15101f'));
    fr.rect(sx, top, 1, HOR - top + 4, hex('#2e2440'));
    fr.rect(sx, top, 14, 2, hex('#15101f'));
    fr.rect(sx + 10, top + 2, 6, 2, hex('#221a30'));
    fr.rect(sx + 11, top + 4, 4, 1, hex('#ffe3b0'));
    fr.glow(sx + 13, top + 5, 9, hex('#ffd9a0'), 0.45, 3);
  }
}

// A low sports coupe, side view (original design), built procedurally into an 80 × 24 layer.
const CW = 80, CH = 24;
function buildCar(f) {
  const L = new Layer(CW, CH);
  const C = { out: hex('#0d1226'), hi: hex('#4a6aa8'), b: hex('#27396a'), s: hex('#18244a'), k: hex('#07060c'), rim: hex('#ff5aa8'),
    g1: hex('#7fe8ff'), g2: hex('#2aa6d0'), g3: hex('#16507e'), p: hex('#0d1226'), tl: hex('#ff2a3d'), tl2: hex('#ffb0b0'), hl: hex('#fff6d0'), o: BRAND.o, o2: BRAND.o2, chrome: hex('#9aa6c8') };
  const roof = (c) => (c < 17 || c > 61 ? null : c < 29 ? Math.round(8 - (c - 17) * 8 / 12) : c <= 45 ? 0 : Math.round((c - 45) * 8 / 16));
  const bodyTop = (c) => (c < 3 ? 9 : c < 62 ? 8 : 8 + Math.round((c - 62) * 3 / 17));
  const wheels = [16, 63];
  for (let c = 0; c < CW; c++) {
    const r = roof(c);
    if (r !== null) for (let y = r; y < 8; y++) {
      let col;
      if (y === r) col = c >= 29 && c <= 45 ? C.rim : C.out;
      else if (c === 18 || c === 19 || c === 40 || c === 41 || y === 7) col = C.p;
      else if (c > 45 && y - 1 <= Math.round((c - 45) * 8 / 16)) col = C.p; // A-pillar edge
      else { const t = (y - r) / (8 - r); const diag = mod(c - y * 2, 22) < 3; col = diag ? C.g1 : t < 0.35 ? C.g2 : C.g3; }
      L.px(c, y, col);
    }
    const top = bodyTop(c); const bot = c < 2 || c > 77 ? 15 : 17;
    for (let y = top; y <= bot; y++) {
      const arch = wheels.some((wx) => Math.hypot(c + 0.5 - wx, y + 0.5 - 18) < 7.5);
      if (arch) { if (wheels.some((wx) => Math.hypot(c + 0.5 - wx, y + 0.5 - 18) >= 6.5)) L.px(c, y, C.k); continue; }
      let col = y === top ? C.hi : y === 12 ? C.o : y === 13 ? C.o2 : y > 13 ? C.s : C.b;
      if (y === bot) col = C.out;
      if (c === 44 && y > top && y < 16) col = C.out;
      if (c === 37 && y === 10) col = C.chrome;
      L.px(c, y, col);
    }
  }
  for (let y = 9; y <= 11; y++) for (let c = 0; c < 3; c++) L.px(c, y, y === 10 && c === 0 ? C.tl2 : C.tl);
  for (let c = 1; c < 8; c++) L.px(c, 7, C.out); L.px(2, 6, C.out); L.px(6, 6, C.out); // spoiler
  L.px(59, 7, C.out); L.px(60, 7, C.out); L.px(60, 6, C.out); // mirror
  for (let c = 74; c < 80; c++) L.px(c, 11, C.hl); L.px(79, 12, C.hl); L.px(78, 12, C.hl);
  // Wheels (4-fold hub turning 22.5° per frame loops every 4 frames).
  const ang = (TAU * f) / 16;
  for (const wx of wheels) {
    for (let y = 11; y < 24; y++) for (let x = wx - 7; x < wx + 7; x++) {
      const d = Math.hypot(x + 0.5 - wx, y + 0.5 - 18);
      if (d < 5.8) L.px(x, y, d < 3.6 ? hex('#3a4060') : C.k);
    }
    for (let k = 0; k < 4; k++) { const a = ang + (k * Math.PI) / 2; L.px(wx - 1 + Math.round(Math.cos(a) * 2.4) + 0.5, 17 + Math.round(Math.sin(a) * 2.4) + 0.5, C.chrome); }
    L.px(wx - 1, 17, C.o); L.px(wx, 17, C.o); L.px(wx - 1, 18, C.o2); L.px(wx, 18, C.o2);
  }
  return L;
}

function drawCar(fr, f) {
  const cx = 100, base = 166;
  const bob = Math.sin((TAU * 9 * f) / N) > 0.55 ? 1 : 0;
  const top = base - CH + bob;
  // Headlight beam.
  for (let x = cx + CW; x < W; x++) {
    const t = (x - cx - CW) / 150; const half = 2 + t * 26;
    for (let y = Math.floor(top + 11 - half * 0.35); y < top + 11 + half * 0.8; y++) {
      if (y >= base + 2) continue;
      fr.add(x, y, hex('#fff1c4'), Math.max(0, 0.24 - t * 0.2) * (bayer(x, y) < 0.8 ? 1 : 0.4));
    }
  }
  const car = buildCar(f);
  // Rippled reflection on the wet road.
  for (let j = 0; j < CH - 4; j++) {
    const rip = Math.round(Math.sin(j * 1.3 + (TAU * 5 * f) / N) * 1.2);
    for (let i = 0; i < CW; i++) { const c = car.get(i, CH - 7 - j); if (c) fr.blend(cx + i + rip, base - 1 + j + bob, c, 0.28 - j * 0.012); }
  }
  fr.blendRect(cx + 4, base - 1, CW - 8, 1, hex('#050409'), 0.8);
  car.stamp(fr, cx, top);
  fr.glow(cx + 1, top + 10, 9, hex('#ff2a3d'), 0.55, 3);
  fr.glow(cx + CW - 1, top + 11.5, 8, hex('#fff1c4'), 0.6, 3);
  // Neon sheen sliding along the body.
  const sweep = mod(2 * f, 200) - 60;
  for (let y = 8; y < 17; y++) for (let i = 0; i < CW; i++) { const c = car.get(i, y); if (c && Math.abs(i - sweep - y) < 2 && y !== 12 && y !== 13) fr.blend(cx + i, top + y, hex('#8a78d8'), 0.45); }
}

function drawStreet(fr, f) {
  // Sidewalk with curb.
  for (let y = HOR; y < ROAD; y++) for (let x = 0; x < W; x++) {
    const seam = mod(x + Math.floor(V3 * f), 24) === 0; fr.px(x, y, y === HOR ? hex('#3a2c56') : y === ROAD - 1 ? hex('#4a3a6c') : seam ? hex('#150f22') : hex('#211a33'));
  }
  // Wet asphalt: reflect the city above the street line, rippled.
  for (let y = ROAD; y < H; y++) {
    const d = y - ROAD; const sy = HOR - 1 - d * 2.3;
    const rip = Math.round(Math.sin(y * 0.9 + TAU * 3 * (f - f % 4) / N) * 1.3);
    const fade = 0.62 - d / 90;
    for (let x = 0; x < W; x++) {
      const base = hex('#0c0a16');
      const s = fr.get(x + rip, sy);
      const lum = Math.max(s[0], s[1], s[2]);
      const k = lum > 70 ? fade : fade * 0.35;
      fr.px(x, y, [base[0] + s[0] * k, base[1] + s[1] * k, base[2] + s[2] * k].map((v) => Math.min(255, v)));
    }
  }
  // Lane dashes.
  for (let x = 0; x < W; x++) if (mod(x + Math.floor(V3 * f), 60) < 26) { fr.px(x, 175, hex('#6a6480')); fr.px(x, 176, hex('#403b55')); }
}

function drawRain(fr, f) {
  const span = 200;
  f -= f % 2; // rain animates on twos: crisper streaks, cheaper to encode
  for (let i = 0; i < 130; i++) {
    const near = hash(i, 1) < 0.3; const k = near ? 12 + (i % 3) : 9 + (i % 3);
    const vy = (k * span) / N; const y0 = hash(i, 2) * span; const pos = y0 + vy * f;
    const cyc = mod(Math.floor(pos / span), k); const yr = Math.floor(mod(pos, span)) - 10;
    const x = Math.floor(mod(hash(i, cyc, 3) * 340 - yr * 0.25, 340)) - 10;
    const len = near ? 6 : 4;
    for (let j = 0; j < len; j++) {
      const px = x + (j >> 2), py = yr - j;
      const inBeam = px > 182 && py > 136 && py < 170;
      fr.px(px, py, inBeam ? hex('#fff1d0') : near ? (j < 3 ? hex('#aeb6f0') : hex('#7278b8')) : hex('#595e9e'));
    }
  }
  // Splashes on the road.
  for (let j = 0; j < 36; j++) {
    const p = [12, 15, 20, 25][j % 4]; const lt = mod(f + j * 7, p); if (lt > 3) continue;
    const cyc = mod(Math.floor((f + j * 7) / p), N / p);
    const x = Math.floor(hash(j, cyc) * W) - Math.floor(V3 * lt), y = ROAD + 2 + Math.floor(hash(j, cyc, 5) * (H - ROAD - 4));
    const c = hex('#9aa4e8');
    if (lt === 0) fr.blend(x, y, c, 0.8);
    else if (lt === 1) { fr.blend(x - 1, y - 1, c, 0.7); fr.blend(x + 1, y - 1, c, 0.7); }
    else { fr.blend(x - 2, y - 1, c, 0.4); fr.blend(x + 2, y - 1, c, 0.4); fr.blend(x, y, c, 0.3); }
  }
}

function render(fr, f) {
  drawSky(fr, f);
  drawCity(fr, f);
  drawLamps(fr, f);
  drawStreet(fr, f);
  drawCar(fr, f);
  drawRain(fr, f);
  // Lightning: one double flash per loop.
  const lf = f - 212; if (lf >= 0 && lf < 7 && lf !== 2) {
    const a = [0.35, 0.2, 0, 0.28, 0.12, 0.06, 0.02][lf];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fr.add(x, y, hex('#c8c0ff'), a * (y < HOR ? 1 : 0.4));
  }
}

export default {
  id: 'neon-rain', frames: N, poster: 12, kbps: 640, setup, render,
};
