const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Updates, option B · Install on quit or idle (docs/design/ui-design-spec.md §8.1). These run the
// production updater functions and IPC handlers from main.js in a sandbox with a fake clock, a fake
// window and a fake electron-updater, without launching an app or contacting an update provider.
const sourcePath = path.resolve(__dirname, '../apps/desktop/electron/main.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const MINUTE = 60_000;

function fixture({ platform = 'darwin', window = 'focused', notices = {}, installState = null } = {}) {
  const handlers = new Map();
  const timers = new Map();
  const events = [];
  const installs = [];
  const notifications = [];
  const writes = [];
  let queue = [];
  let pairing = null;
  let timerId = 0;
  const clock = { now: Date.UTC(2026, 8, 29, 12) };
  const updater = new EventEmitter();
  updater.quitAndInstall = (...args) => installs.push(args);
  // MacUpdater's Squirrel.Mac side: staging starts with its checkForUpdates().
  const native = new EventEmitter();
  native.checks = 0;
  native.checkForUpdates = () => { native.checks += 1; };
  if (platform === 'darwin') updater.nativeUpdater = native;
  const win = {
    visible: window !== 'closed', minimized: window === 'minimized', focused: window === 'focused', destroyed: false,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; }, isMinimized() { return this.minimized; },
    isFocused() { return this.focused; }, hide() { this.visible = false; this.focused = false; },
  };
  const state = { phase: 'idle', progress: 0, releaseNotes: [], updateInfo: null, failedInstall: false, updatedTo: null };
  const app = {
    isPackaged: true, installed: true,
    getVersion: () => '2.0.44',
    getPath: name => name === 'exe' ? '/Applications/SnagThis.app/Contents/MacOS/SnagThis' : '/fixture',
    isInApplicationsFolder() { return this.installed; },
    moveToApplicationsFolder() { return true; },
    exit(code) { events.push({ channel: 'app:exit', code }); },
  };
  class FakeDate extends Date { static now() { return clock.now; } }
  class FakeNotification {
    constructor(options) { this.options = options; }
    static isSupported() { return true; }
    on() {}
    show() { notifications.push(this.options); }
  }
  const sandbox = {
    app, autoUpdater: updater, updaterState: state, path, process: { platform }, Date: FakeDate,
    mainWindow: window === 'closed' ? null : win,
    updaterInstallTimer: null, updaterCheckTimeout: null, updaterCheckPromise: null, updaterInstallRequested: false,
    updaterIdleTimer: null, updaterAwaySince: null, updaterStaged: false, updaterStaging: null,
    UPDATER_CHECK_TIMEOUT_MS: 45_000, UPDATER_INSTALL_TIMEOUT_MS: 180_000, UPDATER_IDLE_POLL_MS: 30_000,
    UPDATER_IDLE_INSTALL_MS: 10 * MINUTE, UPDATER_STAGE_TIMEOUT_MS: 15_000, UPDATER_QUIT_EXIT_TIMEOUT_MS: 10_000,
    apiServer: { getState: () => ({ queue }), getPendingPairing: () => pairing },
    Notification: FakeNotification,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, due: clock.now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setImmediate,
    sendToRenderer(channel, payload) { events.push({ channel, ...payload }); },
    handleIpc(channel, callback) { handlers.set(channel, callback); },
    readUpdaterInstallState: () => installState,
    writeUpdaterInstallState(next) { writes.push(next); },
    clearUpdaterInstallState() { installState = null; writes.push(null); },
    readUpdaterNotice: () => ({ ...notices }),
    writeUpdaterNotice(next) { Object.assign(notices, next); },
    console: { info() {}, warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  const functionsStart = source.indexOf('function clearUpdaterInstallTimer()');
  const functionsEnd = source.indexOf('\nasync function startLocalApi()');
  const handlersStart = source.indexOf("  handleIpc('updater:get-state'");
  const handlersEnd = source.indexOf('\n}\n\nasync function bootstrap()');
  assert.ok(functionsStart >= 0 && functionsEnd > functionsStart && handlersStart >= 0 && handlersEnd > handlersStart);
  vm.runInContext(source.slice(functionsStart, functionsEnd) + source.slice(handlersStart, handlersEnd), sandbox, { filename: sourcePath });
  sandbox.configureAutoUpdater();

  /** Runs the fake clock forward, firing due timers in order and letting their promises settle. */
  async function advance(ms) {
    const target = clock.now + ms;
    for (;;) {
      await flush();
      const [id, timer] = [...timers.entries()].filter(([, entry]) => entry.due <= target).sort((a, b) => a[1].due - b[1].due)[0] || [];
      if (!timer) break;
      timers.delete(id);
      clock.now = timer.due;
      timer.callback();
    }
    clock.now = target;
    await flush();
  }
  const info = { version: '2.0.45', releaseNotes: '<h2>What’s new</h2><ul><li>New: Faster downloads.</li></ul>' };
  return {
    app, updater, native, state, events, installs, notifications, notices, writes, timers, sandbox, win, handlers, clock, info, advance,
    check: () => sandbox.checkForUpdatesNow(),
    checkNow: () => handlers.get('updater:check-now')(),
    install: () => handlers.get('updater:install-now')(),
    queue(value) { queue = value; },
    pairing(value) { pairing = value; },
    /** An update found, downloaded and (on macOS) staged by Squirrel.Mac. */
    async ready({ stage = true } = {}) {
      updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-available', info); return { updateInfo: info, downloadPromise: Promise.resolve() }; };
      await sandbox.checkForUpdatesNow();
      updater.emit('update-downloaded', info);
      if (stage && platform === 'darwin') native.emit('update-downloaded');
      await flush();
    },
  };
}

test('updates download silently: no notification while the window is visible, one when it is hidden, never repeated', async () => {
  const visible = fixture({ window: 'background' });
  await visible.ready();
  assert.equal(visible.state.phase, 'downloaded');
  assert.equal(visible.notifications.length, 0, 'a visible window (even unfocused) gets no notification for downloading or ready');
  assert.ok(visible.events.some((event) => event.channel === 'updater:event' && event.phase === 'downloading'), 'the window still hears about it');

  const notices = {};
  const hidden = fixture({ window: 'closed', notices });
  await hidden.ready();
  assert.equal(hidden.notifications.length, 1, 'one notification when nobody can see the window');
  assert.equal(hidden.notifications[0].title, 'SnagThis 2.0.45 is ready');
  assert.match(hidden.notifications[0].body, /installs the next time you quit/);
  hidden.updater.emit('update-downloaded', hidden.info);
  assert.equal(hidden.notifications.length, 1, 'not repeated in the same session');

  // The next launch finds the same cached update and downloads it again: still no second notification.
  const relaunch = fixture({ window: 'closed', notices });
  await relaunch.ready();
  assert.equal(relaunch.notifications.length, 0, 'never repeated on later launches');
  const minimized = fixture({ window: 'minimized' });
  await minimized.ready();
  assert.equal(minimized.notifications.length, 1, 'a minimised window counts as hidden');
});

test('macOS stages the update with Squirrel.Mac as soon as it is downloaded, and quitting installs it once without reopening', async () => {
  const f = fixture({ window: 'focused' });
  await f.ready({ stage: false });
  assert.equal(f.native.checks, 1, 'staging starts right after the download');
  f.native.emit('update-downloaded');
  await flush();
  assert.equal(f.sandbox.updaterStaged, true);

  assert.equal(await f.sandbox.installUpdateOnQuit(), true, 'the installer takes over the quit');
  assert.deepEqual(f.installs, [[true, false]], 'quitAndInstall is called once, silently, without relaunching');
  assert.equal(f.updater.autoInstallOnAppQuit, false, 'autoInstallOnAppQuit stays off (it breaks MacUpdater)');
  assert.equal(f.updater.autoRunAppAfterInstall, false, 'quit means quit');
  assert.equal(f.win.visible, false, 'the window goes away at once');
  assert.equal(f.writes.at(-1).targetVersion, '2.0.45', 'the attempt is recorded so the next launch can tell whether it worked');
  assert.ok([...f.timers.values()].some((timer) => timer.delay === 10_000), 'the quit finishes even if the installer does not end the app');
  assert.equal(await f.sandbox.installUpdateOnQuit(), false, 'a second quit does not install twice');
  assert.equal(f.installs.length, 1);

  const windows = fixture({ platform: 'win32', window: 'focused' });
  await windows.ready();
  assert.equal(await windows.sandbox.installUpdateOnQuit(), true, 'Windows has nothing to stage');
  assert.deepEqual(windows.installs, [[true, false]], 'NSIS runs silently (/S) and does not reopen');

  const nothing = fixture();
  assert.equal(await nothing.sandbox.installUpdateOnQuit(), false, 'without a ready update the app just quits');
  assert.equal(nothing.installs.length, 0);
});

test('quitting before macOS has staged the update waits a bounded time, then quits normally and installs next time', async () => {
  const f = fixture({ window: 'focused' });
  await f.ready({ stage: false });
  const quitting = f.sandbox.installUpdateOnQuit();
  await f.advance(14_000);
  assert.equal(f.installs.length, 0, 'never calls quitAndInstall before Squirrel.Mac has the update (it would wait with no limit)');
  await f.advance(1_000);
  assert.equal(await quitting, false, 'after 15 s the app quits normally');
  assert.equal(f.installs.length, 0);
  assert.equal(f.writes.filter(Boolean).length, 0, 'no install attempt is recorded, so the next launch reports no failure');
  assert.equal(f.state.phase, 'downloaded', 'the update is still there for the next quit or idle moment');
});

test('idle install waits until SnagThis has been in the background for 10 minutes with nothing downloading or finishing', async () => {
  const f = fixture({ window: 'focused' });
  await f.ready();
  await f.advance(60 * MINUTE);
  assert.equal(f.installs.length, 0, 'never while the person is using the window');

  // The window loses focus: the clock starts.
  f.win.focused = false;
  f.sandbox.noteWindowPresence();
  await f.advance(9 * MINUTE);
  assert.equal(f.installs.length, 0);
  f.queue([{ queueStatus: 'downloading', status: 'downloading' }]);
  await f.advance(20 * MINUTE);
  assert.equal(f.installs.length, 0, 'an active download holds it');
  f.queue([{ queueStatus: 'paused', status: 'finalizing' }]);
  await f.advance(20 * MINUTE);
  assert.equal(f.installs.length, 0, 'a file still being finished holds it too');
  f.queue([]);
  f.pairing({ status: 'pending' });
  await f.advance(20 * MINUTE);
  assert.equal(f.installs.length, 0, 'so does Chrome waiting for Allow');

  // The clock restarts once the queue is quiet.
  f.pairing(null);
  f.queue([{ queueStatus: 'paused', status: 'paused' }, { queueStatus: 'queued', status: 'pending' }, { queueStatus: 'completed', status: 'completed' }]);
  await f.advance(9 * MINUTE);
  assert.equal(f.installs.length, 0, 'paused and waiting downloads do not hold it, but it still waits the full 10 minutes');
  f.win.focused = true;
  f.sandbox.noteWindowPresence();
  await f.advance(5 * MINUTE);
  f.win.focused = false;
  f.sandbox.noteWindowPresence();
  await f.advance(9 * MINUTE);
  assert.equal(f.installs.length, 0, 'coming back to the window restarts the clock');
  await f.advance(2 * MINUTE);
  assert.deepEqual(f.installs, [[true, true]], 'installs silently and relaunches');
  assert.equal(f.state.phase, 'installing');
  assert.equal(f.writes.at(-1).reopen, 'background', 'the relaunch comes back behind other windows, as it was');

  const closed = fixture({ window: 'closed' });
  await closed.ready();
  await closed.advance(11 * MINUTE);
  assert.equal(closed.installs.length, 1, 'a closed window counts as away');
  assert.equal(closed.writes.at(-1).reopen, 'hidden', 'and it reopens without a window');
});

test('the queue is checked again right before the installer takes over', async () => {
  const f = fixture({ window: 'closed' });
  await f.ready();
  const restarting = f.install();
  assert.equal(f.state.phase, 'installing');
  // A download starts while the update is handed over.
  f.queue([{ queueStatus: 'downloading', status: 'downloading' }]);
  const result = await restarting;
  assert.equal(result.ok, false);
  assert.equal(f.installs.length, 0, 'never installs over a running download');
  assert.equal(f.state.phase, 'downloaded', 'the update keeps waiting');
  assert.ok(f.sandbox.updaterIdleTimer, 'and the idle watcher carries on');

  f.queue([{ queueStatus: 'downloading', status: 'downloading' }]);
  assert.equal((await f.install()).ok, false, 'Restart now refuses while downloads run');
  f.queue([]);
  assert.equal((await f.install()).ok, true);
  assert.deepEqual(f.installs, [[true, true]], 'Restart now installs silently and reopens');
});

test('a failed install found at launch is shown with its version and survives the launch check until Try again', async () => {
  for (const [platform, advice, forbidden] of [['darwin', /\/Applications/, null], ['win32', /installer/, /Applications/]]) {
    const f = fixture({ platform, installState: { fromVersion: '2.0.44', targetVersion: '2.0.45', attemptedAt: Date.now() } });
    const launch = f.sandbox.reconcileUpdaterInstallState();
    assert.equal(launch.reopen, null);
    assert.equal(f.state.phase, 'error');
    assert.equal(f.state.errorKind, 'install');
    assert.equal(f.state.failedInstall, true);
    assert.equal(f.state.updateInfo.version, '2.0.45', 'the chip can say which version didn’t install');
    assert.match(f.state.error, advice);
    if (forbidden) assert.doesNotMatch(f.state.error, forbidden);

    let checks = 0;
    f.updater.checkForUpdates = async () => { checks += 1; f.updater.emit('checking-for-update'); f.updater.emit('update-not-available', { version: '2.0.44' }); return { updateInfo: { version: '2.0.44' } }; };
    assert.equal((await f.check()).held, true, 'the launch and periodic checks leave it on screen');
    assert.equal(checks, 0);
    assert.equal(f.state.phase, 'error');
    assert.equal((await f.checkNow()).ok, true, 'Try again checks');
    assert.equal(checks, 1);
    assert.equal(f.state.failedInstall, false);
    assert.equal(f.state.phase, 'idle');
  }
});

test('after relaunching into the new version, the "Updated to" note is set once and cleared when shown', async () => {
  const notes = ['What’s new', '• New: Faster downloads.'];
  const f = fixture({ installState: { fromVersion: '2.0.43', targetVersion: '2.0.44', releaseNotes: notes, reopen: 'hidden' } });
  assert.equal(f.sandbox.reconcileUpdaterInstallState().reopen, 'hidden', 'an idle install reopens as it was');
  assert.deepEqual({ ...f.state.updatedTo, releaseNotes: [...f.state.updatedTo.releaseNotes] }, { version: '2.0.44', releaseNotes: notes });
  assert.equal(f.state.phase, 'idle', 'nothing else is shown');
  await f.handlers.get('updater:updated-seen')();
  assert.equal(f.state.updatedTo, null);
  assert.equal(f.events.at(-1).updatedTo, null, 'the window hears it is gone');
  f.sandbox.reconcileUpdaterInstallState();
  assert.equal(f.state.updatedTo, null, 'the marker was removed, so the next launch shows nothing');
});

test('checks keep a ready or installing update, recover from download errors, and a stalled install gives up', async () => {
  const f = fixture({ window: 'focused' });
  let rejectDownload;
  let checks = 0;
  f.updater.checkForUpdates = async () => {
    checks += 1;
    f.updater.emit('checking-for-update');
    f.updater.emit('update-available', f.info);
    return { updateInfo: f.info, downloadPromise: new Promise((_resolve, reject) => { rejectDownload = reject; }) };
  };
  assert.equal((await f.check()).ok, true);
  assert.equal(f.state.phase, 'downloading');
  await f.check();
  assert.equal(checks, 1, 'periodic checks must not restart an update download');
  f.updater.emit('download-progress', { percent: 41.3, transferred: 39845888, total: 96468992, bytesPerSecond: 2000000 });
  assert.equal(f.state.progress, 41);
  assert.equal(f.events.at(-1).transferredBytes, 39845888, 'the window receives the bytes');
  f.updater.emit('download-progress', { percent: 50 });
  assert.equal(f.state.transferredBytes, null, 'missing byte counts are unknown, not zero');

  const error = new Error('Fixture connection interrupted');
  f.updater.emit('error', error);
  rejectDownload(error);
  await flush();
  assert.equal(f.state.phase, 'error');
  assert.equal(f.state.errorKind, 'download');
  assert.equal((await f.check()).ok, true, 'download failure remains retryable');
  assert.equal(checks, 2);
  f.updater.emit('update-downloaded', f.info);
  f.native.emit('update-downloaded');
  await f.check();
  assert.equal(f.state.phase, 'downloaded');
  assert.equal(checks, 2, 'a ready update is kept');

  assert.equal((await f.install()).ok, true);
  assert.equal(f.state.phase, 'installing');
  await f.check();
  assert.equal(checks, 2, 'checks cannot clear an install');
  const stall = [...f.timers.values()].find((timer) => timer.delay === 180_000);
  assert.ok(stall, 'installing arms a stall timeout');
  stall.callback();
  assert.equal(f.state.phase, 'error');
  assert.equal(f.state.message, 'Update install failed');
  assert.match(f.state.error, /didn’t restart/);
  assert.equal(f.sandbox.updaterInstallRequested, false);

  // Squirrel.Mac failing to stage is an install failure the chip can show.
  const g = fixture();
  await g.ready({ stage: false });
  g.updater.emit('error', new Error('Code signature did not match'));
  assert.equal(g.state.errorKind, 'install');
});

test('update checks support installed apps, offer Move to Applications on macOS, and retry after a failed check', async () => {
  const f = fixture();
  let checks = 0;
  f.updater.checkForUpdates = async () => { checks += 1; throw new Error('Fixture provider unavailable'); };
  f.app.isPackaged = false;
  assert.equal((await f.check()).unsupported, true);
  assert.equal(f.state.needsMove, false, 'development builds are not offered a move');
  f.app.isPackaged = true;
  f.app.installed = false;
  assert.equal((await f.check()).unsupported, true);
  assert.match(f.state.message, /Applications/);
  assert.equal(f.state.needsMove, true, 'Settings offers Move to Applications');
  assert.equal(checks, 0, 'do not download an update the current location cannot install');
  f.app.installed = true;
  assert.equal((await f.check()).ok, false);
  assert.equal(f.state.phase, 'error');
  assert.equal(f.state.errorKind, 'check');
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

  for (const retired of ['updater:remind-later', 'updater:cancel-reminder', 'updater:install-when-idle']) {
    assert.equal(f.handlers.has(retired), false, `${retired} is gone`);
  }
});

test('GitHub HTML release notes become plain lines for the window', () => {
  const { sandbox } = fixture();
  const html = '<h2>What&#39;s new</h2>\n<ul>\n<li>Faster <strong>HLS</strong> downloads</li>\n<li>Fixes &amp; tidy-ups</li>\n</ul>\n<p>Thanks!<br>The team</p><script>alert(1)</script>';
  assert.deepEqual([...sandbox.normalizeReleaseNotes({ releaseNotes: html })], ["What's new", '• Faster HLS downloads', '• Fixes & tidy-ups', 'Thanks!', 'The team']);
  assert.deepEqual([...sandbox.normalizeReleaseNotes({ releaseNotes: [{ version: '2.0.45', note: '<p>One</p><p>Two</p>' }] })], ['One', 'Two']);
  assert.deepEqual([...sandbox.normalizeReleaseNotes({ releaseNotes: 'Plain text note' })], ['Plain text note']);
});

test('the downloads-in-progress quit prompt adds one line when an update installs as SnagThis quits', async () => {
  const start = source.indexOf('function confirmQuitWithActiveDownloads(count)');
  const end = source.indexOf("\napp.on('before-quit'");
  const prompts = [];
  const sandbox = {
    Promise, mainWindow: null, quitPrompt: null, quitConfirmed: false, app: { quit() {} },
    updaterState: { phase: 'downloaded', updateInfo: { version: '1.1.0' } },
    dialog: { async showMessageBox(options) { prompts.push(options); return { response: 1 }; } },
  };
  vm.runInNewContext(source.slice(start, end), sandbox, { filename: sourcePath });
  sandbox.confirmQuitWithActiveDownloads(2);
  await flush();
  assert.equal(prompts[0].message, '2 downloads are still in progress.');
  assert.equal(prompts[0].detail, 'Quitting pauses them. They continue the next time you open SnagThis.\n\nSnagThis 1.1.0 installs as it quits.');
  assert.deepEqual([...prompts[0].buttons], ['Quit', 'Keep downloading']);
  sandbox.updaterState = { phase: 'idle', updateInfo: null };
  sandbox.confirmQuitWithActiveDownloads(1);
  await flush();
  assert.equal(prompts[1].detail, 'Quitting pauses them. They continue the next time you open SnagThis.', 'unchanged without a ready update');
});
