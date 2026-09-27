// The bridge and engine share one logger so a single transport owns each log
// file; two writers rotating the same file would lose or duplicate lines.
module.exports = require('@m3u8/downloader-engine/src/utils/logger');
