const { app, BrowserWindow, Menu, ipcMain, shell, session, Notification, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const preferences = require('./preferences');
const diagnostics = require('./diagnostics');
const { findBundledExecutable } = require('./bundledBinaries');
const { resolveMediaPage } = require('./mediaPageResolver');
const { adoptLegacyUserData } = require('./legacyData');
// electron-updater takes ~50ms to load; loadAutoUpdater() defers it until an update check.
let autoUpdater = null;
const { API } = require('@m3u8/contracts');
const { isMediaFilePath } = require('@m3u8/downloader-api/src/utils/mediaFiles');

let mainWindow = null;
let apiServer = null;
let updaterTimer = null;
let updaterInstallTimer = null;
let updaterCheckTimeout = null;
let updaterCheckPromise = null;
let updaterInstallRequested = false;
// Install when idle polls while a ready update waits (updates spec §8.1, B · Install on quit or idle).
let updaterIdleTimer = null;
// When SnagThis went out of sight (window closed, hidden or minimised) with nothing downloading.
let updaterAwaySince = null;
// macOS installs through Squirrel.Mac, which must stage (fetch and verify) the downloaded update first.
let updaterStaged = false;
let updaterStaging = null;
const apiHost = process.env.M3U8_API_HOST || API.host;
let apiPort = Number(process.env.M3U8_API_PORT ?? API.port);
let apiStartupState = 'starting';
let apiStartupError = null;
let requestedView = null;
// Deep links and the extension open Settings on Chrome extension; the app menu reopens the last section.
let requestedSettingsSection = null;
let settingsListenerReady = false;
// Clicking the update notification opens the chip's popover once the renderer listens.
let updateListenerReady = false;
// snagthis://open/pair asks to show the one pending Chrome request; it carries no ID or secret.
let pairingDialogRequested = false;
let pairingListenerReady = false;
let pairingDialogShownFor = '';
const explicitUserData = process.env.SNAGTHIS_USER_DATA || process.env.E2E_USER_DATA_DIR || app.commandLine.getSwitchValue('user-data-dir');
const defaultUserDataDirectory = path.join(app.getPath('appData'), app.isPackaged ? 'SnagThis' : 'SnagThis-development');
// Builds before the SnagThis rename kept data under the VidSnag name. Adopting
// it is retried on later launches if it cannot finish now.
const userDataDirectory = explicitUserData
  ? path.resolve(explicitUserData)
  : adoptLegacyUserData(defaultUserDataDirectory, path.join(app.getPath('appData'), app.isPackaged ? 'VidSnag' : 'VidSnag-development')).userData;
fs.mkdirSync(userDataDirectory, { recursive: true });
app.setPath('userData', userDataDirectory);
app.setAppUserModelId('com.snagthisvid.desktop');
const UPDATER_CHECK_TIMEOUT_MS = 45_000;
// A native updater that hasn't quit the app by now has stalled; don't leave "Restarting" up forever.
const UPDATER_INSTALL_TIMEOUT_MS = 180_000;
const UPDATER_STARTUP_CHECK_DELAY_MS = 3_000;
const UPDATER_PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000;
const UPDATER_IDLE_POLL_MS = 30_000;
// Installs by itself once SnagThis has been in the background, with nothing downloading, this long.
const UPDATER_IDLE_INSTALL_MS = 10 * 60 * 1000;
// How long a quit or idle install waits for Squirrel.Mac to stage the update before giving up for now.
const UPDATER_STAGE_TIMEOUT_MS = 15_000;
// A quit that hands over to the installer ends the app itself if the installer doesn't.
const UPDATER_QUIT_EXIT_TIMEOUT_MS = 10_000;

const updaterState = {
  phase: 'idle',
  message: 'Idle',
  progress: 0,
  currentVersion: null,
  updateInfo: null,
  releaseNotes: [],
  lastCheckedAt: null,
  error: null,
  // 'check' | 'download' | 'install' | 'location', so the window can say what went wrong in plain words.
  errorKind: null,
  // An install that didn't finish, found at launch. Scheduled checks leave it up until the person retries.
  failedInstall: false,
  // Set once after relaunching into a new version: { version, releaseNotes }. Cleared when the window has shown it.
  updatedTo: null,
  // macOS copies outside /Applications can't update; Settings offers Move to Applications.
  needsMove: false,
  // From electron-updater's download-progress, for "38 of 92 MB".
  transferredBytes: null,
  totalBytes: null,
  bytesPerSecond: null,
};

const appSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const updaterInstallStatePath = () => path.join(app.getPath('userData'), 'updater-install-state.json');
// Remembers which version's "ready" notification was shown, so it never repeats on later launches.
const updaterNoticePath = () => path.join(app.getPath('userData'), 'updater-notice.json');

function getLogsDirPath() {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function readSettings() {
  return preferences.read(appSettingsPath());
}

function writeSettings(next) {
  return preferences.write(appSettingsPath(), next);
}

function currentSettings() {
  const saved = readSettings();
  const queueSettings = apiServer?.getQueueSettings?.();
  return queueSettings ? { ...saved, queueMaxConcurrent: Number(queueSettings.maxConcurrent) || 1, queueAutoStart: queueSettings.autoStart !== false } : saved;
}

// The accent is read on every extension queue poll, so it is cached rather than read from disk.
let accentCache = null;
function accentState() {
  if (!accentCache) { const saved = readSettings(); accentCache = { accent: saved.accent, accentChangedAt: saved.accentChangedAt }; }
  return accentCache;
}

function saveSettings(next) {
  const input = preferences.validatePatch(next);
  if ('launchAtLogin' in input && ['darwin', 'win32'].includes(process.platform)) {
    app.setLoginItemSettings({ openAtLogin: input.launchAtLogin });
  }
  const before = accentState();
  const merged = writeSettings(input);
  accentCache = { accent: merged.accent, accentChangedAt: merged.accentChangedAt };
  // The renderer and the extension (via /v1/queue) follow a change from either side.
  if (accentCache.accent !== before.accent || accentCache.accentChangedAt !== before.accentChangedAt) sendToRenderer('settings:accent', accentCache);
  const queuePatch = {};
  if ('queueMaxConcurrent' in input) queuePatch.maxConcurrent = merged.queueMaxConcurrent;
  if ('queueAutoStart' in input) queuePatch.autoStart = merged.queueAutoStart;
  if (Object.keys(queuePatch).length) apiServer?.updateQueueSettings?.(queuePatch);
  const apiConfig = require('@m3u8/downloader-api/src/config');
  for (const key of ['tmdbApiKey', 'subdlApiKey', 'downloadThreads']) {
    if (key in input) apiConfig[key] = merged[key];
  }
  return currentSettings();
}

function appInfo() {
  return {
    version: app.getVersion(), apiBaseUrl: `http://${apiHost}:${apiPort}`,
    apiVersion: API.apiVersion, isPackaged: app.isPackaged,
    apiAuthToken: apiStartupState === 'ready' ? (apiServer?.getAuthToken?.() || '') : '',
    apiStartupState, apiStartupError,
    extensionConnected: Boolean(apiServer?.getConnectionState?.().extensionConnected),
  };
}

function safeDiagnostics(payload) {
  const settings = readSettings();
  return diagnostics.redact(payload, [apiServer?.getAuthToken?.(), settings.tmdbApiKey, settings.subdlApiKey]);
}

function rendererUrl() {
  return process.env.VITE_DEV_SERVER_URL || pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
}

function apiAllowedOrigins() {
  // The built renderer is a file:// page: fetch sends Origin "null", but its
  // WebSocket handshake sends "file://". Without it, live updates never connect.
  const origins = ['null', 'file://'];
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    const devUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    if (!['http:', 'https:'].includes(devUrl.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(devUrl.hostname)
      || devUrl.username || devUrl.password) {
      throw new Error('The development renderer must use a loopback HTTP or HTTPS address');
    }
    origins.push(devUrl.origin);
  }
  return origins;
}

function sameRendererUrl(value) {
  try {
    const target = new URL(value);
    const trusted = new URL(rendererUrl());
    if (target.protocol !== trusted.protocol || target.host !== trusted.host) return false;
    if (target.pathname === trusted.pathname) return true;
    // Windows spells one file several ways (drive-letter case, 8.3 short names such as
    // RUNNER~1, percent-encoding), so for the built page compare the file itself.
    return trusted.protocol === 'file:' && sameFile(fileURLToPath(target), fileURLToPath(trusted));
  } catch { return false; }
}

function sameFile(a, b) {
  const [first, second] = [a, b].map(file => fs.realpathSync.native(file));
  return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

// Deny by default. The renderer copies (links, the pairing code, diagnostics),
// reads a pasted link and lets the Saved video player go full screen; nothing
// else is granted, and only to the app's own page in the main window.
// Notifications come from the main process.
const RENDERER_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
function rendererPermissionAllowed(contents, permission, requestingUrl) {
  return Boolean(contents && mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents
    && RENDERER_PERMISSIONS.has(permission) && sameRendererUrl(requestingUrl || contents.getURL()));
}
function applyRendererPermissionPolicy(targetSession) {
  targetSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(rendererPermissionAllowed(contents, permission, details && details.requestingUrl));
  });
  targetSession.setPermissionCheckHandler((contents, permission, _origin, details) => (
    rendererPermissionAllowed(contents, permission, details && details.requestingUrl)));
}

function handleIpc(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame || !sameRendererUrl(event.senderFrame.url)) {
      throw new Error('Untrusted desktop request');
    }
    return callback(event, ...args);
  });
}

