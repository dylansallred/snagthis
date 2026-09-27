// Star Courier — a tiny arcade space run past a ringed planet.
import { W, H, TAU, hex, mix, scale, clamp, mod, rng, hash, bayer, bands, sprite, text, MASCOT, MASCOT_PAL, BRAND, Frame } from './lib.mjs';

const N = 300; // 10 s
const wrapDt = (t, t0) => mod(t - t0 + N / 2, N) - N / 2; // signed, loop-aware time since t0

let bg, starLayers, rocks;
const PLANET = { x: 258, y: 132, r: 54 };

function setup() {
  // Static backdrop: deep space gradient plus a dithered nebula.
  bg = new Frame();
  const base = bands(['#04051a', '#080a26', '#120c32', '#1a0e3a'], 8);
  const neb = [hex('#1e1048'), hex('#34166a'), hex('#5a1e7e'), hex('#8a2a86'), hex('#c04a8a')];
  const teal = [hex('#0e1c40'), hex('#123a5a'), hex('#1a5a72')];
  const vn = (x, y, s, seed) => { // smooth 2-D value noise
    const xi = Math.floor(x / s), yi = Math.floor(y / s), fx = x / s - xi, fy = y / s - yi;
    const sm = (t) => t * t * (3 - 2 * t); const h = (a, b) => hash(a, b, seed);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * sm(fx) + (c - a) * sm(fy) + (a - b - c + d) * sm(fx) * sm(fy);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = base(y / H, x, y);
    const n = vn(x, y, 48, 1) * 0.55 + vn(x, y, 20, 2) * 0.3 + vn(x, y, 8, 3) * 0.15;
    const band = Math.exp(-(((y - 70 - (x - 160) * 0.35) / 50) ** 2));
    const v = n * band * 1.5 - 0.35;
    if (v > 0) { const lv = v * neb.length * 1.6; const i = Math.floor(lv); const t = clamp((lv - i - 0.5) * 2.5 + 0.5, 0, 1); const idx = Math.min(neb.length - 1, t > bayer(x, y) ? i + 1 : i); if (idx >= 0) c = neb[idx]; }
    const tn = vn(x + 300, y, 36, 4) * 0.7 + vn(x, y, 12, 5) * 0.3;
    const tb = Math.exp(-(((x - 60) / 70) ** 2 + ((y - 140) / 50) ** 2));
    const tv = tn * tb * 1.8 - 0.55;
    if (tv > 0 && v <= 0) { const lv = tv * teal.length * 2.5; const i = Math.min(teal.length - 1, Math.floor(lv) + (lv % 1 > bayer(x, y) ? 1 : 0)); c = teal[i]; }
    bg.px(x, y, c);
  }
  const r = rng(3);
  starLayers = [
    { v: 1.2, n: 40, col: [hex('#5a5a8a'), hex('#8a7ab8')] },
    { v: 2.4, n: 30, col: [hex('#a8b0e8'), hex('#e0d8ff')] },
    { v: 4.8, n: 22, col: [hex('#ffffff'), hex('#ffe6b0')], big: true },
    { v: 9.6, n: 10, col: [hex('#6a74b8')], streak: true },
  ].map((L) => ({ ...L, P: L.v * N, stars: Array.from({ length: L.n }, () => ({ u: r() * L.v * N, y: Math.floor(r() * H), ph: Math.floor(r() * 99), c: Math.floor(r() * 2) })) }));
  rocks = Array.from({ length: 5 }, (_, i) => {
    const pts = []; const k = 9; const rad = 5 + r() * 6;
    for (let j = 0; j < k; j++) pts.push(rad * (0.7 + r() * 0.4));
    return { u: (i * 900) / 5 + r() * 60, y: 20 + r() * 140, rad, pts, spin: (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2)), seed: i };
  });
}

function drawStars(fr, f) {
  for (const L of starLayers) for (const s of L.stars) {
    const x = Math.floor(mod(s.u - L.v * f, L.P)); if (x >= W + 16) continue;
    const c = L.col[s.c % L.col.length];
    if (L.streak) { for (let i = 0; i < 14; i++) fr.blend(x + i, s.y, c, 0.5 - i * 0.03); continue; }
    fr.px(x, s.y, c);
    if (L.big && mod(f + s.ph, 20) < 10) { fr.blend(x - 1, s.y, c, 0.5); fr.blend(x + 1, s.y, c, 0.5); fr.blend(x, s.y - 1, c, 0.5); fr.blend(x, s.y + 1, c, 0.5); }
  }
}

