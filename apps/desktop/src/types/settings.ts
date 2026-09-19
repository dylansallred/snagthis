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
}
