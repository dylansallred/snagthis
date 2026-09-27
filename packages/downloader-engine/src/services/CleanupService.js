const path = require('path');
const logger = require('../utils/logger');

function linkedJobId(name) {
  const modern = String(name).match(/-([a-z0-9]+-[a-z0-9]+)$/i);
  return modern ? modern[1] : String(name).match(/-([a-z0-9]+)$/i)?.[1];
}

async function cleanupOldSegmentFiles({ fsPromises, downloadDir, maxAgeHours, protectedJobIds }) {
  // Without queue ownership information, no temporary download is proven abandoned.
  if (!protectedJobIds) return;
  const protectedIds = new Set(protectedJobIds);
  const oldest = Date.now() - maxAgeHours * 60 * 60 * 1000;
  try {
    for (const item of await fsPromises.readdir(downloadDir, { withFileTypes: true })) {
      if (!item.isDirectory() || !item.name.startsWith('temp-')) continue;
      const owner = linkedJobId(item.name);
      if (!owner || protectedIds.has(owner)) continue;
      const target = path.join(downloadDir, item.name);
      const stats = await fsPromises.stat(target);
      if (stats.mtimeMs < oldest) await fsPromises.rm(target, { recursive: true, force: true });
    }
  } catch (error) {
    logger.warn('Could not clean abandoned temporary downloads', { error: error.message });
  }
}

// Kept for callers of the old scheduler API. Saved files are owned by the user;
// elapsed time is never permission to delete them, thumbnails, or subtitles.
async function cleanupOldCompletedFiles() {}

function startCleanupScheduler({ fsPromises, downloadDir, intervalMs, tempMaxAgeHours, getProtectedJobIds }) {
  const clean = () => cleanupOldSegmentFiles({
    fsPromises, downloadDir, maxAgeHours: tempMaxAgeHours,
    protectedJobIds: typeof getProtectedJobIds === 'function' ? getProtectedJobIds() : null,
  });
  clean();
  const timer = setInterval(clean, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { cleanupOldSegmentFiles, cleanupOldCompletedFiles, startCleanupScheduler };
