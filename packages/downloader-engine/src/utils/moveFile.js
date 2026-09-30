const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const partialName = (targetPath) => path.join(
  path.dirname(targetPath),
  `.${path.basename(targetPath)}.${crypto.randomBytes(4).toString('hex')}.partial`,
);

// Copies one file, flushes it and checks its size. The copy keeps the source's
// modification time, which the library shows as the day a video was saved.
function copyVerifiedSync(sourcePath, targetPath) {
  const stat = fs.statSync(sourcePath);
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  const handle = fs.openSync(targetPath, 'r+');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  const copiedSize = fs.statSync(targetPath).size;
  if (copiedSize !== stat.size) {
    const error = new Error(`Copied file is incomplete (${copiedSize} of ${stat.size} bytes)`);
    error.code = 'EIO';
    throw error;
  }
  try { fs.utimesSync(targetPath, stat.atime, stat.mtime); } catch { /* Times are cosmetic. */ }
}

// Moves a file, including to another volume (external drive, NAS), where
// rename fails with EXDEV. The copy goes to a hidden temporary name in the
// target folder, is flushed and size-checked, and only then renamed into
// place. The source is removed last, so a failure at any step leaves the
// original file where it was.
function moveFileSync(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
  }

  const tempPath = partialName(targetPath);
  try {
    copyVerifiedSync(sourcePath, tempPath);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* Keep the original error. */ }
    throw error;
  }

  // The copy is complete at the target. A source that cannot be removed is
  // left behind rather than treating the move as failed.
  try {
    fs.unlinkSync(sourcePath);
  } catch { /* The saved copy is authoritative. */ }
}

function copyTreeSync(sourceDir, targetDir) {
  fs.mkdirSync(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyTreeSync(from, to);
    else if (entry.isFile()) copyVerifiedSync(from, to);
    // Links and devices are not copied across volumes; the source keeps them.
    else { const error = new Error(`Cannot copy ${entry.name}`); error.code = 'EPERM'; throw error; }
  }
}

// Moves a folder with everything in it. Same volume: one rename, so it either
// happens or not. Another volume: the whole tree is copied to a hidden folder
// beside the target and verified, renamed into place, and only then is the
// source removed. A failure before that point removes the partial copy and
// leaves the original folder untouched.
function moveDirectorySync(sourceDir, targetDir) {
  try {
    fs.renameSync(sourceDir, targetDir);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
  }
  const tempDir = partialName(targetDir);
  try {
    copyTreeSync(sourceDir, tempDir);
    fs.renameSync(tempDir, targetDir);
  } catch (error) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Keep the original error. */ }
    throw error;
  }
  try {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  } catch { /* The copy is authoritative; leftovers stay visible to the person. */ }
}

module.exports = { moveFileSync, moveDirectorySync };
