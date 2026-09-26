const path = require('path');

// Containers SnagThis produces or accepts as saved media. Anything else (for
// example an executable named by a hostile URL) must never reach the disk
// under its own extension, because Open hands the file to the OS.
const MEDIA_FILE_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.ts', '.avi',
  '.m4a', '.mp3', '.aac', '.opus', '.ogg', '.wav', '.flac',
]);

function isMediaFileExtension(ext) {
  return MEDIA_FILE_EXTENSIONS.has(String(ext || '').toLowerCase());
}

function isMediaFilePath(filePath) {
  return typeof filePath === 'string' && isMediaFileExtension(path.extname(filePath));
}

function normalizeMediaExtension(ext, fallback = '.mp4') {
  const value = String(ext || '').toLowerCase();
  return isMediaFileExtension(value) ? value : fallback;
}

// Keeps a recognised media extension already present in the name, otherwise
// appends the fallback so "clip.exe" becomes "clip.exe.mp4".
function withMediaExtension(name, fallback) {
  const value = String(name || '');
  if (/\.m3u8$/i.test(value)) return value.replace(/\.m3u8$/i, fallback);
  return isMediaFileExtension(path.extname(value)) ? value : `${value}${fallback}`;
}

module.exports = { MEDIA_FILE_EXTENSIONS, isMediaFileExtension, isMediaFilePath, normalizeMediaExtension, withMediaExtension };
