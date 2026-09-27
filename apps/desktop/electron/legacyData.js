const nodeFs = require('fs');
const path = require('path');

// Builds before the SnagThis rename kept data under the VidSnag name. The
// adoption below is safe to interrupt at any step and resumes on next launch:
//
// 1. A marker (migration.json, state "rewrite-pending") is written into the
//    legacy folder, so it travels with the data.
// 2. The legacy folder is renamed to the SnagThis folder. When that fails (for
//    example a Windows lock while VidSnag runs), nothing is created at the
//    SnagThis location and this session runs from the legacy folder; the next
//    launch tries again. Across devices the folder is copied, verified and
//    only then moved into place.
// 3. Absolute paths stored in the queue and history are rewritten. When that
//    fails, the marker stays "rewrite-pending" and the next launch retries.
const MIGRATION_MARKER = 'migration.json';
const REWRITTEN_FILES = [path.join('data', 'queue.json'), path.join('data', 'history-index.json')];

function readMarker(fs, directory) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(directory, MIGRATION_MARKER), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeFileDurableSync(fs, file, contents) {
  const temporaryPath = `${file}.tmp`;
  const handle = fs.openSync(temporaryPath, 'w', 0o600);
  try {
    fs.writeFileSync(handle, contents);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporaryPath, file);
}

function writeMarker(fs, directory, marker) {
  writeFileDurableSync(fs, path.join(directory, MIGRATION_MARKER), JSON.stringify({ version: 1, ...marker, updatedAt: Date.now() }));
}

function rewriteStoredPaths(fs, target, legacy) {
  const escaped = (directory) => JSON.stringify(directory + path.sep).slice(1, -1);
  const from = escaped(legacy);
  const to = escaped(target);
  for (const name of REWRITTEN_FILES) {
    const file = path.join(target, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(from)) continue;
    writeFileDurableSync(fs, file, text.split(from).join(to));
  }
}

function listTree(fs, root, relative = '', out = new Map()) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) listTree(fs, root, child, out);
    else if (entry.isFile()) out.set(child, fs.statSync(path.join(root, child)).size);
    else out.set(child, -1);
  }
  return out;
}

function copyVerified(fs, legacy, target) {
  const staging = `${target}.migrating`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    fs.cpSync(legacy, staging, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
    const source = listTree(fs, legacy);
    const copy = listTree(fs, staging);
    if (source.size !== copy.size || [...source].some(([name, size]) => copy.get(name) !== size)) {
      throw new Error('copied files do not match the original');
    }
    fs.renameSync(staging, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function completeRewrite(fs, target, legacy, log) {
  try {
    rewriteStoredPaths(fs, target, legacy);
    writeMarker(fs, target, { state: 'complete', legacy });
    return 'complete';
  } catch (error) {
    log(`Could not finish adopting earlier VidSnag data; will retry next launch: ${error.code || error.message}`);
    return 'rewrite-pending';
  }
}

// Returns the folder this session should use and the migration state.
function adoptLegacyUserData(target, legacy, { fs = nodeFs, log = console.warn } = {}) {
  try {
    if (fs.existsSync(target)) {
      const marker = readMarker(fs, target);
      if (marker && marker.state === 'rewrite-pending') {
        return { userData: target, state: completeRewrite(fs, target, typeof marker.legacy === 'string' ? marker.legacy : legacy, log) };
      }
      return { userData: target, state: marker ? String(marker.state) : 'none' };
    }
    if (!fs.existsSync(legacy)) return { userData: target, state: 'none' };

    try {
      writeMarker(fs, legacy, { state: 'rewrite-pending', legacy });
      fs.renameSync(legacy, target);
    } catch (error) {
      if (!error || error.code !== 'EXDEV') throw error;
      copyVerified(fs, legacy, target);
      try {
        fs.rmSync(legacy, { recursive: true, force: true });
      } catch (removeError) {
        log(`Adopted earlier VidSnag data; its original folder could not be removed: ${removeError.code || removeError.message}`);
      }
    }
    return { userData: target, state: completeRewrite(fs, target, legacy, log) };
  } catch (error) {
    // Leave the legacy folder as the only copy and use it for this session,
    // so no empty SnagThis folder blocks the next attempt.
    if (fs.existsSync(target)) return { userData: target, state: 'failed' };
    log(`Could not move earlier VidSnag data; using it in place and retrying next launch: ${error.code || error.message}`);
    return { userData: fs.existsSync(legacy) ? legacy : target, state: 'deferred' };
  }
}

module.exports = {
  adoptLegacyUserData,
  MIGRATION_MARKER,
};
