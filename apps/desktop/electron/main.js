const { app, BrowserWindow, Menu, ipcMain, shell, session, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const preferences = require('./preferences');
const diagnostics = require('./diagnostics');
const { resolveMediaPage } = require('./mediaPageResolver');
// electron-updater takes ~50ms to load; loadAutoUpdater() defers it until an update check.
let autoUpdater = null;
const { API } = require('@m3u8/contracts');
const { isMediaFilePath } = require('@m3u8/downloader-api/src/utils/mediaFiles');

let mainWindow = null;
let apiServer = null;
let updaterTimer = null;
let updaterReminderTimer = null;
let updaterInstallTimer = null;
let updaterCheckTimeout = null;
let updaterCheckPromise = null;
let updaterInstallRequested = false;
const apiHost = process.env.M3U8_API_HOST || API.host;
let apiPort = Number(process.env.M3U8_API_PORT ?? API.port);
let apiStartupState = 'starting';
let apiStartupError = null;
let requestedView = null;
// Deep links and the extension open Settings on Chrome extension; the app menu reopens the last section.
let requestedSettingsSection = null;
let settingsListenerReady = false;
const explicitUserData = process.env.SNAGTHIS_USER_DATA || process.env.E2E_USER_DATA_DIR || app.commandLine.getSwitchValue('user-data-dir');
const userDataDirectory = explicitUserData ? path.resolve(explicitUserData) : path.join(app.getPath('appData'), app.isPackaged ? 'SnagThis' : 'SnagThis-development');
// Builds before the SnagThis rename kept data under the VidSnag name. Adopt that
// folder once, rewriting the absolute paths the queue and history store inside it.
function adoptLegacyUserData(target, legacy) {
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
  try {
    fs.renameSync(legacy, target);
  } catch (error) {
    console.warn(`Could not move ${legacy} to ${target}: ${error.message}`);
    return;
  }
  const escaped = directory => JSON.stringify(directory + path.sep).slice(1, -1);
  for (const name of ['queue.json', 'history-index.json']) {
    const file = path.join(target, 'data', name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(`${file}.tmp`, text.split(escaped(legacy)).join(escaped(target)));
    fs.renameSync(`${file}.tmp`, file);
  }
}
if (!explicitUserData) adoptLegacyUserData(userDataDirectory, path.join(app.getPath('appData'), app.isPackaged ? 'VidSnag' : 'VidSnag-development'));
fs.mkdirSync(userDataDirectory, { recursive: true });
app.setPath('userData', userDataDirectory);
app.setAppUserModelId('com.snagthisvid.desktop');
const UPDATER_CHECK_TIMEOUT_MS = 45_000;
const UPDATER_STARTUP_CHECK_DELAY_MS = 3_000;
const UPDATER_PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000;

const updaterState = {
  phase: 'idle',
  message: 'Idle',
  progress: 0,
  currentVersion: null,
  updateInfo: null,
  releaseNotes: [],
  deferredUntil: null,
  nextReminderAt: null,
  reminderIntervalMs: null,
  lastCheckedAt: null,
  error: null,
};

const appSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const updaterInstallStatePath = () => path.join(app.getPath('userData'), 'updater-install-state.json');

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
    return target.protocol === trusted.protocol && target.host === trusted.host && target.pathname === trusted.pathname;
  } catch { return false; }
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
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      if (process.platform !== 'win32') {
        fs.chmodSync(candidate, 0o755);
      }
      return candidate;
    } catch {
      continue;
    }
  }

  return '';
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

  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      if (process.platform !== 'win32') {
        fs.chmodSync(candidate, 0o755);
      }
      return candidate;
    } catch {
      continue;
    }
  }

  return '';
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

function clearUpdaterReminderTimer() {
  if (updaterReminderTimer) {
    clearTimeout(updaterReminderTimer);
    updaterReminderTimer = null;
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
      message: 'Move the app to /Applications to enable updates.',
    };
  }

  return { supported: true, message: '' };
}

function setUpdaterIdleState(message, extra = {}) {
  updaterState.phase = 'idle';
  updaterState.message = message;
  updaterState.progress = 0;
  updaterState.error = null;
  updaterState.currentVersion = app.getVersion();
  updaterState.deferredUntil = null;
  updaterState.nextReminderAt = null;
  updaterState.reminderIntervalMs = null;
  Object.assign(updaterState, extra);
  sendToRenderer('updater:event', updaterState);
}

function setUpdaterUnsupportedState(message) {
  clearUpdaterReminderTimer();
  clearUpdaterInstallTimer();
  clearUpdaterCheckTimeout();
  updaterCheckPromise = null;
  setUpdaterIdleState(message, {
    updateInfo: null,
    releaseNotes: [],
  });
}

