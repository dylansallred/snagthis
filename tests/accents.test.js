const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { inflateSync } = require('node:zlib');
const accents = require('../packages/contracts/src/accents');

const repo = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
// Objects from a vm context have another realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

function cells(d) {
  const set = new Set();
  for (const [, x, y, width] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let dx = 0; dx < Number(width); dx++) set.add(`${Number(x) + dx},${y}`);
  return set;
}
function roleCells(roles, wanted) {
  const set = new Set();
  roles.forEach((role, index) => { if (wanted.includes(role)) set.add(`${index % 16},${Math.floor(index / 16)}`); });
  return set;
}

// RGBA, 8-bit, non-interlaced PNG (the generator's output) without a dependency.
function decodePng(file) {
  const data = fs.readFileSync(file);
  const width = data.readUInt32BE(16); const height = data.readUInt32BE(20);
  assert.deepEqual([...data.subarray(24, 29)], [8, 6, 0, 0, 0]);
  const chunks = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset); const type = data.toString('latin1', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks)); const stride = width * 4; const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0; const up = y ? pixels[(y - 1) * stride + x] : 0; const corner = x >= 4 && y ? pixels[(y - 1) * stride + x - 4] : 0;
      const paeth = () => { const p = left + up - corner; const a = Math.abs(p - left); const b = Math.abs(p - up); const c = Math.abs(p - corner); return a <= b && a <= c ? left : b <= c ? up : corner; };
      pixels[y * stride + x] = (value + [0, left, up, Math.floor((left + up) / 2), paeth()][filter]) & 255;
    }
  }
  return { width, height, pixels };
}

test('accent ids, tokens and the last-change-wins rule', () => {
  assert.deepEqual(accents.ACCENT_IDS, ['orange', 'cobalt', 'violet', 'mint', 'magenta']);
  for (const id of accents.ACCENT_IDS) assert.equal(accents.accentVariables(id).length, 9);
  assert.equal(accents.isAccent('teal'), false);
  assert.equal(accents.isAccent('__proto__'), false);
  assert.equal(accents.isAccentTimestamp(-1), false);
  assert.equal(accents.isAccentTimestamp(1.5), false);
  assert.equal(accents.isAccentTimestamp(Date.now() + 2 * 86_400_000), false, 'a far-future stamp cannot pin a choice');
  const local = { accent: 'mint', changedAt: 2000 }; const remote = { accent: 'violet', changedAt: 3000 };
  assert.equal(accents.newerAccent(local, remote), remote);
  assert.equal(accents.newerAccent(remote, local), remote);
  assert.equal(accents.newerAccent(local, { accent: 'violet', changedAt: 2000 }), local, 'a tie keeps the local choice');
  assert.equal(accents.newerAccent(local, { accent: 'teal', changedAt: 9000 }), local);
  assert.deepEqual(accents.newerAccent(null, null), { accent: 'orange', changedAt: 0 });
  // The desktop's @theme orange is the orange accent (the extension checks the same through check:tokens).
  const theme = read('apps/desktop/src/globals.css');
  for (const [name, value] of accents.accentVariables('orange').slice(0, 5)) assert.match(theme, new RegExp(`${name}: ${value.replace(/[()]/g, '\\$&')};`));
});

test('the shared pixel button matches the generated logo geometry and the packaged 16px icon', () => {
  const logo = read('apps/desktop/src/components/layout/snagthisLogo.ts');
  const part = (name) => cells(new RegExp(`\\n    ${name}: '([^']+)'`).exec(logo)[1]);
  const roles = accents.buttonRoles();
  assert.deepEqual(roleCells(roles, ['face', 'light', 'dark', 'shade', 'glyph']), part('tile'));
  assert.deepEqual(roleCells(roles, ['light']), part('hi'));
  assert.deepEqual(roleCells(roles, ['dark']), new Set([...part('lo')].filter((cell) => !part('shadow').has(cell))));
  assert.deepEqual(roleCells(roles, ['shade']), part('shadow'));
  assert.deepEqual(roleCells(roles, ['glyph']), part('glyph'));

  const png = decodePng(path.join(repo, 'apps/extension/img/icon-16.png'));
  const drawn = accents.buttonIconPixels('orange', 1);
  assert.equal(drawn.width, 16);
  assert.deepEqual([...drawn.data], [...png.pixels], 'orange drawn from geometry equals the packaged icon pixel for pixel');
  const cobalt = accents.buttonIconPixels('cobalt', 2);
  assert.equal(cobalt.width, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const at = (y * 32 + x) * 4; const cell = ((y >> 1) * 16 + (x >> 1));
    assert.equal(cobalt.data[at + 3], roles[cell] ? 255 : 0, 'two whole pixels per cell, no blending');
  }
  assert.deepEqual([...cobalt.data.subarray(((0 * 32) + 6) * 4, ((0 * 32) + 6) * 4 + 3)], [0xa3, 0xc6, 0xff], 'the lit edge follows the accent');
});

