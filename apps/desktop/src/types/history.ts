export interface HistoryItem {
  id: string;
  fileName: string;
  relativePath?: string | null;
  absolutePath?: string | null;
  label: string;
  jobId: string | null;
  title: string | null;
  sizeBytes: number;
  modifiedAt: number;
  ext: string;
  thumbnailUrl: string | null;
  /** The folder of Saved it is in ('' for the save folder itself). */
  folder?: string;
  previewClipUrl?: string | null;
  previewClipDurationSeconds?: number;
  tmdbReleaseDate: string | null;
  tmdbMetadata: {
    overview?: string;
    runtime?: number;
    tagline?: string;
    genres?: string[];
  } | null;
  youtubeMetadata?: {
    channelName?: string;
    channelUrl?: string;
  } | null;
  sourcePageUrl?: string | null;
  /** Where it came from: the page's title, the site's own name and the channel or uploader. */
  sourceInfo?: SourceInfo | null;
  /** When the download finished (the file's modification time can change later). */
  completedAt?: number | null;
}

export interface SourceInfo { pageTitle?: string; siteName?: string; uploader?: string }

/** What is inside a saved file (GET /api/history/:id/media-info), probed once per file version. */
export interface MediaInfo {
  formatName?: string | null;
  durationSeconds?: number | null;
  bitRate?: number | null;
  video?: { codec?: string | null; profile?: string | null; width?: number | null; height?: number | null; fps?: number | null; bitRate?: number | null; hdr?: string | null } | null;
  audio?: { codec?: string | null; profile?: string | null; channels?: number | null; layout?: string | null; language?: string | null; title?: string | null; bitRate?: number | null; default?: boolean }[];
  subtitles?: { codec?: string | null; language?: string | null; title?: string | null; default?: boolean; forced?: boolean }[];
  /** Subtitle files beside the video. */
  sideSubtitles?: { fileName: string; format: string; language: string | null }[];
  cached?: boolean;
  probedAt?: number;
}
