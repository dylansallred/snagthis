const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

  const expectedSize = fs.statSync(sourcePath).size;
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomBytes(4).toString('hex')}.partial`,
  );
  try {
    fs.copyFileSync(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
    const handle = fs.openSync(tempPath, 'r+');
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    const copiedSize = fs.statSync(tempPath).size;
    if (copiedSize !== expectedSize) {
      const error = new Error(`Copied file is incomplete (${copiedSize} of ${expectedSize} bytes)`);
      error.code = 'EIO';
      throw error;
    }
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

module.exports = { moveFileSync };
