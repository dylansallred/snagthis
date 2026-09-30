const fs = require('fs');
const os = require('os');
const path = require('path');
const { isCurrentPreviewClipPath } = require('@m3u8/downloader-engine/src/core/PreviewClip');
const { readJsonState, writeFileDurable } = require('@m3u8/downloader-engine/src/utils/durableJson');
const logger = require('../utils/logger');
const { compareSaved, isSort } = require('@m3u8/contracts/src/library');
const { isJunkName, isMediaName, isSkippedDirName, isVideoFolder, looksLikeJobId, stemOf } = require('./libraryLayout');
const { youtubeVideoIdOf, youtubeArtwork } = require('../utils/youtubeArtwork');
const { sourceInfoOf } = require('../utils/sourceInfo');
const {
  buildDownloadAssetUrl,
  decodeExternalDownloadPath,
  EXTERNAL_DOWNLOAD_PREFIX,
  normalizeRelativePath,
  resolveDownloadPath,
  toPosixPath,
} = require('../utils/downloadPaths');

const INDEX_VERSION = 2;
const DEFAULT_LIMIT = 200;
// A save folder chosen by mistake (a whole drive) must not stall every rescan.
const MAX_LIBRARY_DEPTH = 8;
const MAX_LIBRARY_ENTRIES = 50_000;
const HISTORY_MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.ts',
  '.mkv',
  '.mov',
  '.webm',
  '.m4v',
  '.avi',
]);

function validatePersistedIndex(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'not an index object';
  if (parsed.version !== INDEX_VERSION && parsed.version !== 1) return `unsupported version ${String(parsed.version).slice(0, 20)}`;
  if (!Array.isArray(parsed.items)) return 'missing items';
  return null;
}

const TERMINAL_STATUSES = new Set(['completed', 'completed-with-errors', 'failed', 'cancelled']);

function isVideoHistoryFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return HISTORY_MEDIA_EXTENSIONS.has(ext);
}

// Both preview collectors use mkdtemp('local-preview-'), whose six-character
// suffix distinguishes their scratch folders from ordinary movie folders.
function isLocalPreviewDirectory(name) {
  return /^local-preview-[A-Za-z0-9]{6}$/.test(name);
}

function isValidHistoryJobId(jobIdPrefix) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)?$/i.test(jobIdPrefix) && jobIdPrefix.length <= 80;
}

function extractHistoryJobId(fileName) {
  const name = String(fileName || '').trim().replace(/[.]part$/i, '');
  if (!name) return null;

  const modernMatch = name.match(/^([a-z0-9]+-[a-z0-9]+)-/i);
  if (modernMatch) {
    return modernMatch[1];
  }

  const legacyMatch = name.match(/^([a-z0-9]+)-/i);
  if (legacyMatch) {
    return legacyMatch[1];
  }

  return null;
}

function deriveLabel(fileName) {
  const dashIndex = fileName.indexOf('-');
  if (dashIndex > 0 && dashIndex < fileName.length - 1) {
    return fileName.slice(dashIndex + 1);
  }
  return fileName;
}

function safeParsePositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function encodeCursor(offset) {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const offset = Number.parseInt(decoded, 10);
    if (!Number.isFinite(offset) || offset < 0) return 0;
    return offset;
  } catch {
    return 0;
  }
}

function encodeHistoryItemId(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  return Buffer.from(source, 'utf8').toString('base64url');
}

function decodeHistoryItemId(value) {
  const encoded = String(value || '').trim();
  if (!encoded) return '';
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    return Buffer.from(decoded, 'utf8').toString('base64url') === encoded
      ? decoded
      : '';
  } catch {
    return '';
  }
}

function getHistoryItemLocator(item) {
  if (!item || typeof item !== 'object') return '';
  const absolutePath = typeof item.absolutePath === 'string' && item.absolutePath.trim()
    ? item.absolutePath.trim()
    : '';
  const safeRelativePath = normalizeRelativePath(item.relativePath || item.fileName);
  return absolutePath || safeRelativePath || String(item.fileName || '').trim();
}

function mergeHistoryItems(existingItem, incomingItem) {
  if (!existingItem) return incomingItem;
  if (!incomingItem) return existingItem;

  return {
    ...incomingItem,
    ...existingItem,
    id: existingItem.id || incomingItem.id,
    fileName: existingItem.fileName || incomingItem.fileName,
    relativePath: existingItem.relativePath || incomingItem.relativePath,
    absolutePath: existingItem.absolutePath || incomingItem.absolutePath,
    label: existingItem.label || incomingItem.label,
    jobId: existingItem.jobId || incomingItem.jobId,
    title: existingItem.title || incomingItem.title,
    sizeBytes: Number(existingItem.sizeBytes || incomingItem.sizeBytes || 0),
    modifiedAt: Math.max(Number(existingItem.modifiedAt || 0), Number(incomingItem.modifiedAt || 0)),
    ext: existingItem.ext || incomingItem.ext,
    thumbnailUrl: incomingItem.thumbnailUrl || existingItem.thumbnailUrl,
    tmdbReleaseDate: existingItem.tmdbReleaseDate || incomingItem.tmdbReleaseDate || null,
    tmdbMetadata: existingItem.tmdbMetadata || incomingItem.tmdbMetadata || null,
    youtubeMetadata: existingItem.youtubeMetadata || incomingItem.youtubeMetadata || null,
  };
}

