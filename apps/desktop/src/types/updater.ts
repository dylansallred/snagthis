export type UpdaterPhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error';
/** What failed, so the window can say it in plain words. */
export type UpdaterErrorKind = 'check' | 'download' | 'install' | 'location';

export interface UpdaterState {
  phase: UpdaterPhase;
  message: string;
  progress: number;
  currentVersion?: string | null;
  updateInfo?: { version: string } | null;
  lastCheckedAt?: number | null;
  releaseNotes?: string | string[];
  error?: string | null;
  errorKind?: UpdaterErrorKind | null;
  /** An install that didn't finish, found at launch; it stays until the person retries. */
  failedInstall?: boolean;
  /** Set once after relaunching into a new version, for the "Updated to 1.1.0" toast. */
  updatedTo?: { version: string; releaseNotes: string[] } | null;
  /** macOS copy outside /Applications: Settings offers Move to Applications. */
  needsMove?: boolean;
  /** Bytes from electron-updater's download-progress. */
  transferredBytes?: number | null;
  totalBytes?: number | null;
  bytesPerSecond?: number | null;
}
