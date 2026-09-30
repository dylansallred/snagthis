import { mergeRows, type RowModel } from '@m3u8/contracts/src/rows.mjs';
import type { QueueJob } from '@/types/queue';
import type { UpdaterState } from '@/types/updater';
import emberTide from './media/ember-tide.jpg';
import neonRain from './media/neon-rain.jpg';
import skyHop from './media/sky-hop.jpg';
import starCourier from './media/star-courier.jpg';

const now = Date.now();
const job = (id: string, title: string, patch: Partial<QueueJob> & { height?: number } = {}): QueueJob => ({
  id, title, url: `https://videos.example/${id}/`, queueStatus: 'queued', status: 'queued', progress: 0,
  totalSegments: 0, completedSegments: 0, bytesDownloaded: 0, activeConnections: 0, maxConnections: 16, connectionCountAvailable: true, error: null,
  fallbackUsed: false, fallbackUrl: null, originalHlsUrl: null, createdAt: now, updatedAt: now, ...patch,
});
const pieces = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [String(index), { status: index < 87 ? 'completed' : index < 89 ? 'retrying' : index < 94 ? 'downloading' : 'pending', attempt: index < 89 && index >= 87 ? 2 : 1 }])) as QueueJob['segmentStates'];
export const galleryQueue = [
  job('downloading', 'Neon Rain — night drive', { queueStatus: 'downloading', status: 'downloading', progress: 34, height: 720, etaSeconds: 300, speedBps: 4_100_000, bytesDownloaded: 714_000_000, totalBytes: 2_100_000_000, activeConnections: 6, totalSegments: 256, completedSegments: 87, segmentStates: pieces, thumbnailUrls: [neonRain], youtubeMetadata: { durationSeconds: 757 } }),
  job('finishing', 'Ember Tide — sunset crossing', { queueStatus: 'downloading', status: 'finalizing', progress: 97, bytesDownloaded: 1_130_000_000, totalBytes: 1_160_000_000, totalBytesKnown: true, activeConnections: null, connectionCountAvailable: false, thumbnailUrls: [emberTide], youtubeMetadata: { durationSeconds: 1334 } }),
  job('placeholder', 'Behind the pixels — how Neon Rain was drawn', { queueStatus: 'downloading', status: 'downloading', progress: 18, etaSeconds: 60, speedBps: 3_200_000, bytesDownloaded: 115_000_000, totalBytes: 640_000_000, totalBytesKnown: true, activeConnections: 4, youtubeMetadata: { durationSeconds: 594 } }),
  job('problem-expired', 'Sky Hop — director’s commentary', { queueStatus: 'failed', status: 'failed', progress: 48, bytesDownloaded: 540_000_000, totalBytes: 1_130_000_000, totalBytesKnown: true, error: 'SOURCE_EXPIRED: the video link expired (403)', thumbnailUrls: [skyHop], youtubeMetadata: { durationSeconds: 1458 } }),
  job('paused', 'Star Courier — arcade run', { queueStatus: 'paused', status: 'paused', progress: 48, bytesDownloaded: 380_000_000, totalBytes: 790_000_000, totalBytesKnown: true, thumbnailUrls: [starCourier], youtubeMetadata: { durationSeconds: 485 } }),
  job('waiting', 'Sky Hop — a play button’s day out', { thumbnailUrls: [skyHop], youtubeMetadata: { durationSeconds: 342 } }),
  job('waiting-later', 'Star Courier — boss stage', { thumbnailUrls: [starCourier], youtubeMetadata: { durationSeconds: 312 } }),
];
const history = [
  { id: 'saved', jobId: 'saved', fileName: 'Ember Tide.mp4', title: 'Ember Tide — director’s cut', sourcePageUrl: 'https://videos.example/ember-tide/', height: 1080, sizeBytes: 182_000_000, modifiedAt: now, thumbnailUrl: emberTide, durationSeconds: 1334 },
  { id: 'missing', jobId: 'missing', fileName: 'Sky Hop.mp4', title: 'Sky Hop — saved copy', sizeBytes: 650_000_000, modifiedAt: now - 86400000, thumbnailUrl: skyHop, durationSeconds: 342, missing: true },
];
export const galleryRows = mergeRows(galleryQueue, history, { surface: 'desktop', now });