async function openExternal(url) {
  const parsed = new URL(String(url));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only HTTP and HTTPS links can be opened');
  await shell.openExternal(parsed.href);
  return { ok: true };
}

async function historyRequest(historyId, action) {
  if (apiStartupState !== 'ready' || !apiServer) return { ok: false, error: 'SnagThis is still starting' };
  if (typeof historyId !== 'string' || !historyId.trim()) return { ok: false, error: 'Missing history item' };
  try {
    const route = `/api/history/${encodeURIComponent(historyId)}${action === 'trash' ? '?mode=trash' : `/${action}`}`;
    const response = await fetch(`http://${apiHost}:${apiPort}${route}`, {
      method: action === 'trash' ? 'DELETE' : 'POST',
      headers: { Authorization: `Bearer ${apiServer.getAuthToken()}` },
      signal: AbortSignal.timeout(action === 'locate' ? 300000 : 30000),
    });
    const result = await response.json();
    return { ...result, ok: response.ok && result.ok !== false };
  } catch (error) { return { ok: false, error: String(error.message || error) }; }
}

function readUpdaterInstallState() {
  try {
    const file = updaterInstallStatePath();
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeUpdaterInstallState(next) {
  try {
    const file = updaterInstallStatePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[desktop] Failed to persist updater install state', err);
  }
}

function clearUpdaterInstallState() {
  try {
    const file = updaterInstallStatePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch (err) {
    console.warn('[desktop] Failed to clear updater install state', err);
  }
}

function readUpdaterNotice() {
  return safeReadJson(updaterNoticePath(), {}) || {};
}

function writeUpdaterNotice(next) {
  try {
    fs.writeFileSync(updaterNoticePath(), JSON.stringify(next), 'utf8');
  } catch (err) {
    console.warn('[desktop] Failed to remember the update notification', err);
  }
}

function buildDiagnosticsFilePath() {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\..+$/, '')
    .replace('T', '_');
  const diagnosticsDir = path.join(app.getPath('userData'), 'diagnostics');
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  return path.join(diagnosticsDir, `diagnostics-${stamp}.json`);
}

function getDiagnosticsDirPath() {
  const diagnosticsDir = path.join(app.getPath('userData'), 'diagnostics');
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  return diagnosticsDir;
}

// Where finished videos go: the chosen save folder, or Downloads/SnagThis as Settings, the help
// page and the site say. (Unset used to leave them in the app's hidden data folder.)
function saveFolderPath() {
  const chosen = String(readSettings().outputDirectory || '').trim();
  if (chosen) return chosen;
  // Tests run with a throwaway profile and must never read or fill the real Downloads folder.
  const downloads = process.env.E2E_USER_DATA_DIR ? path.join(app.getPath('userData'), 'Downloads') : app.getPath('downloads');
  return path.join(downloads, 'SnagThis');
}

function getDownloadDirPath() {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const downloadDir = path.join(dataDir, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  return downloadDir;
}

function getBundledYtDlpPath() {
  const explicit = String(process.env.YTDLP_PATH || process.env.YT_DLP_PATH || '').trim();
  if (explicit) {
    return explicit;
  }

  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', binaryName),
    path.join(app.getAppPath(), 'bin', binaryName),
    path.join(__dirname, '..', 'bin', binaryName),
  ];

  return findBundledExecutable(candidates);
}

function getBundledBinaryPath(binaryNames = []) {
  const names = Array.isArray(binaryNames) ? binaryNames.filter(Boolean) : [];
  if (names.length === 0) return '';

  const candidates = [];
  for (const name of names) {
    candidates.push(path.join(process.resourcesPath || '', 'bin', name));
    candidates.push(path.join(app.getAppPath(), 'bin', name));
    candidates.push(path.join(__dirname, '..', 'bin', name));
  }

  return findBundledExecutable(candidates);
}

function getWindowIconPath() {
  const candidateNames = ['icon.png'];
  const candidates = [];
  for (const name of candidateNames) {
    candidates.push(path.join(process.resourcesPath || '', 'build', name));
    candidates.push(path.join(app.getAppPath(), 'build', name));
    candidates.push(path.join(__dirname, '..', 'build', name));
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function resolveHistoryFolderPath(historyId) {
  if (typeof historyId !== 'string' || !historyId.trim()) return null;
  try {
    const downloadDir = getDownloadDirPath();
    const index = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'data', 'history-index.json'), 'utf8'));
    const items = Array.isArray(index.items) ? index.items : [];
    const item = items.find((entry) => entry?.id === historyId)
      || items.find((entry) => entry?.jobId === historyId);
    if (!item) return null;
    let filePath;
    if (typeof item.absolutePath === 'string' && path.isAbsolute(item.absolutePath)) filePath = item.absolutePath;
    else {
      const relativePath = String(item.relativePath || item.fileName || '');
      if (!relativePath.trim()) return null;
      filePath = path.resolve(downloadDir, relativePath);
      const relative = path.relative(downloadDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    }
    return path.dirname(filePath);
  } catch { return null; }
}

function buildSupportBundleDirPath() {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\..+$/, '')
    .replace('T', '_');
  const bundlesDir = path.join(app.getPath('userData'), 'support-bundles');
  const bundleDir = path.join(bundlesDir, `support-bundle-${stamp}`);
  fs.mkdirSync(bundleDir, { recursive: true });
  return bundleDir;
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function clearUpdaterInstallTimer() {
  if (updaterInstallTimer) {
    clearTimeout(updaterInstallTimer);
    updaterInstallTimer = null;
  }
}

function clearUpdaterCheckTimeout() {
  if (updaterCheckTimeout) {
    clearTimeout(updaterCheckTimeout);
    updaterCheckTimeout = null;
  }
}

function isTranslocatedMacApp() {
  if (process.platform !== 'darwin') return false;
  try {
    const exePath = String(app.getPath('exe') || '');
    return exePath.includes('/AppTranslocation/') || exePath.startsWith('/private/var/folders/');
  } catch {
    return false;
  }
}

function isInstalledInApplicationsFolder() {
  if (process.platform !== 'darwin') return true;
  try {
    if (typeof app.isInApplicationsFolder === 'function') {
      return app.isInApplicationsFolder();
    }
  } catch {
    // Fall through to path heuristic.
  }

  try {
    const exePath = String(app.getPath('exe') || '');
    const homeApplications = path.join(app.getPath('home'), 'Applications') + path.sep;
    return exePath.startsWith('/Applications/') || exePath.startsWith(homeApplications);
  } catch {
    return false;
  }
}

function getUpdaterSupportState() {
  if (!app.isPackaged) {
    return {
      supported: false,
      message: 'Updates are only available in installed app builds.',
    };
  }

  if (isTranslocatedMacApp() || !isInstalledInApplicationsFolder()) {
    return {
      supported: false,
      location: true,
      message: 'Move the app to /Applications to enable updates.',
    };
  }

  return { supported: true, message: '' };
}

function setUpdaterUnsupportedState(support) {
  clearIdleInstall();
  clearUpdaterInstallTimer();
  clearUpdaterCheckTimeout();
  updaterCheckPromise = null;
  updaterState.phase = 'idle';
  updaterState.message = support.message;
  updaterState.progress = 0;
  updaterState.error = null;
  updaterState.errorKind = null;
  updaterState.failedInstall = false;
  updaterState.currentVersion = app.getVersion();
  updaterState.updateInfo = null;
  updaterState.releaseNotes = [];
  // Electron can move a macOS copy into /Applications itself (Settings ▸ Updates & support).
  updaterState.needsMove = !!support.location && process.platform === 'darwin' && typeof app.moveToApplicationsFolder === 'function';
  sendToRenderer('updater:event', updaterState);
}

// GitHub release notes arrive as HTML; the window and notifications show plain text lines.
function releaseNoteLines(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(text)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|ul|ol|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return entities[name.toLowerCase()] ?? match;
    })
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && line !== '•');
}

