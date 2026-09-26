/* Direct-file capability and Chrome-owned transfers. Never persist source URLs or request headers. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnagThisBrowserDownloads = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const RECORD_PREFIX = 'snagthis:browser-download:';
  const SAFE_DANGER = new Set(['safe', 'accepted', 'allowlistedByPolicy', 'deepScannedSafe']);
  function httpUrl(value) {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function processingRequested(item) {
    const selected = item?.selection || {};
    return Boolean(item?.audioOnly || selected.audioOnly || selected.audioLang
      || (selected.subtitleLang && selected.subtitleLang !== 'none')
      || (item?.subtitleLang && item.subtitleLang !== 'none'));
  }
  function componentUrls(items) {
    return new Set(items.flatMap(item => [
      ...(item.manifest?.segmentUrls || []), ...(item.manifest?.initializationUrls || []),
      ...(item.manifest?.audio || []).map(track => track.url), ...(item.manifest?.subtitles || []).map(track => track.url),
      ...(item.audio || []).map(track => track.url), ...(item.subtitles || []).map(track => track.url),
    ]).filter(Boolean));
  }
  function directExtension(item) {
    const url = httpUrl(item?.url);
    if (!url || item.manifest || processingRequested(item)) return '';
    if ((item.type && item.type !== 'file') || (item.mediaKind && item.mediaKind !== 'video')
      || item.streamType || item.isFragment || item.isSegment || item.isInitialization || item.hasAudio === false) return '';
    const parsed = new URL(url);
    if (/(^|\.)(?:youtube\.com|youtu\.be|googlevideo\.com)$/.test(parsed.hostname)) return '';
    let filename;
    try { filename = decodeURIComponent(parsed.pathname.split('/').pop() || ''); } catch { return ''; }
    if (/\.(?:m3u8|mpd|ts|m4s|m4f|cmfa|cmfv|vtt|srt|m4a|mp3|aac|ogg|wav|mov|mkv|avi|flv|ogv)$/i.test(filename)) return '';
    if (/(?:^|[._-])(?:init(?:ialization)?|segment|fragment|chunk|audio)(?:[._-]|\d|$)/i.test(filename)
      || /(?:video[._-]?only|video[._-]?track|track[._-]?video)/i.test(filename)) return '';
    const declaredMime = String(item.contentType || '').split(';')[0].trim().toLowerCase();
    // A <video> without a declared type is a DOM hint, not a response MIME.
    const mime = declaredMime === 'video/unknown' ? '' : declaredMime;
    const extension = /\.(mp4|webm)$/i.exec(filename)?.[1].toLowerCase();
    if (mime && !['video/mp4', 'video/webm', 'application/octet-stream', 'binary/octet-stream'].includes(mime)) return '';
    if (mime === 'video/mp4') return extension && extension !== 'mp4' ? '' : 'mp4';
    if (mime === 'video/webm') return extension && extension !== 'webm' ? '' : 'webm';
    return extension || '';
  }
  function resolveSource(item, observedItems) {
    if (!item || processingRequested(item)) return null;
    const streams = observedItems || item.detectedStreams || [item];
    const selected = item.selection?.variantUrl || item.url;
    const source = streams.find(value => value.url === selected);
    if (!source || componentUrls(streams).has(source.url) || !directExtension(source)) return null;
    return source;
  }
  function isSupported(item) { return Boolean(resolveSource(item)); }
  function filenameFor(title, extension) {
    // Format characters (bidi overrides, zero-width marks) can disguise the
    // real extension, as in "Movie\u202Ekcf.mp4". Drop them before sanitising.
    let value = String(title || 'Video').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, ' ')
      .replace(/\.(?:mp4|webm)$/i, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 160).replace(/[. ]+$/g, '');
    if (!value || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `Video${value ? ` ${value}` : ''}`;
    return `${value}.${extension}`;
  }
  function invalidMime(mime) {
    const value = String(mime || '').split(';')[0].trim().toLowerCase();
    return Boolean(value && !['video/mp4', 'video/webm', 'application/octet-stream', 'binary/octet-stream'].includes(value));
  }
  function errorMessage(reason) {
    if (/^(?:SERVER_UNAUTHORIZED|SERVER_FORBIDDEN)$/.test(reason)) return 'The site refused this download. Open the video page and try again, or use the desktop app.';
    if (/^SERVER_/.test(reason)) return 'The video link is unavailable. Refresh the page and try again.';
    if (/^NETWORK_/.test(reason)) return 'The connection was interrupted. Resume in Chrome or try the download again.';
    if (/^FILE_/.test(reason)) return 'Chrome could not save the file. Check free space and your download folder in Chrome.';
    if (reason === 'USER_SHUTDOWN') return 'Chrome stopped this download. Resume it or try again.';
    return 'Chrome could not finish this download. Check Chrome Downloads or try again.';
  }
  function toJob(record, download) {
    const bytesDownloaded = Math.max(0, Number(download?.bytesReceived) || 0);
    const totalBytes = Number(download?.totalBytes) > 0 ? Number(download.totalBytes) : null;
    const blocked = download?.danger && !SAFE_DANGER.has(download.danger);
    const wrongType = invalidMime(download?.mime);
    let queueStatus = 'failed'; let status = 'failed'; let error = '';
    if (!download) error = 'Chrome no longer has this download. Download the video again.';
    else if (download.state === 'interrupted' && download.error && download.error !== 'USER_CANCELED') error = errorMessage(download.error);
    else if (wrongType) { status = 'invalid-media'; error = 'The site returned a different file instead of an MP4 or WebM video. Refresh the page or use the desktop app.'; }
    else if (blocked) { status = 'blocked'; error = 'Chrome blocked or is checking this download. Review it in Chrome Downloads.'; }
    else if (download.state === 'complete') { queueStatus = 'completed'; status = 'completed'; }
    else if (download.state === 'in_progress') { queueStatus = download.paused ? 'paused' : 'downloading'; status = queueStatus; }
    else if (download.error === 'USER_CANCELED') { queueStatus = 'cancelled'; status = 'cancelled'; }
    else error = errorMessage(download.error || '');
    const jobId = `browser:${record.downloadId}`;
    const saved = queueStatus === 'completed';
    return {
      id: jobId, jobId, backend: 'browser', title: record.title, height: record.height || null, durationSeconds: record.durationSeconds || null,
      queueStatus, status, error: error || null, bytesDownloaded, totalBytes,
      progress: saved ? 100 : totalBytes ? Math.min(99, bytesDownloaded / totalBytes * 100) : 0,
      canResume: Boolean(download?.canResume && !blocked && !wrongType),
      fileExists: saved ? download.exists !== false : undefined,
      ...(saved && download.exists !== false && download.filename ? { fileName: download.filename.split(/[/\\]/).pop() } : {}),
      createdAt: download?.startTime || null, completedAt: saved ? download.endTime || null : null,
    };
  }
  function createManager({ chrome: chromeApi, crypto: cryptoApi = globalThis.crypto }) {
    const pending = new Map();
    const available = Boolean(chromeApi.downloads?.download && chromeApi.downloads?.search);
    const recordKey = id => `${RECORD_PREFIX}${id}`;
    const sourceKey = async value => [...new Uint8Array(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const pageKey = async value => { const url = httpUrl(value); return sourceKey(url ? `${new URL(url).origin}${new URL(url).pathname}` : ''); };
    async function records() {
      const values = await chromeApi.storage.local.get(null);
      return Object.entries(values).filter(([key, value]) => key === recordKey(value?.downloadId) && Number.isInteger(value.downloadId)
        && /^[a-f0-9]{64}$/.test(value.sourceKey)).map(([, value]) => value).sort((a, b) => b.downloadId - a.downloadId);
    }
    async function recordFor(jobId) {
      const match = /^browser:(\d+)$/.exec(String(jobId));
      if (!match) throw new Error('This is not a Chrome download.');
      const id = Number(match[1]); const result = await chromeApi.storage.local.get(recordKey(id)); const record = result[recordKey(id)];
      if (!record || record.downloadId !== id) throw new Error('This download is not owned by SnagThis.');
      return record;
    }
    async function inspect(record) {
      const [download] = await chromeApi.downloads.search({ id: record.downloadId });
      if (download?.byExtensionId && download.byExtensionId !== chromeApi.runtime.id) return null;
      return download || null;
    }
    async function checkMime(record, download) {
      if (download?.state === 'in_progress' && invalidMime(download.mime)) {
        await chromeApi.downloads.cancel(record.downloadId);
        return inspect(record);
      }
      return download;
    }
    async function snapshot(items = [], mappings = {}) {
      if (!available) return { queue: [], mappings: { ...mappings } };
      const sources = (await Promise.all(items.map(async item => {
        const source = resolveSource(item, items); return source ? { id: item.id, key: await sourceKey(source.url) } : null;
      }))).filter(Boolean);
      const keys = new Set(sources.map(source => source.key));
      const selected = (await records()).filter(record => keys.has(record.sourceKey) || Object.values(mappings).includes(`browser:${record.downloadId}`));
      const queue = await Promise.all(selected.map(async record => toJob(record, await checkMime(record, await inspect(record)))));
      const merged = { ...mappings };
      for (const source of sources) {
        // A desktop-owned row must retain its existing lifecycle and actions.
        if (merged[source.id] && !String(merged[source.id]).startsWith('browser:')) continue;
        const record = selected.find(value => value.sourceKey === source.key);
        if (record) merged[source.id] = `browser:${record.downloadId}`;
        else if (String(merged[source.id] || '').startsWith('browser:')) delete merged[source.id];
      }
      return { queue, mappings: merged };
    }
    async function start({ source, pageUrl, title }) {
      if (!available) throw new Error('Chrome downloads are unavailable. Reload the extension or use the desktop app.');
      const extension = directExtension(source);
      if (!extension) throw new Error('This video needs the desktop app. Chrome can save standalone MP4 and WebM files.');
      const key = await sourceKey(source.url);
      if (pending.has(key)) return pending.get(key);
      const task = (async () => {
        for (const record of (await records()).filter(value => value.sourceKey === key)) {
          const download = await checkMime(record, await inspect(record));
          const job = toJob(record, download);
          if (download?.state === 'in_progress' || (job.queueStatus === 'completed' && job.fileExists)) return { ok: true, jobId: job.id, backend: 'browser', status: job.queueStatus, job };
        }
        const filename = filenameFor(title || source.sourcePageTitle || source.filename || 'Video', extension);
        let id;
        try { id = await chromeApi.downloads.download({ url: source.url, filename, conflictAction: 'uniquify', saveAs: false }); }
        catch { throw new Error('Chrome could not start this download. Refresh the video page and try again, or use the desktop app.'); }
        if (!Number.isInteger(id)) throw new Error('Chrome did not start the download. Try again.');
        const record = { downloadId: id, title: filename.slice(0, -(extension.length + 1)), height: Number(source.height) > 0 ? Number(source.height) : null,
          durationSeconds: Number(source.durationSeconds) > 0 ? Number(source.durationSeconds) : null, sourceKey: key, pageKey: await pageKey(pageUrl) };
        try { await chromeApi.storage.local.set({ [recordKey(id)]: record }); }
        catch { await chromeApi.downloads.cancel(id).catch(() => {}); throw new Error('Chrome could not save the download state. Free extension storage and try again.'); }
        const job = toJob(record, await checkMime(record, await inspect(record)));
        return { ok: true, jobId: job.id, backend: 'browser', status: job.queueStatus, job };
      })();
      pending.set(key, task);
      try { return await task; } finally { pending.delete(key); }
    }
    async function action(jobId, actionName) {
      if (!available) throw new Error('Chrome downloads are unavailable. Reload the extension.');
      if (!['pause', 'resume', 'cancel', 'show'].includes(actionName)) throw new Error('This Chrome download action is unavailable.');
      const record = await recordFor(jobId); const download = await inspect(record);
      if (!download) throw new Error('Chrome no longer has this download. Download the video again.');
      const job = toJob(record, download);
      if (actionName === 'show' && (job.queueStatus !== 'completed' || !job.fileExists)) throw new Error('The saved file is unavailable. Check Chrome Downloads.');
      if (actionName === 'pause' && (download.state !== 'in_progress' || download.paused)) throw new Error('This download is not running.');
      if (actionName === 'resume' && !job.canResume) throw new Error('Chrome cannot resume this download. Refresh the page and download it again.');
      if (actionName === 'cancel' && download.state !== 'in_progress') throw new Error('This download has already stopped.');
      try { await chromeApi.downloads[actionName](record.downloadId); }
      catch { throw new Error(`Chrome could not ${actionName === 'show' ? 'show the saved file' : `${actionName} this download`}. Check Chrome Downloads.`); }
      return { ok: true, jobId, backend: 'browser', job: toJob(record, await inspect(record)) };
    }
    async function changed(delta) {
      const result = await chromeApi.storage.local.get(recordKey(delta.id)); const record = result[recordKey(delta.id)];
      if (record) await checkMime(record, await inspect(record));
    }
    async function erased(id) { await chromeApi.storage.local.remove(recordKey(id)); }
    return { available, snapshot, start, action, changed, erased };
  }
  return { isSupported, resolveSource, directExtension, filenameFor, invalidMime, toJob, createManager, RECORD_PREFIX };
});
