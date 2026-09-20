(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./titles'), require('../../../packages/contracts/src/hls'), require('../../../packages/contracts/src/selection'), require('../js/detection'));
  else root.VidSnagPopupModel = factory(root.VidSnagTitles, root.VidSnagHls, root.VidSnagSelection, root.VidSnagDetection);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(titles, hls, selection, detection) {
  'use strict';
  function sortMediaByDuration(items = []) {
    const duration = item => {
      for (const value of [item.durationSeconds, item.manifest?.durationSeconds]) {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > 0) return seconds;
      }
      return 0;
    };
    // Stable sorting retains discovery order for equal or unknown durations.
    return [...items].sort((a, b) => duration(b) - duration(a));
  }
  function chooseVariant(item, preferredQuality) {
    const variants = [...(item.variants || item.manifest?.variants || [])].sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0));
    return variants.find(variant => variant.height === Number.parseInt(preferredQuality, 10)) || variants[0] || null;
  }
  function selectMedia(item, preferences = {}, chosen = {}) {
    const variant = (item.variants || []).find(value => value.url === chosen.variantUrl) || chooseVariant(item, preferences.preferredQuality);
    const audio = (item.audio || item.manifest?.audio || []).filter(value => value.url);
    const subtitles = item.subtitles || item.manifest?.subtitles || [];
    const language = chosen.subtitleLang === undefined ? preferences.subtitleLanguage : chosen.subtitleLang;
    const subtitle = language && language !== 'none' ? subtitles.find(value => value.language === language || value.name === language) : null;
    const selected = {};
    if (variant) { selected.variantUrl = variant.url; if (variant.height) selected.height = variant.height; }
    if (chosen.audioOnly && audio.length) {
      selected.audioOnly = true; delete selected.height;
      if (audio[0].language) selected.audioLang = audio[0].language;
    }
    if (subtitle) selected.subtitleLang = subtitle.language || subtitle.name;
    else selected.subtitleLang = 'none';
    const estimatedSize = variant ? hls.estimateSizeBytes(variant.averageBandwidth || variant.bandwidth, item.durationSeconds) : null;
    const isPlaylist = item.type === 'hls' || item.streamType === 'hls' || item.mediaKind === 'hls-manifest' || item.mediaKind === 'dash-manifest' || item.manifest;
    const sizeBytes = selected.audioOnly ? null : variant?.sizeBytes || (variant ? estimatedSize : (!isPlaylist && item.contentLength) || item.sizeBytes || null);
    const sizeEstimated = Boolean(sizeBytes && (variant ? variant.sizeBytes ? variant.sizeEstimated : estimatedSize : item.sizeEstimated));
    return { ...item, ...chosen, height: selected.audioOnly ? null : variant?.height || item.height || null, sizeBytes, sizeEstimated, selection: selected, qualityLabel: selected.audioOnly ? 'Audio only' : variant?.height ? `${variant.height}p` : item.height ? `${item.height}p` : '' };
  }
  function mappingFor(item, mappings = {}) {
    return mappings[item.id] || (item.detectedStreams || []).map(stream => mappings[stream.id]).find(Boolean) || null;
  }
  function jobFor(item, mappings = {}, queue = []) {
    const ids = [mappings[item.id], ...(item.detectedStreams || []).map(stream => mappings[stream.id])].filter(Boolean);
    const jobs = ids.map(id => queue.find(candidate => candidate.id === id || candidate.jobId === id))
      .filter(job => job && job.queueStatus !== 'cancelled' && job.status !== 'cancelled');
    // Prefer an unfinished mapped copy over earlier saved or failed mirrors.
    return jobs.find(job => ['downloading', 'queued', 'paused'].includes(job.queueStatus))
      || jobs.find(job => job.queueStatus !== 'failed' && !['failed', 'error'].includes(job.status)) || jobs[0] || null;
  }
  function browserRow(row, job) {
    if (!row || job?.backend !== 'browser') return row;
    const result = { ...row };
    if (row.state === 'saved') {
      result.statusLine = 'Saved in Chrome';
      result.action = { id: 'show', label: 'Show in folder', style: 'bordered' };
    } else if (row.state === 'missing') {
      result.statusLine = 'File moved or removed';
      result.action = { id: 'chrome-details', label: 'Details', style: 'bordered' };
    } else if (row.state === 'problem') {
      // Chrome owns safety prompts and native transfer errors. Never turn a
      // browser warning into a desktop retry or an implicit approval.
      const blocked = /danger|block|scan|security|virus|invalid-media/i.test(`${job.status || ''} ${typeof job.error === 'string' ? job.error : job.error?.code || ''}`);
      result.statusLine = job.status === 'invalid-media' ? 'The response was not a supported video' : blocked ? 'Check this download in Chrome' : 'Download interrupted in Chrome';
      result.action = blocked ? { id: 'chrome-details', label: 'Details', style: 'bordered' }
        : job.canResume ? { id: 'resume', label: 'Resume', style: 'icon' } : { id: 'retry', label: 'Retry', style: 'bordered' };
    } else if (row.state === 'finishing') result.statusLine = 'Finishing in Chrome';
    else if (!(job.totalBytes > 0) && row.state === 'downloading') result.statusLine = 'Downloading in Chrome';
    else if (!(job.totalBytes > 0) && row.state === 'paused') result.statusLine = 'Paused in Chrome';
    return result;
  }
  function buildDownloadPayload(item, titleOverride = '') {
    const payload = titles.buildJobPayload(item, titleOverride);
    const youtubeId = detection.youtubeId(item.sourcePageUrl) || detection.youtubeId(item.url);
    if (youtubeId) {
      // Site sounds and playback fragments can carry the video's page metadata.
      // YouTube extraction must receive the watch page, never one of those assets
      // or an apparent quality that came from a previously captured resource.
      payload.mediaUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
      payload.mediaType = 'file';
      payload.resourceName = payload.title;
      payload.headers = {};
      payload.selection = { subtitleLang: 'none' };
      payload.durationSeconds = item.durationSeconds || undefined;
      return payload;
    }
    const checked = selection.validateSelection(item.selection);
    if (!checked.ok) throw new Error('Choose an available quality.');
    if (checked.value) payload.selection = checked.value;
    const owner = (item.detectedStreams || []).find(stream => (stream.manifest?.variants || []).some(variant => (variant.url || variant.variantUrl) === checked.value?.variantUrl));
    if (owner) {
      payload.mediaUrl = owner.url;
      payload.headers = owner.requestHeaders || {};
    }
    const alternative = (item.detectedStreams || []).find(stream => stream.url === checked.value?.variantUrl && stream.type === 'file' && stream.mediaKind !== 'dash-manifest');
    if (alternative && !checked.value?.audioOnly) {
      // A directly observed file is an alternative source, not an HLS rendition URL.
      payload.mediaUrl = alternative.url;
      payload.mediaType = 'file';
      payload.headers = alternative.requestHeaders || {};
      payload.selection = { subtitleLang: 'none' };
    }
    payload.durationSeconds = item.durationSeconds || undefined;
    // Only the primary URL's own observed headers are sent. The engine strips them across origins.
    const credentialOrigin = alternative && !checked.value?.audioOnly ? alternative.requestHeadersOrigin : (owner || item).requestHeadersOrigin;
    if (credentialOrigin && new URL(payload.mediaUrl).origin !== credentialOrigin) payload.headers = {};
    return payload;
  }
  function compatibilityIssue(health, version = '1.0.0') {
    if (!health) return 'desktop';
    const range = health.supportedProtocolVersions;
    if (range && Number(range.min) > 1) return 'extension';
    if (range && Number(range.max) < 1) return 'desktop';
    if (!range && health.protocolVersion && String(health.protocolVersion) !== '1') return Number(health.protocolVersion) > 1 ? 'extension' : 'desktop';
    const parse = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0);
    const actual = parse(version); const needed = parse(health.minExtensionVersion || '0');
    for (let index = 0; index < Math.max(actual.length, needed.length); index++) {
      if ((actual[index] || 0) > (needed[index] || 0)) return null;
      if ((actual[index] || 0) < (needed[index] || 0)) return 'extension';
    }
    return null;
  }
  function compatible(health, version = '1.0.0') { return compatibilityIssue(health, version) === null; }
  function localApiBase(candidate) {
    try { const url = new URL(candidate); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null; } catch { return null; }
  }
  function signedLocalAssetUrl(candidate, apiBase) {
    if (!candidate || !localApiBase(apiBase)) return '';
    try {
      const url = new URL(candidate, apiBase);
      return url.origin === apiBase && !url.username && !url.password && url.pathname.startsWith('/downloads/') && /^\d+$/.test(url.searchParams.get('expires') || '') && /^[a-f0-9]{64}$/i.test(url.searchParams.get('signature') || '') ? url.href : '';
    } catch { return ''; }
  }
  function previewClipUrl(candidate, apiBase) {
    const asset = signedLocalAssetUrl(candidate, apiBase);
    if (!asset) return '';
    const url = new URL(asset);
    return url.pathname.startsWith('/downloads/__previews/') && url.pathname.endsWith('.mp4') ? asset : '';
  }
  function resolveThumbnailUrl(candidate, apiBase) {
    const value = String(candidate || '');
    if (value.startsWith('/')) return signedLocalAssetUrl(value, apiBase);
    if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  return { sortMediaByDuration, chooseVariant, selectMedia, mappingFor, jobFor, browserRow, buildDownloadPayload, compatible, compatibilityIssue, localApiBase, previewClipUrl, resolveThumbnailUrl };
});
