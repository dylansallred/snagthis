import { useEffect, useRef } from 'react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { VideoRow } from './VideoRow';
import type { RowCommand } from './RowDetails';
import { ui } from '@/lib/strings';

export function VideoList({ rows, apiBase, folder, expandedId, renamingId, busyId, hasMore, loadingMore, onLoadMore, onToggle, onCommand, onRename, onRefreshLink, onMoveTo }: {
  rows: RowModel[]; apiBase: string; folder: string; expandedId: string | null; renamingId: string | null; busyId: string | null;
  hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; onToggle: (row: RowModel) => void;
  onCommand: (row: RowModel, command: RowCommand) => void; onRename: (row: RowModel, title: string | null) => Promise<void>;
  onRefreshLink: (row: RowModel, url: string) => Promise<void>; onMoveTo: (sourceId: string, targetId: string) => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || loadingMore || !sentinel.current) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onLoadMore(); }, { rootMargin: '120px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);
  return <div role="list" aria-label="Videos" className="video-list" onKeyDown={(event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || (event.target as HTMLElement).matches('input,select,textarea,[role="menuitem"]')) return;
    const rowElements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-row-key]'));
    const active = (event.target as HTMLElement).closest('[data-row-key]');
    const current = rowElements.findIndex((element) => element === active);
    const next = Math.max(0, Math.min(rowElements.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    if (rowElements[next]) { event.preventDefault(); rowElements[next].focus(); }
  }}>
    {rows.map((row) => <VideoRow key={row.id} row={row} apiBase={apiBase} folder={folder} expanded={expandedId === row.id} renaming={renamingId === row.id} busy={busyId === row.id}
      onToggle={() => onToggle(row)} onCommand={(command) => onCommand(row, command)} onRename={(title) => onRename(row, title)} onRefreshLink={(url) => onRefreshLink(row, url)} onMoveTo={onMoveTo} />)}
    {hasMore && <div ref={sentinel} className="load-more"><button className="row-action" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? ui.loading : ui.loadMore}</button></div>}
  </div>;
}