function normalizeReleaseNotes(updateInfo) {
  const source = updateInfo?.releaseNotes;
  if (!source) return [];
  if (typeof source === 'string') {
    return source.trim() ? [source.trim()] : [];
  }
  if (Array.isArray(source)) {
    return source
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry.note === 'string') return entry.note.trim();
        return '';
      })
      .filter(Boolean);
  }
  return [];
}

function focusMainWindow(view, settingsSection = 'chrome') {
  if (view === 'settings') { requestedView = 'settings'; requestedSettingsSection = settingsSection; }
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  if (requestedView === 'settings' && settingsListenerReady) {
    sendToRenderer('app:open-settings', { section: requestedSettingsSection });
    requestedView = null;
  }
}

function summarizeReleaseNote(updateInfo) {
  const firstNote = normalizeReleaseNotes(updateInfo)[0];
  if (!firstNote) return '';
  return firstNote.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function showUpdateNotification(title, body) {
  try {
    if (!Notification || !Notification.isSupported()) return;
    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.on('click', () => {
      focusMainWindow();
    });
    notification.show();
  } catch {
    // Notification delivery is best-effort.
  }
}

function reconcileUpdaterInstallState() {
  const state = readUpdaterInstallState();
  const currentVersion = app.getVersion();
  updaterState.currentVersion = currentVersion;
  if (!state || !state.targetVersion) return;

  if (state.targetVersion === currentVersion || state.fromVersion !== currentVersion) {
    console.info('[desktop] Previous updater install appears to have completed', {
      fromVersion: state.fromVersion,
      targetVersion: state.targetVersion,
      currentVersion,
    });
    clearUpdaterInstallState();
    return;
  }

  const attemptedAt = state.attemptedAt ? new Date(state.attemptedAt).toLocaleString() : 'an unknown time';
  updaterState.phase = 'error';
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
  clearUpdaterInstallState();
}

function scheduleUpdaterReminder(delayMs, intervalMs) {
  clearUpdaterReminderTimer();
  const safeDelay = Math.max(5_000, Number(delayMs) || 0);
  const safeInterval = Math.max(5 * 60 * 1000, Number(intervalMs) || 30 * 60 * 1000);
  updaterState.reminderIntervalMs = safeInterval;
  updaterState.nextReminderAt = Date.now() + safeDelay;
  sendToRenderer('updater:event', updaterState);

  updaterReminderTimer = setTimeout(() => {
    updaterReminderTimer = null;
    if (updaterState.phase !== 'downloaded') {
      updaterState.nextReminderAt = null;
      updaterState.deferredUntil = null;
      sendToRenderer('updater:event', updaterState);
      return;
    }

    const version = updaterState.updateInfo?.version || 'new';
    updaterState.message = `Reminder: Update ${version} is ready. Restart to install.`;
    updaterState.deferredUntil = null;
    sendToRenderer('updater:event', updaterState);

    scheduleUpdaterReminder(safeInterval, safeInterval);
  }, safeDelay);
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
    clearUpdaterReminderTimer();
    updaterState.phase = 'checking';
    updaterState.message = 'Checking for updates...';
    updaterState.deferredUntil = null;
    updaterState.nextReminderAt = null;
    updaterState.reminderIntervalMs = null;
    updaterState.lastCheckedAt = Date.now();
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });

  autoUpdater.on('update-available', (info) => {
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearUpdaterReminderTimer();
    updaterState.phase = 'downloading';
    updaterState.message = `Downloading version ${info.version}...`;
    updaterState.updateInfo = info;
    updaterState.releaseNotes = normalizeReleaseNotes(info);
    updaterState.deferredUntil = null;
    updaterState.nextReminderAt = null;
    updaterState.reminderIntervalMs = null;
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
    const currentVersion = app.getVersion();
    const releaseNoteSummary = summarizeReleaseNote(info);
    showUpdateNotification(
      `SnagThis ${info.version} is downloading`,
      releaseNoteSummary
        ? `Current version: ${currentVersion}. Downloading in the background. ${releaseNoteSummary}`
        : `Current version: ${currentVersion}. Downloading in the background now.`,
    );
  });

  autoUpdater.on('update-not-available', (info) => {
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearUpdaterReminderTimer();
    updaterState.phase = 'idle';
    updaterState.message = `You are up to date on version ${app.getVersion()}.`;
    updaterState.updateInfo = info || null;
    updaterState.releaseNotes = normalizeReleaseNotes(info);
    updaterState.progress = 0;
    updaterState.deferredUntil = null;
    updaterState.nextReminderAt = null;
    updaterState.reminderIntervalMs = null;
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });

  autoUpdater.on('download-progress', (progress) => {
    clearUpdaterCheckTimeout();
    updaterState.phase = 'downloading';
    updaterState.progress = Math.round(progress.percent || 0);
    updaterState.message = `Downloading update... ${updaterState.progress}%`;
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });

  autoUpdater.on('update-downloaded', (info) => {
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearUpdaterReminderTimer();
    updaterState.phase = 'downloaded';
    updaterState.message = `Update ${info.version} downloaded. Restart to install.`;
    updaterState.updateInfo = info;
    updaterState.releaseNotes = normalizeReleaseNotes(info);
    updaterState.progress = 100;
    updaterState.deferredUntil = null;
    updaterState.nextReminderAt = null;
    updaterState.reminderIntervalMs = null;
    updaterState.error = null;
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
    const releaseNoteSummary = summarizeReleaseNote(info);
    showUpdateNotification(
      `SnagThis ${info.version} is ready`,
      releaseNoteSummary
        ? `Restart SnagThis to install. ${releaseNoteSummary}`
        : 'Restart SnagThis to install this update.',
    );
  });

  autoUpdater.on('error', (error) => {
    const failedPhase = updaterState.phase;
    clearUpdaterCheckTimeout();
    clearUpdaterInstallTimer();
    updaterInstallRequested = false;
    clearUpdaterReminderTimer();
    updaterState.phase = 'error';
    updaterState.message = failedPhase === 'installing' ? 'Update install failed'
      : failedPhase === 'downloading' ? 'Update download failed' : 'Update check failed';
    updaterState.deferredUntil = null;
    updaterState.nextReminderAt = null;
    updaterState.reminderIntervalMs = null;
    updaterState.error = error ? String(error.message || error) : 'Unknown updater error';
    updaterState.currentVersion = app.getVersion();
    sendToRenderer('updater:event', updaterState);
  });
}

