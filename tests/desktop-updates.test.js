const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const sourcePath = path.resolve(__dirname, '../apps/desktop/electron/main.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

function fixture() {
  const handlers = new Map();
  const timers = new Map();
  const immediate = [];
  const events = [];
  const installs = [];
  let queue = [];
  let timerId = 0;
  const updater = new EventEmitter();
  updater.quitAndInstall = (...args) => installs.push(args);
  const state = { phase: 'idle', progress: 0 };
  const app = {
    isPackaged: true, installed: true,
    getVersion: () => '2.0.44',
    getPath: name => name === 'exe' ? '/Applications/SnagThis.app/Contents/MacOS/SnagThis' : '/fixture',
    isInApplicationsFolder() { return this.installed; },
  };
  const sandbox = {
    app, autoUpdater: updater, updaterState: state, path, process: { platform: 'darwin' },
    updaterReminderTimer: null, updaterInstallTimer: null, updaterCheckTimeout: null,
    updaterCheckPromise: null, updaterInstallRequested: false, UPDATER_CHECK_TIMEOUT_MS: 45000,
    apiServer: { getState: () => ({ queue }) },
    Notification: { isSupported: () => false },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setImmediate(callback) { immediate.push(callback); },
    sendToRenderer(channel, payload) { events.push({ channel, ...payload }); },
    handleIpc(channel, callback) { handlers.set(channel, callback); },
    writeUpdaterInstallState() {}, clearUpdaterInstallState() {}, console,
  };
  vm.createContext(sandbox);
  const functionsStart = source.indexOf('function clearUpdaterReminderTimer()');
  const functionsEnd = source.indexOf('\nasync function startLocalApi()');
  const handlersStart = source.indexOf("  handleIpc('updater:get-state'");
  const handlersEnd = source.indexOf('\n}\n\nasync function bootstrap()');
  assert.ok(functionsStart >= 0 && functionsEnd > functionsStart && handlersStart >= 0 && handlersEnd > handlersStart);
  // Exercise the production event handlers and IPC callbacks, without launching
  // an app, contacting an update provider, or modifying a real user profile.
  vm.runInContext(source.slice(functionsStart, functionsEnd) + source.slice(handlersStart, handlersEnd), sandbox, { filename: sourcePath });
  sandbox.configureAutoUpdater();
  return {
    app, updater, state, events, installs, timers, sandbox,
    check: () => sandbox.checkForUpdatesNow(),
    install: () => handlers.get('updater:install-now')(),
    defer: () => handlers.get('updater:remind-later')(null, 30),
    queue(value) { queue = value; },
    flushInstall() { for (const callback of immediate.splice(0)) callback(); },
  };
}

test('desktop updates preserve a downloaded or installing update and recover from download errors', async () => {
  const f = fixture();
  const info = { version: '2.0.45', releaseNotes: 'Fixture update' };
  let rejectDownload;
  let checks = 0;
  f.updater.checkForUpdates = async () => {
    checks += 1;
    f.updater.emit('checking-for-update');
    f.updater.emit('update-available', info);
    return { updateInfo: info, downloadPromise: new Promise((_resolve, reject) => { rejectDownload = reject; }) };
  };
  assert.equal((await f.check()).ok, true);
  assert.equal(f.state.phase, 'downloading');
  await f.check();
  assert.equal(checks, 1, 'periodic checks must not restart an update download');
  f.updater.emit('download-progress', { percent: 42 });
  assert.equal(f.state.progress, 42);

  const error = new Error('Fixture connection interrupted');
  f.updater.emit('error', error);
  rejectDownload(error);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.phase, 'error');
  assert.equal(f.state.message, 'Update download failed');
  assert.equal(f.state.error, error.message);
  assert.equal((await f.check()).ok, true, 'download failure remains retryable');
  assert.equal(checks, 2);
  f.updater.emit('update-downloaded', info);
  await f.defer();
  const deferredUntil = f.state.deferredUntil;
  const reminderCount = f.timers.size;
  await f.check();
  assert.equal(f.state.phase, 'downloaded');
  assert.equal(f.state.deferredUntil, deferredUntil);
  assert.equal(f.timers.size, reminderCount, 'scheduled checks preserve the reminder');
  assert.equal(checks, 2);

  f.queue([{ queueStatus: 'downloading', status: 'downloading' }]);
  assert.equal((await f.install()).ok, false);
  assert.equal(f.state.phase, 'downloaded', 'active downloads must not discard the ready update');
  assert.match(f.state.message, /Pause active downloads/);
  f.queue([{ queueStatus: 'paused', status: 'finalizing' }]);
  assert.equal((await f.install()).ok, false, 'finishing a file also prevents a restart');
  assert.equal(f.installs.length, 0);

  f.queue([{ queueStatus: 'paused', status: 'paused' }, { queueStatus: 'queued', status: 'pending' }]);
  assert.equal((await f.install()).ok, true, 'paused and waiting downloads do not block the update');
  assert.equal(f.state.phase, 'installing');
  await f.check();
  assert.equal(f.state.phase, 'installing');
  assert.equal(checks, 2, 'periodic checks cannot clear the explicit install request');
  assert.equal(f.sandbox.updaterInstallRequested, true);
  f.flushInstall();
  assert.equal(f.installs.length, 1);
  assert.equal(f.updater.autoInstallOnAppQuit, false, 'keep the explicit native installer path');
});

test('desktop update checks support installed apps and permit retry after a failed check', async () => {
  const f = fixture();
  let checks = 0;
  f.updater.checkForUpdates = async () => { checks += 1; throw new Error('Fixture provider unavailable'); };
  f.app.isPackaged = false;
  assert.equal((await f.check()).unsupported, true);
  f.app.isPackaged = true;
  f.app.installed = false;
  assert.equal((await f.check()).unsupported, true);
  assert.match(f.state.message, /Applications/);
  assert.equal(checks, 0, 'do not download an update the current location cannot install');
  f.app.installed = true;
  assert.equal((await f.check()).ok, false);
  assert.equal(f.state.phase, 'error');
  f.updater.checkForUpdates = async () => {
    checks += 1;
    f.updater.emit('checking-for-update');
    f.updater.emit('update-not-available', { version: '2.0.44' });
    return { updateInfo: { version: '2.0.44' } };
  };
  assert.equal((await f.check()).ok, true);
  assert.equal(f.state.phase, 'idle');
  assert.equal(f.state.error, null);
  assert.equal(checks, 2);
});

test('an incomplete previous update gives platform-appropriate recovery advice', () => {
  for (const [platform, advice, forbidden] of [['darwin', /\/Applications/, null], ['win32', /installer/, /Applications/]]) {
    const f = fixture();
    f.sandbox.process.platform = platform;
    f.sandbox.readUpdaterInstallState = () => ({ fromVersion: '2.0.44', targetVersion: '2.0.45', attemptedAt: Date.now() });
    f.sandbox.reconcileUpdaterInstallState();
    assert.equal(f.state.phase, 'error');
    assert.match(f.state.error, advice);
    if (forbidden) assert.doesNotMatch(f.state.error, forbidden);
  }
});
