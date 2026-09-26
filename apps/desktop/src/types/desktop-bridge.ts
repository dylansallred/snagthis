import type { DesktopSettings } from './settings';
import type { UpdaterState } from './updater';

export interface AppInfo {
  version: string;
  apiBaseUrl: string;
  apiVersion: string;
  isPackaged: boolean;
  apiAuthToken: string;
  apiStartupState: 'starting' | 'ready' | 'failed';
  apiStartupError: string | null;
  extensionConnected: boolean;
}

export interface DesktopActionResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
  filePath?: string;
  folderPath?: string;
}

export interface ConnectionState {
  extensionConnected: boolean;
  pairedExtensions: number;
}

export interface WindowState {
  fullScreen: boolean;
}

export interface DesktopBridge {
  platform: string;
  getWindowState(): Promise<WindowState>;
  onWindowState(cb: (state: WindowState) => void): () => void;
  getAppInfo(): Promise<AppInfo>;
  /** The saved accent at load time (settings.json), read synchronously by the preload. */
  initialAccent?: { accent: string; accentChangedAt: number } | null;
  /** Accent changes from Settings or the Chrome extension. */
  onAccentChange?(cb: (state: { accent: string; accentChangedAt: number }) => void): () => void;
  getSettings(): Promise<DesktopSettings>;
  saveSettings(settings: Partial<DesktopSettings>): Promise<DesktopSettings>;
  chooseOutputDirectory(): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
  getUpdaterState(): Promise<UpdaterState>;
  checkForUpdates(): Promise<{ ok: boolean }>;
  installUpdateNow(): Promise<{ ok: boolean; error?: string }>;
  remindLater(minutes: number): Promise<{ ok: boolean; deferredUntil?: number }>;
  saveDiagnosticsFile(payload: unknown): Promise<{ ok: boolean; filePath?: string; error?: string }>;
  openDiagnosticsFolder(): Promise<{ ok: boolean; folderPath?: string; error?: string }>;
  exportSupportBundle(payload: unknown): Promise<{ ok: boolean; bundlePath?: string; error?: string }>;
  openHistoryFile(historyId: string): Promise<{ ok: boolean; error?: string }>;
  openHistoryFolder(historyId: string): Promise<{ ok: boolean; error?: string }>;
  moveHistoryFileToTrash(historyId: string): Promise<DesktopActionResult>;
  locateHistoryFile(historyId: string): Promise<DesktopActionResult>;
  getPairingInfo(): Promise<{ code: string; expiresAt: number }>;
  getConnectionState(): Promise<ConnectionState>;
  openSaveFolder(): Promise<DesktopActionResult>;
  openSettings(): Promise<DesktopActionResult>;
  openExternal(url: string): Promise<DesktopActionResult>;
  onAppInfoUpdate(cb: (info: AppInfo) => void): () => void;
  /** `section` is 'chrome' for the extension and deep links; absent for the app menu (reopen the last section). */
  onOpenSettings(cb: (options: { section?: 'chrome' }) => void): () => void;
  onUpdaterEvent(cb: (event: UpdaterState) => void): () => void;
}

declare global {
  interface Window {
    desktop: DesktopBridge;
  }
}