function drawPlanet(fr, f) {
  const { x: px, y: py, r } = PLANET;
  const ringA = 1.9, ringB = 0.32, tilt = -0.28;
  const ring = (front) => {
    for (let y = py - r * 0.9; y < py + r * 0.9; y++) for (let x = px - r * ringA - 4; x < W; x++) {
      const dx = x + 0.5 - px, dy = y + 0.5 - py;
      const rx = dx * Math.cos(tilt) + dy * Math.sin(tilt), ry = -dx * Math.sin(tilt) + dy * Math.cos(tilt);
      const e = Math.hypot(rx / (r * ringA), ry / (r * ringA * ringB));
      if (e < 0.72 || e > 1) continue;
      const isFront = ry > 0; if (isFront !== front) continue;
      if (!front && Math.hypot(dx, dy) < r) continue;
      const band = e < 0.8 ? hex('#8a6ad0') : e < 0.86 ? hex('#c8a8ff') : e < 0.9 ? hex('#5a3a98') : hex('#b090f0');
      const shade = Math.hypot(dx, dy) < r + 2 && !front ? 0.5 : dx > 20 ? 0.75 : 1;
      fr.px(x, y, scale(band, shade).map(Math.round));
    }
  };
  ring(false);
  const L = [-0.62, -0.5, 0.6]; const ln = Math.hypot(...L);
  const cols = [hex('#0a1a30'), hex('#0f3048'), hex('#16586a'), hex('#239086'), hex('#5cc8a8'), hex('#b8f0d0')];
  const rot = (TAU * f) / N;
  for (let y = py - r; y < py + r; y++) for (let x = px - r; x < px + r; x++) {
    const dx = (x + 0.5 - px) / r, dy = (y + 0.5 - py) / r; const d2 = dx * dx + dy * dy; if (d2 > 1) continue;
    const dz = Math.sqrt(1 - d2);
    const lit = clamp((dx * L[0] + dy * L[1] + dz * L[2]) / ln, 0, 1);
    const lat = Math.asin(dy), lon = Math.atan2(dx, dz) + rot;
    let bandv = Math.sin(lat * 9 + Math.sin(lon * 2) * 0.35) * 0.5 + Math.sin(lat * 23) * 0.2;
    // A storm drifting across the face once per loop.
    const sl = mod(lon - 0.4 + Math.PI, TAU) - Math.PI; const storm = Math.hypot(sl * 2.2, (lat - 0.32) * 5.5);
    let lv = lit * 4.2 + bandv * 0.9 + 0.3;
    if (storm < 1 && dz > 0) lv += storm < 0.5 ? 1.6 : 0.8;
    const edge = d2 > 0.9 ? 0.6 : 0;
    const fl = Math.floor(lv + edge), fr_ = lv + edge - fl; const i = clamp(fl + ((fr_ - 0.5) * 3 + 0.5 > bayer(x, y) ? 1 : 0), 0, cols.length - 1);
    fr.px(x, y, storm < 0.5 && dz > 0 && lit > 0.1 ? hex('#ff9a5a') : cols[i]);
  }
  // Atmosphere rim.
  for (let a = 0; a < TAU; a += 0.004) { const x = px + Math.cos(a) * (r + 0.5), y = py + Math.sin(a) * (r + 0.5); if (Math.cos(a) * L[0] + Math.sin(a) * L[1] > 0) fr.blend(x, y, hex('#9af0ff'), 0.7); }
  ring(true);
}

function drawRocks(fr, f) {
  for (const k of rocks) {
    const cx = mod(k.u - 3 * f, 900) - 30; if (cx < -20 || cx > W + 20) continue;
    const cy = k.y + 3 * Math.sin(TAU * f / N + k.seed); const ang = (TAU * k.spin * f) / N;
    const n = k.pts.length;
    for (let y = Math.floor(cy - k.rad - 2); y <= cy + k.rad + 2; y++) for (let x = Math.floor(cx - k.rad - 2); x <= cx + k.rad + 2; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy; const a = mod(Math.atan2(dy, dx) - ang, TAU) / TAU * n;
      const i = Math.floor(a), t = a - i; const rr = k.pts[i % n] * (1 - t) + k.pts[(i + 1) % n] * t; const d = Math.hypot(dx, dy);
      if (d > rr) continue;
      const lit = (-dx - dy) / (rr * 1.4) + (hash(Math.floor(a * 3), k.seed) - 0.5) * 0.3;
      fr.px(x, y, d > rr - 1 ? hex('#1a1426') : lit > 0.35 ? hex('#8a7a8a') : lit > -0.1 ? hex('#5a4a5e') : hex('#3a2e40'));
    }
  }
}

