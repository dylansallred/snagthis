export type UpdaterPhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error';
/** What failed, so the update sheet can say it in plain words. */
export type UpdaterErrorKind = 'check' | 'download' | 'install' | 'location';

export interface UpdaterState {
  phase: UpdaterPhase;
  message: string;
  progress: number;
  currentVersion?: string | null;
  updateInfo?: { version: string } | null;
  lastCheckedAt?: number | null;
  releaseNotes?: string | string[];
  deferredUntil?: number | null;
  nextReminderAt?: number | null;
  error?: string | null;
  errorKind?: UpdaterErrorKind | null;
  /** Bytes from electron-updater's download-progress. */
  transferredBytes?: number | null;
  totalBytes?: number | null;
  bytesPerSecond?: number | null;
  /** "Install when downloads finish" is armed. */
  installWhenIdle?: boolean;
}
