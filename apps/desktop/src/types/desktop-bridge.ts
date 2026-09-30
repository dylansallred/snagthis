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

/** A one-click connection request, as shown in the trusted desktop UI. Never holds a token or secret. */
export interface PairingRequest {
  requestId: string;
  status: 'pending' | 'approved' | 'collected' | 'denied' | 'expired' | 'conflict' | 'cancelled';
  matchCode: string;
  expiresAt: number;
  extensionId: string;
  extensionVersion: string;
  /** 'store' is a known Chrome Web Store ID; 'connected-before' re-pairs a connected extension. */
  identity: 'store' | 'connected-before' | 'unrecognized';
}

export interface ConnectedExtension {
  id: string;
  extensionId: string;
  createdAt: number;
  lastSeenAt: number | null;
  legacy: boolean;
  identity: 'store' | 'unrecognized';
}

export interface WindowState {
  fullScreen: boolean;
}

export interface DesktopBridge {
  platform: string;
  getWindowState(): Promise<WindowState>;
  startWindowDrag?(): Promise<{ ok: boolean }>;
  endWindowDrag?(): Promise<{ ok: boolean }>;
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
  remindLater(minutes: number): Promise<{ ok: boolean; deferredUntil?: number; error?: string }>;
  /** Undo for Later: drops the pending reminder. */
  cancelUpdateReminder(): Promise<{ ok: boolean }>;
  /** Arms or clears "Install when downloads finish". */
  installUpdateWhenIdle(enabled: boolean): Promise<{ ok: boolean; installWhenIdle?: boolean; error?: string }>;
  saveDiagnosticsFile(payload: unknown): Promise<{ ok: boolean; filePath?: string; error?: string }>;
  openDiagnosticsFolder(): Promise<{ ok: boolean; folderPath?: string; error?: string }>;
  exportSupportBundle(payload: unknown): Promise<{ ok: boolean; bundlePath?: string; error?: string }>;
  openHistoryFile(historyId: string): Promise<{ ok: boolean; error?: string }>;
  openHistoryFolder(historyId: string): Promise<{ ok: boolean; error?: string }>;
  moveHistoryFileToTrash(historyId: string): Promise<DesktopActionResult>;
  locateHistoryFile(historyId: string): Promise<DesktopActionResult>;
  getPairingInfo(): Promise<{ code: string; expiresAt: number }>;
  getConnectionState(): Promise<ConnectionState>;
  getPairingRequest(): Promise<PairingRequest | null>;
  decidePairing(requestId: string, allow: boolean): Promise<{ ok: boolean; status: string }>;
  listExtensions(): Promise<ConnectedExtension[]>;
  disconnectExtension(id: string): Promise<{ ok: boolean }>;
  /** snagthis://open/pair while a request is pending. */
  onPairingShow(cb: (request: PairingRequest) => void): () => void;
  onPairingState(cb: (request: PairingRequest | null) => void): () => void;
  onExtensionsChange(cb: (extensions: ConnectedExtension[]) => void): () => void;
  openSaveFolder(): Promise<DesktopActionResult>;
  /** Opens a folder of Saved (a path below the save folder; '' is the save folder) in Finder or Explorer. */
  openLibraryFolder(folderPath: string): Promise<DesktopActionResult>;
  openSettings(): Promise<DesktopActionResult>;
  openExternal(url: string): Promise<DesktopActionResult>;
  onAppInfoUpdate(cb: (info: AppInfo) => void): () => void;
  /** `section` is 'chrome' for the extension and deep links; absent for the app menu (reopen the last section). */
  onOpenSettings(cb: (options: { section?: 'chrome' }) => void): () => void;
  onUpdaterEvent(cb: (event: UpdaterState) => void): () => void;
  /** An update notification was clicked: show the update sheet. */
  onOpenUpdate?(cb: () => void): () => void;
}

declare global {
  interface Window {
    desktop: DesktopBridge;
  }
}
