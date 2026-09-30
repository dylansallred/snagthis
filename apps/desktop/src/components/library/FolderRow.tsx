import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, MoreHorizontal } from 'lucide-react';
import { formatSize } from '@m3u8/contracts/src/rows.mjs';
import { countLabel, libraryStrings as copy, libraryText } from '@m3u8/contracts/src/library.mjs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { revealLabel } from '@/lib/libraryBackend';
import type { LibraryFolder } from '@/types/library';
import { draggedIds, isSavedDrag } from './savedDrag';

/** "N videos · size", or Empty. */
export function folderMeta(folder: Pick<LibraryFolder, 'videoCount' | 'sizeBytes'>) {
  return folder.videoCount ? libraryText('countAndSize', { count: countLabel(folder.videoCount), size: formatSize(folder.sizeBytes) || '0 MB' }) : copy.emptyFolder;
}

type GlyphKind = 'closed' | 'open' | 'empty';
const GLYPHS: Record<GlyphKind, [string, number, number, number, number][]> = {
  closed: [['b', 0, 0, 6, 2], ['b', 0, 2, 16, 11], ['f', 0, 4, 16, 9], ['l', 0, 4, 16, 1], ['b', 0, 12, 16, 1], ['b', 15, 5, 1, 7]],
  // A sheet shows above the lowered front.
  open: [['b', 0, 0, 6, 2], ['b', 0, 2, 16, 11], ['p', 2, 2, 12, 5], ['f', 1, 6, 15, 7], ['l', 1, 6, 15, 1], ['b', 1, 12, 15, 1]],
  // A dotted outline for a folder with nothing in it.
  empty: [['o', 0, 0, 6, 1], ['o', 5, 1, 1, 1], ['o', 6, 2, 10, 1], ['o', 0, 0, 1, 13], ['o', 15, 2, 1, 11], ['o', 0, 12, 16, 1],
    ...[1, 3, 5, 7, 9, 11, 13].map((x): [string, number, number, number, number] => ['o', x, 5, 1, 1])],
};

/** The 16×13 pixel folder in the accent bevel colours; a folder with videos opens on hover, focus and drag-over. */
export function PixelFolder({ empty, small = false }: { empty: boolean; small?: boolean }) {
  const glyph = (kind: GlyphKind) => <svg className={`pixel-folder k-${kind}`} viewBox="0 0 16 13" aria-hidden="true">
    {GLYPHS[kind].map(([tone, x, y, width, height], index) => <rect key={index} className={tone} x={x} y={y} width={width} height={height} />)}
  </svg>;
  return <span className={`folder-glyph${small ? ' small' : ''}`} aria-hidden="true">{empty ? glyph('empty') : <>{glyph('closed')}{glyph('open')}</>}</span>;
}

/**
 * A section label in Saved: FOLDERS 5 above the folders, VIDEOS 17 with their size above the videos.
 * Only shown in a place with subfolders. Inside the list it is a list item holding a heading.
 */
export function SectionLabel({ name, count, meta, inList }: { name: string; count: string; meta?: string; inList: boolean }) {
  return <div role={inList ? 'listitem' : undefined} className="list-section" data-item-key={inList ? `section:${name}` : undefined}>
    <h2 className="list-section-title">{name} <b>{count}</b></h2>{meta && <span className="list-section-meta">{meta}</span>}
  </div>;
}

/**
 * A name field for a new or renamed folder. Enter saves, Esc or leaving it untouched cancels;
 * `onSubmit` resolves to a problem to show (amber, under the field) or null when it worked.
 */
export function FolderNameField({ initial, label, hint, onSubmit, onCancel }: {
  initial: string; label: string; hint: string; onSubmit: (name: string) => Promise<string | null>; onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const submit = async () => {
    if (busy || done.current) return;
    if (value === initial && initial) { done.current = true; onCancel(); return; }
    setBusy(true);
    const result = await onSubmit(value);
    setBusy(false);
    if (result) { setProblem(result); input.current?.focus(); } else done.current = true;
  };
  return <div className="folder-name-field">
    <input ref={input} className="inline-rename" value={value} aria-label={label} placeholder={copy.folderNamePlaceholder} disabled={busy}
      aria-invalid={!!problem || undefined} aria-describedby="folder-name-hint"
      onChange={(event) => { setValue(event.target.value); setProblem(''); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); void submit(); }
        if (event.key === 'Escape') { event.preventDefault(); done.current = true; onCancel(); }
      }}
      onBlur={() => { if (!done.current && !busy) { if (!value.trim() || value === initial) { done.current = true; onCancel(); } else void submit(); } }} />
    <div id="folder-name-hint" className={`row-status${problem ? ' tone-attention' : ' folder-hint'}`} role={problem ? 'alert' : undefined}>{problem || hint}</div>
  </div>;
}

/**
 * A folder of Saved, before the videos (owner choice C · Sections): a compact one-line row in the list,
 * or a chip above the shelf's posters. Pixel folder, name, "N videos · size" (or Empty), and a drop target.
 */
