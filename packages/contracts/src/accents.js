// Node's CommonJS loader runs this file with `this` bound to the exports object;
// classic scripts (popup, service worker) bind the global object and ES modules leave it undefined.
(function (exported, factory) {
  if (exported) Object.assign(exported, factory());
  else globalThis.SnagThisAccents = factory();
})(this && this !== globalThis ? this : null, function () {
  'use strict';

  /**
   * Owner-selected accent colours (unique-look option 9), shared by the desktop app and the
   * Chrome extension. The @theme values in both stylesheets stay orange (scripts/check-tokens.cjs);
   * these maps override them on <html> at runtime.
   * White labels sit on `primary` and `primary-strong` only; contrast against #fff:
   *
   * | Accent  | primary            | white | strong             | white | hover on raised |
   * |---------|--------------------|-------|--------------------|-------|-----------------|
   * | Orange  | hsl(18 96% 40%)    | 5.04  | hsl(18 96% 36%)    | 5.95  | 5.84            |
   * | Cobalt  | hsl(220 80% 50%)   | 5.55  | hsl(220 80% 45%)   | 6.55  | 5.48            |
   * | Violet  | hsl(262 70% 54%)   | 6.28  | hsl(262 70% 48%)   | 7.73  | 5.34            |
   * | Mint    | hsl(160 84% 28%)   | 4.76  | hsl(160 84% 24%)   | 6.03  | 10.08           |
   * | Magenta | hsl(330 75% 46%)   | 5.21  | hsl(330 75% 41%)   | 6.24  | 5.83            |
   *
   * Progress, success green and amber problem colours are never part of a theme.
   */
  const DEFAULT_ACCENT = 'orange';
  const ACCENTS = [
    { id: 'orange', name: 'Orange', swatch: '#fa5d0e' },
    { id: 'cobalt', name: 'Cobalt', swatch: '#3b7bff' },
    { id: 'violet', name: 'Violet', swatch: '#8b5cf6' },
    { id: 'mint', name: 'Mint', swatch: '#1fbf8a' },
    { id: 'magenta', name: 'Magenta', swatch: '#e8388e' },
  ];
  const ACCENT_IDS = ACCENTS.map(function (accent) { return accent.id; });
  // `logo` is "THIS" in the logo; bevel* are the pixel play button's face, lit (top-left) edge and shaded edge/shadow.
  const ACCENT_TOKENS = {
    orange: { primary: 'hsl(18 96% 40%)', strong: 'hsl(18 96% 36%)', hover: 'hsl(20 96% 52%)', muted: 'hsl(16 58% 16%)', ring: 'hsl(18 96% 44%)', logo: '#fa5d0e', bevelFace: '#fa5d0e', bevelLight: '#ffb238', bevelDark: '#bd3f00' },
    cobalt: { primary: 'hsl(220 80% 50%)', strong: 'hsl(220 80% 45%)', hover: 'hsl(218 95% 63%)', muted: 'hsl(220 50% 18%)', ring: 'hsl(219 88% 56%)', logo: '#4a88ff', bevelFace: '#3b7bff', bevelLight: '#a3c6ff', bevelDark: '#1d44b0' },
    violet: { primary: 'hsl(262 70% 54%)', strong: 'hsl(262 70% 48%)', hover: 'hsl(262 90% 70%)', muted: 'hsl(262 45% 20%)', ring: 'hsl(262 80% 62%)', logo: '#9b78ff', bevelFace: '#8b5cf6', bevelLight: '#d0bcff', bevelDark: '#5528b8' },
    mint: { primary: 'hsl(160 84% 28%)', strong: 'hsl(160 84% 24%)', hover: 'hsl(158 70% 50%)', muted: 'hsl(160 50% 13%)', ring: 'hsl(159 77% 40%)', logo: '#26d996', bevelFace: '#1fbf8a', bevelLight: '#a4f3cc', bevelDark: '#0d7a57' },
    magenta: { primary: 'hsl(330 75% 46%)', strong: 'hsl(330 75% 41%)', hover: 'hsl(330 90% 64%)', muted: 'hsl(330 50% 18%)', ring: 'hsl(330 82% 55%)', logo: '#f550a0', bevelFace: '#e8388e', bevelLight: '#ffb3d6', bevelDark: '#9c1558' },
  };
  // Never more than a day ahead of this machine's clock, so a bad stamp cannot pin a choice forever.
  const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

  function isAccent(value) { return typeof value === 'string' && ACCENT_IDS.indexOf(value) !== -1; }

  function isAccentTimestamp(value, now) {
    return Number.isSafeInteger(value) && value >= 0 && value <= (now === undefined ? Date.now() : now) + MAX_CLOCK_SKEW_MS;
  }

  /** CSS custom properties set on <html> for an accent. */
  function accentVariables(id) {
    const tokens = ACCENT_TOKENS[isAccent(id) ? id : DEFAULT_ACCENT];
    return [
      ['--color-primary', tokens.primary], ['--color-primary-strong', tokens.strong], ['--color-primary-hover', tokens.hover],
      ['--color-primary-muted', tokens.muted], ['--color-ring', tokens.ring],
      ['--accent-logo', tokens.logo], ['--accent-bevel-face', tokens.bevelFace], ['--accent-bevel-light', tokens.bevelLight], ['--accent-bevel-dark', tokens.bevelDark],
    ];
  }

  /**
   * Last change wins. Each side keeps { accent, changedAt } (ms); a missing or invalid
   * record never beats a valid one, and a tie keeps `local` so nothing flip-flops.
   */
  function newerAccent(local, remote) {
    const valid = function (record) { return Boolean(record) && isAccent(record.accent) && isAccentTimestamp(record.changedAt); };
    if (!valid(remote)) return valid(local) ? local : { accent: DEFAULT_ACCENT, changedAt: 0 };
    if (!valid(local)) return remote;
    return remote.changedAt > local.changedAt ? remote : local;
  }

  // The logo's Pixel bevel play button on its 16 × 16 grid, computed exactly as
  // scripts/render-brand-assets.cjs does (tests/accents.test.js checks both agree).
  const GRID = 16;
  const GLYPH = ['................', '................', '................', '.....##.........', '.....###........', '.....#####......', '.....######.....', '.....########...', '.....########...', '.....######.....', '.....#####......', '.....###........', '.....##.........', '................', '................', '................'];
  // The dozing mascot shows pause bars on the same tile (desktop components/brand/PixelButton.tsx).
  const PAUSE = function (x, y) { return y >= 4 && y <= 11 && (x === 5 || x === 6 || x === 9 || x === 10); };
  const roleCache = {};
  /**
   * 'face' | 'light' | 'dark' | 'shade' | 'glyph' | '' for every cell, row by row. `shade` is the
   * glyph's one-pixel cast shadow, drawn in the dark bevel colour.
   */
  function buttonRoles(variant) {
    const kind = variant === 'pause' ? 'pause' : 'play';
    if (roleCache[kind]) return roleCache[kind];
    const insets = [3, 1, 1];
    const inside = function (x, y) {
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
      const inset = insets[y] !== undefined ? insets[y] : insets[GRID - 1 - y] !== undefined ? insets[GRID - 1 - y] : 0;
      return x >= inset && x < GRID - inset;
    };
    const glyph = kind === 'pause' ? PAUSE : function (x, y) { return y >= 0 && y < GRID && GLYPH[y][x] === '#'; };
    const roles = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let role = '';
        if (inside(x, y)) {
          const up = !inside(x, y - 1); const left = !inside(x - 1, y); const down = !inside(x, y + 1); const right = !inside(x + 1, y);
          role = 'face';
          if ((up || left) && !(down || right)) role = 'light';
          else if ((down || right) && !(up || left)) role = 'dark';
          else if (up || left || down || right) role = x + y < 15 ? 'light' : 'dark';
          if (glyph(x - 1, y - 1) && !glyph(x, y)) role = 'shade';
          if (glyph(x, y)) role = 'glyph';
        }
        roles.push(role);
      }
    }
    roleCache[kind] = roles;
    return roles;
  }

  function rgb(hex) { return [1, 3, 5].map(function (index) { return parseInt(hex.slice(index, index + 2), 16); }); }

  /**
   * RGBA pixels of the pixel button in an accent, `scale` screen pixels per cell
   * (16px toolbar icon = scale 1, 32px = 2), for chrome.action.setIcon's ImageData.
   */
  function buttonIconPixels(id, scale) {
    const cell = Math.max(1, Math.floor(scale || 1));
    const size = GRID * cell;
    const tokens = ACCENT_TOKENS[isAccent(id) ? id : DEFAULT_ACCENT];
    const colors = { face: rgb(tokens.bevelFace), light: rgb(tokens.bevelLight), dark: rgb(tokens.bevelDark), shade: rgb(tokens.bevelDark), glyph: rgb('#0c0e11') };
    const roles = buttonRoles();
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const role = roles[Math.floor(y / cell) * GRID + Math.floor(x / cell)];
        if (!role) continue;
        const offset = (y * size + x) * 4; const color = colors[role];
        data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = 255;
      }
    }
    return { width: size, height: size, data: data };
  }

  return {
    DEFAULT_ACCENT: DEFAULT_ACCENT, ACCENTS: ACCENTS, ACCENT_IDS: ACCENT_IDS, ACCENT_TOKENS: ACCENT_TOKENS,
    isAccent: isAccent, isAccentTimestamp: isAccentTimestamp, accentVariables: accentVariables, newerAccent: newerAccent,
    buttonRoles: buttonRoles, buttonIconPixels: buttonIconPixels,
  };
});
