const fs = require('node:fs');
const path = require('node:path');

const JOB_STORAGE_MARKER = '.vidsnag-job.json';

function sanitizeJobFolderName(title) {
  let name = String(title || 'Download').normalize('NFC')
    .replace(/\.(?:mp4|mkv|webm|m3u8|ts|m4v|mov|avi|wmv|flv|m4a|mp3|aac|ogg|opus)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').trim() || 'Download';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || /^temp-|^__previews$/i.test(name)) name = `Video ${name}`;
  // Leave room for the collision suffix and stay below byte-based filesystem limits.
  let bounded = '';
  for (const character of name) {
    if (Buffer.byteLength(bounded + character, 'utf8') > 180) break;
    bounded += character;
  }
  return bounded.replace(/[. ]+$/g, '') || 'Download';
}

function hasJobStorageMarker(directory, jobId) {
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const marker = path.join(directory, JOB_STORAGE_MARKER);
    const markerStat = fs.lstatSync(marker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 4096) return false;
    const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
    return owner.version === 1 && owner.jobId === String(jobId);
  } catch { return false; }
}

function isOwnedJobStorageDir(root, jobId, directory) {
  if (!root || !jobId || !directory) return false;
  const target = path.resolve(directory);
  if (path.dirname(target) !== path.resolve(root)) return false;
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  } catch { return false; }
  return path.basename(target) === String(jobId) || hasJobStorageMarker(target, jobId);
}

function allocateJobStorageDir(root, jobId, title) {
  if (!root || !jobId) throw new Error('A download folder requires a root and job ID');
  const parent = path.resolve(root);
  fs.mkdirSync(parent, { recursive: true });
  const base = sanitizeJobFolderName(title);
  for (let number = 1; number <= 10000; number += 1) {
    const directory = path.join(parent, number === 1 ? base : `${base} (${number})`);
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try {
      fs.writeFileSync(path.join(directory, JOB_STORAGE_MARKER), JSON.stringify({ version: 1, jobId: String(jobId) }), { flag: 'wx', mode: 0o600 });
      return directory;
    } catch (error) {
      try { fs.rmdirSync(directory); } catch { /* Never remove content another writer placed here. */ }
      throw error;
    }
  }
  throw new Error('Too many downloads already use this folder name');
}

module.exports = { allocateJobStorageDir, sanitizeJobFolderName, isOwnedJobStorageDir, hasJobStorageMarker, JOB_STORAGE_MARKER };
