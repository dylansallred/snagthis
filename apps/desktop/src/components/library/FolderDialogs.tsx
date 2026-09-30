import { useEffect, useRef, useState } from 'react';
import { FolderInput, ListX, X } from 'lucide-react';
import { formatSize } from '@m3u8/contracts/src/rows.mjs';
import { countLabel, fileCountLabel, libraryStrings as copy, libraryText } from '@m3u8/contracts/src/library.mjs';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { DeleteMode, LibraryFolder } from '@/types/library';

/** Names a folder in a small dialog: New folder… from Move to…, or Rename from the path bar. */
export function FolderNameDialog({ open, title, body, initial = '', confirm, onSubmit, onClose }: {
  open: boolean; title: string; body: string; initial?: string; confirm: string;
  onSubmit: (name: string) => Promise<string | null>; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setValue(initial); setProblem(''); } }, [open, initial]);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const result = await onSubmit(value);
    setBusy(false);
    if (result) setProblem(result);
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="remove-dialog folder-dialog" showCloseButton={false}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{body}</DialogDescription>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input className="inline-rename" autoFocus value={value} placeholder={copy.folderNamePlaceholder} aria-label={copy.folderNamePlaceholder} disabled={busy}
          aria-invalid={!!problem || undefined} onChange={(event) => { setValue(event.target.value); setProblem(''); }} />
        <p className="folder-dialog-problem tone-attention" role={problem ? 'alert' : undefined}>{problem}</p>
        <div className="folder-dialog-actions">
          <button type="button" className="row-action" disabled={busy} onClick={onClose}>{copy.cancel}</button>
          <button type="submit" className="row-action primary-action" disabled={busy}>{confirm}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export interface DeleteRequest { folder: LibraryFolder; anchor: DOMRect; parentName: string }

/**
 * Delete a folder that has something in it: Keep the videos (the default; they move up) or Move
 * folder to Trash. A popover pointing at the control that asked, like Remove… on a video (§9).
 */
export function DeleteFolderPopover({ request, busy, onConfirm, onClose }: {
  request: DeleteRequest | null; busy: boolean; onConfirm: (mode: DeleteMode) => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<DeleteMode>('keep');
  useEffect(() => { if (request) setMode('keep'); }, [request]);
  const width = 370;
  const height = request?.folder.otherFiles.count ? 318 : 268;
  const rect = request?.anchor;
  const left = rect ? Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width + 12)) : 0;
  const above = !!rect && rect.bottom + height + 12 > window.innerHeight - 44 && rect.top - height - 10 > 56;
  const top = rect ? (above ? rect.top - height - 10 : Math.min(window.innerHeight - height - 52, rect.bottom + 8)) : 0;
  const caret = rect ? Math.max(16, Math.min(width - 16, rect.left + rect.width / 2 - left)) : 0;
  const folder = request?.folder;
  const count = folder ? countLabel(folder.videoCount) : '';
  const others = folder?.otherFiles;
  const choose = (next: DeleteMode) => setMode(next);
  return <Dialog open={!!request} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    {folder && <DialogContent className={`remove-popover folder-delete translate-x-0 translate-y-0${above ? ' above' : ''}`} showCloseButton={false}
      style={{ left, top, width, maxWidth: width, '--caret-x': `${caret}px` } as React.CSSProperties}>
      <DialogTitle className="folder-delete-title">{libraryText('deleteTitle', { name: folder.name })}</DialogTitle>
      <DialogDescription className="sr-only">{copy.deleteChoices}</DialogDescription>
      <div role="radiogroup" aria-label={copy.deleteChoices} className="folder-delete-choices"
        onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = mode === 'keep' ? 'trash' : 'keep'; choose(next); (event.currentTarget.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus(); } }}>
        <button type="button" role="radio" data-mode="keep" aria-checked={mode === 'keep'} tabIndex={mode === 'keep' ? 0 : -1} autoFocus className="folder-choice" disabled={busy} onClick={() => choose('keep')}>
          <span className="radio" aria-hidden="true" /><span><strong>{copy.keepVideos}</strong><small>{libraryText('keepVideosBody', { count, parent: request?.parentName || '' })}</small></span>
        </button>
        <button type="button" role="radio" data-mode="trash" aria-checked={mode === 'trash'} tabIndex={mode === 'trash' ? 0 : -1} className="folder-choice destructive-text" disabled={busy} onClick={() => choose('trash')}>
          <span className="radio" aria-hidden="true" /><span><strong>{copy.trashFolder}</strong><small>{libraryText('trashFolderBody', { count, size: formatSize(folder.sizeBytes) || '0 MB' })}</small></span>
        </button>
      </div>
      {!!others?.count && <div className="folder-delete-note">{libraryText('otherFiles', { count: fileCountLabel(others.count), names: others.names.join(', ') + (others.count > others.names.length ? ', …' : '') })}</div>}
      <div className="folder-dialog-actions">
        <button type="button" className="row-action" disabled={busy} onClick={onClose}>{copy.cancel}</button>
        <button type="button" className={`row-action ${mode === 'trash' ? 'labelled destructive-text' : 'primary-action'}`} disabled={busy} onClick={() => onConfirm(mode)}>{mode === 'trash' ? copy.trashConfirm : copy.deleteConfirm}</button>
      </div>
    </DialogContent>}
  </Dialog>;
}

/** The footer while videos are selected: N selected · Move to… · Remove from list · Clear. */
export function SelectionBar({ count, onMove, onRemove, onClear }: { count: number; onMove: (button: HTMLElement) => void; onRemove: () => void; onClear: () => void }) {
  const move = useRef<HTMLButtonElement>(null);
  return <div className="selection-bar" role="toolbar" aria-label={copy.selectionBar}>
    <span className="selection-count" role="status"><i aria-hidden="true" />{libraryText('selectedCount', { n: count })}</span>
    <button ref={move} type="button" className="row-action labelled" aria-haspopup="menu" onClick={() => move.current && onMove(move.current)}><FolderInput />{copy.moveTo}</button>
    <button type="button" className="row-action" onClick={onRemove}><ListX />{copy.removeFromList}</button>
    <button type="button" className="row-action" onClick={onClear}><X />{copy.clearSelection}</button>
  </div>;
}
