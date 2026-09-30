import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, LayoutGrid, List, LoaderCircle, MoreHorizontal, Play } from 'lucide-react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FillThumb, type RequestThumbnailPreview } from '@/components/list/FillThumb';
import { QualityLabel } from '@/components/list/QualityLabel';
import type { RowCommand } from '@/components/list/RowDetails';
import { ui } from '@/lib/strings';
import { resolveThumbnailUrl } from '@/lib/utils';
import { endSavedDrag, startSavedDrag } from './savedDrag';
import './SavedShelf.css';

export type SavedView = 'list' | 'shelf';
const VIEW_KEY = 'snagthis.savedView';
const VIEW_EVENT = 'snagthis:saved-view';

function readView(): SavedView {
  try { return localStorage.getItem(VIEW_KEY) === 'shelf' ? 'shelf' : 'list'; } catch { return 'list'; }
}

/** Saved tab layout (unique-look option 7), remembered between launches. */
export function useSavedView(): [SavedView, (view: SavedView) => void] {
  const [view, setView] = useState<SavedView>(readView);
  useEffect(() => {
    const sync = () => setView(readView());
    window.addEventListener(VIEW_EVENT, sync);
    return () => window.removeEventListener(VIEW_EVENT, sync);
  }, []);
  const choose = (next: SavedView) => {
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* A private store keeps the choice for this session only. */ }
    setView(next);
    window.dispatchEvent(new Event(VIEW_EVENT));
  };
  return [view, choose];
}

/** List ⇄ shelf switch; lives beside search, only on the Saved tab. */
export function SavedViewToggle({ view, onView }: { view: SavedView; onView: (view: SavedView) => void }) {
  return <div className="saved-view-toggle" role="group" aria-label={ui.savedView}>
    <button type="button" className={`row-action${view === 'list' ? ' on' : ''}`} aria-pressed={view === 'list'} aria-label={ui.listView} title={ui.listView} onClick={() => onView('list')}><List /></button>
    <button type="button" className={`row-action${view === 'shelf' ? ' on' : ''}`} aria-pressed={view === 'shelf'} aria-label={ui.shelfView} title={ui.shelfView} onClick={() => onView('shelf')}><LayoutGrid /></button>
  </div>;
}

type InputMode = 'pointer' | 'keyboard';
// Tiles are narrow, so "Saved today" becomes "Today" beside the check (the prototype's shelf copy).
const savedWhen = (statusLine: string) => { const when = statusLine.split(' · ')[0].replace(/^Saved\s+/i, ''); return when.charAt(0).toUpperCase() + when.slice(1); };

