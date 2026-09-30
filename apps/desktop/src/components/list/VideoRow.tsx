import { useEffect, useRef, useState } from 'react';
import { Check, Folder, FolderOpen, GripVertical, MoreHorizontal, Pause, Play, LoaderCircle, CirclePlay } from 'lucide-react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FillThumb, type RequestThumbnailPreview } from './FillThumb';
import { RowDetails, type RowCommand } from './RowDetails';
import { QualityLabel } from './QualityLabel';
import { SpeedTrace, type SpeedTraceState } from './SpeedTrace';
import { ui } from '@/lib/strings';
import { libraryStrings } from '@m3u8/contracts/src/library.mjs';
import { startSavedDrag, endSavedDrag } from '@/components/library/savedDrag';
import { resolveThumbnailUrl } from '@/lib/utils';

export type SelectMode = 'toggle' | 'range';

// The row being dragged, so drop targets can show where it will land (dataTransfer is unreadable during dragover).
let draggingRowId: string | null = null;

export function VideoRow({ row, inputMode, apiBase, folder, expanded, renaming, busy, selected = false, location = '', onToggle, onCommand, onRename, onRefreshLink, onMoveTo, onRequestPreview, onSelect, dragIds }: {
  row: RowModel; inputMode: 'pointer' | 'keyboard'; apiBase: string; folder: string; expanded: boolean; renaming: boolean; busy: boolean;
  /** Part of a multi-selection (⌘/Ctrl-click, Shift-click). */
  selected?: boolean;
  /** The folder of Saved it is in, shown in All and in search results. */
  location?: string;
  onToggle: () => void; onCommand: (command: RowCommand) => void;
  onRename: (title: string | null) => Promise<void>; onRefreshLink: (url: string) => Promise<void>;
  onMoveTo: (sourceId: string, targetId: string) => void;
  onRequestPreview: RequestThumbnailPreview;
  onSelect?: (mode: SelectMode) => void;
  /** The saved videos a drag from this row carries (the selection, when this row is in it). */
  dragIds?: () => string[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [requestedPreview, setRequestedPreview] = useState<{ key: string; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pieces = useRef<HTMLDivElement>(null);
  // Drawer motion: details stay mounted while they slide shut, then unmount.
  const [detailsMounted, setDetailsMounted] = useState(expanded);
  const [detailsOpen, setDetailsOpen] = useState(expanded);
  const previousCells = useRef<number | null>(null);
  const lastSpark = useRef(0);
  const previousState = useRef(row.state);
  const [justSaved, setJustSaved] = useState(false);
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const [dragging, setDragging] = useState(false);
  const pointerMenu = useRef(false);
  const saved = row.state === 'saved' || row.state === 'missing';
  // A saved video that couldn't move keeps its file where it was; its row says so instead of the saved facts.
  const moveFailed = row.state === 'saved' && row.tone === 'attention';

  // Collapsed-row speed trace: live while downloading, frozen when paused or finishing, mint as it saves.
  const traceState: SpeedTraceState | null = ['downloading', 'paused', 'finishing'].includes(row.state) ? row.state as SpeedTraceState : row.state === 'saved' && justSaved ? 'saved' : null;
  const progress = Math.max(0, Math.min(100, Number(row.progress) || 0));
  const activeProgress = row.state === 'downloading' || row.state === 'finishing';
  const showProgress = activeProgress || (['paused', 'problem'].includes(row.state) && progress > 0) || justSaved;
  const progressMotion = visible && activeProgress;
  const completedCells = Math.floor(progress / 100 * 40);
  const previewKind = row.isHistory ? 'history' : 'job';
  const previewId = String(row.isHistory ? row.source.id : row.jobId || row.id);
  const previewKey = `${previewKind}:${previewId}`;
  const suppliedPreview = typeof row.source.previewClipUrl === 'string' ? row.source.previewClipUrl : null;
  const previewUrl = suppliedPreview || (requestedPreview?.key === previewKey ? requestedPreview.url : null);
  const previewActive = (inputMode === 'pointer' ? hovered : focused) && !reducedMotion && visible && row.state !== 'missing';
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
  useEffect(() => {
    // Spark only cells finished while this row was on screen; mounting never replays the whole lane.
    // At most one spark every 250ms, on the newest finished cell.
    const before = previousCells.current;
    previousCells.current = completedCells;
    if (before === null || !activeProgress || completedCells <= before || completedCells - before > 3) return;
    const now = performance.now();
    if (now - lastSpark.current < 250) return;
    lastSpark.current = now;
    const cell = pieces.current?.children[completedCells - 1];
    if (!cell) return;
    cell.classList.add('spark');
    cell.addEventListener('animationend', () => cell.classList.remove('spark'), { once: true });
  }, [completedCells, activeProgress]);
  useEffect(() => {
    // Completion moment: only a download finishing in view, never a saved row appearing.
    const before = previousState.current;
    previousState.current = row.state;
    if (row.state === 'saved' && (before === 'downloading' || before === 'finishing') && !reducedMotion) setJustSaved(true);
  }, [row.state, reducedMotion]);
  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 900);
    return () => clearTimeout(timer);
  }, [justSaved]);
  useEffect(() => {
    if (!expanded && !detailsMounted) return;
    if (expanded) {
      if (!detailsMounted) setDetailsMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setDetailsOpen(true)));
      return () => cancelAnimationFrame(frame);
    }
    setDetailsOpen(false);
    const timer = setTimeout(() => setDetailsMounted(false), reducedMotion ? 0 : 360);
    return () => clearTimeout(timer);
  }, [expanded, reducedMotion, detailsMounted]);
  useEffect(() => { if (renaming) { setTitle(row.title); input.current?.focus(); input.current?.select(); } }, [renaming, row.title]);
  const command = (action: RowCommand) => { setMenuOpen(false); onCommand(action); };
  // Resume keeps its own glyph and name so it never reads as Play on a saved file.
  const actionLabel = row.action?.id === 'resume' ? ui.resumeDownload : row.action?.label;
  return (
    <div role="listitem" data-item-key={row.id} className={`video-item${expanded ? ' expanded' : ''}${drop ? ` drop-${drop}` : ''}${dragging ? ' dragging' : ''}${selected ? ' selected' : ''}`}>
      <div className={`video-row${justSaved ? ' just-saved' : ''}`} data-row-key={row.id} data-state={row.state} data-selected={selected || undefined} role="group" tabIndex={0}
        data-progress={progress} data-progress-active={progressMotion}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
        aria-label={`${row.title}. ${row.statusLine}${selected ? `. ${libraryStrings.selected}` : ''}`} aria-controls={expanded ? `details-${row.id}` : undefined}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button,input,a,[role="menuitem"]')) return;
          if (onSelect && row.state === 'saved' && (event.metaKey || event.ctrlKey || event.shiftKey)) { event.preventDefault(); onSelect(event.shiftKey ? 'range' : 'toggle'); return; }
          onToggle();
        }}
        onMouseDown={(event) => { if (event.shiftKey && row.state === 'saved') event.preventDefault(); }}
        onPointerDownCapture={() => { pointerMenu.current = true; }}
        onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}
        onKeyDown={(event) => {
          pointerMenu.current = false;
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); }
          if (event.key.toLowerCase() === 'p' && (row.state === 'downloading' || row.state === 'paused')) { event.preventDefault(); command(row.state === 'paused' ? 'resume' : 'pause'); }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); command(saved ? 'remove' : 'cancel'); }
          if (event.key.toLowerCase() === 'm' && !event.metaKey && !event.ctrlKey && !event.altKey && row.state === 'saved') { event.preventDefault(); command('move-to'); }
        }}
        draggable={(row.state === 'waiting' || row.state === 'saved') && !renaming}
        onDragStart={(event) => {
          if (row.state === 'saved') { setDragging(true); startSavedDrag(event, dragIds ? dragIds() : [String(row.source.id)], { title: row.title, thumbnailUrl: resolveThumbnailUrl(row.thumbnailUrl, apiBase) }); return; }
          draggingRowId = row.id; setDragging(true); event.dataTransfer.setData('application/x-snagthis-job', row.id); event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => { draggingRowId = null; setDragging(false); endSavedDrag(); }}
        onDragOver={(event) => {
          if (row.state !== 'waiting' || !event.dataTransfer.types.includes('application/x-snagthis-job')) return;
          event.preventDefault(); event.dataTransfer.dropEffect = 'move';
          if (!draggingRowId || draggingRowId === row.id) return;
          // The job takes this row's queue position, so the line shows on the side it will land.
          const source = document.querySelector(`[data-row-key="${CSS.escape(draggingRowId)}"]`);
          setDrop(source && source.compareDocumentPosition(event.currentTarget) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before');
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
        onDrop={(event) => { event.preventDefault(); setDrop(null); const sourceId = event.dataTransfer.getData('application/x-snagthis-job'); if (sourceId && sourceId !== row.id) onMoveTo(sourceId, row.id); }}>
        {showProgress && <div className="progress-pieces" ref={pieces} aria-hidden="true">
          {/* These cells represent aggregate progress; source segments remain in Details. */}
          {Array.from({ length: 40 }, (_, index) => <span key={index} className={`progress-piece${index < completedCells ? ' done' : index === completedCells && progress < 100 ? ' current' : ''}`} style={index === completedCells ? { '--piece-fill': progress / 100 * 40 - completedCells } as React.CSSProperties : undefined} />)}
        </div>}
        <FillThumb row={row} apiBase={apiBase} previewUrl={previewUrl} previewActive={previewActive} />
        <div className={`row-text${traceState && !renaming ? ' has-trace' : ''}`}>
          {renaming ? <form onSubmit={(event) => { event.preventDefault(); onRename(title); }}><input className="inline-rename" ref={input} value={title} aria-label={ui.rename} disabled={busy} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onRename(null); } }} onBlur={() => { if (!busy) onRename(title); }} /></form> : <div className="row-heading"><div className="row-title" title={row.title}>{row.title}</div>{row.durationLabel && <span className="row-duration">{row.durationLabel}</span>}</div>}
          <div className={`row-status tone-${row.tone}${row.state === 'saved' && !moveFailed ? ' saved-meta' : ''}`} title={row.statusLine}
            role={['downloading', 'finishing', 'paused'].includes(row.state) ? 'progressbar' : undefined}
            aria-label={['downloading', 'finishing', 'paused'].includes(row.state) ? `${row.title} download` : undefined}
            aria-valuemin={['downloading', 'finishing', 'paused'].includes(row.state) ? 0 : undefined} aria-valuemax={['downloading', 'finishing', 'paused'].includes(row.state) ? 100 : undefined} aria-valuenow={['downloading', 'finishing', 'paused'].includes(row.state) ? row.percent : undefined}
            aria-valuetext={['downloading', 'finishing', 'paused'].includes(row.state) ? row.statusLine : undefined}>{row.state === 'saved' && !moveFailed ? <>
              {row.qualityLabel && <><QualityLabel label={row.qualityLabel} /><span className="meta-dot" aria-hidden="true">·</span></>}
              {row.sizeLabel && <><span className="file-size">{row.sizeLabel}</span><span className="meta-dot" aria-hidden="true">·</span></>}
              <span className="saved-badge"><Check aria-hidden="true" />{row.statusLine.split(' · ')[0]}</span>
              {location && <><span className="meta-dot" aria-hidden="true">·</span><span className="row-location" title={location}><Folder aria-hidden="true" />{location.split('/').pop()}</span></>}
            </> : row.statusLine}</div>
          {traceState && <SpeedTrace jobId={String(row.jobId || row.id)} state={traceState} speedBps={row.source.speedBps} hidden={expanded || renaming} />}
        </div>
        <div className="row-actions">
          {row.state === 'waiting' && !renaming && <span className="drag-grip hover-action" aria-hidden="true" title={ui.dragToReorder}><GripVertical /></span>}
          {row.state === 'saved' && <button className="row-action hover-action folder-action" aria-label={`${ui.showFolder}: ${row.title}`} title={ui.showFolder} onClick={() => command('show-folder')}><Folder className="icon-rest" /><FolderOpen className="icon-hover" /></button>}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild><button className={`row-action hover-action more-action${menuOpen ? ' menu-open' : ''}`} aria-label={`${ui.more}: ${row.title}`} title={ui.more}><MoreHorizontal /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="video-menu"
              onPointerDownCapture={() => { pointerMenu.current = true; }}
              onKeyDownCapture={() => { pointerMenu.current = false; }}
              onCloseAutoFocus={(event) => { if (pointerMenu.current) event.preventDefault(); }}>
              <DropdownMenuItem onSelect={() => command('details')}>{ui.details}</DropdownMenuItem>
              {row.state === 'saved' && <DropdownMenuItem onSelect={() => command('move-to')}>{libraryStrings.moveTo}<span className="menu-hint" aria-hidden="true">M</span></DropdownMenuItem>}
              {['waiting', 'paused'].includes(row.state) && <DropdownMenuItem onSelect={() => command('rename')}>{ui.rename}</DropdownMenuItem>}
              {row.state === 'waiting' && <><DropdownMenuItem onSelect={() => command('start')}>{ui.startNow}</DropdownMenuItem><DropdownMenuItem onSelect={() => command('move-up')}>{ui.moveUp}</DropdownMenuItem><DropdownMenuItem onSelect={() => command('move-down')}>{ui.moveDown}</DropdownMenuItem></>}
              {(row.source.url || row.source.sourcePageUrl) && <><DropdownMenuItem onSelect={() => command('copy-link')}>{ui.copyLink}</DropdownMenuItem><DropdownMenuItem onSelect={() => command('open-page')}>{ui.openPage}</DropdownMenuItem></>}
              {saved && row.state !== 'missing' && <DropdownMenuItem onSelect={() => command('show-folder')}>{ui.showFolder}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="destructive-text" onSelect={() => command(saved ? 'remove' : 'cancel')}>{saved ? ui.remove : row.state === 'problem' ? ui.removeList : ui.cancelDownload}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {traceState && !row.action && <span className="row-action-spacer" aria-hidden="true" />}
          {row.action && <button className={`row-action ${row.action.style === 'icon' ? `${row.action.id}-action` : row.action.style === 'primary' ? 'primary-action' : 'labelled'}`} disabled={busy} aria-label={`${actionLabel}: ${row.title}`} title={actionLabel} onClick={() => command(row.action!.id as RowCommand)}>
            {busy ? <LoaderCircle className="spin" /> : row.action.style === 'icon' ? row.action.id === 'pause' ? <Pause /> : row.action.id === 'resume' ? <CirclePlay /> : <Play /> : row.action.label}
          </button>}
        </div>
      </div>
      {detailsMounted && <div className={`details-drawer${detailsOpen ? ' open' : ''}`}><div className="details-drawer-clip"><RowDetails row={row} folder={folder} onCommand={command} onRefreshLink={onRefreshLink} /></div></div>}
    </div>
  );
}
