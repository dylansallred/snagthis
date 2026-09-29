import { useRef, useState, type ReactNode } from 'react';
import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Folder, FolderPlus, MoreHorizontal } from 'lucide-react';
import { GROUPS, SORTS, libraryStrings as copy, libraryText, viewLabel, type LibraryView } from '@m3u8/contracts/src/library.mjs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { revealLabel } from '@/lib/libraryBackend';
import { draggedIds, isSavedDrag } from './savedDrag';

/** A breadcrumb segment that opens its folder and takes dropped videos. */
function Crumb({ path, children, onNavigate, onDropVideos, className = '' }: { path: string; children: ReactNode; onNavigate: (path: string) => void; onDropVideos: (path: string, ids: string[]) => void; className?: string }) {
  const [hot, setHot] = useState(false);
  return <button type="button" className={`crumb up${hot ? ' drop-hot' : ''} ${className}`} data-crumb={path} onClick={() => onNavigate(path)}
    onDragOver={(event) => { if (!isSavedDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (!hot) setHot(true); }}
    onDragLeave={() => setHot(false)}
    onDrop={(event) => { if (!isSavedDrag(event)) return; event.preventDefault(); setHot(false); const ids = draggedIds(event); if (ids.length) onDropVideos(path, ids); }}>{children}</button>;
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
 * The bar under the header. Saved: where you are (the save folder › folders), its path, Sort &
 * group, New folder and Show in Finder. All: Sort & group. Downloading keeps queue order.
 */
export function PathBar({ tab, searching, rootName, rootDisplayPath, folder, view, onView, onNavigate, onNewFolder, onReveal, onRenameCurrent, onDeleteCurrent, onDropVideos, sortMenuOpen = false }: {
  tab: 'all' | 'downloading' | 'saved'; searching: boolean; rootName: string; rootDisplayPath: string; folder: string;
  view: LibraryView; onView: (view: LibraryView) => void; onNavigate: (path: string) => void; onNewFolder: () => void;
  onReveal: (path: string) => void; onRenameCurrent: () => void; onDeleteCurrent: (anchor: HTMLElement) => void;
  onDropVideos: (path: string, ids: string[]) => void; sortMenuOpen?: boolean;
}) {
  const more = useRef<HTMLButtonElement>(null);
  // Rename and Delete open dialogs once the menu has closed, instead of its focus return.
  const pending = useRef<(() => void) | null>(null);
  if (tab === 'downloading') {
    return <div className="path-bar"><span className="crumb current">{copy.downloadingScope}</span><span className="path-space" />
      <button type="button" className="sort-button" disabled title={copy.queueOrderHint}><ArrowUpDown aria-hidden="true" /><span>{copy.queueOrder}</span></button></div>;
  }
  if (tab === 'all' || searching) {
    return <div className="path-bar"><span className="crumb current">{copy.allVideos}</span><span className="path-space" />
      <SortMenu view={view} scope={tab === 'all' ? copy.scopeAll : rootName} note={tab === 'all' ? copy.activeStayOnTop : undefined} onView={onView} defaultOpen={sortMenuOpen} /></div>;
  }
  const parts = folder ? folder.split('/') : [];
  const name = parts[parts.length - 1] || rootName;
  const parent = parts.slice(0, -1).join('/');
  const fullPath = folder ? `${rootDisplayPath}/${folder}` : rootDisplayPath;
  return <nav className="path-bar" aria-label={copy.pathBar}>
    {folder && <button type="button" className="row-action path-back" aria-label={libraryText('backTo', { name: parent ? parts[parts.length - 2] : rootName })} title={copy.back} onClick={() => onNavigate(parent)}><ChevronLeft /></button>}
    <ol className="crumbs">
      <li>{folder ? <Crumb path="" onNavigate={onNavigate} onDropVideos={onDropVideos}><Folder aria-hidden="true" />{rootName}</Crumb>
        : <span className="crumb current" aria-current="page"><Folder aria-hidden="true" />{rootName}</span>}</li>
      {parts.map((part, index) => {
        const path = parts.slice(0, index + 1).join('/');
        const last = index === parts.length - 1;
        return <li key={path}><ChevronRight className="crumb-sep" aria-hidden="true" />{last ? <span className="crumb current" aria-current="page">{part}</span>
          : <Crumb path={path} onNavigate={onNavigate} onDropVideos={onDropVideos}>{part}</Crumb>}</li>;
      })}
    </ol>
    <span className="path-text" title={fullPath}>{fullPath}</span>
    <span className="path-space" />
    <SortMenu view={view} scope={folder ? `“${name}”` : rootName} onView={onView} defaultOpen={sortMenuOpen} />
    <button type="button" className="row-action" aria-label={copy.newFolder} title={copy.newFolder} onClick={onNewFolder}><FolderPlus /></button>
    <button type="button" className="row-action" aria-label={revealLabel()} title={revealLabel()} onClick={() => onReveal(folder)}><ExternalLink /></button>
    {folder && <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild><button ref={more} type="button" className="row-action more-action" aria-label={libraryText('folderOptions', { name })} title={libraryText('folderOptions', { name })}><MoreHorizontal /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="video-menu" onCloseAutoFocus={(event) => { const action = pending.current; pending.current = null; if (action) { event.preventDefault(); action(); } }}>
        <DropdownMenuItem onSelect={() => { pending.current = onRenameCurrent; }}>{copy.renameFolder}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="destructive-text" onSelect={() => { pending.current = () => { if (more.current) onDeleteCurrent(more.current); }; }}>{copy.deleteFolderMenu}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
  </nav>;
}
