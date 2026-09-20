import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type MutableRefObject } from 'react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { VideoRow } from './VideoRow';
import type { RowCommand } from './RowDetails';
import { ui } from '@/lib/strings';
import type { RequestThumbnailPreview } from './FillThumb';

interface RowHandlers {
  onToggle: (row: RowModel) => void;
  onCommand: (row: RowModel, command: RowCommand) => void;
  onRename: (row: RowModel, title: string | null) => Promise<void>;
  onRefreshLink: (row: RowModel, url: string) => Promise<void>;
  onMoveTo: (sourceId: string, targetId: string) => void;
}
type StableRowProps = Omit<ComponentProps<typeof VideoRow>, keyof RowHandlers> & { handlers: MutableRefObject<RowHandlers> };

const StableVideoRow = memo(function StableVideoRow({ row, handlers, ...props }: StableRowProps) {
  return <VideoRow {...props} row={row}
    onToggle={() => handlers.current.onToggle(row)} onCommand={(command) => handlers.current.onCommand(row, command)}
    onRename={(title) => handlers.current.onRename(row, title)} onRefreshLink={(url) => handlers.current.onRefreshLink(row, url)}
    onMoveTo={(sourceId, targetId) => handlers.current.onMoveTo(sourceId, targetId)} />;
}, (previous, next) => {
  // Queue ticks rebuild row models, but the immutable saved history stays the
  // same. Check its date-dependent text too, so "Saved today" can still change.
  const sameHistory = previous.row.isHistory && next.row.isHistory
    && previous.row.source === next.row.source && previous.row.statusLine === next.row.statusLine;
  if (previous.row !== next.row && !sameHistory) return false;
  return (Object.keys(next) as (keyof StableRowProps)[]).every((key) => key === 'row' || previous[key] === next[key]);
});

export function VideoList({ rows, apiBase, folder, expandedId, renamingId, busyId, hasMore, loadingMore, onLoadMore, onToggle, onCommand, onRename, onRefreshLink, onMoveTo, onRequestPreview }: {
  rows: RowModel[]; apiBase: string; folder: string; expandedId: string | null; renamingId: string | null; busyId: string | null;
  hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; onToggle: (row: RowModel) => void;
  onCommand: (row: RowModel, command: RowCommand) => void; onRename: (row: RowModel, title: string | null) => Promise<void>;
  onRefreshLink: (row: RowModel, url: string) => Promise<void>; onMoveTo: (sourceId: string, targetId: string) => void;
  onRequestPreview: RequestThumbnailPreview;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const handlers = useRef<RowHandlers>({ onToggle, onCommand, onRename, onRefreshLink, onMoveTo });
  // Events from a memoized row must use the latest committed App callbacks.
  useLayoutEffect(() => { handlers.current = { onToggle, onCommand, onRename, onRefreshLink, onMoveTo }; });
  const [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>('keyboard');
  useEffect(() => {
    const pointerInput = () => setInputMode('pointer');
    const keyboardInput = (event: KeyboardEvent) => {
      if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) setInputMode('keyboard');
    };
    document.addEventListener('pointerdown', pointerInput, true);
    document.addEventListener('pointermove', pointerInput, true);
    document.addEventListener('keydown', keyboardInput, true);
    return () => {
      document.removeEventListener('pointerdown', pointerInput, true);
      document.removeEventListener('pointermove', pointerInput, true);
      document.removeEventListener('keydown', keyboardInput, true);
    };
  }, []);
  useEffect(() => {
    if (!hasMore || loadingMore || !sentinel.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoadMore(); }, { rootMargin: '120px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);
  return <div role="list" aria-label="Videos" className="video-list" data-input-mode={inputMode} onKeyDown={(event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || (event.target as HTMLElement).matches('input,select,textarea,[role="menuitem"]')) return;
    const rowElements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-row-key]'));
    const active = (event.target as HTMLElement).closest('[data-row-key]');
    const current = rowElements.findIndex((element) => element === active);
    const next = Math.max(0, Math.min(rowElements.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    if (rowElements[next]) { event.preventDefault(); rowElements[next].focus(); }
  }}>
    {rows.map((row) => <StableVideoRow key={row.id} row={row} inputMode={inputMode} apiBase={apiBase} folder={folder} expanded={expandedId === row.id} renaming={renamingId === row.id} busy={busyId === row.id}
      handlers={handlers} onRequestPreview={onRequestPreview} />)}
    {hasMore && <div ref={sentinel} className="load-more"><button className="row-action" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? ui.loading : ui.loadMore}</button></div>}
  </div>;
}
