const fs = require('fs');

// Picks the first bundled tool that exists. A binary that is already
// executable is used as is: an app installed by an administrator or mounted
// read-only cannot be chmod-ed by the user (EPERM/EROFS), and that must not
// hide a tool that runs fine. Only a binary that is not executable is
// chmod-ed; if that fails it is still kept as a last resort so the real
// spawn error is reported instead of silently using another yt-dlp/FFmpeg.
function findBundledExecutable(candidates, { fsModule = fs, platform = process.platform } = {}) {
  let reserve = '';
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (!fsModule.existsSync(candidate)) continue;
    } catch {
      continue;
    }
    if (platform === 'win32') return candidate;
    try {
      fsModule.accessSync(candidate, fsModule.constants.X_OK);
      return candidate;
    } catch { /* Not executable yet. */ }
    try {
      fsModule.chmodSync(candidate, 0o755);
      return candidate;
    } catch {
      reserve ||= candidate;
    }
  }
  return reserve;
}

module.exports = { findBundledExecutable };
