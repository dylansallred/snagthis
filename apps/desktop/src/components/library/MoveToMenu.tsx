import { useRef, useState } from 'react';
import { Folder, FolderPlus } from 'lucide-react';
import { libraryStrings as copy, libraryText } from '@m3u8/contracts/src/library.mjs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { LibraryFolder } from '@/types/library';

export interface MoveRequest {
  ids: string[];
  /** The folder the videos are in, when they share one (it reads Here). */
  from: string | null;
  /** Where the menu opens, and the element focus returns to when it closes. */
  anchor: DOMRect;
  returnFocus: HTMLElement | null;
}

/**
 * Move to…: the save folder and every folder as a tree (the current one reads Here), then
 * New folder…. The note names the real destination of the highlighted choice. The choice runs
 * once the menu has closed and handed focus back, so a dialog it opens starts cleanly.
 */
export function MoveToMenu({ request, folders, rootName, rootDisplayPath, onMove, onNewFolder, onClose }: {
  request: MoveRequest | null; folders: LibraryFolder[]; rootName: string; rootDisplayPath: string;
  onMove: (to: string) => void; onNewFolder: () => void; onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const chosen = useRef<(() => void) | null>(null);
  if (!request) return null;
  const count = request.ids.length;
  const pathOf = (folder: string) => (folder ? `${rootDisplayPath}/${folder}` : rootDisplayPath);
  const sorted = [...folders].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base', numeric: true }));
  const item = (path: string, name: string, depth: number, videos: number | null) => {
    const here = request.from === path;
    return <DropdownMenuItem key={path || '/'} disabled={here} data-folder={path} style={{ paddingLeft: 9 + depth * 14 }}
      onFocus={() => setHighlighted(path)} onPointerEnter={() => setHighlighted(path)} onSelect={() => { chosen.current = () => onMove(path); }}>
      <Folder aria-hidden="true" /><span className="move-name">{name}</span><span className="menu-hint">{here ? copy.here : videos ?? ''}</span>
    </DropdownMenuItem>;
  };
  return <DropdownMenu open={open} onOpenChange={(next) => { if (!next) setOpen(false); }}>
    <DropdownMenuTrigger asChild>
      <span className="menu-anchor" aria-hidden="true" style={{ left: request.anchor.left, top: request.anchor.top, width: request.anchor.width, height: request.anchor.height }} />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="video-menu move-menu" aria-label={copy.moveToHeading}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (request.returnFocus?.isConnected) request.returnFocus.focus({ preventScroll: true });
        const action = chosen.current;
        chosen.current = null;
        onClose();
        action?.();
      }}>
      <DropdownMenuLabel>{count > 1 ? libraryText('moveManyHeading', { n: count }) : copy.moveToHeading}</DropdownMenuLabel>
      {item('', rootName, 0, null)}
      {sorted.map((folder) => item(folder.path, folder.name, folder.path.split('/').length, folder.videoCount))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { chosen.current = onNewFolder; }}><FolderPlus aria-hidden="true" />{copy.newFolderMenu}</DropdownMenuItem>
      <p className="menu-note">{libraryText('moveNote', { path: highlighted === null ? `${rootDisplayPath}/…` : pathOf(highlighted) })}</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}
