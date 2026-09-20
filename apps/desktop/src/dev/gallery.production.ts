import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import type { QueueJob } from '@/types/queue';

// Production builds do not ship the development gallery or its sample movies.
export const galleryRows: RowModel[] = [];
export const galleryQueue: QueueJob[] = [];
export async function loadGalleryVideo(_row: Pick<RowModel, 'thumbnailUrl'>): Promise<string | null> {
  return null;
}