export function FolderRow({ folder, variant = 'row', rootDisplayPath, renaming, previewHot = false, onOpen, onReveal, onStartRename, onRename, onCancelRename, onDelete, onDropVideos }: {
  folder: LibraryFolder; variant?: 'row' | 'chip'; rootDisplayPath: string; renaming: boolean;
  /** The design gallery's drag preview shows this folder as the drop target. */
  previewHot?: boolean;
  onOpen: () => void; onReveal: () => void; onStartRename: () => void; onRename: (name: string) => Promise<string | null>; onCancelRename: () => void;
  onDelete: (anchor: HTMLElement) => void; onDropVideos: (ids: string[]) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragHot, setHot] = useState(false);
  const hot = dragHot || previewHot;
  const more = useRef<HTMLButtonElement>(null);
  const row = useRef<HTMLDivElement>(null);
  // Open, Rename and Delete take focus elsewhere: they run once the menu has closed, instead of its focus return.
  const pending = useRef<(() => void) | null>(null);
  const later = (action: () => void) => () => { pending.current = action; };
  const meta = folderMeta(folder);
  const destination = `${rootDisplayPath}/${folder.path}`;
  const chip = variant === 'chip';
  return <div role="listitem" className={chip ? 'folder-chip-item' : 'folder-item'} data-item-key={`folder:${folder.path}`}>
    <div ref={row} className={`${chip ? 'saved-folder-chip' : 'saved-folder-row'}${folder.videoCount ? '' : ' is-empty'}${hot ? ' drop-hot' : ''}${menuOpen ? ' menu-open' : ''}${renaming ? ' editing' : ''}`} role="group" tabIndex={0} data-row-key={`folder:${folder.path}`} data-folder={folder.path}
      aria-label={libraryText('folderLabel', { name: folder.name, count: meta })}
      onClick={(event) => { if (!renaming && !(event.target as HTMLElement).closest('button,input,[role="menuitem"]')) onOpen(); }}
      onContextMenu={(event) => { if (renaming) return; event.preventDefault(); setMenuOpen(true); }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') { event.preventDefault(); onOpen(); }
        else if (event.key === 'F2') { event.preventDefault(); onStartRename(); }
        else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onDelete(more.current || event.currentTarget); }
        else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') { event.preventDefault(); setMenuOpen(true); }
      }}
      onDragOver={(event) => { if (!isSavedDrag(event) || renaming) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (!dragHot) setHot(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHot(false); }}
      onDrop={(event) => { if (!isSavedDrag(event)) return; event.preventDefault(); setHot(false); const ids = draggedIds(event); if (ids.length) onDropVideos(ids); }}>
      <PixelFolder empty={!folder.videoCount} />
      <div className="folder-text">
        {renaming ? <FolderNameField initial={folder.name} label={copy.renameFolder} hint={copy.renameHint} onSubmit={onRename} onCancel={() => { onCancelRename(); requestAnimationFrame(() => row.current?.focus()); }} />
          : <>
            <span className="folder-name" title={folder.name}>{folder.name}</span>
            {/* A chip is narrow: its drop hint is just "Move here"; the row names the whole path. */}
            <span className={`folder-meta${hot ? ' drop-hint' : ''}`}>{hot ? (chip ? copy.moveHereShort : libraryText('moveHere', { path: destination })) : meta}</span>
          </>}
      </div>
      {!renaming && <div className="row-actions">
        {/* Chips keep Show in Finder in their ⋯ menu only. */}
        {!chip && <button type="button" className="row-action hover-action folder-action" aria-label={`${revealLabel()}: ${folder.name}`} title={revealLabel()} onClick={onReveal}><Folder className="icon-rest" /><FolderOpen className="icon-hover" /></button>}
        {/* Not modal: its Delete folder… opens a dialog, which must not inherit the menu's pointer lock. */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild><button ref={more} type="button" className={`row-action hover-action more-action${menuOpen ? ' menu-open' : ''}`} aria-label={libraryText('folderOptions', { name: folder.name })} title={libraryText('folderOptions', { name: folder.name })}><MoreHorizontal /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="video-menu" onCloseAutoFocus={(event) => { const action = pending.current; pending.current = null; if (action) { event.preventDefault(); action(); } }}>
            <DropdownMenuItem onSelect={later(onOpen)}>{copy.openFolder}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onReveal}>{revealLabel()}</DropdownMenuItem>
            <DropdownMenuItem onSelect={later(onStartRename)}>{copy.renameFolder}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="destructive-text" onSelect={later(() => onDelete(more.current || row.current!))}>{copy.deleteFolderMenu}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="folder-chevron" aria-hidden="true"><ChevronRight /></span>
      </div>}
    </div>
  </div>;
}

/** The row a new folder is named in, at the top of the folders. */
export function NewFolderRow({ variant = 'row', parentDisplayPath, onCreate, onCancel }: { variant?: 'row' | 'chip'; parentDisplayPath: string; onCreate: (name: string) => Promise<string | null>; onCancel: () => void }) {
  const chip = variant === 'chip';
  return <div role="listitem" className={chip ? 'folder-chip-item' : 'folder-item'} data-item-key="folder:new">
    <div className={`${chip ? 'saved-folder-chip' : 'saved-folder-row'} is-empty editing`}>
      <PixelFolder empty />
      <div className="folder-text"><FolderNameField initial="" label={copy.newFolder} hint={libraryText('newFolderHint', { path: `${parentDisplayPath}/…` })} onSubmit={onCreate} onCancel={onCancel} /></div>
    </div>
  </div>;
}
