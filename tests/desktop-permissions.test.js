const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { pathToFileURL, fileURLToPath } = require('node:url');

const sourcePath = path.resolve(__dirname, '../apps/desktop/electron/main.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

test('the main window session denies every permission except clipboard and video full screen for the app page', () => {
  const start = source.indexOf('function sameRendererUrl(');
  const end = source.indexOf('\nfunction handleIpc(');
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(source.indexOf('function createWindow('), source.indexOf('\nfunction registerIpc(')),
    /applyRendererPermissionPolicy\(mainWindow\.webContents\.session\)/, 'createWindow installs the policy');
  const appUrl = 'file:///Applications/SnagThis.app/Contents/Resources/app/dist/index.html';
  const main = { getURL: () => appUrl };
  const other = { getURL: () => appUrl };
  const sandbox = { URL, fs, fileURLToPath, process, mainWindow: { webContents: main, isDestroyed: () => false }, rendererUrl: () => appUrl };
  vm.runInNewContext(source.slice(start, end), sandbox, { filename: sourcePath });
  const handlers = {};
  sandbox.applyRendererPermissionPolicy({
    setPermissionRequestHandler: (handler) => { handlers.request = handler; },
    setPermissionCheckHandler: (handler) => { handlers.check = handler; },
  });
  const request = (contents, permission, requestingUrl = appUrl) => new Promise((resolve) => handlers.request(contents, permission, resolve, { requestingUrl }));
  const check = (contents, permission, requestingUrl = appUrl) => handlers.check(contents, permission, 'file:///', { requestingUrl });

  for (const permission of ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']) {
    assert.equal(check(main, permission), true, `${permission} is allowed for the app page`);
  }
  for (const permission of ['media', 'geolocation', 'notifications', 'openExternal', 'hid', 'serial', 'usb', 'midiSysex', 'pointerLock', 'display-capture']) {
    assert.equal(check(main, permission), false, `${permission} is denied`);
  }
  assert.equal(check(other, 'clipboard-read'), false, 'other web contents are denied');
  assert.equal(check(null, 'clipboard-read'), false);
  assert.equal(check(main, 'clipboard-read', 'https://example.com/'), false, 'a navigated-away page is denied');
  return Promise.all([
    request(main, 'clipboard-read').then((allowed) => assert.equal(allowed, true)),
    request(main, 'media').then((allowed) => assert.equal(allowed, false)),
    request(other, 'clipboard-sanitized-write').then((allowed) => assert.equal(allowed, false)),
  ]);
});

test('the built page is trusted however its file path is spelled, and no other file is', (t) => {
  const start = source.indexOf('function sameRendererUrl(');
  const end = source.indexOf('\nfunction handleIpc(');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-renderer-url-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'app dist'));
  const page = path.join(root, 'app dist', 'index.html');
  fs.writeFileSync(page, '');
  fs.writeFileSync(path.join(root, 'app dist', 'other.html'), '');
  // A second spelling of the same folder, as Windows produces with short names or different case.
  fs.symlinkSync(path.join(root, 'app dist'), path.join(root, 'another-spelling'), 'junction');
  const sandbox = { URL, fs, fileURLToPath, process, rendererUrl: () => pathToFileURL(page).href };
  vm.runInNewContext(source.slice(start, end), sandbox, { filename: sourcePath });
  assert.equal(sandbox.sameRendererUrl(pathToFileURL(page).href), true);
  assert.equal(sandbox.sameRendererUrl(pathToFileURL(path.join(root, 'another-spelling', 'index.html')).href), true, 'another spelling of the page');
  assert.equal(sandbox.sameRendererUrl(pathToFileURL(path.join(root, 'app dist', 'other.html')).href), false, 'a different local file');
  assert.equal(sandbox.sameRendererUrl(pathToFileURL(path.join(root, 'missing.html')).href), false, 'a file that does not exist');
  assert.equal(sandbox.sameRendererUrl('https://example.com/index.html'), false);
});
