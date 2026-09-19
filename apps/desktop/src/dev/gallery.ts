import { mergeRows, type RowModel } from '@m3u8/contracts/src/rows.mjs';
import type { QueueJob } from '@/types/queue';
import bunny from './media/big-buck-bunny.jpg';
import sintel from './media/sintel.jpg';
import tears from './media/tears-of-steel.jpg';

const now = Date.now();
const job = (id: string, title: string, patch: Partial<QueueJob> = {}): QueueJob => ({
  id, title, url: `https://studio.blender.org/films/${id}/`, queueStatus: 'queued', status: 'queued', progress: 0,
  totalSegments: 0, completedSegments: 0, bytesDownloaded: 0, error: null,
  fallbackUsed: false, fallbackUrl: null, originalHlsUrl: null, createdAt: now, updatedAt: now, ...patch,
});
const pieces = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [String(index), { status: index < 87 ? 'completed' : index < 89 ? 'retrying' : index < 94 ? 'downloading' : 'pending', attempt: index < 89 && index >= 87 ? 2 : 1 }])) as QueueJob['segmentStates'];
export const galleryQueue = [
  job('downloading', 'Sintel — an open movie by Blender', { queueStatus: 'downloading', status: 'downloading', progress: 34, etaSeconds: 300, speedBps: 4_100_000, bytesDownloaded: 714_000_000, totalBytes: 2_100_000_000, totalSegments: 256, completedSegments: 87, segmentStates: pieces, thumbnailUrls: [sintel], youtubeMetadata: { durationSeconds: 888 } }),
  job('finishing', 'Tears of Steel', { queueStatus: 'downloading', status: 'finalizing', progress: 97, thumbnailUrls: [tears], youtubeMetadata: { durationSeconds: 734 } }),
  job('placeholder', 'Behind the scenes — the animation process', { queueStatus: 'downloading', status: 'downloading', progress: 18, etaSeconds: 60, speedBps: 3_200_000, youtubeMetadata: { durationSeconds: 594 } }),
  job('problem-expired', 'Big Buck Bunny — director’s commentary', { queueStatus: 'failed', status: 'failed', progress: 48, error: 'SOURCE_EXPIRED: the video link expired (403)', thumbnailUrls: [bunny], youtubeMetadata: { durationSeconds: 1458 } }),
  job('paused', 'Sintel — the making of', { queueStatus: 'paused', status: 'paused', progress: 48, thumbnailUrls: [sintel], youtubeMetadata: { durationSeconds: 1000 } }),
  job('waiting', 'Big Buck Bunny — full film', { thumbnailUrls: [bunny], youtubeMetadata: { durationSeconds: 596 } }),
];
const history = [
  { id: 'saved', jobId: 'saved', fileName: 'Tears of Steel.mp4', title: 'Tears of Steel — Blender open movie', sizeBytes: 182_000_000, modifiedAt: now, thumbnailUrl: tears, durationSeconds: 734 },
  { id: 'missing', jobId: 'missing', fileName: 'Big Buck Bunny.mp4', title: 'Big Buck Bunny — saved copy', sizeBytes: 650_000_000, modifiedAt: now - 86400000, thumbnailUrl: bunny, durationSeconds: 596, missing: true },
];
export const galleryRows = mergeRows(galleryQueue, history, { surface: 'desktop', now });

export async function loadGalleryVideo(row: RowModel): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  if (row.thumbnailUrl === sintel) return (await import('./media/sintel.mp4?url')).default;
  if (row.thumbnailUrl === bunny) return (await import('./media/big-buck-bunny.mp4?url')).default;
  return (await import('./media/tears-of-steel.mp4?url')).default;
}
