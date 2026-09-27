// Shared by the engine and bridge loggers. Media URLs are often signed, so
// logs keep only origin and path; credential-bearing fields are dropped.
const SECRET_KEY = /(?:authorization|cookie|password|secret|token|headers|signature|api.?key)/i;
const MAX_DEPTH = 8;

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return value; }
}

// System errors (ENOSPC, EACCES, ffmpeg output) name absolute local paths,
// which reveal the user name and folder layout. Public payloads keep only the
// file name. Quoted paths may contain spaces; a bare path continues across a
// space only while the next word still contains a folder separator.
const QUOTED_PATH = /(['"])((?:\/|[A-Za-z]:[\\/]|\\\\)[^'"\r\n]*)\1/g;
const BARE_PATH = /(^|[\s(=,:])((?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)(?:[^\s'"()<>,]|[ \t](?=[^\s'"()<>,\\/]*[\\/]))*)/g;

function lastSegment(filePath) {
  const parts = String(filePath).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function redactPaths(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .replace(QUOTED_PATH, (match, quote, filePath) => `${quote}${lastSegment(filePath)}${quote}`)
    .replace(BARE_PATH, (match, lead, filePath) => {
      const name = lastSegment(filePath);
      return `${lead}${name || '[path]'}`;
    });
}

function redact(value, key = '', depth = 0) {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    return value.replace(/https?:\/\/[^\s"'<>]+/g, redactUrl)
      .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]');
  }
  if (depth >= MAX_DEPTH) return '[truncated]';
  // Error fields are not enumerable; keep the useful parts instead of {}.
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), ...(value.code ? { code: value.code } : {}) };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name, depth + 1)]));
  }
  return value;
}

module.exports = { redact, redactUrl, redactPaths, SECRET_KEY };
