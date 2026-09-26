const fs = require('fs');
const path = require('path');
const { isAccent, isAccentTimestamp } = require('@m3u8/contracts');

const DEFAULTS = Object.freeze({
  queueMaxConcurrent: 1,
  queueAutoStart: true,
  checkUpdatesOnStartup: true,
  outputDirectory: '',
  tmdbApiKey: '',
  subdlApiKey: '',
  downloadThreads: 8,
  preferredQuality: 'best',
  subtitleLanguage: 'none',
  notifyOnComplete: true,
  launchAtLogin: false,
  fileNaming: 'title',
  customFilename: '',
  // Shared with the Chrome extension; the later change wins (see write()).
  accent: 'orange',
  accentChangedAt: 0,
});

function validatePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object');
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown setting: ${key}`);
    if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Invalid setting: ${key}`);
    } else if (key === 'accentChangedAt') {
      if (!isAccentTimestamp(value)) throw new Error('Invalid accent time');
    } else if (key === 'queueMaxConcurrent' || key === 'downloadThreads') {
      if (!Number.isInteger(value) || value < 1 || value > (key === 'downloadThreads' ? 64 : 16)) throw new Error(`Invalid setting: ${key}`);
    } else if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) {
      throw new Error(`Invalid setting: ${key}`);
    }
    if (key === 'preferredQuality' && !['best', '1080', '720', '480'].includes(value)) throw new Error('Invalid preferred quality');
    if (key === 'accent' && !isAccent(value)) throw new Error('Invalid accent colour');
    if (key === 'fileNaming' && !['title', 'resource', 'custom'].includes(value)) throw new Error('Invalid file naming');
    if (key === 'subtitleLanguage' && !/^(?:none|[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*)$/.test(value)) throw new Error('Invalid subtitle language');
    if (key === 'outputDirectory' && value && !path.isAbsolute(value)) throw new Error('Save folder must be an absolute path');
    if (key === 'customFilename' && /[/\\]/.test(value)) throw new Error('Custom name cannot contain path separators');
    patch[key] = value;
  }
  return patch;
}

function read(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { ...DEFAULTS }; }
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.hasOwn(parsed || {}, key)) continue;
    try { Object.assign(settings, validatePatch({ [key]: parsed[key] })); } catch { /* Use the default for an invalid persisted value. */ }
  }
  return settings;
}

/**
 * An accent choice carries when it was made; one older than the saved choice (an offline
 * Chrome change that lost to a later desktop change) is ignored. A time without a choice is ignored.
 */
function resolveAccent(current, patch) {
  const next = { ...patch };
  if (!('accent' in next)) { delete next.accentChangedAt; return next; }
  if (!('accentChangedAt' in next)) next.accentChangedAt = Math.max(Date.now(), current.accentChangedAt + 1);
  if (next.accentChangedAt < current.accentChangedAt) { delete next.accent; delete next.accentChangedAt; }
  return next;
}

function write(file, patch) {
  const current = read(file);
  const settings = { ...current, ...resolveAccent(current, validatePatch(patch)) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Already renamed. */ }
  }
  return settings;
}

module.exports = { DEFAULTS, read, write, validatePatch };