function ShelfTile({ row, apiBase, busy, inputMode, onCommand, onRequestPreview }: {
  row: RowModel; apiBase: string; busy: boolean; inputMode: InputMode;
  onCommand: (command: RowCommand) => void; onRequestPreview: RequestThumbnailPreview;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [requestedPreview, setRequestedPreview] = useState<{ key: string; url: string } | null>(null);
  const pointerMenu = useRef(false);
  const missing = row.state === 'missing';
  // The hover/focus loop behaves exactly as it does in rows.
  const previewKind = row.isHistory ? 'history' : 'job';
  const previewId = String(row.isHistory ? row.source.id : row.jobId || row.id);
  const previewKey = `${previewKind}:${previewId}`;
  const suppliedPreview = typeof row.source.previewClipUrl === 'string' ? row.source.previewClipUrl : null;
  const previewUrl = suppliedPreview || (requestedPreview?.key === previewKey ? requestedPreview.url : null);
  const previewActive = (inputMode === 'pointer' ? hovered : focused) && !reducedMotion && visible && !missing;
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => setReducedMotion(preference.matches);
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    preference.addEventListener('change', onPreference);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { preference.removeEventListener('change', onPreference); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  useEffect(() => {
    if (!previewActive || previewUrl) return;
    let stopped = false;
    onRequestPreview(previewId, previewKind, row.thumbnailUrl).then((url) => {
      if (!stopped && url) setRequestedPreview({ key: previewKey, url });
    }).catch(() => { /* An unavailable preview keeps the existing poster. */ });
    return () => { stopped = true; };
  }, [previewActive, previewUrl, previewId, previewKind, previewKey, row.thumbnailUrl, onRequestPreview]);
  // A saved video drags onto a folder chip, as rows do in the list.
  const [dragging, setDragging] = useState(false);
  const command = (action: RowCommand) => { setMenuOpen(false); onCommand(action); };
  const primary = () => { if (row.action) command(row.action.id as RowCommand); };
  return <div role="listitem" className="shelf-item">
    <div className={`shelf-tile${dragging ? ' dragging' : ''}`} data-row-key={row.id} data-state={row.state} role="group" tabIndex={0} aria-label={`${row.title}. ${row.statusLine}`}
      draggable={row.state === 'saved'}
      onDragStart={(event) => { if (row.state !== 'saved') return; setDragging(true); startSavedDrag(event, [String(row.source.id)], { title: row.title, thumbnailUrl: resolveThumbnailUrl(row.thumbnailUrl, apiBase) }); }}
      onDragEnd={() => { setDragging(false); endSavedDrag(); }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
      onPointerDownCapture={() => { pointerMenu.current = true; }}
      onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}
      onKeyDown={(event) => {
        pointerMenu.current = false;
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); primary(); }
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); command('remove'); }
      }}>
      {/* Clicking the poster plays it; nothing is ever drawn over the image. */}
      <div className="shelf-poster" onClick={() => { if (!missing) primary(); }}>
        <FillThumb row={row} apiBase={apiBase} previewUrl={previewUrl} previewActive={previewActive} />
      </div>
      <div className="shelf-ledge" aria-hidden="true" />
      <div className="shelf-heading">
        <span className="shelf-title" title={row.title}>{row.title}</span>
        {row.durationLabel && <span className="row-duration">{row.durationLabel}</span>}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild><button className={`row-action hover-action more-action${menuOpen ? ' menu-open' : ''}`} aria-label={`${ui.more}: ${row.title}`} title={ui.more}><MoreHorizontal /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="video-menu"
            onPointerDownCapture={() => { pointerMenu.current = true; }}
            onKeyDownCapture={() => { pointerMenu.current = false; }}
            onCloseAutoFocus={(event) => { if (pointerMenu.current) event.preventDefault(); }}>
            <DropdownMenuItem onSelect={() => command('details')}>{ui.details}</DropdownMenuItem>
            {(row.source.url || row.source.sourcePageUrl) && <><DropdownMenuItem onSelect={() => command('copy-link')}>{ui.copyLink}</DropdownMenuItem><DropdownMenuItem onSelect={() => command('open-page')}>{ui.openPage}</DropdownMenuItem></>}
            {!missing && <DropdownMenuItem onSelect={() => command('show-folder')}>{ui.showFolder}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="destructive-text" onSelect={() => command('remove')}>{ui.remove}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {row.action?.style === 'icon' && <button className="row-action hover-action play-action" disabled={busy} aria-label={`${row.action.label || ui.play}: ${row.title}`} title={row.action.label || ui.play} onClick={() => command(row.action!.id as RowCommand)}>
          {busy ? <LoaderCircle className="spin" /> : <Play />}
        </button>}
      </div>
      <div className={`row-status shelf-status tone-${row.tone}${row.state === 'saved' ? ' saved-meta' : ''}`} title={row.statusLine}>{row.state === 'saved' ? <>
        {row.qualityLabel && <><QualityLabel label={row.qualityLabel} /><span className="meta-dot" aria-hidden="true">·</span></>}
        {row.sizeLabel && <><span className="file-size">{row.sizeLabel}</span><span className="meta-dot" aria-hidden="true">·</span></>}
        <span className="saved-badge"><Check aria-hidden="true" />{savedWhen(row.statusLine)}</span>
      </> : <span className="shelf-problem">{row.statusLine}</span>}
        {row.action && row.action.style !== 'icon' && <button className="row-action labelled" disabled={busy} aria-label={`${row.action.label}: ${row.title}`} onClick={() => command(row.action!.id as RowCommand)}>{busy ? <LoaderCircle className="spin" /> : row.action.label}</button>}
      </div>
    </div>
  </div>;
}

/** Arrow keys move through a grid of `selector` items by column and row; Home/End jump to the ends. */
export function moveGridFocus(event: KeyboardEvent<HTMLElement>, selector: string) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  const target = event.target as HTMLElement;
  if (!keys.includes(event.key) || !target.matches(selector)) return;
  const tiles = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector));
  const index = tiles.indexOf(target);
  if (index < 0) return;
  const firstTop = tiles[0].offsetTop;
  const secondRow = tiles.findIndex((tile) => tile.offsetTop !== firstTop);
  const columns = secondRow === -1 ? tiles.length : secondRow;
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, Home: -Infinity, End: Infinity };
  const step = steps[event.key];
  const next = Math.max(0, Math.min(tiles.length - 1, index + step));
  // Down from a short last row lands on the final tile rather than doing nothing.
  event.preventDefault();
  tiles[next]?.focus();
  tiles[next]?.scrollIntoView({ block: 'nearest' });
}

export function SavedShelf({ rows, apiBase, busyIds, hasMore, loadingMore, onLoadMore, onCommand, onRequestPreview }: {
  rows: RowModel[]; apiBase: string; busyIds: ReadonlySet<string>; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void;
  onCommand: (row: RowModel, command: RowCommand) => void; onRequestPreview: RequestThumbnailPreview;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [inputMode, setInputMode] = useState<InputMode>('keyboard');
  useEffect(() => {
    const pointerInput = () => setInputMode('pointer');
    const keyboardInput = (event: globalThis.KeyboardEvent) => { if (!['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) setInputMode('keyboard'); };
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
  return <div className="shelf-view">
    <div className="shelf-grid" role="list" aria-label={ui.savedShelf} data-input-mode={inputMode} onKeyDown={(event) => moveGridFocus(event, '.shelf-tile')}>
      {rows.map((row) => <ShelfTile key={row.id} row={row} apiBase={apiBase} busy={busyIds.has(row.id)} inputMode={inputMode}
        onCommand={(action) => onCommand(row, action)} onRequestPreview={onRequestPreview} />)}
    </div>
    {hasMore && <div ref={sentinel} className="load-more"><button className="row-action" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? ui.loading : ui.loadMore}</button></div>}
  </div>;
}
