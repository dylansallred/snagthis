export interface DesktopSettings {
  queueMaxConcurrent: number;
  queueAutoStart: boolean;
  checkUpdatesOnStartup: boolean;
  outputDirectory: string;
  tmdbApiKey?: string;
  subdlApiKey?: string;
  downloadThreads: number;
  preferredQuality: 'best' | '1080' | '720' | '480';
  subtitleLanguage: string;
  notifyOnComplete: boolean;
  launchAtLogin: boolean;
  fileNaming: 'title' | 'resource' | 'custom';
  customFilename: string;
  accent?: 'orange' | 'cobalt' | 'violet' | 'mint' | 'magenta';
  /** When the accent was last chosen, in ms; the later change between desktop and Chrome wins. */
  accentChangedAt?: number;
  /** Saved's sort and grouping per place (`all`, `saved:<folder>`). */
  libraryViews?: Record<string, { sort: import('@m3u8/contracts/src/library.mjs').SortId; group: import('@m3u8/contracts/src/library.mjs').GroupId }>;
}
