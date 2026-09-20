import { useEffect, useRef, useState } from 'react';
import { Check, Folder, FolderOpen, MoreHorizontal, Pause, Play, LoaderCircle } from 'lucide-react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FillThumb, type RequestThumbnailPreview } from './FillThumb';
import { RowDetails, type RowCommand } from './RowDetails';
import { QualityLabel } from './QualityLabel';
import { ui } from '@/lib/strings';

export function VideoRow({ row, inputMode, apiBase, folder, expanded, renaming, busy, onToggle, onCommand, onRename, onRefreshLink, onMoveTo, onRequestPreview }: {
  row: RowModel; inputMode: 'pointer' | 'keyboard'; apiBase: string; folder: string; expanded: boolean; renaming: boolean; busy: boolean;
  onToggle: () => void; onCommand: (command: RowCommand) => void;
  onRename: (title: string | null) => Promise<void>; onRefreshLink: (url: string) => Promise<void>;
  onMoveTo: (sourceId: string, targetId: string) => void;
  onRequestPreview: RequestThumbnailPreview;
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
  const pointerMenu = useRef(false);
  const saved = row.state === 'saved' || row.state === 'missing';
  const progress = Math.max(0, Math.min(100, Number(row.progress) || 0));
  const activeProgress = row.state === 'downloading' || row.state === 'finishing';
  const showProgress = activeProgress || (['paused', 'problem'].includes(row.state) && progress > 0);
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
    const before = previousCells.current;
    previousCells.current = completedCells;
    if (before === null || !activeProgress || completedCells - before > 3) return;
    for (const cell of Array.from(pieces.current?.children ?? []).slice(before, completedCells)) {
      cell.classList.add('spark');
      cell.addEventListener('animationend', () => cell.classList.remove('spark'), { once: true });
    }
  }, [completedCells, activeProgress]);
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
  return (
    <div role="listitem" className={`video-item${expanded ? ' expanded' : ''}`}>
      <div className="video-row" data-row-key={row.id} data-state={row.state} role="group" tabIndex={0}
        data-progress={progress} data-progress-active={progressMotion}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
        aria-label={`${row.title}. ${row.statusLine}`} aria-controls={expanded ? `details-${row.id}` : undefined}
        onClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,a,[role="menuitem"]')) onToggle(); }}
        onPointerDownCapture={() => { pointerMenu.current = true; }}
        onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}
        onKeyDown={(event) => {
          pointerMenu.current = false;
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); }
          if (event.key.toLowerCase() === 'p' && (row.state === 'downloading' || row.state === 'paused')) { event.preventDefault(); command(row.state === 'paused' ? 'resume' : 'pause'); }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); command(saved ? 'remove' : 'cancel'); }
        }}
        draggable={row.state === 'waiting' && !renaming}
        onDragStart={(event) => { event.dataTransfer.setData('application/x-vidsnag-job', row.id); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(event) => { if (row.state === 'waiting') { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('application/x-vidsnag-job'); if (sourceId && sourceId !== row.id) onMoveTo(sourceId, row.id); }}>
        {showProgress && <div className="progress-pieces" ref={pieces} aria-hidden="true">
          {/* These cells represent aggregate progress; source segments remain in Details. */}
          {Array.from({ length: 40 }, (_, index) => <span key={index} className={`progress-piece${index < completedCells ? ' done' : index === completedCells && progress < 100 ? ' current' : ''}`} style={index === completedCells ? { '--piece-fill': progress / 100 * 40 - completedCells } as React.CSSProperties : undefined} />)}
        </div>}
        <FillThumb row={row} apiBase={apiBase} previewUrl={previewUrl} previewActive={previewActive} />
        <div className="row-text">
          {renaming ? <form onSubmit={(event) => { event.preventDefault(); onRename(title); }}><input className="inline-rename" ref={input} value={title} aria-label={ui.rename} disabled={busy} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onRename(null); } }} onBlur={() => { if (!busy) onRename(title); }} /></form> : <div className="row-heading"><div className="row-title" title={row.title}>{row.title}</div>{row.durationLabel && <span className="row-duration">{row.durationLabel}</span>}</div>}
          <div className={`row-status tone-${row.tone}${row.state === 'saved' ? ' saved-meta' : ''}`} title={row.statusLine}
            role={['downloading', 'finishing', 'paused'].includes(row.state) ? 'progressbar' : undefined}
            aria-label={['downloading', 'finishing', 'paused'].includes(row.state) ? `${row.title} download` : undefined}
            aria-valuemin={['downloading', 'finishing', 'paused'].includes(row.state) ? 0 : undefined} aria-valuemax={['downloading', 'finishing', 'paused'].includes(row.state) ? 100 : undefined} aria-valuenow={['downloading', 'finishing', 'paused'].includes(row.state) ? row.percent : undefined}
            aria-valuetext={['downloading', 'finishing', 'paused'].includes(row.state) ? row.statusLine : undefined}>{row.state === 'saved' ? <>
              {row.qualityLabel && <><QualityLabel label={row.qualityLabel} /><span className="meta-dot" aria-hidden="true">·</span></>}
              {row.sizeLabel && <><span className="file-size">{row.sizeLabel}</span><span className="meta-dot" aria-hidden="true">·</span></>}
              <span className="saved-badge"><Check aria-hidden="true" />{row.statusLine.split(' · ')[0]}</span>
            </> : row.statusLine}</div>
        </div>
        <div className="row-actions">
          {row.state === 'saved' && <button className="row-action hover-action folder-action" aria-label={`${ui.showFolder}: ${row.title}`} title={ui.showFolder} onClick={() => command('show-folder')}><Folder className="icon-rest" /><FolderOpen className="icon-hover" /></button>}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild><button className={`row-action hover-action more-action${menuOpen ? ' menu-open' : ''}`} aria-label={`${ui.more}: ${row.title}`} title={ui.more}><MoreHorizontal /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="video-menu"
              onPointerDownCapture={() => { pointerMenu.current = true; }}
              onKeyDownCapture={() => { pointerMenu.current = false; }}
              onCloseAutoFocus={(event) => { if (pointerMenu.current) event.preventDefault(); }}>
              <DropdownMenuItem onSelect={() => command('details')}>{ui.details}</DropdownMenuItem>
              {['waiting', 'paused'].includes(row.state) && <DropdownMenuItem onSelect={() => command('rename')}>{ui.rename}</DropdownMenuItem>}
              {row.state === 'waiting' && <><DropdownMenuItem onSelect={() => command('start')}>{ui.startNow}</DropdownMenuItem><DropdownMenuItem onSelect={() => command('move-up')}>{ui.moveUp}</DropdownMenuItem><DropdownMenuItem onSelect={() => command('move-down')}>{ui.moveDown}</DropdownMenuItem></>}
              {(row.source.url || row.source.sourcePageUrl) && <><DropdownMenuItem onSelect={() => command('copy-link')}>{ui.copyLink}</DropdownMenuItem><DropdownMenuItem onSelect={() => command('open-page')}>{ui.openPage}</DropdownMenuItem></>}
              {saved && row.state !== 'missing' && <DropdownMenuItem onSelect={() => command('show-folder')}>{ui.showFolder}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="destructive-text" onSelect={() => command(saved ? 'remove' : 'cancel')}>{saved ? ui.remove : row.state === 'problem' ? ui.removeList : ui.cancelDownload}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {row.action && <button className={`row-action ${row.action.style === 'icon' ? `${row.action.id}-action` : row.action.style === 'primary' ? 'primary-action' : 'labelled'}`} disabled={busy} aria-label={`${row.action.label}: ${row.title}`} title={row.action.label} onClick={() => command(row.action!.id as RowCommand)}>
            {busy ? <LoaderCircle className="spin" /> : row.action.style === 'icon' ? row.action.id === 'pause' ? <Pause /> : <Play /> : row.action.label}
          </button>}
        </div>
      </div>
      {detailsMounted && <div className={`details-drawer${detailsOpen ? ' open' : ''}`}><div className="details-drawer-clip"><RowDetails row={row} folder={folder} onCommand={command} onRefreshLink={onRefreshLink} /></div></div>}
    </div>
  );
}
