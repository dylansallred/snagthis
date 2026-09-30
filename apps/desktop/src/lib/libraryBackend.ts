import { libraryStrings } from '@m3u8/contracts/src/library.mjs';
import type { ApiClient } from '@/lib/api';
import type { LibraryBackend } from '@/types/library';

/** Folder operations through the local bridge; Reveal goes through the main process. */
export function createApiLibraryBackend(api: ApiClient): LibraryBackend {
  return {
    info: () => api.getLibrary(),
    createFolder: (parent, name) => api.createFolder(parent, name),
    renameFolder: (path, name) => api.renameFolder(path, name),
    deleteFolder: (path, mode) => api.deleteFolder(path, mode),
    move: async (ids, to) => (await api.moveVideos(ids, to)).results,
    renameVideo: async (id, name) => { await api.renameVideo(id, name); },
    reveal: async (path) => {
      const result = await window.desktop.openLibraryFolder(path);
      if (!result.ok) throw new Error(result.error || libraryStrings.reasonFolderMissing);
    },
  };
}

/** "Show in Finder" on macOS, "Show in Explorer" on Windows. */
export function revealLabel() {
  const platform = navigator.platform || '';
  return /Mac|iPhone|iPad/.test(platform) ? libraryStrings.revealMac : /Win/.test(platform) ? libraryStrings.revealWindows : libraryStrings.revealOther;
}