// Release notes as main.js delivers them from a GitHub release body: lines, list items prefixed "• ".
const galleryReleaseNotes = [
  'What’s new',
  '• New: Accent colours. Pick Orange, Cobalt, Violet, Mint or Magenta. Chrome follows along.',
  '• New: Saved shelf previews. Hover a thumbnail to see a few seconds of the video.',
  '• Better: Expired links. Reopen the page and SnagThis carries on from where it stopped.',
  '• Fixed: Big files. Downloads over 4 GB no longer stall at 99%.',
  '• Fixed: Windows. The window remembers its size on high-DPI screens.',
  'Which file do I need?',
  '• Mac with Apple Silicon (M1 or later): SnagThis-mac-arm64.dmg',
  '• Windows: SnagThis-1.1.0-win-x64.exe',
];
export const galleryUpdateStates = ['checking', 'uptodate', 'downloading', 'ready', 'blocked', 'installing', 'error', 'failed-install', 'updated', 'move'] as const;

/** `?gallery&update=<state>` previews the update chip, popover, toast and Settings row without contacting an update service. */
export function galleryUpdater(state: string | null): UpdaterState | null {
  if (!state || !(galleryUpdateStates as readonly string[]).includes(state)) return null;
  const base: UpdaterState = { phase: 'downloaded', message: '', progress: 100, currentVersion: '1.0.0', updateInfo: { version: '1.1.0' }, releaseNotes: galleryReleaseNotes, lastCheckedAt: Date.now(), error: null };
  switch (state) {
    case 'checking': return { ...base, phase: 'checking', progress: 0, updateInfo: null, releaseNotes: [] };
    case 'uptodate': return { ...base, phase: 'idle', progress: 0, updateInfo: { version: '1.0.0' }, releaseNotes: [] };
    case 'downloading': return { ...base, phase: 'downloading', progress: 41, transferredBytes: 38_000_000, totalBytes: 92_000_000, bytesPerSecond: 2_700_000 };
    case 'installing': return { ...base, phase: 'installing' };
    case 'error': return { ...base, phase: 'error', progress: 41, errorKind: 'download', message: 'Update download failed', transferredBytes: 38_000_000, totalBytes: 92_000_000,
      error: 'Error: net::ERR_CONNECTION_RESET\n  GET https://github.com/dylansallred/snagthis/releases/download/v1.1.0/SnagThis-1.1.0-arm64-mac.zip\n  at ClientRequest.<anonymous> (electron-updater/out/httpExecutor.js:318)\n  received 38000000 of 92000000 bytes' };
    // What main.js reports after relaunching on the old version: the install didn't finish.
    case 'failed-install': return { ...base, phase: 'error', progress: 0, errorKind: 'install', failedInstall: true, message: 'Previous update install did not complete', releaseNotes: [],
      error: 'Tried to install 1.1.0 on 29/09/2026, 15:42:10, but the app reopened on 1.0.0. Move the app to /Applications and retry.' };
    // Relaunched into 1.1.0 after installing.
    case 'updated': return { ...base, phase: 'idle', progress: 0, currentVersion: '1.1.0', updateInfo: { version: '1.1.0' }, releaseNotes: [], updatedTo: { version: '1.1.0', releaseNotes: galleryReleaseNotes } };
    case 'move': return { ...base, phase: 'idle', progress: 0, updateInfo: null, releaseNotes: [], lastCheckedAt: null, needsMove: true, message: 'Move the app to /Applications to enable updates.' };
    default: return base;
  }
}

export async function loadGalleryVideo(row: Pick<RowModel, 'thumbnailUrl'>): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  if (row.thumbnailUrl === neonRain) return (await import('./media/neon-rain.mp4?url')).default;
  if (row.thumbnailUrl === skyHop) return (await import('./media/sky-hop.mp4?url')).default;
  if (row.thumbnailUrl === starCourier) return (await import('./media/star-courier.mp4?url')).default;
  return (await import('./media/ember-tide.mp4?url')).default;
}
