import type { DragEvent } from 'react';
import { libraryText } from '@m3u8/contracts/src/library.mjs';

/** Saved videos being dragged onto a folder (never a link, so Drop to snag ignores it). */
export const SAVED_DRAG_TYPE = 'application/x-snagthis-saved';

// dataTransfer can't be read during dragover, so targets read the dragged videos from here.
let current: { ids: string[] } | null = null;

/** The drag image: a small card with the poster and title (and how many videos), never the whole row. */
function dragCard(title: string, thumbnailUrl: string | null, count: number) {
  const card = document.createElement('div');
  card.className = 'drag-ghost';
  if (thumbnailUrl) {
    const image = document.createElement('img');
    image.src = thumbnailUrl;
    image.alt = '';
    card.append(image);
  }
  const label = document.createElement('span');
  label.textContent = title;
  card.append(label);
  if (count > 1) {
    const badge = document.createElement('b');
    badge.textContent = libraryText('dragCount', { n: count });
    card.append(badge);
  }
  document.body.append(card);
  requestAnimationFrame(() => card.remove());
  return card;
}

export function startSavedDrag(event: DragEvent, ids: string[], look: { title: string; thumbnailUrl: string | null }) {
  current = { ids };
  event.dataTransfer.setData(SAVED_DRAG_TYPE, JSON.stringify(ids));
  event.dataTransfer.effectAllowed = 'move';
  try { event.dataTransfer.setDragImage(dragCard(look.title, look.thumbnailUrl, ids.length), 18, 15); } catch { /* The row itself is the drag image. */ }
}
export function endSavedDrag() { current = null; }
export function isSavedDrag(event: DragEvent) { return Array.from(event.dataTransfer.types || []).includes(SAVED_DRAG_TYPE); }
export function draggedIds(event: DragEvent): string[] {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData(SAVED_DRAG_TYPE) || 'null');
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) return parsed;
  } catch { /* Fall back to the drag this window started. */ }
  return current?.ids || [];
}
