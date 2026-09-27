/* SnagThis media normalization. No inferred playlist names or guessed fallback files. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../../packages/contracts/src/hls'));
  else root.SnagThisDetection = factory(root.SnagThisHls);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(hls) {
  'use strict';
  function httpUrl(value, base) {
    if (!value) return '';
    try { const url = new URL(String(value || ''), base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function mediaType(url, contentType = '', body = '') {
    const path = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
    if (/\.(?:ts|m4s|m4f|cmfa|cmfv|vtt|srt)$/i.test(path) || /(?:mp2t|webvtt)/i.test(contentType)) return null;
    if (/\.m3u8$/i.test(path) || /mpegurl/i.test(contentType) || /^\uFEFF?\s*#EXTM3U(?:\s|$)/.test(body)) return 'hls';
    if (/\.mpd$/i.test(path) || /dash\+xml/i.test(contentType) || (body && hls.isDashManifest(body))) return 'dash';
    if (/\.(?:mp4|m4v|mov|webm|mkv|avi|flv|ogv|mp3|m4a|ogg|wav)$/i.test(path) || /^(?:video|audio)\//i.test(contentType)) return 'file';
    return null;
  }
  function sanitizeHeaders(input) {
    const entries = Array.isArray(input) ? input.map(item => [item.name, item.value]) : Object.entries(input || {});
    const result = {};
    for (const [name, raw] of entries) {
      const key = String(name || '').toLowerCase(); const value = String(raw || '');
      if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(key) || !value || value.length > 8192 || /[\r\n\x00]/.test(value)) continue;
      if (/^(?:host|content-length|connection|range|accept-encoding|transfer-encoding|upgrade|sec-|proxy-)/i.test(key)) continue;
      result[key] = value;
      if (Object.keys(result).length >= 30) break;
    }
    return result;
  }
  function thumbnailUrl(value, base) {
    const text = String(value || '');
    if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(text)) return text.length <= 20480 ? text : '';
    return httpUrl(text, base);
  }
  function youtubeId(raw) {
    try {
      const url = new URL(raw); const host = url.hostname.replace(/^www\./, '');
      const id = host === 'youtu.be' ? url.pathname.split('/')[1] : /(^|\.)youtube\.com$/.test(host) ? url.searchParams.get('v') || /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1] : '';
      return /^[\w-]{6,20}$/.test(id || '') ? id : '';
    } catch { return ''; }
  }
  function isYoutubeMediaHost(raw) {
    try { return /(^|\.)googlevideo\.com$/.test(new URL(raw).hostname); } catch { return false; }
  }
  function isYoutubeAuxiliaryResource(url, pageUrl, mediaKind) {
    const pageId = youtubeId(pageUrl);
    return Boolean(pageId && (mediaKind !== 'youtube-page' || youtubeId(url) !== pageId));
  }
  // Quota trimming keeps only each playlist's segment directories; a direct
  // file directly inside one of them is still a component, not a new video.
  function inSegmentBase(url, bases) {
    const path = String(url).split(/[?#]/)[0];
    return bases.some(base => path.startsWith(base) && !path.slice(base.length).includes('/'));
  }
  function manifestComponent(url, items) {
    return items.some(({ manifest }) => manifest && ((manifest.segmentUrls || []).includes(url)
      || (manifest.initializationUrls || []).includes(url) || inSegmentBase(url, manifest.segmentBases || [])
      || hls.matchesSegmentTemplate(url, manifest.segmentTemplates)));
  }
  function withoutManifestSegments(items) {
    const segments = new Set(items.flatMap(item => (item.manifest?.segmentUrls || []).concat(item.manifest?.initializationUrls || [])));
    const bases = items.flatMap(item => item.manifest?.segmentBases || []);
    // DASH SegmentTemplate: pieces are named by pattern, not listed.
    const templates = items.flatMap(item => item.manifest?.segmentTemplates || []);
    return items.filter(item => !segments.has(item.url) && !(bases.length && item.mediaKind === 'video' && inSegmentBase(item.url, bases))
      && !(templates.length && item.mediaKind === 'video' && hls.matchesSegmentTemplate(item.url, templates))
      && !isYoutubeAuxiliaryResource(item.url, item.sourcePageUrl, item.mediaKind));
  }
  // Pieces of an adaptive stream (fMP4/CMAF fragments, init segments, byte
  // ranges) look like small MP4 files. Without their manifest they are not a
  // video anyone can save; with it, withoutManifestSegments() folds them in.
  // Only requests the page's scripts made count: a <video src> or a direct
  // media load is always a standalone file, however short.
  const INIT_NAME = /(?:^|[\W_])init(?:iali[sz]ation)?(?:[\W_]|\d|$)/i;
  const FRAGMENT_PATH = /\/(?:range|bytes)[/=]\d+-\d+|\/Fragments\(|\/QualityLevels\(|(?:^|[/_.-])(?:seg(?:ment)?|chunk|frag(?:ment)?)[-_]?\d+(?:[/_.-]|$)/i;
  const FRAGMENT_QUERY = /[?&](?:range|bytes|seg(?:ment)?|chunk|frag(?:ment)?|sq)=\d/i;
  function numberedTemplate(value) {
    try {
      const url = new URL(value); const parts = url.pathname.split('/');
      const name = parts.pop();
      if (!/\d/.test(name)) return '';
      return `${url.host}${parts.join('/')}/${name.replace(/\d+/g, '#')}`;
    } catch { return ''; }
  }
  function isStreamFragment(item, items = [], mappings = {}) {
    if (!item || item.mediaKind !== 'video' || item.manifest || item.streamType || mappings[item.id] || item.delivery === 'element') return false;
    let url; try { url = new URL(item.url); } catch { return false; }
    let name = url.pathname.split('/').pop() || '';
    try { name = decodeURIComponent(name); } catch { /* Keep the encoded name. */ }
    if (INIT_NAME.test(name) || FRAGMENT_PATH.test(url.pathname) || FRAGMENT_QUERY.test(url.search)) return true;
    if (item.delivery !== 'script') return false;
    if (item.rangeRequested) return true;
    // Numbered siblings (seg-1.mp4, seg-2.mp4 …) fetched by one player.
    const template = numberedTemplate(item.url);
    if (template && items.filter(other => other !== item && other.delivery === 'script' && other.mediaKind === 'video' && numberedTemplate(other.url) === template).length >= 2) return true;
    const duration = Number(item.durationSeconds) > 0 ? Number(item.durationSeconds) : 0;
    const size = Number(item.contentLength) > 0 ? Number(item.contentLength) : 0;
    // "N/A" or "<1 MB" with no duration of its own, or a size far too small
    // for the duration it borrowed from the page's player.
    if (!duration) return size < 1e6;
    return duration >= 60 && size > 0 && size < duration * 4000;
  }
  // DRM: a manifest that declares protection, or a frame whose player uses
  // Encrypted Media Extensions. Detection only; nothing is ever decrypted.
  function markProtected(items, contexts = {}) {
    return items.map(item => {
      if (item.mediaKind === 'youtube-page') return item;
      const manifest = item.manifest;
      const frame = contexts?.[item.frameId || 0]?.protection || null;
      let locked = Boolean(manifest?.isDrm);
      if (!locked && frame) {
        const stream = item.streamType === 'hls' || item.streamType === 'dash';
        // A parsed manifest without keys proves that stream is clear (a
        // trailer beside the protected film); an HLS master defers to its renditions.
        if (stream) locked = !manifest;
        else if (item.mediaKind === 'video') locked = item.delivery === 'script' || Boolean(frame.mediaSourceUrl && frame.mediaSourceUrl === item.url);
      }
      if (!locked) return item;
      return { ...item, drm: true, keySystem: manifest?.keySystems?.[0] || frame?.keySystem || item.keySystem || '' };
    });
  }
  // One row for the page's protected title instead of its many pieces.
  // Unprotected media on the same page keeps its own rows.
  function withProtectedRow(groups, page = {}) {
    const frames = Object.entries(page.contexts || {}).filter(([, context]) => context?.protection)
      .map(([frameId, context]) => ({ frameId: Number(frameId), context })).sort((a, b) => a.frameId - b.frameId);
    const isLocked = group => Boolean(group.drm || (group.detectedStreams || []).some(stream => stream.drm));
    const locked = groups.filter(isLocked);
    const frame = frames[0];
    const id = frame ? `protected:${frame.frameId}` : '';
    if (!locked.length && (!frame || (page.hidden || []).includes(id))) return groups;
    const clear = groups.filter(group => !isLocked(group));
    const duration = group => Number(group.durationSeconds) > 0 ? Number(group.durationSeconds) : 0;
    const main = locked.slice().sort((a, b) => duration(b) - duration(a))[0] || null;
    const streams = locked.flatMap(group => group.detectedStreams || [group]);
    const context = frame?.context || {};
    const protection = context.protection || {};
    const pageUrl = main?.sourcePageUrl || context.sourcePageUrl || page.url || '';
    const row = {
      id: id || main.id, url: main?.url || pageUrl, type: 'protected', mediaKind: 'protected', frameId: frame ? frame.frameId : main.frameId,
      sourcePageUrl: pageUrl, sourcePageTitle: main?.sourcePageTitle || context.sourcePageTitle || '',
      pageTitleCandidates: main?.pageTitleCandidates || context.pageTitleCandidates || [],
      pageEpisodeHint: main?.pageEpisodeHint || context.pageEpisodeHint || null,
      durationSeconds: Number(protection.durationSeconds) > 0 ? Number(protection.durationSeconds) : main ? duration(main) || null : null,
      thumbnailUrl: main?.thumbnailUrl || protection.poster || '',
      drm: true, keySystem: protection.keySystem || streams.map(stream => stream.keySystem).find(Boolean) || '',
      drmSite: protection.siteName || '', detectedAt: main?.detectedAt || 0,
      variants: [], audio: [], subtitles: [], detectedStreams: streams, collapsedCount: streams.length,
    };
    return [row, ...clear];
  }
  // Plain-language name for "Protected by …": the site's own name when it
  // declares one, else its host without www.
  function protectedSiteName(item) {
    if (item?.drmSite) return item.drmSite;
    try { return new URL(item.sourcePageUrl || item.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }
  // Page noise that is not a video anyone came for: notification sounds, ad
  // creatives and tiny looping banners. Playlists and started downloads stay.
  const AD_HOSTS = ['a-ads.com', 'doubleclick.net', 'googlesyndication.com', 'adnxs.com', 'amazon-adsystem.com'];
  function isJunkMedia(item, mappings = {}) {
    if (!item || item.mediaKind !== 'video' || item.streamType || item.manifest || mappings[item.id]) return false;
    let host = ''; let path = '';
    try { const url = new URL(item.url); host = url.hostname.toLowerCase(); path = url.pathname; } catch { return false; }
    if (AD_HOSTS.some(ad => host === ad || host.endsWith(`.${ad}`))) return true;
    const duration = Number(item.durationSeconds) > 0 ? Number(item.durationSeconds) : 0;
    const size = Number(item.contentLength) > 0 ? Number(item.contentLength) : 0;
    const audio = /^audio\//i.test(item.contentType || '') || /\.(?:mp3|m4a|aac|ogg|wav|opus)$/i.test(path);
    if (audio) return duration ? duration < 10 : size > 0 && size < 256 * 1024;
    // A short clip the page itself plays looped or muted is a creative; an
    // ordinary short video (no such presentation) stays a real download.
    const shown = item.presentation || {};
    const decorative = shown.loop || shown.muted || shown.autoplay;
    const tiny = shown.height > 0 && shown.height <= 120; // Covers 320x100 and 728x90 banners.
    return Boolean(duration && decorative && (duration < 5 || (tiny && duration < 30)));
  }
  // Transport failures carry browser wording ("Failed to fetch", "signal timed
  // out"). Every caller of this bridge talks only to the local desktop app.
  function friendlyError(error, fallback = 'SnagThis could not finish that action.') {
    const text = String(error?.message || error || '');
    if (error?.name === 'TimeoutError' || /timed? ?out|timeout/i.test(text)) return 'The connection to SnagThis timed out. Try again.';
    // fetch() rejects with a TypeError only when no HTTP response arrived.
    if (error?.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed|err_connection|err_network/i.test(text)) return "SnagThis desktop isn't running. Open it, then try again.";
    return text || fallback;
  }
  return { httpUrl, mediaType, sanitizeHeaders, thumbnailUrl, youtubeId, isYoutubeMediaHost, isYoutubeAuxiliaryResource, manifestComponent, withoutManifestSegments, isJunkMedia, isStreamFragment, markProtected, withProtectedRow, protectedSiteName, friendlyError };
});