test('the popup logo is the generated artwork with accent-driven parts', () => {
  const svg = read('apps/extension/img/snagthis-logo-title.svg');
  const popup = read('apps/extension/popup.html');
  const fileParts = [...svg.matchAll(/<path fill="[^"]+" d="([^"]+)"\/>/g)].map((match) => match[1]);
  const inline = /<svg class="logo-wordmark"[\s\S]*?<\/svg>/.exec(popup)[0];
  assert.deepEqual([...inline.matchAll(/<path class="[^"]+" d="([^"]+)"\/>/g)].map((match) => match[1]), fileParts);
  assert.match(inline, /role="img" aria-label="SnagThis"/);
  assert.match(inline, /<g transform="translate\(104 3\)">/);
});

function popupAccent({ storage = {}, cache = null, now = 5000 } = {}) {
  const store = { ...storage };
  const local = new Map(cache ? [['snagthis.accent', JSON.stringify(cache)]] : []);
  const style = new Map();
  const context = {
    Date: { now: () => now }, URLSearchParams, JSON, setTimeout, clearTimeout,
    location: { protocol: 'chrome-extension:', search: '' },
    localStorage: { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) },
    matchMedia: () => ({ matches: true }),
    document: { documentElement: { style: { setProperty: (name, value) => style.set(name, value) }, classList: { toggle() {}, remove() {} }, dataset: {} } },
    chrome: { storage: { local: { get: async (key) => ({ [key]: store[key] }), set: async (value) => Object.assign(store, value) } } },
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('packages/contracts/src/accents.js'), context);
  vm.runInContext(read('apps/extension/popup/accent.js'), context);
  return { api: context.SnagThisPopupAccent, store, local, style, root: context.document.documentElement };
}

test('the popup paints the cached accent first, then follows chrome.storage and the desktop, last change winning', async () => {
  const popup = popupAccent({ cache: { accent: 'violet', changedAt: 100 }, storage: { accent: { accent: 'mint', changedAt: 200 } } });
  assert.equal(popup.root.dataset.accent, 'violet', 'before the first paint, from the synchronous mirror');
  assert.equal(popup.style.get('--accent-bevel-face'), '#8b5cf6');
  await popup.api.load();
  assert.equal(popup.root.dataset.accent, 'mint');
  assert.equal(popup.api.reconcile({ accent: 'cobalt', accentChangedAt: 150 }), 'push', 'an older desktop choice loses and receives this one');
  assert.equal(popup.root.dataset.accent, 'mint');
  assert.equal(popup.api.reconcile({ accent: 'cobalt', accentChangedAt: 300 }), 'pulled');
  assert.equal(popup.root.dataset.accent, 'cobalt');
  assert.deepEqual(plain(popup.store.accent), { accent: 'cobalt', changedAt: 300 });
  assert.equal(popup.api.reconcile(undefined), 'same', 'an app without accents is never written to');
  assert.equal(popup.api.reconcile({ accent: 'teal', accentChangedAt: 900 }), 'same');
  const chosen = await popup.api.choose('magenta');
  assert.deepEqual(plain(chosen), { accent: 'magenta', changedAt: 5000 });
  assert.deepEqual(plain(popup.store.accent), plain(chosen), 'offline choices are kept for the toolbar icon and the next reconnect');
  assert.equal(JSON.parse(popup.local.get('snagthis.accent')).accent, 'magenta');
  assert.equal(popup.api.reconcile({ accent: 'cobalt', accentChangedAt: 300 }), 'push');
});

test('the worker draws non-orange toolbar icons from the geometry and restores the packaged orange', async () => {
  const calls = []; const listeners = [];
  const context = {
    console, ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    chrome: {
      storage: { local: { get: async () => ({ accent: { accent: 'violet', changedAt: 1 } }) }, onChanged: { addListener: (listener) => listeners.push(listener) } },
      action: { setIcon: async (details) => calls.push(['icon', details]), setBadgeBackgroundColor: async (details) => calls.push(['badge', details]) },
      runtime: { getManifest: () => ({ action: { default_icon: { 16: 'img/icon-16.png' } } }) },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('packages/contracts/src/accents.js'), context);
  vm.runInContext(read('apps/extension/js/accent-icon.js'), context);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(Object.keys(calls[0][1].imageData), ['16', '32']);
  assert.equal(calls[0][1].imageData[16].width, 16);
  assert.equal(context.SnagThisAccentIcon.badgeColor(), context.SnagThisAccentIcon.hex('hsl(262 70% 54%)'));
  listeners[0]({ accent: { newValue: { accent: 'orange', changedAt: 2 } } }, 'local');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(plain(calls.at(-2)), ['icon', { path: { 16: 'img/icon-16.png' } }]);
  assert.deepEqual(plain(calls.at(-1)), ['badge', { color: '#dc4505' }]);
  assert.equal(context.SnagThisAccentIcon.hex('hsl(0 100% 50%)'), '#ff0000');
});
