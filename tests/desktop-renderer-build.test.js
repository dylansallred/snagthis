const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

// The e2e specs use the Vite dev server. Packaged apps load the built bundle,
// where a CommonJS wrapper around the shared UMD contracts once called `require`
// and left the window blank.
test('the production renderer bundle starts without Node globals', { timeout: 90_000 }, async (t) => {
  const { build } = await import('vite');
  const desktop = path.resolve(__dirname, '../apps/desktop');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-renderer-build-'));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  await build({ root: desktop, configFile: path.join(desktop, 'vite.config.ts'), logLevel: 'error', build: { outDir, emptyOutDir: true } });
  const assets = path.join(outDir, 'assets');
  const entry = fs.readdirSync(assets).find(name => name.endsWith('.js'));
  assert.doesNotMatch(fs.readFileSync(path.join(assets, entry), 'utf8'), /\brequire\(/);

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const off = () => () => {};
    window.desktop = {
      platform: 'darwin', getWindowState: async () => ({ fullScreen: false }), onWindowState: off,
      getAppInfo: async () => ({ version: '0.0.0', apiBaseUrl: 'http://127.0.0.1:9', apiStartupState: 'starting', apiStartupError: null, apiAuthToken: '' }),
      getSettings: async () => ({}), getUpdaterState: async () => ({ phase: 'idle', message: '', progress: 0 }),
      onAppInfoUpdate: off, onUpdaterEvent: off, onOpenSettings: off,
    };
  });
  // Chromium blocks module scripts from file://; serve the build as Electron reads it.
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
  await page.route('http://snagthis-production.test/**', route => {
    const file = path.join(outDir, new URL(route.request().url()).pathname.replace(/^\/$/, '/index.html'));
    return fs.existsSync(file) ? route.fulfill({ contentType: types[path.extname(file)], body: fs.readFileSync(file) }) : route.fulfill({ status: 404 });
  });
  await page.goto('http://snagthis-production.test/');
  await page.waitForSelector('.workbench', { state: 'attached', timeout: 10_000 });
  assert.deepEqual(errors, []);
});
