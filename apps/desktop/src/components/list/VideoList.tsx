import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type MutableRefObject, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { libraryText } from '@m3u8/contracts/src/library.mjs';
import { VideoRow, type SelectMode } from './VideoRow';
import type { RowCommand } from './RowDetails';
import { ui } from '@/lib/strings';
import type { RequestThumbnailPreview } from './FillThumb';
import type { SavedDetailsContext } from './SavedDetails';

interface RowHandlers {
  onToggle: (row: RowModel) => void;
  onCommand: (row: RowModel, command: RowCommand) => void;
  onRename: (row: RowModel, title: string | null) => Promise<void>;
  onRefreshLink: (row: RowModel, url: string) => Promise<void>;
  onMoveTo: (sourceId: string, targetId: string) => void;
  onSelect: (row: RowModel, mode: SelectMode, from?: RowModel) => void;
  dragIds: (row: RowModel) => string[];
}
type StableRowProps = Omit<ComponentProps<typeof VideoRow>, keyof RowHandlers> & { handlers: MutableRefObject<RowHandlers> };

const StableVideoRow = memo(function StableVideoRow({ row, handlers, ...props }: StableRowProps) {
  return <VideoRow {...props} row={row}
    onToggle={() => handlers.current.onToggle(row)} onCommand={(command) => handlers.current.onCommand(row, command)}
    onRename={(title) => handlers.current.onRename(row, title)} onRefreshLink={(url) => handlers.current.onRefreshLink(row, url)}
    onMoveTo={(sourceId, targetId) => handlers.current.onMoveTo(sourceId, targetId)}
    onSelect={(mode) => handlers.current.onSelect(row, mode)} dragIds={() => handlers.current.dragIds(row)} />;
}, (previous, next) => {
  // Queue ticks rebuild row models, but the immutable saved history stays the
  // same. Check its date-dependent text too, so "Saved today" can still change.
  const sameHistory = previous.row.isHistory && next.row.isHistory
    && previous.row.source === next.row.source && previous.row.statusLine === next.row.statusLine;
  if (previous.row !== next.row && !sameHistory) return false;
  return (Object.keys(next) as (keyof StableRowProps)[]).every((key) => key === 'row' || previous[key] === next[key]);
});

const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
// Filters, searches and paging change many rows at once; those swap instantly.
const MAX_ANIMATED_CHANGES = 3;
type Leaving = { row: RowModel; after: string | null };

function withLeaving(rows: RowModel[], leaving: Leaving[]) {
  const present = new Set(rows.map((row) => row.id));
  const result = [...rows];
  for (const { row, after } of leaving) {
    if (present.has(row.id)) continue;
    result.splice(after === null ? 0 : result.findIndex((item) => item.id === after) + 1 || result.length, 0, row);
  }
  return result;
}

/** A group of saved videos under a collapsible header (Sort & group ▸ Group by). No label: no header. */
export interface ListSection { key: string; label: string; meta: string; collapsed: boolean; rows: RowModel[] }
const noSelection: ReadonlySet<string> = new Set();
const noSelect = () => {};
const ownId = (row: RowModel) => [String(row.source.id)];

