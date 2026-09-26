// Node's CommonJS loader runs this file with `this` bound to the exports object;
// classic scripts bind the global object and ES modules leave it undefined. Avoiding
// the free `module` identifier keeps bundlers from wrapping the file in a CommonJS shim.
(function (node, factory) {
  if (node) Object.assign(node.exported, factory(node.strings));
  else globalThis.SnagThisRows = factory(globalThis.SnagThisStrings);
})(this && this !== globalThis ? { exported: this, strings: require('./strings') } : null, function (copy) {
  'use strict';
  if (!copy) throw new Error('Load SnagThis strings before rows');
  const text = copy.strings;
  const t = copy.interpolate;
  const finite = function (value) { return typeof value === 'number' && Number.isFinite(value); };
  const clampProgress = function (value) { return finite(value) ? Math.max(0, Math.min(100, value)) : 0; };

  function formatEta(seconds) {
    if (!finite(seconds) || seconds < 0) return '';
    if (seconds < 60) return text.underMinute;
    const minutes = Math.floor(seconds / 60);
    if (seconds < 3600) return t('minutesLeft', { m: minutes });
    return t('hoursLeft', { h: Math.floor(minutes / 60), m: minutes % 60 });
  }

  function formatSize(bytes, options) {
    if (!finite(bytes) || bytes < 0) return '';
    const size = bytes > 0 && bytes < 1e6 ? '<1 MB' : bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.round(bytes / 1e6) + ' MB';
    return options && options.estimated ? t('about', { size: size }) : size;
  }

  function formatDuration(seconds) {
    if (!finite(seconds) || seconds <= 0) return '';
    const total = Math.floor(seconds);
    const sec = String(total % 60).padStart(2, '0');
    const minutes = Math.floor(total / 60);
    return minutes < 60 ? minutes + ':' + sec : Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') + ':' + sec;
  }

  function formatQualityBadge(value) {
    const label = typeof value === 'string' ? value.trim() : '';
    const resolution = /^(\d+)[pi]$/i.exec(label) || /^\d+\s*[x×]\s*(\d+)$/i.exec(label);
    const tiers = {
      144: ['SD', 'Standard definition'], 240: ['SD', 'Standard definition'],
      360: ['SD', 'Standard definition'], 480: ['SD', 'Standard definition'], 576: ['SD', 'Standard definition'],
      720: ['HD', 'HD'], 1080: ['FHD', 'Full HD'], 1440: ['QHD', 'Quad HD'],
      2160: ['4K', '4K'], 4320: ['8K', '8K'],
    };
    const tier = resolution ? tiers[Number(resolution[1])] : null;
    return { tier: tier ? tier[0] : '', label: label, name: tier ? tier[1] : '' };
  }

  function formatWhen(value, now) {
    if (value === undefined || value === null || value === '') return '';
    const date = new Date(value);
    const today = new Date(now === undefined ? Date.now() : now);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(today.getTime())) return '';
    // Calendar days, rather than elapsed 24-hour blocks, preserve yesterday across DST.
    const dayNumber = function (d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };
    const days = dayNumber(today) - dayNumber(date);
    if (days <= 0) return text.today;
    if (days === 1) return text.yesterday;
    if (days < 7) return text.weekdays[date.getDay()];
    return date.getDate() + ' ' + text.months[date.getMonth()];
  }

  function classifyProblem(error, options) {
    const opts = options || {};
    const pct = Math.min(99, Math.floor(clampProgress(opts.progress)));
    const object = error && typeof error === 'object' ? error : {};
    const raw = typeof error === 'string' ? error : [object.code, object.message, object.statusCode, object.status, object.cause && (object.cause.code || object.cause.message)].filter(Boolean).join(' ');
    let code = 'unknown';
    if (/drm|widevine|fairplay|playready|sample-aes|unsupported|not supported|live.stream|live playlist/i.test(raw)) code = 'unsupported';
    else if (/\bsign[ -]?in\b|\blog[ -]?in required\b|\blogin_required\b|\bauthentication required\b|\bage[- ]restricted\b|\bconfirm your age\b/i.test(raw)) code = 'authentication';
    else if (/enospc|edquot|eacces|eperm|disk.full|not.enough.space|not.writable|permission.denied/i.test(raw)) code = 'disk';
    else if (/file.missing|output.missing|file.*(moved|deleted|not found)|enoent/i.test(raw)) code = 'missing';
    // A rendition whose own pieces are broken (5xx) or refused before anything
    // was saved (403 at 0%) is a dead quality on that CDN, not an expired link:
    // another quality can work. A 403 part-way through is still an expiry.
    else if (/variant_unavailable|quality.{0,12}unavailable/i.test(raw)
      || (/segment|piece/i.test(raw) && (/\b50[0-4]\b/.test(raw) || (/\b403\b/.test(raw) && pct < 1)))) code = 'quality';
    else if (/expired|source_expired|link_expired|\b410\b/i.test(raw) || /\b403\b/i.test(raw)) code = 'expired';
    else if (/network|connection|unreachable|retry|retries|exhausted|econn|enotfound|etimedout|eai_again|timeout|timed out|fetch failed/i.test(raw)) code = 'network';
    const keys = {
      authentication: ['signInRequired', 'details', 'details'],
      expired: ['expired', 'open-page', 'openPage'], network: ['connectionLost', 'retry', 'retry'],
      disk: ['diskFull', 'choose-folder', 'chooseFolder'], unsupported: ['unsupported', 'details', 'details'],
      missing: ['missing', 'locate', 'locate'], unknown: ['unknownProblem', 'retry', 'retry'],
      quality: ['qualityUnavailable', 'details', 'details'],
    }[code];
    const message = t(keys[0], { pct: pct, folder: opts.folder || text.saveFolder });
    return { code: code, message: message, action: { id: keys[1], label: text[keys[2]], style: 'bordered' }, raw: raw };
  }

  function toRowModel(input, options) {
    const item = input || {};
    const opts = options || {};
    if (item.queueStatus === 'cancelled') return null;
    const isHistory = opts.kind === 'history' || item.kind === 'history' || (!item.queueStatus && (item.fileName !== undefined || item.absolutePath !== undefined));
    const jobId = item.jobId || (!isHistory && item.queueStatus ? item.id : null);
    const id = jobId || item.id || item.url || item.fileName || '';
    const originalProgress = clampProgress(item.progress);
    const pct = Math.min(99, Math.floor(originalProgress));
    const isFinishing = item.queueStatus === 'downloading' && (originalProgress >= 100 || /remux|convert|verif|finaliz|merg|mux|preparing/i.test(item.status || ''));
    let state = 'detected';
    if (isHistory || item.queueStatus === 'completed') state = 'saved';
    else if (item.queueStatus === 'failed') state = 'problem';
    else if (item.queueStatus === 'paused') state = 'paused';
    else if (item.queueStatus === 'queued') state = 'waiting';
    else if (item.queueStatus === 'downloading') state = isFinishing ? 'finishing' : 'downloading';
    if (state === 'saved' && (item.fileExists === false || item.exists === false || item.missing === true)) state = 'missing';
    const reportedSize = isHistory ? item.sizeBytes : item.totalBytes ?? item.sizeBytes ?? item.estimatedSizeBytes;
    const sizeBytes = finite(reportedSize) && reportedSize > 0 ? reportedSize : undefined;
    const duration = item.durationSeconds ?? item.duration ?? (item.youtubeMetadata && item.youtubeMetadata.durationSeconds) ?? (item.tmdbMetadata && item.tmdbMetadata.runtime ? item.tmdbMetadata.runtime * 60 : null);
    const qualityHeight = item.height || item.resolutionHeight || (item.selection && item.selection.height);
    // The engine may start on a lower quality when the chosen one is dead on the CDN.
    const fallback = item.qualityFallback && finite(item.qualityFallback.to) && finite(item.qualityFallback.from) ? item.qualityFallback : null;
    const qualityNote = fallback ? t('qualityFallback', { to: fallback.to, from: fallback.from }) : '';
    const qualityLabel = fallback ? fallback.to + 'p' : qualityHeight ? qualityHeight + 'p' : (typeof item.resolution === 'string' ? item.resolution : '');
    let statusLine = '';
    let action = null;
    let problem = null;
    let tone = 'muted';
    switch (state) {
      case 'detected':
        statusLine = [qualityLabel, formatSize(sizeBytes)].filter(Boolean).join(' · ');
        action = { id: 'download', label: text.download, style: 'primary' };
        break;
      case 'waiting': statusLine = opts.firstQueuedId === id || opts.firstQueuedId === item.id ? text.waitingNext : text.waiting; break;
      case 'downloading':
        statusLine = [pct + '%', formatEta(item.etaSeconds), qualityNote].filter(Boolean).join(' · ');
        action = { id: 'pause', label: text.pause, style: 'icon' };
        break;
      case 'finishing': statusLine = text.finishing; break;
      case 'paused':
        statusLine = t('paused', { pct: pct });
        action = { id: 'resume', label: text.resume, style: 'icon' };
        break;
      case 'missing':
      case 'problem':
        problem = classifyProblem(state === 'missing' ? { code: 'FILE_MISSING' } : item.error, { progress: originalProgress, folder: opts.folder || item.outputDirectory || item.folder });
        statusLine = problem.message;
        action = problem.action;
        if (problem.code === 'expired' && opts.surface === 'popup') {
          // The popup is already on the video's page: a fresh play refreshes the link.
          statusLine = t('expiredOnPage', { pct: Math.min(99, Math.floor(originalProgress)) });
          action = { id: 'continue', label: text.download, style: 'primary' };
        }
        if (problem.code === 'authentication' && opts.surface === 'desktop') {
          try {
            const source = new URL(item.url || item.mediaUrl || item.sourcePageUrl);
            if (['http:', 'https:'].includes(source.protocol) && !source.username && !source.password && !source.port
              && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(source.hostname)) {
              action = { id: 'use-chrome-session', label: text.useChromeSession, style: 'bordered' };
            }
          } catch { /* Without a valid YouTube source, retain ordinary error details. */ }
        }
        tone = 'attention';
        break;
      case 'saved': {
        const when = formatWhen(item.completedAt ?? item.modifiedAt ?? item.updatedAt ?? item.createdAt, opts.now);
        statusLine = opts.surface === 'popup' ? [text.saved, qualityNote].filter(Boolean).join(' · ') : [when ? t('savedWhen', { when: when }) : text.saved, formatSize(sizeBytes), qualityNote].filter(Boolean).join(' · ');
        action = { id: 'play', label: text.play, style: opts.surface === 'popup' ? 'bordered' : 'icon' };
        if (opts.surface === 'popup') tone = 'success';
        break;
      }
    }
    const progress = state === 'saved' || state === 'missing' || state === 'detected' ? 100 : state === 'waiting' ? 0 : state === 'finishing' ? Math.max(97, originalProgress) : originalProgress;
    return {
      id: String(id), jobId: jobId ? String(jobId) : null,
      title: item.title || item.tmdbTitle || (item.youtubeMetadata && item.youtubeMetadata.title) || item.label || item.fileName || text.untitled,
      state: state, statusLine: statusLine, tone: tone, progress: progress, percent: pct,
      thumbnailUrl: (item.thumbnailUrls && item.thumbnailUrls[0]) || (item.youtubeMetadata && item.youtubeMetadata.thumbnailUrl) || item.thumbnailUrl || item.poster || null,
      durationLabel: formatDuration(duration), qualityLabel: qualityLabel, qualityNote: qualityNote, sizeLabel: formatSize(sizeBytes),
      action: action, problem: problem, source: item, isHistory: isHistory,
      fill: { percent: progress, dimmed: state === 'paused' || state === 'problem', scanLine: state === 'downloading' || state === 'finishing' },
    };
  }

  function mergeRows(queue, history, options) {
    const opts = options || {};
    const queued = Array.isArray(queue) ? queue : [];
    const saved = Array.isArray(history) ? history : [];
    const firstWaiting = queued.find(function (item) { return item.queueStatus === 'queued'; });
    const rowOptions = Object.assign({}, opts, { firstQueuedId: opts.firstQueuedId || (firstWaiting && firstWaiting.id) });
    const queueById = new Map(queued.map(function (item) { return [String(item.id), item]; }));
    const historyJobIds = new Set(saved.filter(function (item) { return item.jobId; }).map(function (item) { return String(item.jobId); }));
    const rows = [];
    const rowIds = new Set();
    queued.forEach(function (item) {
      if (item.queueStatus === 'completed' && historyJobIds.has(String(item.id))) return;
      const row = toRowModel(item, rowOptions);
      if (row) { rows.push(row); rowIds.add(row.id); }
    });
    const historyOptions = Object.assign({}, rowOptions, { kind: 'history' });
    saved.forEach(function (item) {
      const job = item.jobId && queueById.get(String(item.jobId));
      // A stale history entry must not conceal a currently active retry.
      if (job && job.queueStatus !== 'completed' && job.queueStatus !== 'cancelled') return;
      const row = toRowModel(item, historyOptions);
      if (row && !rowIds.has(row.id)) { rows.push(row); rowIds.add(row.id); }
    });
    const rank = { problem: 0, missing: 0, downloading: 1, finishing: 1, paused: 2, waiting: 3, detected: 3, saved: 4 };
    // The library refreshes this merge on every queue update; parse each saved date once.
    const savedTimes = new Map();
    const savedTime = function (row) {
      let time = savedTimes.get(row);
      if (time === undefined) {
        time = new Date(row.source.completedAt ?? row.source.modifiedAt ?? row.source.updatedAt ?? row.source.createdAt ?? 0).getTime();
        savedTimes.set(row, time);
      }
      return time;
    };
    rows.sort(function (a, b) {
      const byState = rank[a.state] - rank[b.state];
      if (byState) return byState;
      if (a.state === 'saved' && b.state === 'saved') return savedTime(b) - savedTime(a);
      return 0; // Stable sort retains queue order, including drag-reordered waiting jobs.
    });
    return rows;
  }

  return { toRowModel: toRowModel, formatEta: formatEta, formatSize: formatSize, formatWhen: formatWhen, formatDuration: formatDuration, formatQualityBadge: formatQualityBadge, classifyProblem: classifyProblem, mergeRows: mergeRows };
});
