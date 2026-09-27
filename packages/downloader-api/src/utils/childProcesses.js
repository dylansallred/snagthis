// Re-exported so the desktop main process can stop the engine's yt-dlp and
// FFmpeg children on exit through its declared @m3u8/downloader-api dependency.
const { killTrackedChildProcesses } = require('@m3u8/downloader-engine/src/core/ProcessTermination');

module.exports = { killTrackedChildProcesses };