function normalizeReleaseNotes(updateInfo) {
  const source = updateInfo?.releaseNotes;
  if (!source) return [];
  if (typeof source === 'string') return releaseNoteLines(source);
  if (Array.isArray(source)) {
    return source.flatMap((entry) => {
      if (typeof entry === 'string') return releaseNoteLines(entry);
      if (entry && typeof entry.note === 'string') return releaseNoteLines(entry.note);
      return [];
    });
  }
  return [];
}

// Automated tests run the real app in the background: its window is shown (so it paints and
// animates normally) but fully transparent, never takes focus and stays out of the Dock and
// taskbar, so test runs don't flash windows over whatever the developer is doing.
// E2E_BACKGROUND=0 shows it normally for watching a test.
// CI has no screen to disturb, and an inactive window there can miss keyboard focus, so CI shows it normally.
const backgroundTestWindow = Boolean(process.env?.E2E_USER_DATA_DIR) && !process.env?.CI && process.env?.E2E_BACKGROUND !== '0';
function showWindow(window) {
  if (!backgroundTestWindow) { window.show(); return; }
  window.setOpacity(0);
  window.setSkipTaskbar(true);
  window.showInactive();
}

function focusMainWindow(view, settingsSection = 'chrome') {
  if (view === 'settings') { requestedView = 'settings'; requestedSettingsSection = settingsSection; }
  if (view === 'update') requestedView = 'update';
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  showWindow(mainWindow);
  if (!backgroundTestWindow) mainWindow.focus();
  deliverRequestedView();
}

/** Opens Settings or the update chip's popover once the renderer has said it is listening. */
function deliverRequestedView() {
  if (requestedView === 'settings' && settingsListenerReady) {
    sendToRenderer('app:open-settings', { section: requestedSettingsSection });
    requestedView = null;
  } else if (requestedView === 'update' && updateListenerReady) {
    sendToRenderer('updater:open', {});
    requestedView = null;
  }
}

/**
 * A deep link only focuses the app. The Approve dialog appears when a request is actually
 * pending, so a website opening the link shows nothing.
 */
function showPendingPairing() {
  pairingDialogRequested = true;
  focusMainWindow();
  deliverPairingDialog();
}

function deliverPairingDialog() {
  if (!pairingListenerReady || apiStartupState !== 'ready') return;
  const pending = apiServer?.getPendingPairing?.();
  // A reloaded window gets the dialog back for the request the link already opened.
  const reshow = pending && pending.status === 'pending' && pending.requestId === pairingDialogShownFor;
  if (!pairingDialogRequested && !reshow) return;
  pairingDialogRequested = false;
  if (pending && pending.status === 'pending') {
    pairingDialogShownFor = pending.requestId;
    sendToRenderer('pairing:show', pending);
  }
}

function showUpdateNotification(title, body) {
  try {
    if (!Notification || !Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: true });
    notification.on('click', () => focusMainWindow('update'));
    notification.show();
  } catch {
    // Notification delivery is best-effort.
  }
}

/** Whether the person can see the window right now (on screen, not minimised). */
function windowOnScreen() {
  const window = mainWindow;
  return !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
}

/**
 * SnagThis is out of sight: its window is closed, hidden or minimised. A visible window counts as
 * in use even when unfocused (it may be on another screen), so a relaunch never flashes in front.
 */
function windowAway() {
  return !windowOnScreen();
}

/** How the window looked before an idle install, so the relaunch restores it without popping up. */
function windowVisibility() {
  const window = mainWindow;
  return window && !window.isDestroyed() && window.isVisible() && window.isMinimized() ? 'minimized' : 'hidden';
}

/**
 * Updates download silently. The only notification is one "ready" note when nobody can see the
 * window, once per version, even across launches that find the same cached update again.
 */
function notifyUpdateReady(version) {
  if (!version || windowOnScreen()) return;
  if (readUpdaterNotice().notifiedVersion === version) return;
  writeUpdaterNotice({ notifiedVersion: version });
  showUpdateNotification(`SnagThis ${version} is ready`, 'It installs the next time you quit SnagThis.');
}

/** Reads what the last install attempt left behind. Returns how to reopen after an idle install. */
function reconcileUpdaterInstallState() {
  const state = readUpdaterInstallState();
  const currentVersion = app.getVersion();
  updaterState.currentVersion = currentVersion;
  if (!state || !state.targetVersion) return { reopen: null };
  clearUpdaterInstallState();
  const reopen = ['hidden', 'minimized'].includes(state.reopen) ? state.reopen : null;

  if (state.targetVersion === currentVersion) {
    console.info('[desktop] Updated', { fromVersion: state.fromVersion, currentVersion });
    // One fading "Updated to 1.1.0" toast; the window clears it once shown (updater:updated-seen).
    const notes = Array.isArray(state.releaseNotes) ? state.releaseNotes.filter((line) => typeof line === 'string').slice(0, 60) : [];
    updaterState.updatedTo = { version: currentVersion, releaseNotes: notes };
    return { reopen };
  }
  if (state.fromVersion !== currentVersion) {
    console.info('[desktop] Previous updater install appears to have completed', {
      fromVersion: state.fromVersion,
      targetVersion: state.targetVersion,
      currentVersion,
    });
    return { reopen };
  }

  const attemptedAt = state.attemptedAt ? new Date(state.attemptedAt).toLocaleString() : 'an unknown time';
  updaterState.phase = 'error';
  updaterState.errorKind = 'install';
  updaterState.failedInstall = true;
  // The chip names the version that didn't install, so keep it.
  updaterState.updateInfo = { version: String(state.targetVersion) };
  updaterState.releaseNotes = [];
  updaterState.message = 'Previous update install did not complete';
  // Only macOS installs depend on the app living in /Applications.
  const recovery = process.platform === 'darwin'
    ? 'Move the app to /Applications and retry.'
    : 'Check for updates again, or run the latest SnagThis installer.';
  updaterState.error = `Tried to install ${state.targetVersion} on ${attemptedAt}, but the app reopened on ${currentVersion}. ${recovery}`;
  updaterState.lastCheckedAt = Date.now();
  console.warn('[desktop] Previous updater install did not complete', {
    fromVersion: state.fromVersion,
    targetVersion: state.targetVersion,
    currentVersion,
    attemptedAt: state.attemptedAt,
  });
  return { reopen };
}

/** Downloads a restart would interrupt; Restart now, the idle install and the window share this rule. */
function hasUpdateBlockingDownloads() {
  return !!apiServer?.getState?.().queue?.some((job) =>
    job.queueStatus === 'downloading' || ['fetching-playlist', 'downloading', 'finalizing'].includes(job.status));
}

/** Something the idle install must not interrupt: a running download, or Chrome waiting for Allow. */
function updaterBusy() {
  if (hasUpdateBlockingDownloads()) return true;
  try { return apiServer?.getPendingPairing?.()?.status === 'pending'; } catch { return false; }
}

/**
 * macOS: electron-updater downloads the ZIP, then serves it to Squirrel.Mac through a local proxy.
 * Squirrel fetches it only on its own check, and MacUpdater.quitAndInstall() waits with no limit for
 * that when it hasn't happened yet. Stage it as soon as the update is downloaded, so a quit or idle
 * install finds it ready. Windows (NSIS) has nothing to stage.
 */
