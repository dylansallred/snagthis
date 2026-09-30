const fs = require('fs');
const path = require('path');
const { moveFileSync, moveDirectorySync } = require('@m3u8/downloader-engine/src/utils/moveFile');
const { failureCode, folderNameProblem, parentFolder, videoNameProblem } = require('@m3u8/contracts/src/library');
const logger = require('../utils/logger');
const {
  buildDownloadAssetUrl, decodeExternalDownloadPath, EXTERNAL_DOWNLOAD_PREFIX, resolveDownloadPath,
} = require('../utils/downloadPaths');
const {
  folderSegments, freeSuffix, isJunkName, isSkippedDirName, isVideoFolder, readDirInfo, sideFilesOf, stemOf, suffixed,
} = require('./libraryLayout');

class LibraryError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const JOB_PATH_KEYS = ['filePath', 'mp4Path', 'outputPath', 'thumbnailPath', 'subtitlePath', 'subtitleZipPath', 'storageDir', 'outputDirectory'];
const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const joinFolder = (parent, name) => (parent ? `${parent}/${name}` : name);

/**
 * Real folders in the save folder: create, rename and delete them, and move saved videos
 * between them. Every change is a file operation that either completes or leaves the
 * original where it was; the library index and any finished job follow the new paths.
 */
function createLibraryFolders({ historyIndex, jobs, saveQueue, downloadDir, onTrashFile, onRemoveItem, platform = process.platform }) {
  // Names that differ only in case count as the same folder everywhere, as they do on macOS and
  // Windows, so a library moved between systems never ends up with look-alike folders.
  const caseInsensitive = true;
  const root = () => historyIndex.libraryRootPath();

  /** The absolute path of a user folder ('' is the save folder), refusing anything that could escape it. */
  function resolveFolder(folderPath, { allowRoot = true } = {}) {
    const segments = folderSegments(folderPath);
    if (!segments) throw new LibraryError(400, 'invalid-path', 'Choose a folder in the save folder');
    const base = root();
    if (!segments.length) {
      if (!allowRoot) throw new LibraryError(400, 'invalid-path', 'The save folder itself can’t be changed here');
      fs.mkdirSync(base, { recursive: true });
      return base;
    }
    let current = base;
    for (const segment of segments) {
      if (isSkippedDirName(segment)) throw new LibraryError(404, 'folder-missing');
      current = path.join(current, segment);
      let stat;
      try { stat = fs.lstatSync(current); } catch { throw new LibraryError(404, 'folder-missing'); }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LibraryError(404, 'folder-missing');
      if (isVideoFolder(segment, readDirInfo(current))) throw new LibraryError(400, 'invalid-path', 'That is a video, not a folder');
    }
    return current;
  }

  function assetPath(url) {
    if (typeof url !== 'string' || !url) return null;
    if (url.startsWith(EXTERNAL_DOWNLOAD_PREFIX)) return decodeExternalDownloadPath(url.slice(EXTERNAL_DOWNLOAD_PREFIX.length)) || null;
    if (url.startsWith('/downloads/')) return resolveDownloadPath(downloadDir, url.slice('/downloads/'.length));
    return null;
  }

  /** Points the index and finished jobs at moved files. `map` returns a new path, or null when unaffected. */
  function follow(map) {
    for (const item of historyIndex.items) {
      const current = item.absolutePath || (item.relativePath ? path.join(downloadDir, item.relativePath) : null);
      const next = current && map(path.resolve(current));
      if (next) {
        item.absolutePath = next;
        item.relativePath = historyIndex.toRelativePath(next) || path.basename(next);
        item.fileName = path.basename(next);
        item.missing = false;
      }
      const poster = assetPath(item.thumbnailUrl);
      const movedPoster = poster && map(path.resolve(poster));
      if (movedPoster) item.thumbnailUrl = buildDownloadAssetUrl(downloadDir, movedPoster);
    }
    let jobsChanged = false;
    for (const job of jobs.values()) {
      if (!job) continue;
      let changed = false;
      for (const key of JOB_PATH_KEYS) {
        const next = typeof job[key] === 'string' && job[key] ? map(path.resolve(job[key])) : null;
        if (next) { job[key] = next; changed = true; }
      }
      if (Array.isArray(job.thumbnailPaths)) {
        job.thumbnailPaths = job.thumbnailPaths.map((value) => {
          const next = typeof value === 'string' && value ? map(path.resolve(value)) : null;
          if (next) changed = true;
          return next || value;
        });
      }
      if (!changed) continue;
      // A clash suffix renames the file; the job's names follow it.
      if (job.filePath) job.downloadName = path.basename(job.filePath);
      if (job.mp4Path) job.downloadNameMp4 = path.basename(job.mp4Path);
      job.updatedAt = Date.now();
      jobsChanged = true;
    }
    return jobsChanged;
  }
  const prefixMap = (from, to) => (value) => (value === from ? to : isInside(from, value) ? path.join(to, path.relative(from, value)) : null);
  const exactMap = (pairs, directories) => {
    const byPath = new Map(pairs.map(([from, to]) => [path.resolve(from), to]));
    return (value) => byPath.get(value) || (directories && directories[0] === value ? directories[1] : null);
  };

  /**
   * Moves one saved video into `destination` with everything that belongs to it. Its own folder
   * moves whole; a loose file moves with its side files, all renamed with the same ` (2)` suffix
   * if a name is taken. Returns the path map, or null when it is already there.
   */
  function moveVideo(item, destination) {
    const source = historyIndex.resolveFilePath(item.id);
    if (!source || !fs.existsSync(source)) throw Object.assign(new Error('Saved file not found'), { code: 'ENOENT' });
    const parent = path.dirname(path.resolve(source));
    if (parent === destination) return null;
    const base = root();
    const parentInfo = readDirInfo(parent);
    const ownFolder = parent !== base && parent !== path.resolve(downloadDir) && isVideoFolder(path.basename(parent), parentInfo);
    if (ownFolder) {
      if (path.dirname(parent) === destination) return null;
      if (destination === parent || isInside(parent, destination)) throw new LibraryError(400, 'invalid-path');
      const [name] = freeSuffix(destination, [path.basename(parent)], suffixed);
      const target = path.join(destination, name);
      moveDirectorySync(parent, target);
      return prefixMap(parent, target);
    }
    const fileName = path.basename(source);
    const job = item.jobId && jobs.get(item.jobId);
    const known = job ? [job.thumbnailPath, job.subtitlePath, job.subtitleZipPath, ...(Array.isArray(job.thumbnailPaths) ? job.thumbnailPaths : [])]
      .filter((value) => typeof value === 'string' && value && path.dirname(path.resolve(value)) === parent && fs.existsSync(value)).map((value) => path.basename(value)) : [];
    const names = [...new Set([fileName, ...sideFilesOf(fileName, parentInfo.files, item.jobId), ...known])];
    const stem = stemOf(fileName);
    const rename = (name, number) => (number === 1 ? name : name.startsWith(stem) ? `${stem} (${number})${name.slice(stem.length)}` : suffixed(name, number));
    const targets = freeSuffix(destination, names, rename);
    const moved = [];
    try {
      names.forEach((name, index) => {
        const from = path.join(parent, name);
        const to = path.join(destination, targets[index]);
        moveFileSync(from, to);
        moved.push([from, to]);
      });
    } catch (error) {
      // Put back whatever already moved, so the video is never split between folders.
      for (const [from, to] of moved.reverse()) {
        try { moveFileSync(to, from); } catch (undoError) { logger.warn('Could not undo a partial move', { code: undoError && undoError.code }); }
      }
      throw error;
    }
    return exactMap(moved, [parent, destination]);
  }

  async function finish(reason, jobsChanged) {
    if (jobsChanged && typeof saveQueue === 'function') await saveQueue();
    await historyIndex.persistIndex();
    historyIndex.emitChange(reason);
  }

  async function rescan() {
    await historyIndex.refreshFromDisk({ force: true }).catch((error) => logger.warn('Library rescan failed', { error: error && error.message }));
  }

  async function moveVideos(ids, to) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((id) => typeof id !== 'string' || !id || id.length > 4096)) {
      throw new LibraryError(400, 'invalid-request', 'Choose the videos to move');
    }
    const results = await historyIndex.runExclusive(async () => {
      const destination = resolveFolder(to);
      const outcome = [];
      let jobsChanged = false;
      for (const id of ids) {
        const item = historyIndex.findById(id);
        if (!item) { outcome.push({ id, ok: false, code: 'missing' }); continue; }
        try {
          const map = moveVideo(item, destination);
          if (map) jobsChanged = follow(map) || jobsChanged;
          item.folder = to;
          outcome.push({ id, ok: true, item: { ...item } });
        } catch (error) {
          const code = error instanceof LibraryError ? error.code : failureCode(error);
          logger.warn('Saved video could not move', { code: error && error.code, reason: code });
          outcome.push({ id, ok: false, code });
        }
      }
      await finish('move', jobsChanged);
      return outcome;
    });
    await rescan();
    return results;
  }

  function checkName(parentAbs, name, current) {
    const siblings = fs.readdirSync(parentAbs);
    const problem = folderNameProblem(name, { siblings, caseInsensitive, current });
    if (problem) throw new LibraryError(400, problem.code, problem.message);
  }

  async function createFolder(parent, name) {
    const created = await historyIndex.runExclusive(async () => {
      const parentAbs = resolveFolder(parent);
      checkName(parentAbs, name);
      try { fs.mkdirSync(path.join(parentAbs, name)); } catch (error) { throw new LibraryError(409, failureCode(error)); }
      return { path: joinFolder(parent, name.normalize('NFC')) };
    });
    await rescan();
    historyIndex.emitChange('folders');
    return created;
  }

  async function renameFolder(folderPath, name) {
    const renamed = await historyIndex.runExclusive(async () => {
      const from = resolveFolder(folderPath, { allowRoot: false });
      const parentAbs = path.dirname(from);
      checkName(parentAbs, name, path.basename(from));
      const to = path.join(parentAbs, name);
      const nextPath = joinFolder(parentFolder(folderPath), name.normalize('NFC'));
      if (to === from) return { path: nextPath };
      try { fs.renameSync(from, to); } catch (error) { throw new LibraryError(409, failureCode(error)); }
      const jobsChanged = follow(prefixMap(from, to));
      for (const item of historyIndex.items) {
        if (item.folder === folderPath) item.folder = nextPath;
        else if (typeof item.folder === 'string' && item.folder.startsWith(`${folderPath}/`)) item.folder = nextPath + item.folder.slice(folderPath.length);
      }
      await finish('folders', jobsChanged);
      return { path: nextPath };
    });
    await rescan();
    return renamed;
  }

  /**
   * Deletes a folder. Empty: removed straight away. `keep`: its videos and other contents move up
   * to the parent (names that clash get a suffix), then the empty folder goes. `trash`: the folder
   * and everything in it go to the system Trash through the app's trash path.
   */
  async function deleteFolder(folderPath, mode) {
    const result = await historyIndex.runExclusive(async () => {
      const folder = resolveFolder(folderPath, { allowRoot: false });
      const parentAbs = path.dirname(folder);
      const parentPath = parentFolder(folderPath);
      const inside = (item) => item.folder === folderPath || (typeof item.folder === 'string' && item.folder.startsWith(`${folderPath}/`));
      const contents = fs.readdirSync(folder).filter((name) => !isJunkName(name));
      const removeEmpty = () => {
        for (const name of fs.readdirSync(folder)) if (isJunkName(name)) fs.rmSync(path.join(folder, name), { force: true, recursive: true });
        fs.rmdirSync(folder);
      };
      if (!contents.length) {
        try { removeEmpty(); } catch (error) { throw new LibraryError(409, failureCode(error)); }
        return { deleted: 'empty', moved: 0 };
      }
      if (mode === 'trash') {
        if (typeof onTrashFile !== 'function') throw new LibraryError(501, 'unavailable', 'Move to Trash is available in the desktop app');
        const trashed = historyIndex.items.filter(inside);
        try { await onTrashFile(folder); } catch (error) { throw new LibraryError(409, failureCode(error)); }
        historyIndex.items = historyIndex.items.filter((item) => !inside(item));
        for (const item of trashed) {
          historyIndex.removedPaths.set(path.resolve(item.absolutePath || path.join(downloadDir, item.relativePath)), Date.now());
          if (typeof onRemoveItem === 'function') await onRemoveItem(item).catch(() => {});
        }
        await finish('folders', false);
        return { deleted: 'trash', moved: trashed.filter((item) => !item.missing).length };
      }
      if (mode !== 'keep') throw new LibraryError(409, 'choose', 'Choose whether to keep the videos or move the folder to Trash');
      let jobsChanged = false;
      let moved = 0;
      try {
        // Videos first, so each keeps its subtitles and poster beside it.
        for (const item of historyIndex.items.filter((entry) => entry.folder === folderPath)) {
          if (item.missing) { item.folder = parentPath; continue; }
          const map = moveVideo(item, parentAbs);
          if (map) jobsChanged = follow(map) || jobsChanged;
          item.folder = parentPath;
          moved += 1;
        }
        // Then subfolders and files SnagThis didn't save.
        for (const name of fs.readdirSync(folder)) {
          if (isJunkName(name)) continue;
          const from = path.join(folder, name);
          const [free] = freeSuffix(parentAbs, [name], suffixed);
          const to = path.join(parentAbs, free);
          if (fs.lstatSync(from).isDirectory()) {
            moveDirectorySync(from, to);
            jobsChanged = follow(prefixMap(from, to)) || jobsChanged;
            const oldPath = joinFolder(folderPath, name);
            const newPath = joinFolder(parentPath, free);
            for (const item of historyIndex.items) {
              if (item.folder === oldPath) item.folder = newPath;
              else if (typeof item.folder === 'string' && item.folder.startsWith(`${oldPath}/`)) item.folder = newPath + item.folder.slice(oldPath.length);
            }
          } else {
            moveFileSync(from, to);
          }
        }
        removeEmpty();
      } catch (error) {
        await finish('folders', jobsChanged);
        const code = error instanceof LibraryError ? error.code : failureCode(error);
        throw new LibraryError(409, code);
      }
      await finish('folders', jobsChanged);
      return { deleted: 'keep', moved };
    });
    await rescan();
    return result;
  }

  /** Renames files in one directory as a set (`pairs` of [from, to] names), putting every one back if any fails. */
  function renameSet(directory, pairs) {
    const done = [];
    // Two steps, through names nobody uses, so a change of case or a swap never meets itself.
    const staged = pairs.filter(([from, to]) => from !== to).map(([from, to], index) => [from, `.snagthis-rename-${process.pid}-${Date.now()}-${index}`, to]);
    try {
      for (const [from, temp] of staged) { fs.renameSync(path.join(directory, from), path.join(directory, temp)); done.push([from, temp]); }
      for (const [, temp, to] of staged) {
        if (fs.existsSync(path.join(directory, to))) throw Object.assign(new Error('Name taken'), { code: 'EEXIST' });
        fs.renameSync(path.join(directory, temp), path.join(directory, to));
        const index = done.findIndex(([, name]) => name === temp);
        done[index] = [done[index][0], to];
      }
    } catch (error) {
      for (const [from, current] of done.reverse()) {
        try { fs.renameSync(path.join(directory, current), path.join(directory, from)); } catch (undoError) { logger.warn('Could not undo a partial rename', { code: undoError && undoError.code }); }
      }
      throw error;
    }
    return staged.map(([from, , to]) => [path.join(directory, from), path.join(directory, to)]);
  }

  /**
   * Renames a saved video on disk: its own folder, the video file and the side files that share
   * its name, together; a name in use gets ` (2)`. On any failure every file keeps its old name.
   */
  async function renameVideo(id, name) {
    if (typeof id !== 'string' || !id || id.length > 4096) throw new LibraryError(400, 'invalid-request', 'Choose the video to rename');
    const problem = videoNameProblem(name);
    if (problem) throw new LibraryError(400, problem.code, problem.message);
    const wanted = name.normalize('NFC');
    const result = await historyIndex.runExclusive(async () => {
      const item = historyIndex.findById(id);
      if (!item) throw new LibraryError(404, 'missing', 'Saved item not found');
      const source = historyIndex.resolveFilePath(item.id);
      if (!source || !fs.existsSync(source)) throw new LibraryError(409, 'missing');
      const file = path.resolve(source);
      const parent = path.dirname(file);
      const base = root();
      const parentInfo = readDirInfo(parent);
      const ownFolder = parent !== base && parent !== path.resolve(downloadDir) && isVideoFolder(path.basename(parent), parentInfo);
      const fileName = path.basename(file);
      const stem = stemOf(fileName);
      const job = item.jobId && jobs.get(item.jobId);
      // The files that carry the video's name: it, its subtitles and poster (not the job's `{id}-…` files).
      const named = [fileName, ...sideFilesOf(fileName, parentInfo.files, null)].filter((entry) => entry === fileName || entry.startsWith(`${stem}.`));
      const renamed = (entry, number) => {
        const next = number === 1 ? wanted : `${wanted} (${number})`;
        return `${next}${entry.slice(stem.length)}`;
      };
      const mine = new Set(named.map((entry) => entry.toLowerCase()));
      const freeIn = (directory, candidates, own) => candidates.every((candidate) => !fs.existsSync(path.join(directory, candidate)) || own.has(candidate.toLowerCase()));
      const pairs = [];
      try {
        if (ownFolder) {
          // The folder first (it may need a suffix), then the files inside it take the same name.
          const container = path.dirname(parent);
          const ownName = new Set([path.basename(parent).toLowerCase()]);
          let folderName = wanted;
          for (let number = 1; number <= 10_000; number += 1) {
            folderName = number === 1 ? wanted : `${wanted} (${number})`;
            if (freeIn(container, [folderName], ownName)) break;
          }
          const inside = named.map((entry) => [entry, renamed(entry, 1)]);
          const moved = renameSet(parent, inside);
          let target = parent;
          try {
            if (folderName !== path.basename(parent)) {
              [[, target]] = renameSet(container, [[path.basename(parent), folderName]]);
            }
          } catch (error) {
            renameSet(parent, inside.map(([from, to]) => [to, from]));
            throw error;
          }
          const byPath = new Map(moved.map(([from, to]) => [from, path.join(target, path.basename(to))]));
          const map = (value) => byPath.get(value) || (value === parent ? target : isInside(parent, value) ? path.join(target, path.relative(parent, value)) : null);
          pairs.push(map);
        } else {
          let targets = null;
          for (let number = 1; number <= 10_000 && !targets; number += 1) {
            const candidates = named.map((entry) => renamed(entry, number));
            if (freeIn(parent, candidates, mine)) targets = candidates;
          }
          if (!targets) throw Object.assign(new Error('Too many files with this name'), { code: 'EEXIST' });
          const moved = renameSet(parent, named.map((entry, index) => [entry, targets[index]]));
          pairs.push(exactMap(moved));
        }
      } catch (error) {
        const code = error instanceof LibraryError ? error.code : failureCode(error);
        logger.warn('Saved video could not be renamed', { code: error && error.code, reason: code });
        throw new LibraryError(409, code);
      }
      const jobsChanged = follow(pairs[0]);
      item.title = wanted;
      if (job) {
        job.title = wanted;
        job.manualTitleOverride = true;
        job.updatedAt = Date.now();
      }
      await finish('rename', jobsChanged || !!job);
      return { item: { ...item } };
    });
    await rescan();
    return result;
  }

  return { createFolder, renameFolder, deleteFolder, moveVideos, renameVideo, resolveFolder };
}

module.exports = { createLibraryFolders, LibraryError };
