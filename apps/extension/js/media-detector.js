/* Page-world observation of standard fetch/XHR; never modifies requests or consumes the page's response. */
(() => {
  'use strict';
  if (window.__vidsnagObserver) return;
  window.__vidsnagObserver = true;
  const CHANNEL = 'vidsnag:media';
  const MAX_MANIFEST = 262144;
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
  function emit(url, contentType, contentLength, body, requestHeaders) {
    const resolved = absolute(url); const type = typeFor(resolved, contentType, body);
    if (!resolved || !type) return;
    window.postMessage({ source: CHANNEL, media: { url: resolved, type, contentType, contentLength: Number(contentLength) || 0, manifestText: type === 'hls' && /^\uFEFF?\s*#EXTM3U/.test(body || '') ? body : '', requestHeaders, detectedAt: Date.now() } }, '*');
  }
  function headersOf(value) {
    try { return Object.fromEntries(new Headers(value || {}).entries()); } catch { return {}; }
  }
  async function inspectBody(response) {
    const reader = response.clone().body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder(); let body = ''; let length = 0;
    try {
      while (length < MAX_MANIFEST) {
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
    const requestHeaders = headersOf(args[1]?.headers || args[0]?.headers);
    const pageUrl = location.href;
    const result = originalFetch.apply(this, args);
    result.then(async response => {
      if (!response.ok || pageUrl !== location.href) return;
      const url = response.url || requestUrl; const type = response.headers.get('content-type') || '';
      const size = response.headers.get('content-length');
      const scopedHeaders = absolute(url) && requestUrl && new URL(url).origin === new URL(requestUrl).origin ? requestHeaders : {};
      emit(url, type, size, '', scopedHeaders);
      if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(url) || !type || /^(?:text\/|application\/octet-stream)/i.test(type)) {
        const body = await inspectBody(response);
        if (pageUrl === location.href && body) emit(url, type, size, body, scopedHeaders);
      }
    }).catch(() => {});
    return result;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    requests.set(this, { url: absolute(resolveRequestUrl(url)), page: location.href, headers: {} });
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const request = requests.get(this); if (request) request.headers[name] = String(value);
    return originalSetHeader.call(this, name, value);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', () => {
      const request = requests.get(this); if (!request || request.page !== location.href || this.status < 200 || this.status >= 400) return;
      let body = '';
      try { if (!this.responseType || this.responseType === 'text') { const text = this.responseText; if (text.length <= MAX_MANIFEST && /^\uFEFF?\s*#EXTM3U/.test(text)) body = text; } } catch { /* Binary XHR has no responseText. */ }
      const url = this.responseURL || request.url;
      const scopedHeaders = request.url && new URL(url).origin === new URL(request.url).origin ? request.headers : {};
      emit(url, this.getResponseHeader('content-type') || '', this.getResponseHeader('content-length'), body, scopedHeaders);
    }, { once: true });
    return originalSend.apply(this, args);
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