// Player ship (original design), nose to the right.
const SHIP = [
  '....kk....................',
  '....kak...................',
  '.....kaak.................',
  '.....kdaak................',
  'kkk..kddoakkkk............',
  'kgkkkkooooooaawwkk........',
  'kggggkooooooacccwwwkk.....',
  'kggggkoooooooaCCccwwwwkk..',
  'kggggkoooooooooooooooaaawk',
  'kgkkkkdddddoooooooddddkkk.',
  'kkk..kddodkkkkkkkkk.......',
  '.....kdook................',
  '.....kddk.................',
  '....kdk...................',
  '....kk....................',
];
const SHIP_PAL = { k: hex('#2a1210'), a: BRAND.amber, o: BRAND.o, d: BRAND.o2, w: hex('#fff4e0'), c: hex('#6ff0ff'), C: hex('#1a6aa0'), g: hex('#7a7f98') };
const shipX = (t) => 56 + Math.round(6 * Math.sin((TAU * 2 * t) / N + 0.5));
const shipY = (t) => Math.round(82 + 30 * Math.sin((TAU * t) / N) + 9 * Math.sin((TAU * 3 * t) / N + 1));

const ENEMY = [
  '...kkkkk...',
  '..kmmmmmk..',
  '.kmMmmmmmk.',
  'kmMwwmmmmmk',
  'kmwrrwmmmMk',
  'kmMwwmmmMMk',
  '.kmmmmmMMk.',
  '..kkmkmkk..',
  '...k.k.k...',
];
const ENEMY_PAL = { k: hex('#1a0512'), m: hex('#ff5a9a'), M: hex('#b0206a'), w: hex('#ffffff'), r: hex('#2a0a1a') };

// Scripted kills: each enemy dies at time tk, at x = xk, from a bolt aimed at it.
const BOLT_V = 7;
const KILLS = [
  { tk: 58, xk: 214, amp: 14, w: 2 }, { tk: 76, xk: 196, amp: 10, w: 3 }, { tk: 94, xk: 230, amp: 16, w: 2 }, { tk: 112, xk: 206, amp: 12, w: 3 },
  { tk: 212, xk: 222, amp: 14, w: 2 }, { tk: 236, xk: 200, amp: 18, w: 3 }, { tk: 258, xk: 216, amp: 12, w: 2 },
].map((k) => {
  const tf = k.tk - Math.round((k.xk - (shipX(k.tk) + 26)) / BOLT_V);
  return { ...k, tf, by: shipY(tf) + 8, bx0: shipX(tf) + 26 };
});
const POWER = { tc: 168 };

function drawEnemies(fr, f) {
  for (const k of KILLS) {
    const dt = wrapDt(f, k.tk);
    if (dt < 0 && dt > -140) {
      const x = k.xk - dt * 1.7, y = k.by + k.amp * Math.sin((dt * k.w * TAU) / 120);
      if (x < W + 12) { const blink = mod(f, 6) < 3; sprite(fr, ENEMY, x - 5, y - 4, blink ? ENEMY_PAL : { ...ENEMY_PAL, r: hex('#ffe08a') }); }
    }
    // Bolt.
    const bt = wrapDt(f, k.tf);
    if (bt >= 0 && k.tf + bt <= k.tk) {
      const x = k.bx0 + bt * BOLT_V;
      for (let i = 0; i < 7; i++) fr.px(x - i, k.by, i < 2 ? hex('#fff6d0') : i < 5 ? BRAND.amber : BRAND.o);
      fr.px(x - 1, k.by - 1, BRAND.amber); fr.px(x - 1, k.by + 1, BRAND.amber);
      fr.glow(x - 1, k.by + 0.5, 4, BRAND.amber, 0.35, 2);
    }
    // Explosion.
    if (dt >= 0 && dt < 26) {
      const cx = k.xk, cy = k.by;
      if (dt < 3) fr.glow(cx, cy, 16 - dt * 3, hex('#fff2c8'), 0.9, 4);
      const rr = 3 + dt * 1.4; if (dt < 14) for (let a = 0; a < TAU; a += 0.06) if (hash(Math.floor(a * 20), k.tk) < 0.7 - dt * 0.04) fr.px(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, dt < 6 ? hex('#ffe08a') : BRAND.o);
      for (let p = 0; p < 18; p++) {
        const a = hash(p, k.tk) * TAU, sp = 0.6 + hash(p, k.tk, 1) * 1.8; const d = sp * dt * (1 - dt / 60);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const c = dt < 4 ? hex('#ffffff') : dt < 9 ? hex('#ffe08a') : dt < 15 ? BRAND.amber : dt < 20 ? BRAND.o : BRAND.o2;
        fr.px(x, y, c); if (dt < 10 && p % 3 === 0) { fr.px(x + 1, y, c); fr.px(x, y + 1, c); fr.px(x + 1, y + 1, c); }
      }
      if (dt > 3 && dt < 26) text(fr, '+100', cx - 7, cy - 10 - Math.floor(dt / 2), dt % 4 < 2 ? hex('#fff4e0') : BRAND.amber, hex('#2a1210'));
    }
  }
}

