import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import type { QueueJob } from '@/types/queue';
import type { UpdaterState } from '@/types/updater';

// Production builds do not ship the development gallery or its sample movies.
export const galleryRows: RowModel[] = [];
export const galleryQueue: QueueJob[] = [];
export function galleryUpdater(_state: string | null): UpdaterState | null {
  return null;
}
export async function loadGalleryVideo(_row: Pick<RowModel, 'thumbnailUrl'>): Promise<string | null> {
  return null;
}