export function VideoList({ rows, apiBase, folder, expandedId, renamingId, busyIds, hasMore, loadingMore, onLoadMore, onToggle, onCommand, onRename, onRefreshLink, onMoveTo, onRequestPreview, motionScope = '',
  prefix, sections, onToggleSection, selectedIds = noSelection, onSelect = noSelect, dragIds = ownId, showLocation = false, savedContext }: {
  /** Saved's folders and the file probe, for saved videos' details. */
  savedContext?: SavedDetailsContext;
  motionScope?: string;
  /** Rows before the videos: the folders of the folder being shown. */
  prefix?: ReactNode;
  /** Grouped videos; `rows` then lists the visible ones in order. */
  sections?: ListSection[]; onToggleSection?: (key: string) => void;
  selectedIds?: ReadonlySet<string>; onSelect?: (row: RowModel, mode: SelectMode, from?: RowModel) => void; dragIds?: (row: RowModel) => string[];
  /** Name each saved video's folder in its status line (All, search results). */
  showLocation?: boolean;
  rows: RowModel[]; apiBase: string; folder: string; expandedId: string | null; renamingId: string | null; busyIds: ReadonlySet<string>;
  hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; onToggle: (row: RowModel) => void;
  onCommand: (row: RowModel, command: RowCommand) => void; onRename: (row: RowModel, title: string | null) => Promise<void>;
  onRefreshLink: (row: RowModel, url: string) => Promise<void>; onMoveTo: (sourceId: string, targetId: string) => void;
  onRequestPreview: RequestThumbnailPreview;
}) {
  const grouped = !!sections;
  const sentinel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const animatedLeaving = useRef(new Set<string>());
  const order = rows.map((row) => row.id).join('\n');
  const motion = useRef<{ order: string | null; scope: string; rows: RowModel[]; tops: Map<string, number> | null }>({ order: null, scope: motionScope, rows, tops: null });
  // Row motion needs the old positions, which only exist before React commits a new order.
  if (motion.current.order !== null && motion.current.order !== order && !motion.current.tops && list.current) {
    motion.current.tops = new Map(Array.from(list.current.querySelectorAll<HTMLElement>(':scope > [data-item-key]'), (element) => [element.dataset.itemKey!, element.getBoundingClientRect().top]));
  }
  useLayoutEffect(() => {
    const state = motion.current;
    if (state.order === order) { state.rows = rows; state.scope = motionScope; return; }
    const { rows: previousRows, tops, order: previousOrder, scope } = state;
    Object.assign(state, { order, rows, tops: null, scope: motionScope });
    const container = list.current;
    // A row that returns while collapsing (Undo) takes its element back at full size.
    for (const element of container?.querySelectorAll<HTMLElement>(':scope > .leaving') ?? []) {
      if (!order.split('\n').includes(element.dataset.itemKey!)) continue;
      element.classList.remove('leaving');
      element.removeAttribute('aria-hidden');
      element.getAnimations().forEach((animation) => animation.cancel());
    }
    if (previousOrder === null || !tops || !container || scope !== motionScope || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const current = new Set(rows.map((row) => row.id));
    const previous = new Set(previousRows.map((row) => row.id));
    const entered = rows.filter((row) => !previous.has(row.id));
    const left = previousRows.flatMap((row, index) => current.has(row.id) ? [] : [{ row, after: index ? previousRows[index - 1].id : null }]);
    if (entered.length + left.length > MAX_ANIMATED_CHANGES) return;
    const item = (id: string) => container.querySelector<HTMLElement>(`:scope > [data-item-key="${CSS.escape(id)}"]`);
    if (entered.length || left.length) {
      // New rows open from nothing and slide down; removed rows stay long enough to collapse. Neighbours follow the height.
      for (const row of entered) {
        const element = item(row.id);
        if (!element) continue;
        element.animate([
          { height: '0px', opacity: 0, transform: 'translateY(-6px)', overflow: 'hidden' },
          { height: `${element.offsetHeight}px`, opacity: 1, transform: 'none', overflow: 'hidden' },
        ], { duration: 220, easing: EASE_OUT });
      }
      // Grouped lists re-place rows under headers, so removed rows leave at once.
      if (left.length && !grouped) setLeaving((items) => [...items.filter((entry) => !current.has(entry.row.id)), ...left]);
      return;
    }
    // Reorders and completions: each row glides from where it was (FLIP).
    for (const element of container.querySelectorAll<HTMLElement>(':scope > [data-item-key]')) {
      const before = tops.get(element.dataset.itemKey!);
      const offset = before === undefined ? 0 : before - element.getBoundingClientRect().top;
      if (Math.abs(offset) > .5) element.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], { duration: 280, easing: EASE_OUT });
    }
  }, [order, motionScope, rows, grouped]);
  useLayoutEffect(() => {
    const container = list.current;
    if (!container) return;
    for (const { row } of leaving) {
      if (animatedLeaving.current.has(row.id)) continue;
      const element = container.querySelector<HTMLElement>(`:scope > [data-item-key="${CSS.escape(row.id)}"]`);
      if (!element) continue;
      animatedLeaving.current.add(row.id);
      element.classList.add('leaving');
      element.setAttribute('aria-hidden', 'true');
      const animation = element.animate([
        { height: `${element.offsetHeight}px`, opacity: 1, overflow: 'hidden' },
        { height: '0px', opacity: 0, overflow: 'hidden', borderTopWidth: '0px' },
      ], { duration: 180, easing: 'ease-in', fill: 'forwards' });
      const done = () => { animatedLeaving.current.delete(row.id); setLeaving((items) => items.filter((entry) => entry.row !== row)); };
      animation.finished.then(done, done);
    }
  }, [leaving]);
  const shown = leaving.length && !grouped ? withLeaving(rows, leaving) : rows;
  const handlers = useRef<RowHandlers>({ onToggle, onCommand, onRename, onRefreshLink, onMoveTo, onSelect, dragIds });
  // Events from a memoized row must use the latest committed App callbacks.
  useLayoutEffect(() => { handlers.current = { onToggle, onCommand, onRename, onRefreshLink, onMoveTo, onSelect, dragIds }; });
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
  return <div ref={list} role="list" aria-label="Videos" className="video-list" data-input-mode={inputMode} onKeyDown={(event) => {
    // ⌘↑ / Alt+↑ is the app's "up one folder".
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.metaKey || event.altKey || (event.target as HTMLElement).matches('input,select,textarea,[role="menuitem"]')) return;
    const rowElements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-row-key]'));
    const active = (event.target as HTMLElement).closest('[data-row-key]');
    const current = rowElements.findIndex((element) => element === active);
    const next = Math.max(0, Math.min(rowElements.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    if (rowElements[next]) {
      event.preventDefault(); rowElements[next].focus();
      // Shift+↑/↓ extends the selection over saved videos.
      if (event.shiftKey) {
        const byKey = (element: Element | null | undefined) => shown.find((row) => row.id === (element as HTMLElement | null)?.dataset.rowKey);
        const target = byKey(rowElements[next]);
        if (target?.state === 'saved') onSelect(target, 'range', byKey(rowElements[current]));
      }
    }
  }}>
    {prefix}
    {(() => {
      const render = (row: RowModel) => <StableVideoRow key={row.id} row={row} inputMode={inputMode} apiBase={apiBase} folder={folder} expanded={expandedId === row.id} renaming={renamingId === row.id} busy={busyIds.has(row.id)}
        selected={selectedIds.has(row.id)} location={showLocation && row.isHistory ? String(row.source.folder || '') : ''}
        handlers={handlers} onRequestPreview={onRequestPreview} savedContext={savedContext} />;
      if (!sections) return shown.map(render);
      return sections.map((section) => <Fragment key={`section:${section.key}`}>
        {section.label && <div role="listitem" className="group-item" data-item-key={`group:${section.key}`}>
          <button type="button" className="group-header" data-row-key={`group:${section.key}`} aria-expanded={!section.collapsed}
            aria-label={libraryText(section.collapsed ? 'expandGroup' : 'collapseGroup', { label: `${section.label}, ${section.meta}` })}
            onClick={() => onToggleSection?.(section.key)}><ChevronDown className="chev" aria-hidden="true" /><b>{section.label}</b><span className="group-meta">{section.meta}</span></button>
        </div>}
        {!section.collapsed && section.rows.map(render)}
      </Fragment>);
    })()}
    {hasMore && <div ref={sentinel} className="load-more"><button className="row-action" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? ui.loading : ui.loadMore}</button></div>}
  </div>;
}
