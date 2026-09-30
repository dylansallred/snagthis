const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/*
 * Moves run on the app's main process, so every step is asynchronous: a copy to an external
 * drive can take many seconds per gigabyte, and the interface, the local API and download
 * progress must keep going meanwhile. fs.promises.copyFile runs in libuv's thread pool (using
 * the system's copy call), never on the event loop. `fs.promises` is read at call time so tests
 * can model another volume.
 */

const partialName = (targetPath) => path.join(
  path.dirname(targetPath),
  `.${path.basename(targetPath)}.${crypto.randomBytes(4).toString('hex')}.partial`,
);

// Copies one file, flushes it and checks its size. The copy keeps the source's
// modification time, which the library shows as the day a video was saved.
async function copyVerified(sourcePath, targetPath) {
  const fsp = fs.promises;
  const stat = await fsp.stat(sourcePath);
  await fsp.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  const handle = await fsp.open(targetPath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const copiedSize = (await fsp.stat(targetPath)).size;
  if (copiedSize !== stat.size) {
    const error = new Error(`Copied file is incomplete (${copiedSize} of ${stat.size} bytes)`);
    error.code = 'EIO';
    throw error;
  }
  try { await fsp.utimes(targetPath, stat.atime, stat.mtime); } catch { /* Times are cosmetic. */ }
}

// Moves a file, including to another volume (external drive, NAS), where
// rename fails with EXDEV. The copy goes to a hidden temporary name in the
// target folder, is flushed and size-checked, and only then renamed into
// place. The source is removed last, so a failure at any step leaves the
// original file where it was.
async function moveFile(sourcePath, targetPath) {
  const fsp = fs.promises;
  try {
    await fsp.rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
  }

  const tempPath = partialName(targetPath);
  try {
    await copyVerified(sourcePath, tempPath);
    await fsp.rename(tempPath, targetPath);
  } catch (error) {
    try { await fsp.rm(tempPath, { force: true }); } catch { /* Keep the original error. */ }
    throw error;
  }

  // The copy is complete at the target. A source that cannot be removed is
  // left behind rather than treating the move as failed.
  try {
    await fsp.unlink(sourcePath);
  } catch { /* The saved copy is authoritative. */ }
}

async function copyTree(sourceDir, targetDir) {
  const fsp = fs.promises;
  await fsp.mkdir(targetDir);
  for (const entry of await fsp.readdir(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyVerified(from, to);
    // Links and devices are not copied across volumes; the source keeps them.
    else { const error = new Error(`Cannot copy ${entry.name}`); error.code = 'EPERM'; throw error; }
  }
}

// Moves a folder with everything in it. Same volume: one rename, so it either
// happens or not. Another volume: the whole tree is copied to a hidden folder
// beside the target and verified, renamed into place, and only then is the
// source removed. A failure before that point removes the partial copy and
// leaves the original folder untouched.
async function moveDirectory(sourceDir, targetDir) {
  const fsp = fs.promises;
  try {
    await fsp.rename(sourceDir, targetDir);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
  }
  const tempDir = partialName(targetDir);
  try {
    await copyTree(sourceDir, tempDir);
    await fsp.rename(tempDir, targetDir);
  } catch (error) {
    try { await fsp.rm(tempDir, { recursive: true, force: true }); } catch { /* Keep the original error. */ }
    throw error;
  }
  try {
    await fsp.rm(sourceDir, { recursive: true, force: true });
  } catch { /* The copy is authoritative; leftovers stay visible to the person. */ }
}

module.exports = { moveFile, moveDirectory };
