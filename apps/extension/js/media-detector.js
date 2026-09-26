/* Page-world observation of standard fetch/XHR; never modifies requests or consumes the page's response. */
(() => {
  'use strict';
  if (window.__snagthisObserver) return;
  window.__snagthisObserver = true;
  const CHANNEL = 'snagthis:media';
  const MAX_MANIFEST = 5 * 1024 * 1024;
  function resolveRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    if (input && typeof input.href === 'string') return input.href;
    return '';
  }
  function absolute(value) {
    if (!value) return '';
    try { const url = new URL(value, document.baseURI); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function typeFor(url, contentType, body = '') {
    if (/\.(?:ts|m4s|m4f|cmfa|cmfv|vtt)(?:[?#]|$)/i.test(url) || /mp2t|webvtt/i.test(contentType)) return null;
    if (/\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(contentType) || /^\uFEFF?\s*#EXTM3U(?:\s|$)/.test(body)) return 'hls';
    if (/\.mpd(?:[?#]|$)/i.test(url) || /dash\+xml/i.test(contentType)) return 'dash';
    return /\.(?:mp4|m4v|mov|webm|mkv|mp3|m4a|ogg)(?:[?#]|$)/i.test(url) || /^(?:video|audio)\//i.test(contentType) ? 'file' : null;
  }
  // A POST (or other non-GET) response cannot be replayed by URL. It is only
  // reported with its playlist text, which then is the one usable copy.
  // A blob: playlist the player makes from that text has no fetchable URL
  // and stays unreported (absolute() rejects it): it is the same playlist.
  function requestMethod(input, init) {
    try {
      const value = (init && init.method) || (input && typeof input === 'object' && typeof input.method === 'string' ? input.method : '');
      return String(value || 'GET').toUpperCase();
    } catch { return 'GET'; }
  }
  function emit(url, contentType, contentLength, body, method = 'GET') {
    const resolved = absolute(url); const type = typeFor(resolved, contentType, body);
    const manifestText = type === 'hls' && /^\uFEFF?\s*#EXTM3U/.test(body || '') ? body : '';
    if (!resolved || !type || (method !== 'GET' && !manifestText)) return;
    window.postMessage({ source: CHANNEL, pageUrl: location.href, media: { url: resolved, type, contentType, contentLength: Number(contentLength) || 0, manifestText, method, detectedAt: Date.now() } }, '*');
  }
  async function inspectBody(response) {
    const reader = response.clone().body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder(); let body = ''; let length = 0;
    try {
      // Read through EOF even at the exact limit; a prefix of a longer
      // playlist would publish incomplete duration and component references.
      while (length <= MAX_MANIFEST) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > MAX_MANIFEST) return '';
        body += decoder.decode(value, { stream: true });
        if (body.trim().length >= 8 && !/^\uFEFF?\s*#EXTM3U/.test(body)) return '';
      }
      return body + decoder.decode();
    } catch { return ''; } finally { void reader.cancel().catch(() => {}); }
  }
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const requestUrl = absolute(resolveRequestUrl(args[0]));
    const method = requestMethod(args[0], args[1]);
    const pageUrl = location.href;
    const result = originalFetch.apply(this, args);
    result.then(async response => {
      if (!response.ok || pageUrl !== location.href) return;
      const url = response.url || requestUrl; const type = response.headers.get('content-type') || '';
      const size = response.headers.get('content-length');
      emit(url, type, size, '', method);
      if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(url) || !type || /^(?:text\/|image\/|application\/octet-stream)/i.test(type)) {
        const body = await inspectBody(response);
        if (pageUrl === location.href && body) emit(url, type, size, body, method);
      }
    }).catch(() => {});
    return result;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    requests.get(this)?.cleanup?.();
    requests.set(this, { url: absolute(resolveRequestUrl(url)), method: String(method || 'GET').toUpperCase(), page: location.href });
    return originalOpen.call(this, method, url, ...rest);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    const request = requests.get(this);
    const cleanup = () => {
      this.removeEventListener('load', onLoad);
      for (const event of ['abort', 'error', 'timeout', 'loadend']) this.removeEventListener(event, cleanup);
      if (request?.cleanup === cleanup) delete request.cleanup;
    };
    const onLoad = async () => {
      cleanup();
      if (!request || requests.get(this) !== request || request.page !== location.href || this.status < 200 || this.status >= 400) return;
      // Capture response identity before an asynchronous Blob read: the page
      // may reuse this XHR while that read is still finishing.
      const url = this.responseURL || request.url;
      const contentType = this.getResponseHeader('content-type') || '';
      const contentLength = this.getResponseHeader('content-length');
      let body = '';
      try {
        let text = '';
        if (!this.responseType || this.responseType === 'text') text = this.responseText;
        else if (this.responseType === 'arraybuffer' && this.response?.byteLength <= MAX_MANIFEST) text = new TextDecoder().decode(this.response);
        else if (this.responseType === 'blob' && this.response?.size <= MAX_MANIFEST) text = await this.response.text();
        if (text.length <= MAX_MANIFEST && /^\uFEFF?\s*#EXTM3U/.test(text)) body = text;
      } catch { /* Unsupported or unreadable responses remain header-only. */ }
      if (request.page !== location.href) return;
      emit(url, contentType, contentLength, body, request.method);
    };
    if (request) request.cleanup = cleanup;
    this.addEventListener('load', onLoad);
    for (const event of ['abort', 'error', 'timeout', 'loadend']) this.addEventListener(event, cleanup, { once: true });
    try { return originalSend.apply(this, args); } catch (error) { cleanup(); throw error; }
  };
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function(...args) {
      const before = location.href; const result = original.apply(this, args);
      if (location.href !== before) window.postMessage({ source: CHANNEL, navigation: true }, '*');
      return result;
    };
  }
})();