function normalizeStoredItem(item) {
  if (!item || typeof item.fileName !== 'string') return null;
  const absolutePath = typeof item.absolutePath === 'string' && item.absolutePath.trim()
    ? item.absolutePath.trim()
    : null;
  const rawRelativePath = item.relativePath || item.fileName;
  const safeRelativePath = normalizeRelativePath(rawRelativePath);
  if (!safeRelativePath && !absolutePath) return null;
  const normalized = {
    ...item,
    fileName: path.basename(item.fileName),
    relativePath: safeRelativePath || item.fileName,
    absolutePath,
  };
  const storedId = typeof item.id === 'string' ? item.id.trim() : '';
  const decodedStoredId = storedId ? decodeHistoryItemId(storedId) : '';
  const nextId = decodedStoredId ? storedId : encodeHistoryItemId(getHistoryItemLocator(normalized));
  return {
    ...normalized,
    id: nextId,
  };
}

class HistoryIndexService {
  constructor(options = {}) {
    const {
      downloadDir,
      indexDir = downloadDir,
      fsPromises,
      jobs,
      onChange,
      minRefreshIntervalMs = 1_000,
      getLibraryRoot,
    } = options;

    if (!downloadDir) {
      throw new Error('HistoryIndexService requires downloadDir');
    }
    if (!fsPromises) {
      throw new Error('HistoryIndexService requires fsPromises');
    }

    this.downloadDir = downloadDir;
    // The save folder people see as Saved: Settings' "Save videos to", else the download folder.
    this.getLibraryRoot = typeof getLibraryRoot === 'function' ? getLibraryRoot : () => downloadDir;
    this.fsPromises = fsPromises;
    this.jobs = jobs || new Map();
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.minRefreshIntervalMs = Math.max(1_000, Number(minRefreshIntervalMs) || 5_000);
    this.indexFilePath = path.join(indexDir, 'history-index.json');
    this.legacyIndexFilePath = path.join(downloadDir, 'history-index.json');
    // Path -> time the user removed it. A file written there later (the same
    // title downloaded again) is a new item, not the removed one.
    this.removedPaths = new Map();
    this.items = [];
    this.lastRefreshAt = 0;
    this.lastSavedAt = 0;
    this.refreshInFlight = null;
    this.persistence = Promise.resolve();
    this.queuedPersist = null;
    // Set when the saved index exists but could not be read; it is never
    // overwritten in that session.
    this.persistBlocked = false;
    // Directory listings and existence answers gathered during one rescan.
    this.scanListing = null;
    this.scanExists = null;
    // Directory contents gathered during one rescan (see libraryLayout.readDirInfo).
    this.scanDirs = null;
    // User folders in the save folder, from the last rescan.
    this.folders = [];
    this.folderSignature = '';
    this.libraryRoot = path.resolve(downloadDir);
    // Folder operations run alone: a rescan never interleaves with a move.
    this.exclusive = null;
  }

  libraryRootPath() {
    const configured = String(this.getLibraryRoot() || '').trim();
    return path.resolve(configured && path.isAbsolute(configured) ? configured : this.downloadDir);
  }

  /** Runs `task` with rescans held back, after any rescan in progress has finished. */
  async runExclusive(task) {
    while (this.exclusive) await this.exclusive.catch(() => {});
    let release;
    this.exclusive = new Promise((resolve) => { release = resolve; });
    try {
      if (this.refreshInFlight) await this.refreshInFlight.catch(() => {});
      return await task();
    } finally {
      this.exclusive = null;
      release();
    }
  }

  async init() {
    await this.fsPromises.mkdir(this.downloadDir, { recursive: true });
    await this.fsPromises.mkdir(path.dirname(this.indexFilePath), { recursive: true });
    if (this.indexFilePath !== this.legacyIndexFilePath && fs.existsSync(this.legacyIndexFilePath)) {
      if (!fs.existsSync(this.indexFilePath)) await this.fsPromises.copyFile(this.legacyIndexFilePath, this.indexFilePath);
      await this.fsPromises.unlink(this.legacyIndexFilePath);
    }
    await this.loadPersistedIndex();
    await this.refreshFromDisk({ force: true });
  }

