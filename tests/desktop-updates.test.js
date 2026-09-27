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
    updaterCheckPromise: null, updaterInstallRequested: false, updaterIdleTimer: null,
    UPDATER_CHECK_TIMEOUT_MS: 45000, UPDATER_INSTALL_TIMEOUT_MS: 180000, UPDATER_IDLE_POLL_MS: 3000,
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
    undoDefer: () => handlers.get('updater:cancel-reminder')(),
    installWhenIdle: (enabled) => handlers.get('updater:install-when-idle')(null, enabled),
    idleTimer: () => timers.get(sandbox.updaterIdleTimer),
    runIdleTimer() { const id = sandbox.updaterIdleTimer; const timer = timers.get(id); timers.delete(id); timer.callback(); },
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

test('a stalled native install gives up with a retryable error instead of installing forever', async () => {
  const f = fixture();
  const info = { version: '2.0.45', releaseNotes: '' };
  f.updater.checkForUpdates = async () => ({ updateInfo: info, downloadPromise: Promise.resolve() });
  await f.check();
  f.updater.emit('update-downloaded', info);
  assert.equal((await f.install()).ok, true);
  f.flushInstall();
  const stall = [...f.timers.values()].find(timer => timer.delay === 180000);
  assert.ok(stall, 'installing arms a stall timeout');
  stall.callback();
  assert.equal(f.state.phase, 'error');
  assert.equal(f.state.message, 'Update install failed');
  assert.match(f.state.error, /didn’t restart/);
  assert.equal(f.sandbox.updaterInstallRequested, false);
});

test('GitHub HTML release notes become plain lines for the window and notifications', () => {
  const { sandbox } = fixture();
  const html = '<h2>What&#39;s new</h2>\n<ul>\n<li>Faster <strong>HLS</strong> downloads</li>\n<li>Fixes &amp; tidy-ups</li>\n</ul>\n<p>Thanks!<br>The team</p><script>alert(1)</script>';
  assert.deepEqual([...sandbox.normalizeReleaseNotes({ releaseNotes: html })], ["What's new", '• Faster HLS downloads', '• Fixes & tidy-ups', 'Thanks!', 'The team']);
  assert.deepEqual([...sandbox.normalizeReleaseNotes({ releaseNotes: [{ version: '2.0.45', note: '<p>One</p><p>Two</p>' }] })], ['One', 'Two']);
  assert.deepEqual([...sandbox.normalizeReleaseNotes({ releaseNotes: 'Plain text note' })], ['Plain text note']);
  assert.equal(sandbox.summarizeReleaseNote({ releaseNotes: html }), "What's new");
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

test('update download progress carries bytes so the window can show MB and time left', async () => {
  const f = fixture();
  const info = { version: '2.0.45', releaseNotes: '' };
  f.updater.checkForUpdates = async () => { f.updater.emit('update-available', info); return { updateInfo: info, downloadPromise: Promise.resolve() }; };
  await f.check();
  assert.equal(f.state.transferredBytes, null, 'a new download starts without stale bytes');
  f.updater.emit('download-progress', { percent: 41.3, transferred: 39845888, total: 96468992, bytesPerSecond: 2000000 });
  assert.equal(f.state.progress, 41);
  assert.equal(f.state.transferredBytes, 39845888);
  assert.equal(f.state.totalBytes, 96468992);
  assert.equal(f.state.bytesPerSecond, 2000000);
  assert.equal(f.events.at(-1).transferredBytes, 39845888, 'the renderer receives the bytes');
  assert.equal(f.events.at(-1).totalBytes, 96468992);
  f.updater.emit('download-progress', { percent: 50 });
  assert.equal(f.state.transferredBytes, null, 'missing byte counts are unknown, not zero');
  assert.equal(f.state.totalBytes, null);
});

test('install when downloads finish waits for the queue, installs once, and Later or a new phase clears it', async () => {
  const f = fixture();
  const info = { version: '2.0.45', releaseNotes: '' };
  f.updater.checkForUpdates = async () => ({ updateInfo: info, downloadPromise: Promise.resolve() });
  assert.equal((await f.installWhenIdle(true)).ok, false, 'nothing to install before an update is downloaded');
  assert.notEqual(f.state.installWhenIdle, true);
  await f.check();
  f.updater.emit('update-downloaded', info);

  f.queue([{ queueStatus: 'downloading', status: 'downloading' }]);
  assert.equal((await f.installWhenIdle(true)).ok, true);
  assert.equal(f.state.installWhenIdle, true);
  assert.equal(f.events.at(-1).installWhenIdle, true, 'the renderer shows the choice');
  f.runIdleTimer();
  assert.equal(f.state.phase, 'downloaded', 'an active download keeps the update waiting');
  assert.equal(f.state.installWhenIdle, true);
  f.queue([{ queueStatus: 'paused', status: 'finalizing' }]);
  f.runIdleTimer();
  assert.equal(f.state.phase, 'downloaded', 'a file still being finished also waits');
  assert.ok(f.idleTimer(), 'the watcher keeps polling');
  f.queue([{ queueStatus: 'paused', status: 'paused' }, { queueStatus: 'completed', status: 'completed' }]);
  f.runIdleTimer();
  assert.equal(f.state.phase, 'installing', 'the same install path runs once the queue is idle');
  assert.equal(f.state.installWhenIdle, false);
  assert.equal(f.sandbox.updaterIdleTimer, null);
  f.flushInstall();
  assert.equal(f.installs.length, 1);

  // Later clears it, and so does leaving the downloaded phase.
  const g = fixture();
  g.updater.checkForUpdates = f.updater.checkForUpdates;
  await g.check();
  g.updater.emit('update-downloaded', info);
  g.queue([{ queueStatus: 'downloading', status: 'downloading' }]);
  await g.defer();
  assert.ok(g.state.deferredUntil);
  await g.installWhenIdle(true);
  assert.equal(g.state.deferredUntil, null, 'waiting for downloads replaces the Later reminder');
  await g.defer();
  assert.equal(g.state.installWhenIdle, false, 'Later clears install when downloads finish');
  assert.equal(g.sandbox.updaterIdleTimer, null);
  assert.equal(g.installs.length, 0);
  await g.undoDefer();
  assert.equal(g.state.deferredUntil, null, 'Undo drops the reminder');
  assert.equal(g.state.phase, 'downloaded');
  await g.installWhenIdle(true);
  g.updater.emit('error', new Error('Fixture updater failure'));
  assert.equal(g.state.installWhenIdle, false, 'an error clears it');
  assert.equal(g.state.errorKind, 'check');
  assert.equal(g.sandbox.updaterIdleTimer, null);
  g.flushInstall();
  assert.equal(g.installs.length, 0);
});
