const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  // The header clears the macOS traffic lights or the Windows/Linux caption buttons.
  platform: process.platform,
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  onWindowState: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  // Read once, synchronously, so the saved accent is on <html> before the first paint.
  initialAccent: (() => { try { return ipcRenderer.sendSync('settings:get-accent-sync'); } catch { return null; } })(),
  onAccentChange: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('settings:accent', handler);
    return () => ipcRenderer.removeListener('settings:accent', handler);
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseOutputDirectory: () => ipcRenderer.invoke('settings:choose-output-directory'),
  getUpdaterState: () => ipcRenderer.invoke('updater:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check-now'),
  installUpdateNow: () => ipcRenderer.invoke('updater:install-now'),
  remindLater: (minutes) => ipcRenderer.invoke('updater:remind-later', minutes),
  saveDiagnosticsFile: (payload) => ipcRenderer.invoke('app:save-diagnostics-file', payload),
  openDiagnosticsFolder: () => ipcRenderer.invoke('app:open-diagnostics-folder'),
  exportSupportBundle: (payload) => ipcRenderer.invoke('app:export-support-bundle', payload),
  openHistoryFile: (historyId) => ipcRenderer.invoke('app:open-history-file', historyId),
  openHistoryFolder: (historyId) => ipcRenderer.invoke('app:open-history-folder', historyId),
  moveHistoryFileToTrash: (historyId) => ipcRenderer.invoke('app:trash-history-file', historyId),
  locateHistoryFile: (historyId) => ipcRenderer.invoke('app:locate-history-file', historyId),
  getPairingInfo: () => ipcRenderer.invoke('app:get-pairing-info'),
  getConnectionState: () => ipcRenderer.invoke('app:get-connection-state'),
  openSaveFolder: () => ipcRenderer.invoke('app:open-save-folder'),
  openSettings: () => ipcRenderer.invoke('app:open-settings'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onAppInfoUpdate: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('app:info-update', handler);
    return () => ipcRenderer.removeListener('app:info-update', handler);
  },
  onOpenSettings: (cb) => {
    const handler = (_event, options) => cb(options && typeof options === 'object' ? { section: options.section || undefined } : {});
    ipcRenderer.on('app:open-settings', handler);
    ipcRenderer.invoke('app:settings-listener-ready').catch(() => {});
    return () => ipcRenderer.removeListener('app:open-settings', handler);
  },
  onUpdaterEvent: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('updater:event', handler);
    return () => ipcRenderer.removeListener('updater:event', handler);
  },
});