  async loadPersistedIndex() {
    this.items = [];
    const result = await readJsonState(this.fsPromises, this.indexFilePath, {
      validate: validatePersistedIndex,
      logger,
      label: 'history index',
    });
    if (result.status === 'unreadable') {
      // The saved index may be intact but locked. Rebuild the list from disk
      // for this session without replacing the file it could not read.
      this.persistBlocked = true;
      return;
    }
    if (result.status !== 'loaded') return;
    const parsed = result.data;
    const removedAt = parsed.removedAt && typeof parsed.removedAt === 'object' ? parsed.removedAt : {};
    const loadedAt = Date.now();
    this.removedPaths = new Map((Array.isArray(parsed.removedPaths) ? parsed.removedPaths : [])
      .filter((value) => typeof value === 'string')
      .map((value) => [value, Number(removedAt[value]) || loadedAt]));
    this.items = parsed.items
      .map(normalizeStoredItem)
      .filter(Boolean)
      .sort((a, b) => Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0));
  }

  serializeIndex() {
    const payload = {
      version: INDEX_VERSION,
      updatedAt: Date.now(),
      items: this.items,
      removedPaths: [...this.removedPaths.keys()],
      removedAt: Object.fromEntries(this.removedPaths),
    };
    return JSON.stringify(payload);
  }

  // Requests made while a write is pending share it. The write snapshots state
  // when it starts, so every caller's change is on disk once its promise settles.
  persistIndex() {
    if (!this.queuedPersist) {
      const persist = async () => {
        this.queuedPersist = null;
        if (this.persistBlocked) return;
        await writeFileDurable(this.fsPromises, this.indexFilePath, this.serializeIndex());
        this.lastSavedAt = Date.now();
      };
      this.queuedPersist = this.persistence.then(persist, persist);
      this.persistence = this.queuedPersist;
    }
    return this.queuedPersist;
  }

  // Rescans answer existence from the directory listings they just read, and
  // check any other path once per scan rather than once per item.
  pathExists(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    const listed = this.scanListing && this.scanListing.get(path.dirname(candidate));
    if (listed) return listed.has(path.basename(candidate));
    if (!this.scanExists) return fs.existsSync(candidate);
    let exists = this.scanExists.get(candidate);
    if (exists === undefined) {
      exists = fs.existsSync(candidate);
      this.scanExists.set(candidate, exists);
    }
    return exists;
  }

  toRelativePath(absolutePath) {
    if (typeof absolutePath !== 'string' || !absolutePath.trim()) return null;
    const rel = path.relative(this.downloadDir, absolutePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return toPosixPath(rel);
  }

  isInternalPreviewFile(absolutePath) {
    const relative = this.toRelativePath(absolutePath);
    return Boolean(relative && relative.split('/').slice(0, -1).some(isLocalPreviewDirectory));
  }

  buildActiveJobFiles() {
    const activeFiles = new Set();
    if (!this.jobs || typeof this.jobs.values !== 'function') {
      return activeFiles;
    }

    for (const job of this.jobs.values()) {
      if (!job) continue;
      const status = String(job.status || job.queueStatus || '');
      if (TERMINAL_STATUSES.has(status)) continue;

      if (job.filePath) {
        const rel = this.toRelativePath(job.filePath);
        if (rel) {
          activeFiles.add(rel);
          activeFiles.add(path.basename(rel));
        }
      }
      if (job.mp4Path) {
        const rel = this.toRelativePath(job.mp4Path);
        if (rel) {
          activeFiles.add(rel);
          activeFiles.add(path.basename(rel));
        }
      }
    }
    return activeFiles;
  }

  buildJobLookup() {
    const byFile = new Map();
    if (!this.jobs || typeof this.jobs.values !== 'function') {
      return byFile;
    }

    for (const job of this.jobs.values()) {
      if (!job) continue;
      for (const file of [job.filePath, job.mp4Path]) {
        if (typeof file !== 'string' || !file) continue;
        const rel = this.toRelativePath(file);
        if (rel) byFile.set(rel, job);
        // Finished downloads in a chosen save folder are found by their full path.
        byFile.set(path.resolve(file), job);
      }
    }
    return byFile;
  }

  async walkMediaFiles(currentDir = this.downloadDir, relativeDir = '', walk = null) {
    if (walk) {
      walk.entries += 1;
      if (walk.entries > MAX_LIBRARY_ENTRIES || walk.depth > MAX_LIBRARY_DEPTH) return [];
    }
    let entries;
    try {
      entries = await this.fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      // The download folder must be readable; a vanished or locked folder in the save folder is skipped.
      if (!walk) throw error;
      return [];
    }
    const files = [];
    if (this.scanListing) this.scanListing.set(currentDir, new Set(entries.filter((entry) => entry && !entry.isDirectory()).map((entry) => entry.name)));
    if (this.scanDirs) {
      const info = { files: [], dirs: [], hasMarker: false };
      for (const entry of entries) {
        if (!entry) continue;
        if (entry.isDirectory()) { if (!isSkippedDirName(entry.name)) info.dirs.push(entry.name); }
        else if (entry.isFile()) { if (entry.name === '.snagthis-job.json') info.hasMarker = true; else info.files.push(entry.name); }
      }
      this.scanDirs.set(currentDir, info);
    }

    for (const entry of entries) {
      if (!entry) continue;
      const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (isLocalPreviewDirectory(entry.name)
          || (!relativeDir && (entry.name.startsWith('temp-') || entry.name === '__previews'))) {
          continue;
        }
        if (walk && (isSkippedDirName(entry.name) || walk.skip.has(path.resolve(fullPath)))) continue;
        if (walk) walk.depth += 1;
        const nested = await this.walkMediaFiles(fullPath, childRelative, walk);
        if (walk) walk.depth -= 1;
        files.push(...nested);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!isVideoHistoryFile(entry.name)) continue;

      let stat = null;
      try {
        stat = await this.fsPromises.stat(fullPath);
      } catch {
        stat = null;
      }
      if (!stat) continue;

      files.push(walk ? {
        fullPath,
        absolutePath: fullPath,
        relativePath: this.toRelativePath(fullPath) || entry.name,
        fileName: entry.name,
        // Keep sibling checks (a .ts beside its .mp4) within this folder of the save folder.
        dirRelative: `library:${relativeDir}`,
        stat,
      } : {
        fullPath,
        relativePath: childRelative,
        fileName: entry.name,
        dirRelative: relativeDir,
        stat,
      });
    }

    return files;
  }

  /** The save folder's own videos, when it is not the download folder (walked separately). */
  async walkLibraryRoot(root) {
    const downloadRoot = path.resolve(this.downloadDir);
    if (root === downloadRoot) return [];
    const inside = path.relative(downloadRoot, root);
    if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) return [];
    try {
      const stat = await this.fsPromises.stat(root);
      if (!stat.isDirectory()) return [];
    } catch { return []; }
    const skip = new Set([downloadRoot, path.resolve(path.dirname(this.indexFilePath))]);
    return this.walkMediaFiles(root, '', { skip, entries: 0, depth: 0 });
  }

  /**
   * The user folder a file is in, as a path below the save folder ('' for the save folder itself
   * and for files kept elsewhere). A video's own folder is part of the video, not a user folder.
   * `previous` is the folder recorded before, used when a missing file's folder is gone.
   */
  folderOf(absolutePath, root, previous) {
    const relative = path.relative(root, path.resolve(absolutePath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
    const parts = relative.split(path.sep).slice(0, -1);
    const kept = [];
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      if (isSkippedDirName(parts[index])) break;
      const info = this.scanDirs ? this.scanDirs.get(current) : null;
      const last = index === parts.length - 1;
      const videoFolder = info ? isVideoFolder(parts[index], info)
        : last && (looksLikeJobId(parts[index]) || (typeof previous === 'string' && previous === kept.join('/')));
      if (videoFolder) break;
      kept.push(parts[index]);
    }
    return kept.join('/');
  }

  collectFolders(root) {
    const folders = [];
    if (!this.scanDirs) return folders;
    const visit = (directory, relative) => {
      const info = this.scanDirs.get(directory);
      if (!info) return;
      for (const name of [...info.dirs].sort((a, b) => a.localeCompare(b))) {
        const child = path.join(directory, name);
        const childInfo = this.scanDirs.get(child);
        if (!childInfo || isVideoFolder(name, childInfo)) continue;
        const childRelative = relative ? `${relative}/${name}` : name;
        folders.push({ path: childRelative, name, parent: relative, files: childInfo.files.filter((file) => !isJunkName(file)) });
        visit(child, childRelative);
      }
    };
    visit(root, '');
    return folders;
  }

  collectExternalJobMediaFiles() {
    const files = [];
    if (!this.jobs || typeof this.jobs.values !== 'function') {
      return files;
    }

    for (const job of this.jobs.values()) {
      if (!job) continue;
      const status = String(job.queueStatus || job.status || '').trim();
      if (!status || !TERMINAL_STATUSES.has(status)) continue;
      // Files inside the download folder are found by the directory walk.
      const internal = (value) => typeof value !== 'string' || !value.trim() || Boolean(this.toRelativePath(value));
      if (internal(job.mp4Path) && internal(job.filePath)) continue;

      const candidatePath = job.mp4Path && fs.existsSync(job.mp4Path) ? job.mp4Path : job.filePath;
      if (typeof candidatePath !== 'string' || !candidatePath.trim()) continue;
      if (!fs.existsSync(candidatePath)) continue;
      const relative = this.toRelativePath(candidatePath);
      if (relative) continue;

      try {
        const stat = fs.statSync(candidatePath);
        if (!stat.isFile()) continue;
        files.push({
          fullPath: candidatePath,
          absolutePath: candidatePath,
          relativePath: path.basename(candidatePath),
          fileName: path.basename(candidatePath),
          dirRelative: '',
          stat,
          job,
        });
      } catch {
        continue;
      }
    }

    return files;
  }

  collectPersistedExternalMediaFiles() {
    const files = [];
    const seen = new Set();

    for (const item of this.items) {
      if (!item || typeof item.absolutePath !== 'string' || !item.absolutePath.trim()) continue;
      const absolutePath = item.absolutePath.trim();
      const relative = this.toRelativePath(absolutePath);
      if (relative) continue;
      if (seen.has(absolutePath)) continue;
      if (!fs.existsSync(absolutePath)) continue;

      try {
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) continue;
        files.push({
          fullPath: absolutePath,
          absolutePath,
          relativePath: path.basename(absolutePath),
          fileName: path.basename(absolutePath),
          dirRelative: '',
          stat,
          persistedItem: item,
        });
        seen.add(absolutePath);
      } catch {
        continue;
      }
    }

    return files;
  }

  findThumbnailUrl({ validJobId, dirAbsolute, dirRelative, job, persistedItem }) {
    // Explicit selected artwork must survive refreshes even when an older
    // opening-frame or page thumbnail still exists beside the saved video.
    if (job && typeof job.thumbnailPath === 'string' && job.thumbnailPath.trim() && this.pathExists(job.thumbnailPath)) {
      const url = buildDownloadAssetUrl(this.downloadDir, job.thumbnailPath);
      if (url) return url;
    }

    if (job && Array.isArray(job.thumbnailPaths)) {
      for (const thumbPath of job.thumbnailPaths) {
        if (typeof thumbPath !== 'string') continue;
        if (!this.pathExists(thumbPath)) continue;
        const url = buildDownloadAssetUrl(this.downloadDir, thumbPath);
        if (url) return url;
      }
    }

    const persistedThumbCandidates = [];
    if (persistedItem && typeof persistedItem.thumbnailUrl === 'string') {
      persistedThumbCandidates.push(persistedItem.thumbnailUrl);
    }

    for (const candidate of persistedThumbCandidates) {
      const value = String(candidate || '').trim();
      if (!value) continue;
      if (/^https?:\/\//i.test(value)) {
        const artwork = youtubeArtwork(value, youtubeVideoIdOf(job) || youtubeVideoIdOf(persistedItem));
        if (artwork) return artwork;
        continue;
      }
      if (value.startsWith('/downloads/')) {
        const relative = value.slice('/downloads/'.length);
        const resolved = resolveDownloadPath(this.downloadDir, relative);
        if (resolved && this.pathExists(resolved)) {
          return `/downloads/${toPosixPath(relative)}`;
        }
      }
      if (value.startsWith(EXTERNAL_DOWNLOAD_PREFIX)) {
        const decoded = decodeExternalDownloadPath(value.slice(EXTERNAL_DOWNLOAD_PREFIX.length));
        if (decoded && this.pathExists(decoded)) {
          return value;
        }
      }
    }

    const localThumbCandidates = [];
    if (validJobId) localThumbCandidates.push(`${validJobId}-thumb.jpg`);
    if (job && typeof job.thumbnailPath === 'string' && job.thumbnailPath.trim()) {
      localThumbCandidates.push(path.basename(job.thumbnailPath));
    }
    for (const thumbName of localThumbCandidates) {
      const sameDirPath = path.join(dirAbsolute, thumbName);
      if (this.pathExists(sameDirPath)) {
        const url = buildDownloadAssetUrl(this.downloadDir, sameDirPath);
        if (url) return url;
      }
      const legacyPath = path.join(this.downloadDir, thumbName);
      if (this.pathExists(legacyPath)) return `/downloads/${thumbName}`;
    }

    if (
      job
      && Array.isArray(job.thumbnailUrls)
      && job.thumbnailUrls.length > 0
      && typeof job.thumbnailUrls[0] === 'string'
    ) {
      return youtubeArtwork(job.thumbnailUrls[0], youtubeVideoIdOf(job)) || null;
    }

    return null;
  }

  buildItem(mediaFile, filesByDir, activeJobFiles, jobLookup, persistedByPath) {
    const fileName = mediaFile.fileName;
    const relativePath = toPosixPath(mediaFile.relativePath);
    const ext = path.extname(fileName).toLowerCase();
    const dirRelative = mediaFile.dirRelative || '';
    const dirAbsolute = path.dirname(mediaFile.fullPath);

    if (ext === '.ts') {
      const mp4Variant = fileName.replace(/\.ts$/i, '.mp4');
      const siblingNames = filesByDir.get(dirRelative) || new Set();
      if (siblingNames.has(mp4Variant)) return null;
      if (activeJobFiles.has(relativePath) || activeJobFiles.has(fileName)) return null;
    }

    const extractedJobId = extractHistoryJobId(fileName);
    const validJobId = extractedJobId && isValidHistoryJobId(extractedJobId)
      ? extractedJobId
      : null;
    const persistedItem = mediaFile.persistedItem
      || (persistedByPath ? persistedByPath.get(mediaFile.fullPath) : this.items.find((item) => item.absolutePath === mediaFile.fullPath))
      || null;
    const job = mediaFile.job
      || jobLookup.get(relativePath)
      || jobLookup.get(path.resolve(mediaFile.fullPath))
      || (validJobId ? this.jobs.get(validJobId) : null)
      || null;
    const resolvedJobId = (job && job.id) || validJobId || null;

    if (resolvedJobId) {
      const associatedJob = this.jobs.get(resolvedJobId) || job;
      if (associatedJob) {
        const associatedStatus = String(associatedJob.queueStatus || associatedJob.status || '').trim();
        if (associatedStatus && !TERMINAL_STATUSES.has(associatedStatus)) {
          return null;
        }
      }
    }

    const thumbnailUrl = this.findThumbnailUrl({
      validJobId: resolvedJobId,
      dirAbsolute,
      dirRelative,
      job,
      persistedItem,
    });
    const previewClipPath = (job && job.previewClipPath) || (persistedItem && persistedItem.previewClipPath) || null;
    const previewClipUrl = isCurrentPreviewClipPath(previewClipPath) && this.pathExists(previewClipPath)
      ? buildDownloadAssetUrl(this.downloadDir, previewClipPath) : null;

    return {
      id: (persistedItem && persistedItem.id) || encodeHistoryItemId(mediaFile.absolutePath || relativePath),
      fileName,
      relativePath,
      absolutePath: mediaFile.absolutePath || mediaFile.fullPath,
      label: deriveLabel(fileName),
      jobId: resolvedJobId,
      title: (job && job.title) || (persistedItem && persistedItem.title) || null,
      sizeBytes: Number(mediaFile.stat.size || 0),
      modifiedAt: Number(mediaFile.stat.mtimeMs || Date.now()),
      ext,
      thumbnailUrl,
      previewClipPath,
      previewClipUrl,
      previewClipDurationSeconds: (job && job.previewClipDurationSeconds) || (persistedItem && persistedItem.previewClipDurationSeconds) || null,
      missing: false,
      sourcePageUrl: (job && job.sourcePageUrl) || (persistedItem && persistedItem.sourcePageUrl) || null,
      // Page title, site and channel; never request headers or cookies.
      sourceInfo: sourceInfoOf(job) || sourceInfoOf(persistedItem),
      // When the download finished; the file's modification time changes if it is touched later.
      completedAt: Number((job && job.completedAt) || (persistedItem && persistedItem.completedAt)) || null,
      selection: (job && job.selection) || (persistedItem && persistedItem.selection) || null,
      tmdbReleaseDate: (job && job.tmdbReleaseDate) || (persistedItem && persistedItem.tmdbReleaseDate) || null,
      tmdbMetadata: (job && job.tmdbMetadata) || (persistedItem && persistedItem.tmdbMetadata) || null,
      youtubeMetadata: (job && job.youtubeMetadata) || (persistedItem && persistedItem.youtubeMetadata) || null,
    };
  }

  static buildSignature(items) {
    return items
      .map((item) => `${item.absolutePath || item.relativePath || item.fileName}:${item.sizeBytes}:${item.modifiedAt}:${item.thumbnailUrl || ''}:${item.previewClipUrl || ''}:${item.missing ? 1 : 0}:${item.folder || ''}`)
      .join('|');
  }

  async refreshFromDisk(options = {}) {
    const force = Boolean(options.force);
    const now = Date.now();
    if (!force && now - this.lastRefreshAt < this.minRefreshIntervalMs) {
      return { changed: false, reason: 'throttled' };
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    // A folder operation in progress changes the files being scanned; rescan once it is done.
    while (this.exclusive) await this.exclusive.catch(() => {});
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      this.lastRefreshAt = Date.now();
      this.scanListing = new Map();
      this.scanExists = new Map();
      this.scanDirs = new Map();
      const root = this.libraryRootPath();

      const mediaFiles = await this.walkMediaFiles();
      mediaFiles.push(...await this.walkLibraryRoot(root));
      mediaFiles.push(...this.collectExternalJobMediaFiles());
      mediaFiles.push(...this.collectPersistedExternalMediaFiles());
      const filesByDir = new Map();
      for (const mediaFile of mediaFiles) {
        const key = mediaFile.dirRelative || '';
        if (!filesByDir.has(key)) {
          filesByDir.set(key, new Set());
        }
        filesByDir.get(key).add(mediaFile.fileName);
      }

      const activeJobFiles = this.buildActiveJobFiles();
      const jobLookup = this.buildJobLookup();

      // A tombstone only hides an existing file; a later file there is newer.
      for (const removedPath of [...this.removedPaths.keys()]) if (!this.pathExists(removedPath)) this.removedPaths.delete(removedPath);
      const persistedByPath = new Map();
      for (const item of this.items) if (item.absolutePath && !persistedByPath.has(item.absolutePath)) persistedByPath.set(item.absolutePath, item);
      const nextItemsByLocator = new Map();
      for (const mediaFile of mediaFiles) {
        const item = this.buildItem(mediaFile, filesByDir, activeJobFiles, jobLookup, persistedByPath);
        if (!item || (this.removedPaths.size > 0 && this.isRemoved(path.resolve(item.absolutePath || path.join(this.downloadDir, item.relativePath)), item.modifiedAt))) continue;

        const locator = getHistoryItemLocator(item);
        if (!locator) continue;

        const existing = nextItemsByLocator.get(locator);
        nextItemsByLocator.set(locator, mergeHistoryItems(existing, item));
      }

      // Keep records for moved/deleted files so the user can locate or remove them.
      for (const previous of this.items) {
        const locator = getHistoryItemLocator(previous);
        if (nextItemsByLocator.has(locator)) continue;
        const absolute = path.resolve(previous.absolutePath || path.join(this.downloadDir, previous.relativePath));
        // Old versions indexed copied init fragments as saved videos. Remove
        // those records, including already-cleaned scratch files, without
        // deleting files or weakening missing-file recovery for user media.
        if (this.isInternalPreviewFile(absolute)) continue;
        if (!this.removedPaths.has(absolute)) {
          nextItemsByLocator.set(locator, { ...previous, missing: !this.pathExists(absolute) });
        }
      }
      const nextItems = Array.from(nextItemsByLocator.values());
      // Identities start as the file's path. A video moved into a folder keeps its identity, so a
      // new file later saved at its old path needs one of its own.
      const owners = new Map(this.items.map((item) => [item.id, getHistoryItemLocator(item)]));
      const seenIds = new Set();
      for (const item of nextItems) {
        const locator = getHistoryItemLocator(item);
        const owner = owners.get(item.id);
        if (seenIds.has(item.id) || (owner && owner !== locator)) item.id = encodeHistoryItemId(`${locator}#${item.modifiedAt}#${seenIds.size}`);
        seenIds.add(item.id);
      }
      const previousFolders = new Map(this.items.map((item) => [getHistoryItemLocator(item), item.folder]));
      const folders = this.collectFolders(root);
      const folderPaths = new Set(folders.map((folder) => folder.path));
      for (const item of nextItems) {
        const previous = previousFolders.get(getHistoryItemLocator(item));
        // A missing file stays in the folder it was last seen in, while that folder exists.
        item.folder = item.missing && typeof previous === 'string'
          ? (folderPaths.has(previous) ? previous : '')
          : this.folderOf(item.absolutePath || path.join(this.downloadDir, item.relativePath), root, previous);
      }

      nextItems.sort((a, b) => Number(b.modifiedAt || 0) - Number(a.modifiedAt || 0));

      const folderSignature = `${root}\n${folders.map((folder) => `${folder.path}:${folder.files.join('/')}`).join('\n')}`;
      const foldersChanged = folderSignature !== this.folderSignature;
      this.folders = folders;
      this.folderSignature = folderSignature;
      this.libraryRoot = root;

      const currentSignature = HistoryIndexService.buildSignature(this.items);
      const nextSignature = HistoryIndexService.buildSignature(nextItems);

      if (currentSignature === nextSignature) {
        if (foldersChanged) this.emitChange('folders');
        return { changed: foldersChanged, reason: foldersChanged ? 'folders' : 'unchanged' };
      }

      this.items = nextItems;
      await this.persistIndex();
      this.emitChange('refresh');
      return { changed: true };
    })().finally(() => {
      this.scanListing = null;
      this.scanExists = null;
      this.scanDirs = null;
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  emitChange(reason) {
    if (!this.onChange) return;
    try {
      this.onChange({
        reason,
        changedAt: Date.now(),
        total: this.items.length,
      });
    } catch {
      // Ignore observer failures.
    }
  }

  async list(options = {}) {
    await this.refreshFromDisk({ force: this.items.length === 0 });

    const limit = safeParsePositiveInt(options.limit, DEFAULT_LIMIT, { min: 1, max: 1_000 });
    const offset = decodeCursor(options.cursor);
    const nextOffset = offset + limit;
    const query = String(options.q || '').trim().toLocaleLowerCase();
    // Search covers the whole library; otherwise a folder shows only its own videos.
    const folder = !query && typeof options.folder === 'string' ? options.folder : null;
    let matchingItems = query ? this.items.filter((item) => [item.title, item.label, item.fileName, item.sourcePageUrl].some((value) => String(value || '').toLocaleLowerCase().includes(query))) : this.items;
    if (folder !== null) matchingItems = matchingItems.filter((item) => (item.folder || '') === folder);
    if (isSort(options.sort) && options.sort !== 'newest') matchingItems = [...matchingItems].sort(compareSaved(options.sort));
    const slice = matchingItems.slice(offset, nextOffset);
    const nextCursor = nextOffset < matchingItems.length ? encodeCursor(nextOffset) : null;

    return {
      items: slice,
      total: matchingItems.length,
      nextCursor,
      // Finished downloads already in the library, wherever they are filed, so a list of one
      // folder never shows another folder's video again as its finished download.
      savedJobIds: [...new Set(this.items.map((item) => item.jobId).filter(Boolean))],
    };
  }

  findByFileName(fileName) {
    const safeName = path.basename(String(fileName || ''));
    if (!safeName) return null;
    return this.items.find((item) => item.fileName === safeName) || null;
  }

  findById(historyId) {
    const safeId = String(historyId || '').trim();
    if (!safeId) return null;

    const exact = this.items.find((item) => item.id === safeId);
    if (exact) return exact;

    const decoded = decodeHistoryItemId(safeId);
    if (!decoded) {
      return this.findByFileName(safeId);
    }

    const safeRelative = normalizeRelativePath(decoded);
    if (safeRelative) {
      const byRelative = this.items.find((item) => item.relativePath === safeRelative);
      if (byRelative) return byRelative;
    }

    const byAbsolute = this.items.find((item) => item.absolutePath === decoded);
    if (byAbsolute) return byAbsolute;

    return this.findByFileName(decoded);
  }

  resolveFilePath(historyId) {
    const item = this.findById(historyId);
    if (!item) return null;
    if (item.absolutePath) {
      return item.absolutePath;
    }
    const safeRelative = normalizeRelativePath(item.relativePath || item.fileName);
    if (!safeRelative) return null;
    const resolved = path.resolve(this.downloadDir, safeRelative);
    const relative = path.relative(this.downloadDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return resolved;
  }

  isRemoved(absolutePath, modifiedAt) {
    const removedAt = this.removedPaths.get(absolutePath);
    if (removedAt === undefined) return false;
    if (Number(modifiedAt) > removedAt) {
      this.removedPaths.delete(absolutePath);
      return false;
    }
    return true;
  }

  async removeById(historyId) {
    const item = this.findById(historyId);
    if (!item) return false;
    const before = this.items.length;
    this.removedPaths.set(path.resolve(item.absolutePath || path.join(this.downloadDir, item.relativePath)), Date.now());
    this.items = this.items.filter((candidate) => candidate.id !== item.id);
    if (this.items.length === before) return false;
    await this.persistIndex();
    this.emitChange('delete');
    return true;
  }

  async removeByFileNames(fileNames) {
    if (!Array.isArray(fileNames) || fileNames.length === 0) return 0;
    const safeNames = new Set(fileNames.map((name) => path.basename(String(name || ''))).filter(Boolean));
    if (safeNames.size === 0) return 0;
    const before = this.items.length;
    this.items = this.items.filter((item) => !safeNames.has(item.fileName));
    const removed = before - this.items.length;
    if (removed > 0) {
      await this.persistIndex();
      this.emitChange('delete-many');
    }
    return removed;
  }

  async locateById(historyId, selectedPath) {
    const item = this.findById(historyId);
    if (!item) return null;
    const previousPath = item.absolutePath || path.join(this.downloadDir, item.relativePath);
    this.removedPaths.set(path.resolve(previousPath), Date.now());
    this.removedPaths.delete(path.resolve(selectedPath));
    const stat = await this.fsPromises.stat(selectedPath);
    Object.assign(item, {
      absolutePath: path.resolve(selectedPath),
      relativePath: this.toRelativePath(selectedPath) || path.basename(selectedPath),
      fileName: path.basename(selectedPath),
      sizeBytes: stat.size, missing: false,
      previewClipPath: null, previewClipUrl: null, previewClipDurationSeconds: null,
    });
    await this.persistIndex();
    this.emitChange('locate');
    return item;
  }

  /**
   * The save folder and its user folders for Saved: each with its videos (counted through
   * subfolders), their size, and files SnagThis didn't save.
   */
  async library() {
    await this.refreshFromDisk({ force: this.items.length === 0 });
    const root = this.libraryRoot;
    const byPath = new Map(this.folders.map((folder) => [folder.path, {
      path: folder.path, name: folder.name, parent: folder.parent,
      videoCount: 0, sizeBytes: 0, otherFiles: [],
    }]));
    const chain = (folder, visit) => {
      for (let current = folder; current; current = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '') {
        const entry = byPath.get(current);
        if (entry) visit(entry);
      }
    };
    for (const item of this.items) {
      if (item.missing || !item.folder) continue;
      chain(item.folder, (entry) => {
        entry.videoCount += 1;
        entry.sizeBytes += Number(item.sizeBytes) || 0;
      });
    }
    for (const folder of this.folders) {
      const stems = folder.files.filter(isMediaName).map(stemOf);
      const others = folder.files.filter((name) => !isMediaName(name) && !stems.some((stem) => name.startsWith(`${stem}.`)) && !/^[a-z0-9]{7,10}-[a-z0-9]{1,8}-/i.test(name));
      if (others.length) chain(folder.path, (entry) => { entry.otherFiles.push(...others); });
    }
    const home = os.homedir();
    const relativeHome = path.relative(home, root);
    const displayPath = home && relativeHome && !relativeHome.startsWith('..') && !path.isAbsolute(relativeHome)
      ? `~/${relativeHome.split(path.sep).join('/')}` : root;
    return {
      root: { name: root === path.resolve(this.downloadDir) ? 'SnagThis' : path.basename(root) || root, path: root, displayPath },
      folders: [...byPath.values()].map((entry) => ({ ...entry, otherFiles: { count: entry.otherFiles.length, names: entry.otherFiles.slice(0, 3) } })),
    };
  }

  async clear() {
    if (this.items.length === 0) return;
    for (const item of this.items) this.removedPaths.set(path.resolve(item.absolutePath || path.join(this.downloadDir, item.relativePath)), Date.now());
    this.items = [];
    await this.persistIndex();
    this.emitChange('clear');
  }
}

module.exports = {
  HistoryIndexService,
  decodeHistoryItemId,
  encodeHistoryItemId,
};
