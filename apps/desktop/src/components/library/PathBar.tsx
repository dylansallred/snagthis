import { Fragment, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowUpDown, ChevronDown, Copy, ExternalLink, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { GROUPS, SORTS, libraryStrings as copy, libraryText, viewLabel, type LibraryView } from '@m3u8/contracts/src/library.mjs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { revealLabel } from '@/lib/libraryBackend';
import { PixelFolder } from './FolderRow';
import { draggedIds, isSavedDrag } from './savedDrag';

/** Dragged saved videos over a target: `hot` while over it, `onDrop` with their ids. */
function useVideoDrop(onDrop: (ids: string[]) => void) {
  const [hot, setHot] = useState(false);
  return {
    hot,
    handlers: {
      onDragOver: (event: DragEvent) => { if (!isSavedDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (!hot) setHot(true); },
      onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHot(false); },
      onDrop: (event: DragEvent) => { if (!isSavedDrag(event)) return; event.preventDefault(); setHot(false); const ids = draggedIds(event); if (ids.length) onDrop(ids); },
    },
  };
}

/** The pixel "/" between segments. */
const Slash = () => <svg className="crumb-sep" viewBox="0 0 5 12" aria-hidden="true">
  {[[4, 0, 1, 2], [3, 2, 1, 3], [2, 5, 1, 2], [1, 7, 1, 3], [0, 10, 1, 2]].map(([x, y, width, height]) => <rect key={y} x={x} y={y} width={width} height={height} />)}
</svg>;

/** A parent segment: opens its folder and takes dropped videos. */
function Crumb({ path, title, children, onNavigate, onDropVideos }: { path: string; title: string; children: ReactNode; onNavigate: (path: string) => void; onDropVideos: (path: string, ids: string[]) => void }) {
  const drop = useVideoDrop((ids) => onDropVideos(path, ids));
  return <button type="button" className={`crumb up${drop.hot ? ' drop-hot' : ''}`} data-crumb={path} title={title} onClick={() => onNavigate(path)} {...drop.handlers}>{children}</button>;
}

/** A folder in the "…" menu of collapsed segments: opens it, or takes dropped videos. */
function HiddenFolder({ path, name, depth, title, onNavigate, onDropVideos, onDropped }: { path: string; name: string; depth: number; title: string; onNavigate: (path: string) => void; onDropVideos: (path: string, ids: string[]) => void; onDropped: () => void }) {
  const drop = useVideoDrop((ids) => { onDropped(); onDropVideos(path, ids); });
  return <DropdownMenuItem className={`hidden-folder${drop.hot ? ' drop-hot' : ''}`} data-crumb={path} title={title} style={{ paddingLeft: 8 + depth * 12 }} onSelect={() => onNavigate(path)} {...drop.handlers}>
    <PixelFolder empty={false} small /><span className="move-name">{name}</span>
  </DropdownMenuItem>;
}

/** "…": the middle folders a long path folds away, nearest the save folder first. Dragging videos over it opens it. */
function CollapsedCrumbs({ folders, displayPath, onNavigate, onDropVideos }: { folders: { path: string; name: string }[]; displayPath: (path: string) => string; onNavigate: (path: string) => void; onDropVideos: (path: string, ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const label = libraryText('hiddenFolders', { n: folders.length });
  return <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="crumb up crumb-more" aria-label={label} title={label} onDragEnter={(event) => { if (isSavedDrag(event) && !open) setOpen(true); }}>…</button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="video-menu hidden-folders-menu">
      {folders.map((entry, index) => <HiddenFolder key={entry.path} path={entry.path} name={entry.name} depth={index} title={displayPath(entry.path)} onNavigate={onNavigate} onDropVideos={onDropVideos} onDropped={() => setOpen(false)} />)}
      <p className="menu-note">{copy.hiddenFoldersNote}</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Sort & group: one control naming the current view; each place remembers its own. */
export function SortMenu({ view, scope, note, onView, defaultOpen = false }: { view: LibraryView; scope: string; note?: string; onView: (view: LibraryView) => void; defaultOpen?: boolean }) {
  const label = viewLabel(view);
  return <DropdownMenu defaultOpen={defaultOpen}>
    <DropdownMenuTrigger asChild>
      <button type="button" className="sort-button" aria-label={libraryText('sortAndGroup', { label })}><ArrowUpDown aria-hidden="true" /><span>{label}</span><ChevronDown className="chev" aria-hidden="true" /></button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="video-menu sort-menu">
      <DropdownMenuLabel>{copy.sortBy}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={view.sort} onValueChange={(sort) => onView({ ...view, sort: sort as LibraryView['sort'] })}>
        {SORTS.map((sort) => <DropdownMenuRadioItem key={sort.id} value={sort.id}>{sort.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{copy.groupBy}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={view.group} onValueChange={(group) => onView({ ...view, group: group as LibraryView['group'] })}>
        {GROUPS.map((group) => <DropdownMenuRadioItem key={group.id} value={group.id}>{group.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <p className="menu-note">{libraryText('viewRemembered', { scope })}{note ? ` ${note}` : ''}</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/**
 * The bar under the header. Saved: where you are (the save folder / folders), Sort & group, New folder,
 * Show in Finder and ⋯. All: Sort & group. Downloading keeps queue order.
 */
export function PathBar({ tab, searching, rootName, rootDisplayPath, folder, view, onView, onNavigate, onNewFolder, onReveal, onCopyPath, onRenameCurrent, onDeleteCurrent, onDropVideos, sortMenuOpen = false }: {
  tab: 'all' | 'downloading' | 'saved'; searching: boolean; rootName: string; rootDisplayPath: string; folder: string;
  view: LibraryView; onView: (view: LibraryView) => void; onNavigate: (path: string) => void; onNewFolder: () => void;
  onReveal: (path: string) => void; onCopyPath: (path: string) => void; onRenameCurrent: () => void; onDeleteCurrent: (anchor: HTMLElement) => void;
  onDropVideos: (path: string, ids: string[]) => void; sortMenuOpen?: boolean;
}) {
  if (tab === 'downloading') {
    return <div className="path-bar"><span className="crumb current">{copy.downloadingScope}</span><span className="path-space" />
      <button type="button" className="sort-button" disabled title={copy.queueOrderHint}><ArrowUpDown aria-hidden="true" /><span>{copy.queueOrder}</span></button></div>;
  }
  if (tab === 'all' || searching) {
    return <div className="path-bar"><span className="crumb current">{copy.allVideos}</span><span className="path-space" />
      <SortMenu view={view} scope={tab === 'all' ? copy.scopeAll : rootName} note={tab === 'all' ? copy.activeStayOnTop : undefined} onView={onView} defaultOpen={sortMenuOpen} /></div>;
  }
  return <SavedPathBar rootName={rootName} rootDisplayPath={rootDisplayPath} folder={folder} view={view} onView={onView} onNavigate={onNavigate} onNewFolder={onNewFolder}
    onReveal={onReveal} onCopyPath={onCopyPath} onRenameCurrent={onRenameCurrent} onDeleteCurrent={onDeleteCurrent} onDropVideos={onDropVideos} sortMenuOpen={sortMenuOpen} />;
}

/**
 * Saved's bar (owner choice D · Minimal): the save folder's pixel folder and name, then each folder in plain
 * text with a pixel "/" between, the current one in the accent. No back button and no path text: a parent
 * segment (or ⌘↑ / Alt+↑) goes up, and ⋯ holds Copy path. When the trail doesn't fit, the middle folders
 * fold into "…", nearest the save folder first; the save folder and the current folder always stay.
 */
function SavedPathBar({ rootName, rootDisplayPath, folder, view, onView, onNavigate, onNewFolder, onReveal, onCopyPath, onRenameCurrent, onDeleteCurrent, onDropVideos, sortMenuOpen }: {
  rootName: string; rootDisplayPath: string; folder: string; view: LibraryView; onView: (view: LibraryView) => void; onNavigate: (path: string) => void; onNewFolder: () => void;
  onReveal: (path: string) => void; onCopyPath: (path: string) => void; onRenameCurrent: () => void; onDeleteCurrent: (anchor: HTMLElement) => void;
  onDropVideos: (path: string, ids: string[]) => void; sortMenuOpen: boolean;
}) {
  const bar = useRef<HTMLElement>(null);
  const trail = useRef<HTMLOListElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  // Rename and Delete open dialogs once the menu has closed, instead of its focus return.
  const pending = useRef<(() => void) | null>(null);
  const parts = folder ? folder.split('/') : [];
  const name = parts[parts.length - 1] || rootName;
  const displayPath = (path: string) => (path ? `${rootDisplayPath}/${path}` : rootDisplayPath);
  const fullPath = displayPath(folder);

  // How many middle folders are folded into "…": measured again whenever the place, the bar's width or the sort label changes.
  const [width, setWidth] = useState(0);
  const fitKey = `${folder}\n${rootName}\n${width}\n${viewLabel(view)}`;
  const [fit, setFit] = useState({ key: '', hidden: 0 });
  const hidden = fit.key === fitKey ? fit.hidden : 0;
  const middle = Math.max(0, parts.length - 1);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = trail.current;
    if (!element || hidden >= middle) return;
    element.classList.add('measuring');
    const overflows = element.scrollWidth > element.clientWidth + 1;
    element.classList.remove('measuring');
    if (overflows) setFit({ key: fitKey, hidden: hidden + 1 });
  }, [fitKey, hidden, middle]);

  const segments = parts.map((part, index) => ({ path: parts.slice(0, index + 1).join('/'), name: part, index }));
  const folded = segments.slice(0, hidden);
  const shown = segments.slice(hidden);
  const rootLabel = <><PixelFolder empty={false} small /><span className="crumb-name">{rootName}</span></>;
  return <nav ref={bar} className="path-bar saved-path-bar" aria-label={copy.pathBar}>
    <ol ref={trail} className="crumbs">
      <li>{folder ? <Crumb path="" title={rootDisplayPath} onNavigate={onNavigate} onDropVideos={onDropVideos}>{rootLabel}</Crumb>
        : <span className="crumb current" aria-current="page" title={rootDisplayPath}>{rootLabel}</span>}</li>
      {folded.length > 0 && <li><Slash /><CollapsedCrumbs folders={folded} displayPath={displayPath} onNavigate={onNavigate} onDropVideos={onDropVideos} /></li>}
      {shown.map((segment) => <li key={segment.path}><Slash />{segment.index === parts.length - 1
        ? <span className="crumb current" aria-current="page" title={displayPath(segment.path)}><span className="crumb-name">{segment.name}</span></span>
        : <Crumb path={segment.path} title={displayPath(segment.path)} onNavigate={onNavigate} onDropVideos={onDropVideos}><span className="crumb-name">{segment.name}</span></Crumb>}</li>)}
    </ol>
    <span className="path-space" />
    <SortMenu view={view} scope={folder ? `“${name}”` : rootName} onView={onView} defaultOpen={sortMenuOpen} />
    <button type="button" className="row-action" aria-label={copy.newFolder} title={copy.newFolder} onClick={onNewFolder}><FolderPlus /></button>
    <button type="button" className="row-action" aria-label={revealLabel()} title={revealLabel()} onClick={() => onReveal(folder)}><ExternalLink /></button>
    {/* ⋯ is there at the save folder too, for Copy path. */}
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><button ref={more} type="button" className="row-action more-action" aria-label={folder ? libraryText('folderOptions', { name }) : copy.saveFolderOptions} title={folder ? libraryText('folderOptions', { name }) : copy.saveFolderOptions}><MoreHorizontal /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="video-menu folder-options-menu" onCloseAutoFocus={(event) => { const action = pending.current; pending.current = null; if (action) { event.preventDefault(); action(); } }}>
        <DropdownMenuItem onSelect={() => onCopyPath(folder)}><Copy aria-hidden="true" />{copy.copyPath}</DropdownMenuItem>
        <p className="menu-path" role="presentation">{fullPath.split('/').map((piece, index) => <Fragment key={index}>{index > 0 && <>/<wbr /></>}{piece}</Fragment>)}</p>
        <DropdownMenuItem onSelect={() => onReveal(folder)}><ExternalLink aria-hidden="true" />{revealLabel()}</DropdownMenuItem>
        {folder && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { pending.current = onRenameCurrent; }}><Pencil aria-hidden="true" />{copy.renameFolder}</DropdownMenuItem>
          <DropdownMenuItem className="destructive-text" onSelect={() => { pending.current = () => { if (more.current) onDeleteCurrent(more.current); }; }}><Trash2 aria-hidden="true" />{copy.deleteFolderMenu}</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  </nav>;
}
