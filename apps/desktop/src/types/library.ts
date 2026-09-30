/** A folder of Saved: a real subfolder of the save folder. `path` is relative to it ('/'-separated). */
export interface LibraryFolder {
  path: string;
  name: string;
  parent: string;
  /** Videos inside, counting subfolders. */
  videoCount: number;
  sizeBytes: number;
  /** Files SnagThis didn't save (named in the delete confirmation). */
  otherFiles: { count: number; names: string[] };
}

export interface LibraryInfo {
  root: { name: string; path: string; displayPath: string };
  folders: LibraryFolder[];
}

export interface MoveResult { id: string; ok: boolean; code?: string }
export type DeleteMode = 'keep' | 'trash';

/** Folder operations: the local bridge in the app, an in-memory library in the design gallery. */
export interface LibraryBackend {
  info(): Promise<LibraryInfo>;
  createFolder(parent: string, name: string): Promise<{ path: string }>;
  renameFolder(path: string, name: string): Promise<{ path: string }>;
  deleteFolder(path: string, mode?: DeleteMode): Promise<{ deleted: 'empty' | 'keep' | 'trash'; moved: number }>;
  move(ids: string[], to: string): Promise<MoveResult[]>;
  /** Renames a saved video's file, own folder and side files on disk. */
  renameVideo(id: string, name: string): Promise<void>;
  reveal(path: string): Promise<void>;
}
