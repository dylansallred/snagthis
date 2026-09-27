const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(__dirname, '../apps/desktop/electron/main.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

function statement(startText) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, `main.js contains ${startText}`);
  const end = source.indexOf('\n});', start);
  return source.slice(start, end + 4);
}

// A hidden page resolver (mediaPageResolver.js) is a BrowserWindow too.
const hiddenResolver = { isVisible: () => false, isDestroyed: () => false };

test('the Dock icon reopens the app while a hidden page resolver window exists', () => {
  const handlers = {};
  let created = 0;
  const sandbox = {
    app: { on: (name, handler) => { handlers[name] = handler; }, isReady: () => true },
    BrowserWindow: { getAllWindows: () => [hiddenResolver] },
    mainWindow: null,
    createWindow: () => { created += 1; },
  };
  vm.runInNewContext(statement("app.on('activate'"), sandbox, { filename: sourcePath });
  handlers.activate();
  assert.equal(created, 1);
  sandbox.mainWindow = { isDestroyed: () => false };
  handlers.activate();
  assert.equal(created, 1, 'an open main window is not duplicated');
});

test('closing the main window during downloads asks first even while a page resolver runs', () => {
  const start = source.indexOf("  window.on('close', (event) => {");
  const block = source.slice(start, source.indexOf('\n  });', start) + 6);
  const listeners = {};
  const window = { on: (name, handler) => { listeners[name] = handler; } };
  let prompts = 0;
  const sandbox = {
    window, mainWindow: window, process: { platform: 'win32' },
    quitConfirmed: false, apiShutdownPromise: null, updaterInstallRequested: false,
    activeDownloadCount: () => 1,
    BrowserWindow: { getAllWindows: () => [window, hiddenResolver] },
    confirmQuitWithActiveDownloads: () => { prompts += 1; },
  };
  vm.runInNewContext(block, sandbox, { filename: sourcePath });
  let prevented = false;
  listeners.close({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'the close waits for the answer');
  assert.equal(prompts, 1, 'the quit prompt is shown');
});

test('closing the main window outside macOS quits even if a resolver window is still open', () => {
  const block = statement("  window.on('closed', () => {").replace(/\n}\);$/, '');
  assert.match(block, /if \(process\.platform !== 'darwin'\) app\.quit\(\);/);
  assert.doesNotMatch(source, /BrowserWindow\.getAllWindows\(\)/, 'no lifecycle decision counts hidden windows');
});