function stageNativeUpdate() {
  if (updaterStaged) return Promise.resolve(true);
  const native = process.platform === 'darwin' ? autoUpdater?.nativeUpdater : null;
  if (!native || autoUpdater.squirrelDownloadedUpdate) {
    updaterStaged = true;
    return Promise.resolve(true);
  }
  if (!updaterStaging) {
    updaterStaging = new Promise((resolve) => {
      const finish = (staged) => {
        native.removeListener('update-downloaded', onStaged);
        native.removeListener('error', onError);
        updaterStaging = null;
        if (staged) updaterStaged = true;
        resolve(staged);
      };
      const onStaged = () => finish(true);
      const onError = () => finish(false);
      native.once('update-downloaded', onStaged);
      native.once('error', onError);
      try { native.checkForUpdates(); } catch { finish(false); }
    });
  }
  return updaterStaging;
}

/** True once the update is staged, or false after `timeoutMs` (staging carries on in the background). */
function whenUpdateStaged(timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve(false); }, timeoutMs);
    stageNativeUpdate().then((staged) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(staged);
    });
  });
}

function clearIdleInstall() {
  if (updaterIdleTimer) {
    clearTimeout(updaterIdleTimer);
    updaterIdleTimer = null;
  }
  updaterAwaySince = null;
}

/** Window focus, visibility and minimising move the idle clock (see createWindow). */
function noteWindowPresence() {
  if (updaterState.phase !== 'downloaded') return;
  if (!windowAway()) updaterAwaySince = null;
  else if (updaterAwaySince == null && !updaterBusy()) updaterAwaySince = Date.now();
}

/**
 * Install when idle: once SnagThis has sat in the background for 10 minutes with nothing downloading
 * (and no Chrome request waiting), the ready update installs and SnagThis reopens as it was.
 */
function watchIdleInstall() {
  if (updaterIdleTimer) clearTimeout(updaterIdleTimer);
  updaterIdleTimer = setTimeout(() => {
    updaterIdleTimer = null;
    if (updaterState.phase !== 'downloaded') { updaterAwaySince = null; return; }
    const now = Date.now();
    if (!windowAway() || updaterBusy()) updaterAwaySince = null;
    else if (updaterAwaySince == null) updaterAwaySince = now;
    else if (now - updaterAwaySince >= UPDATER_IDLE_INSTALL_MS) {
      installDownloadedUpdate({ reason: 'idle' }).then((result) => {
        if (!result.ok && updaterState.phase === 'downloaded' && !updaterIdleTimer) watchIdleInstall();
      });
      return;
    }
    watchIdleInstall();
  }, UPDATER_IDLE_POLL_MS);
}

function failUpdateInstall(error) {
  updaterInstallRequested = false;
  clearUpdaterInstallState();
  updaterState.phase = 'error';
  updaterState.errorKind = 'install';
  updaterState.message = 'Update install failed';
  updaterState.error = error;
  sendToRenderer('updater:event', updaterState);
}

function recordInstallAttempt(reopen) {
  writeUpdaterInstallState({
    attemptedAt: new Date().toISOString(),
    fromVersion: app.getVersion(),
    targetVersion: updaterState.updateInfo?.version || null,
    platform: process.platform,
    exePath: app.getPath('exe'),
    reopen,
    // The relaunched version shows these behind "Updated to 1.1.0 · What's new".
    releaseNotes: Array.isArray(updaterState.releaseNotes) ? updaterState.releaseNotes.slice(0, 60) : [],
  });
}

/**
 * Restart now (`reason: 'restart'`) or the idle install (`'idle'`): installs the ready update and
 * relaunches. Never while a download is running or finishing; the queue is checked again right
 * before handing over to the installer.
 */
async function installDownloadedUpdate({ reason = 'restart' } = {}) {
  if (updaterState.phase !== 'downloaded') {
    return { ok: false, error: 'No downloaded update available' };
  }
  if (!app.isPackaged) {
    return { ok: false, error: 'Install update is only available in packaged builds' };
  }
  const translocated = isTranslocatedMacApp();
  if (translocated || !isInstalledInApplicationsFolder()) {
    const error = translocated
      ? 'Move the app to /Applications before installing updates'
      : 'Auto-update only works when SnagThis is installed in /Applications';
    clearIdleInstall();
    updaterState.phase = 'error';
    updaterState.errorKind = 'location';
    updaterState.message = 'Update install blocked';
    updaterState.error = error;
    sendToRenderer('updater:event', updaterState);
    return { ok: false, error };
  }
  const idle = reason === 'idle';
  const blocked = () => hasUpdateBlockingDownloads() || (idle && (updaterBusy() || !windowAway()));
  if (blocked()) {
    return { ok: false, error: 'Pause active downloads or let them finish before restarting to install the update.' };
  }

  clearIdleInstall();
  updaterInstallRequested = true;
  clearUpdaterInstallTimer();
  updaterState.phase = 'installing';
  updaterState.message = 'Installing update and restarting...';
  updaterState.error = null;
  updaterState.errorKind = null;
  sendToRenderer('updater:event', updaterState);
  const reopen = idle ? windowVisibility() : null;

  try {
    // Keep installs on the direct quitAndInstall() path. Enabling autoInstallOnAppQuit
    // breaks MacUpdater because it waits for a native update-downloaded event that is
    // only triggered by another check.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    const staged = await whenUpdateStaged(idle ? UPDATER_STAGE_TIMEOUT_MS : UPDATER_INSTALL_TIMEOUT_MS);
    // Let the window's request settle, then look at the queue once more before handing over.
    await new Promise((resolve) => setImmediate(resolve));
    if (updaterState.phase !== 'installing') return { ok: false, error: updaterState.error || 'The update changed while it was being installed' };
    if (!staged || blocked()) {
      updaterInstallRequested = false;
      if (!staged && !idle) {
        failUpdateInstall('SnagThis couldn’t get the update ready to install. Try again, or download the installer from snagthisvid.com.');
        return { ok: false, error: updaterState.error };
      }
      // Idle installs try again later; a download that just started keeps the update waiting.
      updaterState.phase = 'downloaded';
      updaterState.message = 'Update ready';
      sendToRenderer('updater:event', updaterState);
      watchIdleInstall();
      return { ok: false, error: staged ? 'A download started, so the update waits.' : 'The update is still being prepared.' };
    }
    recordInstallAttempt(reopen);
    // Silent (NSIS /S) and relaunch. On macOS the staged update installs and SnagThis reopens.
    autoUpdater.quitAndInstall(true, true);
    updaterInstallTimer = setTimeout(() => {
      updaterInstallTimer = null;
      if (updaterState.phase !== 'installing') return;
      failUpdateInstall('SnagThis didn’t restart to install the update. Try again, or download the installer from snagthisvid.com.');
      console.error('[desktop] update install did not restart the app');
    }, UPDATER_INSTALL_TIMEOUT_MS);
    return { ok: true };
  } catch (err) {
    failUpdateInstall(String((err && err.message) || err || 'Unknown updater error'));
    console.error('[desktop] quitAndInstall failed', err);
    return { ok: false, error: updaterState.error };
  }
}

/**
 * Install on quit, called once shutdown has paused and saved the queue. Returns true when the
 * installer takes over the quit, or false when SnagThis should just quit: nothing is ready, or macOS
 * hasn't staged the update in time (it then installs at the next quit or idle moment).
 */
async function installUpdateOnQuit() {
  if (updaterState.phase !== 'downloaded' || updaterInstallRequested || !autoUpdater || !getUpdaterSupportState().supported) return false;
  clearIdleInstall();
  // The person asked to quit: nothing stays on screen while the update gets ready.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  const staged = await whenUpdateStaged(UPDATER_STAGE_TIMEOUT_MS);
  if (!staged || updaterState.phase !== 'downloaded') {
    console.warn('[desktop] The update was not staged in time; it installs next time');
    return false;
  }
  try {
    autoUpdater.autoInstallOnAppQuit = false;
    // Quit means quit: install without reopening.
    autoUpdater.autoRunAppAfterInstall = false;
    updaterInstallRequested = true;
    updaterState.phase = 'installing';
    recordInstallAttempt(null);
    autoUpdater.quitAndInstall(true, false);
    // The installer normally ends the app at once; make sure the quit still finishes.
    const exit = setTimeout(() => app.exit(0), UPDATER_QUIT_EXIT_TIMEOUT_MS);
    exit?.unref?.();
    return true;
  } catch (err) {
    console.error('[desktop] Install on quit failed', err);
    updaterInstallRequested = false;
    updaterState.phase = 'downloaded';
    clearUpdaterInstallState();
    return false;
  }
}