async function checkForUpdatesNow() {
  const support = getUpdaterSupportState();
  if (!support.supported) {
    setUpdaterUnsupportedState(support.message);
    return { ok: false, unsupported: true, error: support.message };
  }
  loadAutoUpdater();

  if (updaterCheckPromise) {
    return { ok: true, inFlight: true };
  }
  // A scheduled check must not replace a ready update or interrupt its install.
  if (['downloading', 'downloaded', 'installing'].includes(updaterState.phase)) {
    return { ok: true, inFlight: updaterState.phase !== 'downloaded' };
  }

  updaterState.phase = 'checking';
  updaterState.message = 'Checking for updates...';
  updaterState.progress = 0;
  updaterState.error = null;
  updaterState.currentVersion = app.getVersion();
  updaterState.lastCheckedAt = Date.now();
  updaterState.deferredUntil = null;
  updaterState.nextReminderAt = null;
  updaterState.reminderIntervalMs = null;
  sendToRenderer('updater:event', updaterState);

  updaterCheckPromise = (async () => {
    clearUpdaterCheckTimeout();
    updaterCheckTimeout = setTimeout(() => {
      updaterCheckTimeout = null;
      if (updaterState.phase !== 'checking') return;
      updaterState.phase = 'error';
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
    allowedOrigins: apiAllowedOrigins(),
    appVersion: app.getVersion(),
    dataDir,
    downloadDir,
    getCompletedOutputDir: () => String(readSettings().outputDirectory || '').trim(),
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
    onExtensionConnected: () => sendToRenderer('app:info-update', appInfo()),
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

function createWindow() {
  settingsListenerReady = false;
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
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
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
    if (activeDownloads === 0 || BrowserWindow.getAllWindows().length > 1) return;
    event.preventDefault();
    confirmQuitWithActiveDownloads(activeDownloads);
  });
  window.webContents.on('did-finish-load', () => {
    sendWindowState();
    sendToRenderer('app:info-update', appInfo());
    if (requestedView === 'settings' && settingsListenerReady) {
      sendToRenderer('app:open-settings', { section: requestedSettingsSection });
      requestedView = null;
    }
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameRendererUrl(url)) { event.preventDefault(); openExternal(url).catch(() => {}); }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

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

function registerIpc() {
  handleIpc('app:get-info', async () => appInfo());
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
  handleIpc('app:get-connection-state', async () => apiServer?.getConnectionState?.() || { extensionConnected: false, pairedExtensions: 0 });
  handleIpc('app:open-settings', async () => { focusMainWindow('settings'); return { ok: true }; });
  handleIpc('app:settings-listener-ready', async () => {
    settingsListenerReady = true;
    if (requestedView === 'settings') {
      sendToRenderer('app:open-settings', { section: requestedSettingsSection });
      requestedView = null;
    }
  });
  handleIpc('app:open-external', async (_event, url) => openExternal(url));
  handleIpc('app:open-save-folder', async () => {
    const folderPath = readSettings().outputDirectory || getDownloadDirPath();
    fs.mkdirSync(folderPath, { recursive: true });
    const error = await shell.openPath(folderPath);
    return error ? { ok: false, error } : { ok: true, folderPath };
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

  handleIpc('updater:check-now', async () => checkForUpdatesNow());

  handleIpc('updater:install-now', async () => {
    if (updaterState.phase !== 'downloaded') {
      return { ok: false, error: 'No downloaded update available' };
    }
    if (!app.isPackaged) {
      return { ok: false, error: 'Install update is only available in packaged builds' };
    }
    if (isTranslocatedMacApp()) {
      const error = 'Move the app to /Applications before installing updates';
      updaterState.phase = 'error';
      updaterState.message = 'Update install blocked';
      updaterState.error = error;
      sendToRenderer('updater:event', updaterState);
      return { ok: false, error };
    }
    if (!isInstalledInApplicationsFolder()) {
      const error = 'Auto-update only works when SnagThis is installed in /Applications';
      updaterState.phase = 'error';
      updaterState.message = 'Update install blocked';
      updaterState.error = error;
      sendToRenderer('updater:event', updaterState);
      return { ok: false, error };
    }
    const activeJobs = apiServer?.getState?.().queue?.some((job) =>
      job.queueStatus === 'downloading' || ['fetching-playlist', 'downloading', 'finalizing'].includes(job.status));
    if (activeJobs) {
      const error = 'Pause active downloads or let them finish before restarting to install the update.';
      updaterState.message = error;
      sendToRenderer('updater:event', updaterState);
      return { ok: false, error };
    }

    clearUpdaterReminderTimer();
    updaterInstallRequested = true;
    clearUpdaterInstallTimer();
    updaterState.phase = 'installing';
    updaterState.message = 'Installing update and restarting...';
    updaterState.error = null;
    sendToRenderer('updater:event', updaterState);

    try {
      // Keep explicit installs on the direct quitAndInstall() path. Enabling
      // autoInstallOnAppQuit here breaks MacUpdater because it waits for a
      // native update-downloaded event that is only triggered by another check.
      autoUpdater.autoInstallOnAppQuit = false;
      writeUpdaterInstallState({
        attemptedAt: new Date().toISOString(),
        fromVersion: app.getVersion(),
        targetVersion: updaterState.updateInfo?.version || null,
        platform: process.platform,
        exePath: app.getPath('exe'),
      });
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (err) {
          updaterInstallRequested = false;
          clearUpdaterInstallState();
          updaterState.phase = 'error';
          updaterState.message = 'Update install failed';
          updaterState.error = String((err && err.message) || err || 'Unknown updater error');
          sendToRenderer('updater:event', updaterState);
          console.error('[desktop] quitAndInstall failed', err);
        }
      });

      return { ok: true };
    } catch (err) {
      updaterInstallRequested = false;
      clearUpdaterInstallState();
      updaterState.phase = 'error';
      updaterState.message = 'Update install failed';
      updaterState.error = String((err && err.message) || err || 'Unknown updater error');
      sendToRenderer('updater:event', updaterState);
      return { ok: false, error: updaterState.error };
    }
  });

  handleIpc('updater:remind-later', async (event, minutes = 30) => {
    if (updaterState.phase !== 'downloaded') {
      return { ok: false, error: 'No downloaded update to defer' };
    }
    const delayMs = Math.max(1, Number(minutes) || 30) * 60 * 1000;
    updaterState.deferredUntil = Date.now() + delayMs;
    updaterState.message = `Update deferred until ${new Date(updaterState.deferredUntil).toLocaleString()}`;
    scheduleUpdaterReminder(delayMs, delayMs);
    return { ok: true, deferredUntil: updaterState.deferredUntil };
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
  if (app.isPackaged) app.setAsDefaultProtocolClient('snagthis');
  reconcileUpdaterInstallState();
  registerIpc();
  installApplicationMenu();
  createWindow();
  // Paint the usable window before synchronous binary discovery and API startup.
  const firstWindow = mainWindow;
  await new Promise((resolve) => firstWindow.webContents.once('did-finish-load', resolve));
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
    setUpdaterUnsupportedState(updaterSupport.message);
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
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
});

let apiShutdownPromise = null;
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
    detail: 'Quitting pauses them. They continue the next time you open SnagThis.',
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
  clearUpdaterReminderTimer();
  clearUpdaterCheckTimeout();

  if (!apiServer || apiShutdownComplete) return;
  // Keep the installer's quit direct. Normal quit must wait for local cleanup;
  // Electron does not wait for promises returned by event listeners.
  if (!installingUpdate) event.preventDefault();
  if (apiShutdownPromise) return;
  apiShutdownPromise = (async () => {
    try {
      await apiServer.stop();
    } catch {
      // ignore shutdown error
    }
    apiShutdownComplete = true;
    if (!installingUpdate) app.quit();
  })();
});

bootstrap();