function drawPower(fr, f) {
  const dt = wrapDt(f, POWER.tc);
  if (dt < 0 && dt > -120) {
    const x = shipX(POWER.tc) + 12 - dt * 1.6, y = shipY(POWER.tc) + 1 + Math.round(6 * Math.sin((dt * TAU) / 40));
    fr.glow(x + 8, y + 8, 16, BRAND.o, 0.35 + 0.15 * Math.sin((f * TAU) / 15), 4);
    sprite(fr, MASCOT, x, y, MASCOT_PAL);
  }
  if (dt >= 0 && dt < 30) text(fr, 'SNAG!', shipX(f) + 4, shipY(f) - 10 - Math.floor(dt / 3), dt % 4 < 2 ? BRAND.amber : hex('#fff4e0'), hex('#2a1210'));
}

function drawShip(fr, f) {
  const x = shipX(f), y = shipY(f);
  // Exhaust trail: particles emitted in the past, drifting left.
  for (let age = 1; age < 16; age++) {
    const ey = shipY(f - age) + 7 + Math.round((hash(mod(f - age, N), 9) - 0.5) * 3);
    const ex = shipX(f - age) - 3 - age * 3;
    const c = age < 3 ? hex('#fff2c0') : age < 6 ? BRAND.amber : age < 10 ? BRAND.o : hex('#6a2a50');
    fr.px(ex, ey, c); if (age < 6) fr.px(ex, ey + 1, c);
  }
  const fl = 4 + (mod(f, 3) === 0 ? 3 : mod(f, 3));
  for (let i = 0; i < fl; i++) { fr.px(x - 1 - i, y + 7, i < 2 ? hex('#ffffff') : BRAND.amber); if (i < fl - 2) { fr.px(x - 1 - i, y + 6, BRAND.o); fr.px(x - 1 - i, y + 8, BRAND.o); } }
  fr.glow(x - 2, y + 7.5, 7, BRAND.amber, 0.45, 3);
  sprite(fr, SHIP, x, y, SHIP_PAL);
  // Shield after grabbing the power-up.
  const dt = wrapDt(f, POWER.tc);
  if (dt >= 0 && dt < 90 && !(dt > 60 && mod(dt, 6) < 3)) {
    const cx = x + 13, cy = y + 7.5, rr = 17 + (dt < 6 ? 6 - dt : 0);
    for (let a = 0; a < TAU; a += 0.03) { const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.8; fr.blend(px, py, mod(a * 10 + f * 0.5, 4) < 2 ? hex('#6ff0ff') : hex('#ffb238'), 0.8); }
    if (dt < 8) fr.glow(cx, cy, 28, hex('#6ff0ff'), 0.4 * (1 - dt / 8), 4);
  }
}

function drawHud(fr, f) {
  for (let i = 0; i < 3; i++) { const x = 6 + i * 9, y = 6; fr.rect(x, y + 2, 6, 2, BRAND.o); fr.px(x + 6, y + 3, BRAND.amber); fr.px(x + 1, y + 1, BRAND.amber); fr.px(x + 1, y + 4, BRAND.o2); }
  text(fr, 'STAGE 3', W - 34, 6, hex('#e0d8ff'), hex('#1a0e3a'));
}

function render(fr, f) {
  fr.d.set(bg.d);
  drawStars(fr, f);
  drawPlanet(fr, f);
  drawRocks(fr, f);
  drawPower(fr, f);
  drawEnemies(fr, f);
  drawShip(fr, f);
  drawHud(fr, f);
}

export default { id: 'star-courier', frames: N, poster: 62, kbps: 640, setup, render };
