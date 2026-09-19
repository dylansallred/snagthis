(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./titles'), require('../../../packages/contracts/src/hls'), require('../../../packages/contracts/src/selection'), require('../js/detection'));
  else root.VidSnagPopupModel = factory(root.VidSnagTitles, root.VidSnagHls, root.VidSnagSelection, root.VidSnagDetection);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(titles, hls, selection, detection) {
  'use strict';
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
    const sizeBytes = selected.audioOnly ? null : variant?.sizeBytes || (variant ? hls.estimateSizeBytes(variant.averageBandwidth || variant.bandwidth, item.durationSeconds) : item.type === 'hls' ? null : item.contentLength || item.sizeBytes || null);
    return { ...item, ...chosen, height: selected.audioOnly ? null : variant?.height || item.height || null, sizeBytes, selection: selected, qualityLabel: selected.audioOnly ? 'Audio only' : variant?.height ? `${variant.height}p` : item.height ? `${item.height}p` : '' };
  }
  function mappingFor(item, mappings = {}) {
    return mappings[item.id] || (item.detectedStreams || []).map(stream => mappings[stream.id]).find(Boolean) || null;
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
    const credentialOrigin = alternative && !checked.value?.audioOnly ? alternative.requestHeadersOrigin : item.requestHeadersOrigin;
    if (credentialOrigin && new URL(payload.mediaUrl).origin !== credentialOrigin) payload.headers = {};
    return payload;
  }
  function compatible(health, version = '1.0.0') {
    if (!health) return false;
    const range = health.supportedProtocolVersions;
    if (range && (Number(range.min) > 1 || Number(range.max) < 1)) return false;
    if (!range && health.protocolVersion && String(health.protocolVersion) !== '1') return false;
    const parse = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0);
    const actual = parse(version); const needed = parse(health.minExtensionVersion || '0');
    for (let index = 0; index < Math.max(actual.length, needed.length); index++) {
      if ((actual[index] || 0) > (needed[index] || 0)) return true;
      if ((actual[index] || 0) < (needed[index] || 0)) return false;
    }
    return true;
  }
  function localApiBase(candidate) {
    try { const url = new URL(candidate); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null; } catch { return null; }
  }
  function previewClipUrl(candidate, apiBase) {
    if (!candidate || !localApiBase(apiBase)) return '';
    try {
      const url = new URL(candidate, apiBase);
      return url.origin === apiBase && !url.username && !url.password && url.pathname.startsWith('/downloads/__previews/') && url.pathname.endsWith('.mp4') && /^\d+$/.test(url.searchParams.get('expires') || '') && /^[a-f0-9]{64}$/i.test(url.searchParams.get('signature') || '') ? url.href : '';
    } catch { return ''; }
  }
  return { chooseVariant, selectMedia, mappingFor, buildDownloadPayload, compatible, localApiBase, previewClipUrl };
});
