const fs = require('fs');
const path = require('path');
const { JOB_STORAGE_MARKER } = require('@m3u8/downloader-engine/src/core/JobStorage');
const { isInternalName } = require('@m3u8/contracts/src/library');

/*
 * How the save folder is laid out on disk, and how SnagThis tells its parts apart.
 *
 * - A *video folder* holds one saved video and its side files. New downloads get one each,
 *   named after the video and marked with `.snagthis-job.json`; older versions used the job ID
 *   (`mf3k2x1a-ab12cd`) or the title without a marker. A video folder moves as a unit.
 * - A *user folder* is any other folder the person made, here or in Finder/Explorer. Saved shows
 *   them as folders; a video lives in exactly one.
 * - A *loose video* sits straight in a user folder (or the save folder). It moves together with
 *   the files that share its name (subtitles, poster) and its job's `{id}-…` side files.
 */

const MEDIA_EXTENSIONS = new Set(['.mp4', '.ts', '.mkv', '.mov', '.webm', '.m4v', '.avi']);
// Operating-system clutter that never makes a folder "not empty".
const JUNK = /^(?:\.DS_Store|Thumbs\.db|ehthumbs\.db|desktop\.ini|\._.*|\.localized)$/i;

const isMediaName = (name) => MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase());
const isJunkName = (name) => JUNK.test(name);
const stemOf = (name) => name.slice(0, name.length - path.extname(name).length);
const normalizeStem = (value) => String(value).normalize('NFC').toLowerCase().replace(/ \(\d+\)$/, '').replace(/[^\p{L}\p{N}]+/gu, '');

/** Folders SnagThis never shows: hidden ones, its own scratch space and previews. */
function isSkippedDirName(name) {
  return !name || name.startsWith('.') || isInternalName(name) || /^\$RECYCLE\.BIN$|^System Volume Information$/i.test(name);
}

/** Job IDs are a base-36 timestamp and a short random part (createJobId). */
function looksLikeJobId(name) {
  const match = /^([a-z0-9]{7,10})-([a-z0-9]{1,8})$/i.exec(String(name || ''));
  if (!match) return false;
  const time = Number.parseInt(match[1], 36);
  return time > Date.UTC(2015, 0, 1) && time < Date.now() + 365 * 86_400_000;
}

/** What one directory holds: file names, subfolder names (visible ones) and the job marker. */
function readDirInfo(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const info = { files: [], dirs: [], hasMarker: false };
  for (const entry of entries) {
    if (entry.isDirectory()) { if (!isSkippedDirName(entry.name)) info.dirs.push(entry.name); continue; }
    if (!entry.isFile()) continue;
    if (entry.name === JOB_STORAGE_MARKER) info.hasMarker = true;
    else info.files.push(entry.name);
  }
  return info;
}

/** True when a directory is one video's own folder rather than a folder of videos. */
function isVideoFolder(name, info) {
  if (!info) return looksLikeJobId(name);
  if (info.hasMarker || looksLikeJobId(name)) return true;
  const stems = new Set(info.files.filter(isMediaName).map(stemOf));
  if (!stems.size) return false;
  // Title folders from before the marker: exactly one video named like its folder, nothing nested.
  return stems.size === 1 && info.dirs.length === 0 && normalizeStem([...stems][0]) === normalizeStem(name);
}

/** The side files that belong to a loose video: same name with another extension, or its job's `{id}-…` files. */
function sideFilesOf(fileName, names, jobId) {
  const stem = stemOf(fileName);
  const ext = path.extname(fileName).toLowerCase();
  return names.filter((name) => {
    if (name === fileName || isJunkName(name)) return false;
    const sameName = name.startsWith(`${stem}.`);
    const jobFile = !!jobId && name.startsWith(`${jobId}-`);
    if (!sameName && !jobFile) return false;
    if (!isMediaName(name)) return true;
    // The transport-stream twin of a remuxed MP4 is the same video.
    return ext === '.mp4' && name === `${stem}.ts`;
  });
}

/** `Name (2).ext`: the first free variant of a set of names that must all be free together. */
function freeSuffix(directory, names, rename) {
  for (let number = 1; number <= 10_000; number += 1) {
    const candidates = names.map((name) => rename(name, number));
    if (candidates.every((candidate) => !fs.existsSync(path.join(directory, candidate)))) return candidates;
  }
  const error = new Error('Too many files with this name');
  error.code = 'EEXIST';
  throw error;
}
const suffixed = (name, number) => {
  if (number === 1) return name;
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)} (${number})${ext}`;
};

function toPosix(value) { return String(value || '').split(path.sep).join('/'); }

/** A folder path from the interface (`Road trips/2024`) as segments, or null if it could escape. */
function folderSegments(value) {
  if (typeof value !== 'string') return null;
  if (!value) return [];
  if (value.includes('\\') || value.includes('\0') || value.length > 4096) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return parts;
}

module.exports = {
  MEDIA_EXTENSIONS, isMediaName, isJunkName, isSkippedDirName, looksLikeJobId, readDirInfo, isVideoFolder,
  sideFilesOf, freeSuffix, suffixed, stemOf, toPosix, folderSegments,
};
