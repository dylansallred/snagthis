const path = require('path');

// Errors that usually clear on their own (antivirus, backup or sync tools
// holding the file, descriptor pressure). The file itself may be intact.
const TRANSIENT_READ_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE', 'EIO']);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function corruptCopyPath(filePath, now = Date.now()) {
  return `${filePath}.corrupt-${now}`;
}

// Reads a JSON state file without ever treating a damaged or unreadable file
// as "empty". Outcomes:
//   missing     - the file does not exist; the caller starts fresh.
//   loaded      - `data` holds the parsed, validated contents.
//   preserved   - the file could not be parsed or has an unsupported shape or
//                 version; it was renamed aside to `preservedPath` so a later
//                 write cannot destroy it.
//   unreadable  - reading kept failing (or the file could not be moved
//                 aside); the caller must not overwrite it this session.
async function readJsonState(fsPromises, filePath, options = {}) {
  const {
    validate = () => null,
    retries = 3,
    retryDelayMs = 100,
    logger = null,
    label = path.basename(filePath),
  } = options;

  let raw;
  for (let attempt = 0; ; attempt += 1) {
    try {
      raw = await fsPromises.readFile(filePath, 'utf8');
      break;
    } catch (error) {
      if (error && error.code === 'ENOENT') return { status: 'missing' };
      const transient = error && TRANSIENT_READ_CODES.has(error.code);
      if (transient && attempt < retries) {
        await delay(retryDelayMs * (attempt + 1));
        continue;
      }
      logger?.warn(`Could not read ${label}; keeping it untouched and not saving over it this session`, {
        code: error && error.code,
      });
      return { status: 'unreadable', code: error && error.code };
    }
  }

  let reason = null;
  let data;
  try {
    data = JSON.parse(raw);
    reason = validate(data);
  } catch {
    reason = 'invalid JSON';
  }
  if (!reason) return { status: 'loaded', data };

  const preservedPath = corruptCopyPath(filePath);
  try {
    await fsPromises.rename(filePath, preservedPath);
  } catch (error) {
    logger?.warn(`Could not set aside unreadable ${label}; keeping it untouched and not saving over it this session`, {
      reason,
      code: error && error.code,
    });
    return { status: 'unreadable', code: error && error.code, reason };
  }
  logger?.warn(`Set aside unreadable ${label} and started fresh`, {
    reason,
    preservedFile: path.basename(preservedPath),
  });
  return { status: 'preserved', preservedPath, reason };
}

async function syncDirectory(fsPromises, directory) {
  // Windows cannot open directories for fsync; the rename is still atomic there.
  let handle;
  try {
    handle = await fsPromises.open(directory, 'r');
    await handle.sync();
  } catch {
    // Best effort only.
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// Writes via a flushed temporary file and an atomic rename, then flushes the
// directory entry where the platform allows it, so a crash leaves either the
// previous complete file or the new complete file.
async function writeFileDurable(fsPromises, filePath, contents, { mode = 0o600 } = {}) {
  const temporaryPath = `${filePath}.tmp`;
  await fsPromises.writeFile(temporaryPath, contents, { encoding: 'utf8', mode, flush: true });
  await fsPromises.rename(temporaryPath, filePath);
  await syncDirectory(fsPromises, path.dirname(filePath));
}

module.exports = {
  TRANSIENT_READ_CODES,
  readJsonState,
  writeFileDurable,
  syncDirectory,
};
