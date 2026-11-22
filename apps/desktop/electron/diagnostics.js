const PRIVATE_KEY = /auth|cookie|token|secret|password|api.?key|credential|referer|origin|source|url|path|directory|filename|title|headers|signature|customFilename|libraryViews/i;

function redactString(value, secrets) {
  let text = value.replace(/(?:https?|wss?|file|snagthis):\/\/[^\s<>"']+/gi, '[redacted URL]')
    .replace(/(?:Bearer|Basic)\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(?:authorization|cookie|token|secret|password|api[_-]?key)\s*[:=]\s*[^\r\n]+/gi, '[redacted credential]')
    .replace(/(?:\/(?:Users|home|private|tmp|var\/folders|Volumes)\/|[a-z]:[\\/]|\\\\)[^\r\n"']*/gi, '[redacted path]');
  for (const secret of secrets.filter((item) => typeof item === 'string' && item.length >= 4)) text = text.split(secret).join('[redacted]');
  return text.slice(0, 20000);
}

function redact(value, secrets = [], key = '', depth = 0) {
  if (PRIVATE_KEY.test(key)) return '[redacted]';
  if (depth > 12) return '[omitted]';
  if (typeof value === 'string') return redactString(value, secrets);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(String(value.message || ''), secrets),
      ...(value.code ? { code: value.code } : {}),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, secrets, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([name, item]) => [
      redactString(name, secrets),
      redact(item, secrets, name, depth + 1),
    ]));
  }
  return value;
}

function queueSummary(queue) {
  const items = Array.isArray(queue) ? queue : (Array.isArray(queue?.jobs) ? queue.jobs : []);
  const states = {};
  for (const item of items) {
    const status = String(item.queueStatus || item.status || 'unknown');
    const safeStatus = /^(queued|preparing|downloading|paused|converting|completed|completed-with-errors|failed|cancelled)$/.test(status) ? status : 'other';
    states[safeStatus] = (states[safeStatus] || 0) + 1;
  }
  return { count: items.length, states };
}

module.exports = { redact, queueSummary };