function loadAutoUpdater() {
  if (autoUpdater) return;
  autoUpdater = require('electron-updater').autoUpdater;
  configureAutoUpdater();
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearIdleInstall();
    updaterState.phase = 'checking';
    updaterState.message = 'Checking for updates...';
    updaterState.errorKind = null;
    updaterState.lastCheckedAt = Date.now();
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });

  // Downloads silently: no notification and no header chip until it is ready.
  autoUpdater.on('update-available', (info) => {
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearIdleInstall();
    if (updaterState.updateInfo?.version !== info.version) updaterStaged = false;
    updaterState.phase = 'downloading';
    updaterState.message = `Downloading version ${info.version}...`;
    updaterState.updateInfo = info;
    updaterState.releaseNotes = normalizeReleaseNotes(info);
    updaterState.transferredBytes = null;
    updaterState.totalBytes = null;
    updaterState.bytesPerSecond = null;
    updaterState.errorKind = null;
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });

  autoUpdater.on('update-not-available', (info) => {
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearIdleInstall();
    updaterState.phase = 'idle';
    updaterState.errorKind = null;
    updaterState.message = `You are up to date on version ${app.getVersion()}.`;
    updaterState.updateInfo = info || null;
    updaterState.releaseNotes = normalizeReleaseNotes(info);
    updaterState.progress = 0;
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });

  autoUpdater.on('download-progress', (progress) => {
    clearUpdaterCheckTimeout();
    updaterState.phase = 'downloading';
    updaterState.progress = Math.round(progress.percent || 0);
    updaterState.message = `Downloading update... ${updaterState.progress}%`;
    const bytes = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);
    updaterState.transferredBytes = bytes(progress.transferred);
    updaterState.totalBytes = bytes(progress.total) || null;
    updaterState.bytesPerSecond = bytes(progress.bytesPerSecond);
    updaterState.error = null;
    updaterState.errorKind = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });

  autoUpdater.on('update-downloaded', (info) => {
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    updaterState.phase = 'downloaded';
    updaterState.errorKind = null;
    updaterState.message = `Update ${info.version} downloaded. It installs when SnagThis quits.`;
    updaterState.updateInfo = info;
    updaterState.releaseNotes = normalizeReleaseNotes(info);
    updaterState.progress = 100;
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
    stageNativeUpdate();
    clearIdleInstall();
    watchIdleInstall();
    notifyUpdateReady(info.version);
  });

  autoUpdater.on('error', (error) => {
    const failedPhase = updaterState.phase;
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearIdleInstall();
    updaterState.phase = 'error';
    // A downloaded update only fails while Squirrel.Mac stages or installs it.
    const kind = ['installing', 'downloaded'].includes(failedPhase) ? 'install' : failedPhase === 'downloading' ? 'download' : 'check';
    updaterState.errorKind = kind;
    updaterState.message = kind === 'install' ? 'Update install failed'
      : kind === 'download' ? 'Update download failed' : 'Update check failed';
    updaterState.error = error ? String(error.message || error) : 'Unknown updater error';
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });
}

/**
 * Checks for an update: at launch, every six hours, and for Check now / Try again (`userInitiated`).
 * A failed install found at launch stays on screen until the person retries it.
 */
async function checkForUpdatesNow({ userInitiated = false } = {}) {
  const support = getUpdaterSupportState();
  if (!support.supported) {
    setUpdaterUnsupportedState(support);
    return { ok: false, unsupported: true, error: support.message };
  }
  if (updaterState.failedInstall && !userInitiated) {
    return { ok: true, held: true };
  }
  loadAutoUpdater();

  if (updaterCheckPromise) {
    return { ok: true, inFlight: true };
  }
  // A scheduled check must not replace a ready update or interrupt its install.
  if (['downloading', 'downloaded', 'installing'].includes(updaterState.phase)) {
    return { ok: true, inFlight: updaterState.phase !== 'downloaded' };
  }

  clearIdleInstall();
  updaterState.failedInstall = false;
  updaterState.phase = 'checking';
  updaterState.message = 'Checking for updates...';
  updaterState.progress = 0;
  updaterState.error = null;
  updaterState.errorKind = null;
  updaterState.currentVersion = app.getVersion();
  updaterState.lastCheckedAt = Date.now();
  sendToRenderer('updater:event', updaterState);

  updaterCheckPromise = (async () => {
    clearUpdaterCheckTimeout();
    updaterCheckTimeout = setTimeout(() => {
      updaterCheckTimeout = null;
      if (updaterState.phase !== 'checking') return;
      updaterState.phase = 'error';
      updaterState.errorKind = 'check';
      updaterState.message = 'Update check timed out';
      updaterState.error = 'The update service did not respond. Try again in a moment.';
      updaterState.progress = 0;
      updaterState.currentVersion = app.getVersion();
      sendToRenderer('updater:event', updaterState);
    }, UPDATER_CHECK_TIMEOUT_MS);

    try {
      const result = await autoUpdater.checkForUpdates();
      // checkForUpdates resolves before the download. The updater emits its
      // error event and also rejects this separate promise on download failure.
      result?.downloadPromise?.catch(() => {});
      if (updaterState.phase === 'checking') {
        const nextVersion = result && result.updateInfo && result.updateInfo.version
          ? String(result.updateInfo.version)
          : '';
        const hasNewVersion = nextVersion && nextVersion !== app.getVersion();
        if (hasNewVersion) {
          updaterState.phase = 'downloading';
          updaterState.message = `Downloading version ${nextVersion}...`;
          updaterState.updateInfo = result.updateInfo;
          updaterState.releaseNotes = normalizeReleaseNotes(result.updateInfo);
        } else {
          updaterState.phase = 'idle';
          updaterState.message = `You're up to date on version ${app.getVersion()}.`;
          updaterState.updateInfo = result && result.updateInfo ? result.updateInfo : null;
          updaterState.releaseNotes = normalizeReleaseNotes(result && result.updateInfo);
        }
        updaterState.progress = 0;
        updaterState.error = null;
        updaterState.currentVersion = app.getVersion();
        sendToRenderer('updater:event', updaterState);
      }
      return { ok: true };
    } catch (err) {
      updaterState.phase = 'error';
      updaterState.errorKind = 'check';
      updaterState.message = 'Update check failed';
      updaterState.error = String(err.message || err);
      updaterState.progress = 0;
      updaterState.currentVersion = app.getVersion();
      sendToRenderer('updater:event', updaterState);
      return { ok: false, error: updaterState.error };
    } finally {
      clearUpdaterCheckTimeout();
      updaterCheckPromise = null;
    }
  })();

  return updaterCheckPromise;
}

