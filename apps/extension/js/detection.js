/* SnagThis media normalization. No inferred playlist names or guessed fallback files. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnagThisDetection = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function httpUrl(value, base) {
    if (!value) return '';
    try { const url = new URL(String(value || ''), base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  }
  function mediaType(url, contentType = '', body = '') {
    const path = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
    if (/\.(?:ts|m4s|m4f|cmfa|cmfv|vtt|srt)$/i.test(path) || /(?:mp2t|webvtt)/i.test(contentType)) return null;
    if (/\.m3u8$/i.test(path) || /mpegurl/i.test(contentType) || /^\uFEFF?\s*#EXTM3U(?:\s|$)/.test(body)) return 'hls';
    if (/\.mpd$/i.test(path) || /dash\+xml/i.test(contentType)) return 'dash';
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
      || (manifest.initializationUrls || []).includes(url) || inSegmentBase(url, manifest.segmentBases || [])));
  }
  function withoutManifestSegments(items) {
    const segments = new Set(items.flatMap(item => (item.manifest?.segmentUrls || []).concat(item.manifest?.initializationUrls || [])));
    const bases = items.flatMap(item => item.manifest?.segmentBases || []);
    return items.filter(item => !segments.has(item.url) && !(bases.length && item.mediaKind === 'video' && inSegmentBase(item.url, bases))
      && !isYoutubeAuxiliaryResource(item.url, item.sourcePageUrl, item.mediaKind));
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
  return { httpUrl, mediaType, sanitizeHeaders, thumbnailUrl, youtubeId, isYoutubeAuxiliaryResource, manifestComponent, withoutManifestSegments, isJunkMedia, friendlyError };
});
