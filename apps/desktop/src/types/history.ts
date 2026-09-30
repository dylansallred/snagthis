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
}