async function startLocalApi() {
  process.env.LOG_DIR = process.env.LOG_DIR || getLogsDirPath();
  const bundledYtDlpPath = getBundledYtDlpPath();
  if (bundledYtDlpPath) {
    process.env.YTDLP_PATH = bundledYtDlpPath;
    process.env.YT_DLP_PATH = bundledYtDlpPath;
    console.info(`[desktop] Using bundled yt-dlp at ${bundledYtDlpPath}`);
  }
  const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeBinaryName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const bundledFfmpegPath = getBundledBinaryPath([ffmpegBinaryName]);
  const bundledFfprobePath = getBundledBinaryPath([ffprobeBinaryName]);
  if (bundledFfmpegPath) {
    process.env.FFMPEG_PATH = bundledFfmpegPath;
    console.info(`[desktop] Using bundled ffmpeg at ${bundledFfmpegPath}`);
  }
  if (bundledFfprobePath) {
    process.env.FFPROBE_PATH = bundledFfprobePath;
    console.info(`[desktop] Using bundled ffprobe at ${bundledFfprobePath}`);
  }

  const savedSettings = readSettings();
  if (savedSettings.tmdbApiKey) {
    process.env.TMDB_API_KEY = savedSettings.tmdbApiKey;
  }
  if (savedSettings.subdlApiKey) {
    process.env.SUBDL_API_KEY = savedSettings.subdlApiKey;
  }

  const { createApiServer } = require('@m3u8/downloader-api');
  const apiConfig = require('@m3u8/downloader-api/src/config');
  if (savedSettings.downloadThreads > 0) {
    apiConfig.downloadThreads = savedSettings.downloadThreads;
  }
  const dataDir = path.join(app.getPath('userData'), 'data');
  const downloadDir = path.join(dataDir, 'downloads');

  apiServer = createApiServer({
    host: apiHost,
    port: apiPort,
    // Inspection is reachable only from this app's own window (/api), for links the user pasted
    // themselves, so home servers and NAS addresses stay allowed. Extensions have no inspect route.
    inspectPrivateAddresses: true,
    allowedOrigins: apiAllowedOrigins(),
    appVersion: app.getVersion(),
    dataDir,
    downloadDir,
    getCompletedOutputDir: () => saveFolderPath(),
    ffmpegPath: bundledFfmpegPath || process.env.FFMPEG_PATH,
    ffprobePath: bundledFfprobePath || process.env.FFPROBE_PATH,
    ytDlpPath: bundledYtDlpPath || process.env.YTDLP_PATH || process.env.YT_DLP_PATH,
    trustBinaryPaths: Boolean(bundledFfmpegPath || bundledYtDlpPath),
    initialQueueSettings: {
      maxConcurrent: Number(savedSettings.queueMaxConcurrent) || 1,
      autoStart: savedSettings.queueAutoStart !== false,
    },
    onFocus: (view) => focusMainWindow(view),
    onResolvePage: resolveMediaPage,
    onTrashFile: async (filePath) => { await shell.trashItem(filePath); },
    onOpenFile: async (filePath) => {
      // openPath launches whatever handler owns the extension; allow media only.
      if (!isMediaFilePath(filePath)) throw new Error('Only video and audio files can be opened');
      const error = await shell.openPath(filePath);
      if (error) throw new Error(error);
    },
    onLocateFile: async (item) => {
      focusMainWindow();
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Locate saved video', properties: ['openFile'],
        defaultPath: item?.absolutePath || readSettings().outputDirectory || app.getPath('downloads'),
        filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'ts'] }],
      });
      return result.canceled ? null : (result.filePaths[0] || null);
    },
    onExtensionConnected: () => {
      sendToRenderer('app:info-update', appInfo());
      sendToRenderer('pairing:extensions', apiServer?.listExtensions?.() || []);
    },
    // Match codes go only to the trusted renderer; they are never logged.
    onPairingChange: (pending) => sendToRenderer('pairing:state', pending),
    onGetSettings: currentSettings,
    onSaveSettings: saveSettings,
    onGetAppearance: accentState,
    onDownloadComplete: (job) => {
      try {
        if (!readSettings().notifyOnComplete || !Notification.isSupported()) return;
        const notification = new Notification({ title: 'Video saved', body: String(job.title || job.filename || 'Your video is ready.') });
        notification.on('click', () => focusMainWindow());
        notification.show();
      } catch { /* System notifications are best-effort. */ }
    },
  });

  const address = await apiServer.start();
  apiPort = Number(address?.port || apiServer.server?.address()?.port || apiPort);
  if (apiServer && typeof apiServer.applyLegacyQueueSettings === 'function') {
    apiServer.applyLegacyQueueSettings({
      maxConcurrent: Number(savedSettings.queueMaxConcurrent) || 1,
      autoStart: savedSettings.queueAutoStart !== false,
    });
  }
}

// Unified header (spec §6): the app's dark top bar is the title bar. These
// match --color-surface-chrome and --color-foreground-muted in globals.css;
// accent themes never change them, so the overlay colours stay fixed.
const WINDOW_CHROME = {
  background: '#080a0c',
  symbol: '#9f9793',
  // Header is 53px including its 1px accent line; 52 keeps the line visible.
  overlayHeight: 52,
  // Vertically centres the 12px traffic lights in the 52px bar.
  trafficLights: { x: 20, y: 20 },
};

function windowChromeOptions() {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: WINDOW_CHROME.trafficLights };
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: WINDOW_CHROME.background, symbolColor: WINDOW_CHROME.symbol, height: WINDOW_CHROME.overlayHeight },
  };
}

function windowState(window) {
  return { fullScreen: !!window && !window.isDestroyed() && window.isFullScreen() };
}

// macOS keeps a standard application menu so ⌘C/⌘V/⌘Z, ⌘W, ⌘M, ⌘Q and full
// screen keep working. Windows and Linux get no menu bar: the header is the
// title bar, and Chromium handles Ctrl+C/V/X/Z/A in text fields natively.
function installApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Command+,', click: () => focusMainWindow('settings', null) },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ] },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      ...(isDev ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []),
      { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]));
}

