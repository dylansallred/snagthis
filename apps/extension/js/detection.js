/* VidSnag media normalization. No inferred playlist names or guessed fallback files. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VidSnagDetection = factory();
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
  function withoutManifestSegments(items) {
    const segments = new Set(items.flatMap(item => (item.manifest?.segmentUrls || []).concat(item.manifest?.initializationUrls || [])));
    return items.filter(item => !segments.has(item.url) && !isYoutubeAuxiliaryResource(item.url, item.sourcePageUrl, item.mediaKind));
  }
  return { httpUrl, mediaType, sanitizeHeaders, thumbnailUrl, youtubeId, isYoutubeAuxiliaryResource, withoutManifestSegments };
});
