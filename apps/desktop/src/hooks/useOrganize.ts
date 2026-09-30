import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { countLabel, failureReason, folderName, libraryStrings as copy, libraryText, normalizeView, parentFolder, type LibraryView } from '@m3u8/contracts/src/library.mjs';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { ApiRequestError } from '@/lib/api';
import type { DesktopSettings } from '@/types/settings';
import type { DeleteMode, LibraryBackend, LibraryFolder, LibraryInfo } from '@/types/library';
import type { MoveRequest } from '@/components/library/MoveToMenu';
import type { DeleteRequest } from '@/components/library/FolderDialogs';

export interface FailedMove { to: string; code: string }
export type NameDialog = { kind: 'create-and-move'; ids: string[]; parent: string; returnFocus: HTMLElement | null } | { kind: 'rename'; path: string };

const problemText = (error: unknown) => (error instanceof ApiRequestError && error.code && error.code.startsWith('name') ? error.message
  : error instanceof ApiRequestError && error.code ? failureReason(error.code) : failureReason('unknown'));

/**
 * Saved's folders: the folder tree, where Saved is, the remembered views, the selection, and the
 * folder and move actions with their failure states. `revision` reloads the folders whenever
 * the list is refreshed (window focus, a new download, a change from another place).
 */
export function useOrganize({ backend, folder, setFolder, settings, saveSettings, revision, onChanged, titleOf }: {
  backend: LibraryBackend | null; folder: string; setFolder: (path: string) => void;
  settings: DesktopSettings; saveSettings: (patch: Partial<DesktopSettings>) => Promise<void>;
  revision: number; onChanged: () => Promise<void> | void; titleOf: (historyId: string) => string;
}) {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [failed, setFailed] = useState<ReadonlyMap<string, FailedMove>>(() => new Map());
  const [moveRequest, setMoveRequest] = useState<(MoveRequest & { key: number }) | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const requests = useRef(0);

  const reload = useCallback(async () => {
    if (!backend) return;
    try { setInfo(await backend.info()); } catch { /* The list keeps working without its folders. */ }
  }, [backend]);
  useEffect(() => { void reload(); }, [reload, revision]);
  // A folder removed or renamed outside SnagThis: go up to the nearest one that still exists.
  useEffect(() => {
    if (!info || !folder || info.folders.some((entry) => entry.path === folder)) return;
    let up = parentFolder(folder);
    while (up && !info.folders.some((entry) => entry.path === up)) up = parentFolder(up);
    setFolder(up);
  }, [info, folder, setFolder]);

  const rootName = info?.root.name || 'SnagThis';
  const rootDisplayPath = info?.root.displayPath || '';
  const folders = info?.folders || [];
  const nameOf = (path: string) => folderName(path, rootName);
  const views = settings.libraryViews || {};
  const viewOf = (key: string) => normalizeView(views[key]);
  const setView = (key: string, view: LibraryView) => { void saveSettings({ libraryViews: { ...views, [key]: view } }); };
  const after = async () => { await onChanged(); await reload(); };

  const clearSelection = useCallback(() => { setSelected(new Set()); anchor.current = null; }, []);
  /** ⌘/Ctrl-click toggles one video; Shift-click (or Shift+↑/↓) selects the range from the last one chosen. */
  const select = (row: RowModel, mode: 'toggle' | 'range', visible: RowModel[], from?: RowModel) => {
    if (mode === 'toggle') {
      setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; });
      anchor.current = row.id;
      return;
    }
    const start = anchor.current ?? from?.id ?? row.id;
    const ids = visible.map((entry) => entry.id);
    const [a, b] = [ids.indexOf(start), ids.indexOf(row.id)].sort((x, y) => x - y);
    if (a < 0) { setSelected(new Set([row.id])); anchor.current = row.id; return; }
    anchor.current = start;
    setSelected(new Set(visible.slice(a, b + 1).filter((entry) => entry.state === 'saved').map((entry) => entry.id)));
  };

  const openMove = (ids: string[], from: string | null, element: HTMLElement | null) => {
    if (!ids.length) return;
    const rect = element?.getBoundingClientRect() || new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    requests.current += 1;
    setMoveRequest({ ids, from, anchor: rect, returnFocus: element, key: requests.current });
  };

  /** Moves saved videos (history IDs) into a folder; a video that can't move stays and says why. */
  const move = async (ids: string[], to: string) => {
    if (!backend || !ids.length) return;
    let results;
    try { results = await backend.move(ids, to); }
    catch (error) { toast.error(libraryText('moveFailed', { folder: nameOf(to), reason: problemText(error) })); await after(); return; }
    const moved = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);
    setFailed((current) => {
      const next = new Map(current);
      for (const result of moved) next.delete(result.id);
      for (const result of failures) next.set(result.id, { to, code: result.code || 'unknown' });
      return next;
    });
    clearSelection();
    const destination = nameOf(to);
    if (!failures.length) {
      toast.success(moved.length === 1 ? libraryText('movedOne', { title: titleOf(moved[0].id), folder: destination }) : libraryText('movedMany', { count: countLabel(moved.length), folder: destination }));
    } else if (results.length > 1) {
      toast.warning(libraryText('movedPartial', { moved: moved.length, total: results.length, folder: destination, failed: failures.length }));
    }
    await after();
  };

  const createFolder = async (parent: string, name: string): Promise<string | null> => {
    if (!backend) return failureReason('unknown');
    try { await backend.createFolder(parent, name); } catch (error) { return problemText(error); }
    setCreating(false);
    await after();
    return null;
  };

  const renameFolder = async (path: string, name: string): Promise<string | null> => {
    if (!backend) return failureReason('unknown');
    let next: string;
    try { next = (await backend.renameFolder(path, name)).path; } catch (error) { return problemText(error); }
    setRenaming(null);
    setNameDialog(null);
    // The folder's remembered views move with it.
    const key = `saved:${path}`;
    const moved = Object.entries(views).filter(([entry]) => entry === key || entry.startsWith(`${key}/`));
    if (moved.length) {
      const nextViews = { ...views };
      for (const [entry, value] of moved) { delete nextViews[entry]; nextViews[`saved:${next}${entry.slice(key.length)}`] = value; }
      void saveSettings({ libraryViews: nextViews });
    }
    if (folder === path || folder.startsWith(`${path}/`)) setFolder(next + folder.slice(path.length));
    await after();
    return null;
  };

  const isEmpty = (entry: LibraryFolder) => !entry.videoCount && !entry.otherFiles.count && !folders.some((other) => other.parent === entry.path);
  /** Empty folders go at once; anything else asks: keep the videos, or move the folder to Trash. */
  const requestDelete = async (entry: LibraryFolder, element: HTMLElement) => {
    if (isEmpty(entry)) { await runDelete(entry, undefined); return; }
    setDeleteRequest({ folder: entry, anchor: element.getBoundingClientRect(), parentName: nameOf(entry.parent) });
  };
  const runDelete = async (entry: LibraryFolder, mode: DeleteMode | undefined) => {
    if (!backend) return;
    setDeleting(true);
    try {
      const result = await backend.deleteFolder(entry.path, mode);
      setDeleteRequest(null);
      if (folder === entry.path || folder.startsWith(`${entry.path}/`)) setFolder(entry.parent);
      const count = countLabel(entry.videoCount);
      toast.success(result.deleted === 'trash' ? libraryText('folderTrashed', { name: entry.name, count })
        : result.deleted === 'keep' && entry.videoCount ? libraryText('folderDeletedKept', { name: entry.name, count, parent: nameOf(entry.parent) })
          : libraryText('folderDeleted', { name: entry.name }));
    } catch (error) {
      toast.error(libraryText('folderFailed', { name: entry.name, reason: problemText(error) }));
    } finally {
      setDeleting(false);
      await after();
    }
  };

  const reveal = async (path: string) => {
    if (!backend) return;
    try { await backend.reveal(path); } catch (error) { toast.error(error instanceof Error ? error.message : failureReason('unknown')); }
  };

  /** The absolute path of a folder of Saved, in the platform's own separators. */
  const absolutePath = (path: string) => {
    const root = info?.root.path || '';
    const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
    return path ? `${root.replace(/[\\/]+$/, '')}${separator}${path.split('/').join(separator)}` : root;
  };
  /** ⋯ ▸ Copy path: the folder's absolute path on the clipboard. */
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(absolutePath(path));
      toast.success(libraryText('pathCopied', { path: path ? `${rootDisplayPath}/${path}` : rootDisplayPath }));
    } catch { toast.error(copy.pathCopyFailed); }
  };

  const toggleSection = (key: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return {
    info, folders, rootName, rootDisplayPath, reload, viewOf, setView,
    selected, setSelected, select, clearSelection, failed, setFailed,
    moveRequest, openMove, closeMove: () => setMoveRequest(null), move,
    deleteRequest, deleting, requestDelete, confirmDelete: (mode: DeleteMode) => deleteRequest && runDelete(deleteRequest.folder, mode), closeDelete: () => setDeleteRequest(null),
    nameDialog, setNameDialog, creating, setCreating, renaming, setRenaming, createFolder, renameFolder, reveal, absolutePath, copyPath,
    collapsed, toggleSection, nameOf, copy,
  };
}