/** `reveal`: 'show' (normal) or 'minimized' (after an idle install, so nothing pops up). */
function createWindow({ reveal: revealAs = 'show' } = {}) {
  settingsListenerReady = false;
  updateListenerReady = false;
  pairingListenerReady = false;
  mainWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    show: false,
    // Dark chrome from the first frame, so a slow or failed load is never a white window.
    backgroundColor: WINDOW_CHROME.background,
    ...windowChromeOptions(),
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const window = mainWindow;
  const reveal = () => {
    if (window.isDestroyed() || window.isVisible() || window.isMinimized()) return;
    if (revealAs === 'minimized') window.minimize();
    else showWindow(window);
  };
  window.once('ready-to-show', reveal);
  // Without GPU compositing (some Linux desktops, virtual displays) a hidden window can
  // skip its first paint, so ready-to-show never fires. Never leave the app invisible.
  const revealFallback = setTimeout(reveal, 3000);
  // Closing, hiding or minimising the window moves the idle-install clock; a visible window stops it.
  for (const name of ['show', 'hide', 'minimize', 'restore']) window.on(name, noteWindowPresence);
  window.on('closed', () => {
    clearTimeout(revealFallback);
    if (mainWindow !== window) return;
    mainWindow = null;
    noteWindowPresence();
    // A hidden page-resolver window would otherwise hold off window-all-closed.
    if (process.platform !== 'darwin') app.quit();
  });
  // A crashed or killed renderer otherwise leaves a dead window while downloads
  // continue. Reload it, backing off, and stop if it keeps crashing on load.
  const rendererCrashes = [];
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[desktop] Renderer process gone: ${details.reason} (${details.exitCode})`);
    if (details.reason === 'clean-exit') return;
    const now = Date.now();
    while (rendererCrashes.length && now - rendererCrashes[0] > 60_000) rendererCrashes.shift();
    rendererCrashes.push(now);
    if (rendererCrashes.length > 3) return;
    setTimeout(() => { if (!window.isDestroyed()) window.webContents.reload(); }, 1000 * rendererCrashes.length);
  });
  // The header drops its traffic-light inset in macOS full screen.
  const sendWindowState = () => { if (!window.isDestroyed()) window.webContents.send('window:state', windowState(window)); };
  window.on('enter-full-screen', sendWindowState);
  window.on('leave-full-screen', sendWindowState);
  if (process.platform !== 'darwin' && process.env.VITE_DEV_SERVER_URL) {
    // Without a menu bar, keep the developer tools shortcuts in development.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) { event.preventDefault(); window.webContents.toggleDevTools(); }
      else if (input.control && !input.shift && input.key.toLowerCase() === 'r') { event.preventDefault(); window.webContents.reload(); }
    });
  }
  // Outside macOS the last window's close quits the app. Ask while the window
  // still exists, so "Keep downloading" leaves it open instead of hidden.
  window.on('close', (event) => {
    if (process.platform === 'darwin' || quitConfirmed || apiShutdownPromise || updaterInstallRequested) return;
    const activeDownloads = activeDownloadCount();
    // Hidden page-resolver windows are not app windows; only the main
    // window's close ends the app here.
    if (activeDownloads === 0 || window !== mainWindow) return;
    event.preventDefault();
    confirmQuitWithActiveDownloads(activeDownloads);
  });
  window.webContents.on('did-finish-load', () => {
    sendWindowState();
    sendToRenderer('app:info-update', appInfo());
    deliverRequestedView();
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameRendererUrl(url)) { event.preventDefault(); openExternal(url).catch(() => {}); }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  applyRendererPermissionPolicy(mainWindow.webContents.session);

  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const cspParts = [
    `default-src 'self'`,
    `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*`,
    `img-src 'self' data: blob: http://127.0.0.1:* https:`,
    `media-src 'self' blob: http://127.0.0.1:*`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-src 'none'`,
    `font-src 'self' data:`,
  ];
  const csp = cspParts.join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// The logo and tabs move the window from JavaScript instead of a native drag region, where
// macOS delivers no pointer events (no hover, no clicks). The renderer starts a drag once the
// pointer has moved a few pixels and ends it on release; the window follows the cursor meanwhile.
let windowDrag = null;
function stopWindowDrag() {
  if (!windowDrag) return;
  clearInterval(windowDrag.timer);
  clearTimeout(windowDrag.limit);
  if (!windowDrag.window.isDestroyed()) windowDrag.window.removeListener('blur', stopWindowDrag);
  windowDrag = null;
}
function startWindowDrag(window) {
  stopWindowDrag();
  if (!window || window.isDestroyed() || window.isFullScreen() || window.isMaximized()) return { ok: false };
  const cursor = screen.getCursorScreenPoint();
  const [left, top] = window.getPosition();
  const offset = { x: cursor.x - left, y: cursor.y - top };
  const timer = setInterval(() => {
    if (window.isDestroyed()) { stopWindowDrag(); return; }
    const point = screen.getCursorScreenPoint();
    window.setPosition(Math.round(point.x - offset.x), Math.round(point.y - offset.y));
  }, 16);
  // A lost release (focus moved elsewhere, a missed pointerup) must never leave the window stuck to the cursor.
  const limit = setTimeout(stopWindowDrag, 30_000);
  window.once('blur', stopWindowDrag);
  windowDrag = { window, timer, limit };
  return { ok: true };
}

function registerIpc() {
  handleIpc('app:get-info', async () => appInfo());
  handleIpc('window:drag-start', async (event) => startWindowDrag(BrowserWindow.fromWebContents(event.sender)));
  handleIpc('window:drag-end', async () => { stopWindowDrag(); return { ok: true }; });
  handleIpc('window:get-state', async (event) => windowState(BrowserWindow.fromWebContents(event.sender)));
  handleIpc('settings:get', async () => currentSettings());
  handleIpc('settings:save', async (_event, next) => saveSettings(next));
  // The preload reads the accent synchronously so it is applied before the first paint.
  ipcMain.on('settings:get-accent-sync', (event) => {
    const trusted = mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
    event.returnValue = trusted ? accentState() : { accent: 'orange', accentChangedAt: 0 };
  });
  handleIpc('app:get-pairing-info', async () => {
    if (apiStartupState !== 'ready') throw new Error('SnagThis is still starting');
    return apiServer.getPairingInfo();
  });
  handleIpc('pairing:get-state', async () => (apiStartupState === 'ready' ? apiServer.getPendingPairing() : null));
  handleIpc('pairing:decide', async (_event, requestId, allow) => {
    if (apiStartupState !== 'ready') throw new Error('SnagThis is still starting');
    return apiServer.decidePairing(String(requestId || ''), allow === true);
  });
  handleIpc('pairing:listener-ready', async () => { pairingListenerReady = true; deliverPairingDialog(); });
  handleIpc('extensions:list', async () => (apiStartupState === 'ready' ? apiServer.listExtensions() : []));
  handleIpc('extensions:disconnect', async (_event, id) => {
    if (apiStartupState !== 'ready') throw new Error('SnagThis is still starting');
    return { ok: apiServer.revokeExtension(String(id || '')) };
  });
  handleIpc('app:get-connection-state', async () => apiServer?.getConnectionState?.() || { extensionConnected: false, pairedExtensions: 0 });
  handleIpc('app:open-settings', async () => { focusMainWindow('settings'); return { ok: true }; });
  handleIpc('app:settings-listener-ready', async () => {
    settingsListenerReady = true;
    deliverRequestedView();
  });
  handleIpc('updater:listener-ready', async () => {
    updateListenerReady = true;
    deliverRequestedView();
  });
  handleIpc('app:open-external', async (_event, url) => openExternal(url));
  handleIpc('app:open-save-folder', async () => {
    const folderPath = saveFolderPath();
    fs.mkdirSync(folderPath, { recursive: true });
    const error = await shell.openPath(folderPath);
    return error ? { ok: false, error } : { ok: true, folderPath };
  });
  handleIpc('library:open-folder', async (_event, folderPath) => {
    try {
      // The renderer names a folder of Saved; it is resolved inside the save folder and never follows links out of it.
      const root = path.resolve(saveFolderPath());
      const segments = typeof folderPath === 'string' && folderPath ? folderPath.split('/') : [];
      if (typeof folderPath !== 'string' || folderPath.length > 4096 || /[\\\0]/.test(folderPath) || segments.some((part) => !part || part === '.' || part === '..')) {
        return { ok: false, error: 'Folder not found' };
      }
      let current = root;
      if (!segments.length) fs.mkdirSync(root, { recursive: true });
      for (const segment of segments) {
        current = path.join(current, segment);
        const stat = fs.lstatSync(current, { throwIfNoEntry: false });
        if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return { ok: false, error: 'Folder not found' };
      }
      const error = await shell.openPath(current);
      return error ? { ok: false, error } : { ok: true, folderPath: current };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  handleIpc('app:trash-history-file', async (_event, id) => historyRequest(id, 'trash'));
  handleIpc('app:locate-history-file', async (_event, id) => historyRequest(id, 'locate'));

  handleIpc('settings:choose-output-directory', async () => {
    try {
      const current = readSettings();
      const result = await dialog.showOpenDialog(mainWindow || undefined, {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: String(current.outputDirectory || '').trim() || app.getPath('downloads'),
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { ok: false, cancelled: true };
      }
      return { ok: true, path: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  handleIpc('app:save-diagnostics-file', async (event, payload) => {
    try {
      const filePath = buildDiagnosticsFilePath();
      fs.writeFileSync(filePath, JSON.stringify(safeDiagnostics(payload || {}), null, 2), { encoding: 'utf8', mode: 0o600 });
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  handleIpc('app:open-diagnostics-folder', async () => {
    try {
      const folderPath = getDiagnosticsDirPath();
      const openResult = await shell.openPath(folderPath);
      if (openResult) {
        return { ok: false, error: openResult, folderPath };
      }
      return { ok: true, folderPath };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  handleIpc('app:open-history-file', async (_event, id) => historyRequest(id, 'open'));

  handleIpc('app:open-history-folder', async (_event, historyId) => {
    try {
      const safeHistoryId = typeof historyId === 'string' ? historyId.trim() : '';
      if (!safeHistoryId) {
        return { ok: false, error: 'Missing video' };
      }
      // The renderer provides only an identity. Resolve its directory from the
      // trusted history index or current queue, including unfinished downloads.
      const job = apiServer?.getState?.().queue?.find(item => item.id === safeHistoryId);
      const folderPath = resolveHistoryFolderPath(safeHistoryId) || job?.outputDirectory;
      if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath) || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return { ok: false, error: 'Folder not found' };
      }
      const error = await shell.openPath(folderPath);
      return error ? { ok: false, error } : { ok: true, folderPath };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  handleIpc('app:export-support-bundle', async (_event, payload) => {
    try {
      const bundleDir = buildSupportBundleDirPath();
      const state = apiServer?.getState?.() || {};
      const snapshot = safeDiagnostics({
        exportedAt: new Date().toISOString(), appVersion: app.getVersion(),
        platform: process.platform, arch: process.arch, apiStartupState,
        settings: currentSettings(), queue: diagnostics.queueSummary(state.queue),
        updater: { phase: updaterState.phase, error: updaterState.error },
        diagnostics: payload || {},
      });
      fs.writeFileSync(path.join(bundleDir, 'summary.json'), JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
      return { ok: true, bundlePath: bundleDir, included: ['summary.json'] };
    } catch (error) { return { ok: false, error: String(error.message || error) }; }
  });

  handleIpc('updater:get-state', async () => ({ ...updaterState }));

  handleIpc('updater:check-now', async () => checkForUpdatesNow({ userInitiated: true }));

  handleIpc('updater:install-now', async () => installDownloadedUpdate());

  // The window showed "Updated to 1.1.0" once; later windows and launches don't repeat it.
  handleIpc('updater:updated-seen', async () => {
    if (!updaterState.updatedTo) return { ok: true };
    updaterState.updatedTo = null;
    sendToRenderer('updater:event', updaterState);
    return { ok: true };
  });

  // macOS copies outside /Applications can't update. Electron moves the app there and reopens it.
  handleIpc('app:move-to-applications', async () => {
    if (process.platform !== 'darwin' || !app.isPackaged || typeof app.moveToApplicationsFolder !== 'function') {
      return { ok: false, error: 'SnagThis can’t move itself from here. Drag it to your Applications folder.' };
    }
    const active = activeDownloadCount();
    const options = {
      type: 'question',
      buttons: ['Move to Applications', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Move SnagThis to your Applications folder?',
      detail: `SnagThis closes, moves itself there and opens again, so it can keep itself up to date.${active ? ' Downloads in progress pause and continue when it reopens.' : ''}`,
    };
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const { response } = await (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options));
    if (response !== 0) return { ok: false, cancelled: true };
    try {
      // The person already chose; the move quits and relaunches without the downloads prompt.
      quitConfirmed = true;
      const moved = app.moveToApplicationsFolder();
      if (!moved) quitConfirmed = false;
      return moved ? { ok: true } : { ok: false, error: 'SnagThis wasn’t moved.' };
    } catch (error) {
      quitConfirmed = false;
      return { ok: false, error: String(error?.message || error) };
    }
  });
}

async function bootstrap() {
  const skipSingleInstanceLock = process.env.E2E_ALLOW_MULTI_INSTANCE === '1';
  if (!skipSingleInstanceLock) {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
      return;
    }
  }

  const handleProtocol = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'snagthis:' || parsed.hostname !== 'open') return;
      if (parsed.pathname === '/pair') { showPendingPairing(); return; }
      focusMainWindow(parsed.pathname === '/settings' ? 'settings' : undefined);
    } catch { /* Ignore unrelated launch arguments. */ }
  };
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((value) => value.startsWith('snagthis://'));
    if (url) handleProtocol(url);
    else focusMainWindow();
  });
  app.on('open-url', (event, url) => { event.preventDefault(); handleProtocol(url); });
  const initialProtocol = process.argv.find((value) => value.startsWith('snagthis://'));
  if (initialProtocol) handleProtocol(initialProtocol);

  await app.whenReady();
  if (backgroundTestWindow && process.platform === 'darwin') app.dock?.hide();
  if (app.isPackaged) app.setAsDefaultProtocolClient('snagthis');
  const { reopen } = reconcileUpdaterInstallState();
  registerIpc();
  installApplicationMenu();
  // After an idle install SnagThis comes back as it was: without a window on macOS if it had
  // none (the Dock icon opens it), otherwise minimised, never in front.
  const launchHidden = reopen === 'hidden' && process.platform === 'darwin' && !pairingDialogRequested && !requestedView;
  if (!launchHidden) {
    createWindow({ reveal: reopen ? 'minimized' : 'show' });
    // Paint the usable window before synchronous binary discovery and API startup.
    const firstWindow = mainWindow;
    await new Promise((resolve) => firstWindow.webContents.once('did-finish-load', resolve));
  }
  try {
    await startLocalApi();
    apiStartupState = 'ready';
  } catch (error) {
    apiStartupState = 'failed';
    apiStartupError = error?.code === 'EADDRINUSE'
      ? 'Another app is using SnagThis’s connection port. Close the other copy and reopen SnagThis.'
      : 'SnagThis could not start its download service. Reopen the app or export diagnostics from Settings.';
    console.error('[desktop] Download service startup failed:', safeDiagnostics(String(error?.message || error)));
  }
  sendToRenderer('app:info-update', appInfo());

  const settings = readSettings();
  const updaterSupport = getUpdaterSupportState();
  if (!updaterSupport.supported) {
    setUpdaterUnsupportedState(updaterSupport);
  } else if (settings.checkUpdatesOnStartup !== false) {
    setTimeout(() => {
      checkForUpdatesNow();
    }, UPDATER_STARTUP_CHECK_DELAY_MS);

    updaterTimer = setInterval(() => {
      checkForUpdatesNow();
    }, UPDATER_PERIODIC_CHECK_MS);
  }

}

// Tests and scripted quits must not wait on a native prompt nobody can answer.
const skipQuitConfirmation = process.env.NODE_ENV === 'test' || process.env.SNAGTHIS_SKIP_QUIT_CONFIRM === '1';

// macOS apps keep running without a window so downloads continue; the Dock
// icon reopens it. Elsewhere closing the last window quits (with the prompt).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  // Hidden page-resolver windows do not count: the Dock icon must reopen the app.
  if (app.isReady() && (!mainWindow || mainWindow.isDestroyed())) createWindow();
});

// yt-dlp runs in its own process group and FFmpeg is not tied to this
// process, so neither stops when the app exits abruptly (update install,
// app.exit, a signal, an uncaught error). Kill what is still running.
process.on('exit', () => {
  if (!apiServer) return;
  try { require('@m3u8/downloader-api/src/utils/childProcesses').killTrackedChildProcesses(); } catch { /* Exiting anyway. */ }
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => { quitConfirmed = true; app.quit(); setTimeout(() => app.exit(0), SHUTDOWN_TIMEOUT_MS + 2000).unref(); });
}
// After an uncaught error the main process state is unknown. Save the queue
// through the normal shutdown instead of leaving downloads running headless.
let uncaughtErrorSeen = false;
process.on('uncaughtException', (error) => {
  console.error('[desktop] Uncaught exception:', safeDiagnostics(String(error?.stack || error?.message || error)));
  if (uncaughtErrorSeen) return;
  uncaughtErrorSeen = true;
  quitConfirmed = true;
  try { app.quit(); } catch { /* Forced below. */ }
  setTimeout(() => app.exit(1), SHUTDOWN_TIMEOUT_MS + 2000).unref();
});

let apiShutdownPromise = null;
// Pausing and saving downloads normally takes a few seconds; never let a stuck
// child or socket keep the app from quitting.
const SHUTDOWN_TIMEOUT_MS = 15_000;
let apiShutdownComplete = false;
let quitConfirmed = false;
let quitPrompt = null;

function activeDownloadCount() {
  if (!apiServer || typeof apiServer.getState !== 'function' || skipQuitConfirmation) return 0;
  try {
    return apiServer.getState().queue.filter((job) => job && job.queueStatus === 'downloading').length;
  } catch {
    return 0;
  }
}

function confirmQuitWithActiveDownloads(count) {
  if (quitPrompt) return;
  const options = {
    type: 'question',
    buttons: ['Quit', 'Keep downloading'],
    defaultId: 1,
    cancelId: 1,
    message: count === 1 ? 'A download is still in progress.' : `${count} downloads are still in progress.`,
    detail: 'Quitting pauses them. They continue the next time you open SnagThis.'
      // A ready update installs as SnagThis quits (updates spec §8.1).
      + (updaterState.phase === 'downloaded' && updaterState.updateInfo?.version ? `\n\nSnagThis ${updaterState.updateInfo.version} installs as it quits.` : ''),
  };
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  quitPrompt = Promise.resolve(owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options))
    .then(({ response }) => {
      if (response !== 0) return;
      quitConfirmed = true;
      app.quit();
    }, () => {})
    .finally(() => { quitPrompt = null; });
}

app.on('before-quit', (event) => {
  // Ask before a normal quit interrupts downloads. An update install already
  // asked the user, and a quit already in progress must stay non-interactive.
  if (!updaterInstallRequested && !quitConfirmed && !apiShutdownPromise) {
    const activeDownloads = activeDownloadCount();
    if (activeDownloads > 0) {
      event.preventDefault();
      confirmQuitWithActiveDownloads(activeDownloads);
      return;
    }
  }
  const installingUpdate = updaterInstallRequested;
  updaterInstallRequested = false;
  clearUpdaterInstallTimer();
  if (updaterTimer) {
    clearInterval(updaterTimer);
    updaterTimer = null;
  }
  clearIdleInstall();
  clearUpdaterCheckTimeout();

  if (!apiServer || apiShutdownComplete) return;
  // Keep the installer's quit direct. Normal quit must wait for local cleanup;
  // Electron does not wait for promises returned by event listeners.
  if (!installingUpdate) event.preventDefault();
  if (apiShutdownPromise) return;
  apiShutdownPromise = (async () => {
    let shutdownTimer;
    try {
      await Promise.race([
        apiServer.stop(),
        new Promise((resolve) => { shutdownTimer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS); }),
      ]);
    } catch {
      // ignore shutdown error
    } finally {
      clearTimeout(shutdownTimer);
    }
    apiShutdownComplete = true;
    if (installingUpdate) return;
    // Install on quit: with the queue saved, a ready update installs as SnagThis quits.
    if (await installUpdateOnQuit()) return;
    app.quit();
  })();
});

bootstrap();
