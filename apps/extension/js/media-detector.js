/* Page-world observation of standard fetch/XHR; never modifies requests or consumes the page's response. */
(() => {
  'use strict';
  if (window.__snagthisObserver) return;
  window.__snagthisObserver = true;
  const CHANNEL = 'snagthis:media';
  const MAX_MANIFEST = 5 * 1024 * 1024;
  // Init segments are a few KB; only already-received small responses are scanned.
  const MAX_INIT_SEGMENT = 64 * 1024;
  const MPD = /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w-]+:)?MPD[\s>]/;
  const manifestBody = text => /^\uFEFF?\s*#EXTM3U/.test(text) || MPD.test(text);
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
    if (/\.mpd(?:[?#]|$)/i.test(url) || /dash\+xml/i.test(contentType) || MPD.test(body)) return 'dash';
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
    const manifestText = (type === 'hls' && /^\uFEFF?\s*#EXTM3U/.test(body || '')) || (type === 'dash' && MPD.test(body || '')) ? body : '';
    // A POST answer is only usable as playlist text; DASH text is read for detection only.
    if (!resolved || !type || (method !== 'GET' && !(manifestText && type === 'hls'))) return;
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
        if (body.trim().length >= 8 && !/^\uFEFF?\s*(?:#EXTM3U|<)/.test(body)) return '';
        if (body.length >= 4096 && !manifestBody(body)) return '';
      }
      body += decoder.decode();
      return manifestBody(body) ? body : '';
    } catch { return ''; } finally { void reader.cancel().catch(() => {}); }
  }
  // DRM observation only. The page's own EME calls and responses are left
  // untouched; SnagThis never decrypts, records or saves protected media.
  function reportProtection(signal, keySystem) {
    window.postMessage({ source: CHANNEL, pageUrl: location.href, protection: { signal, keySystem: String(keySystem || '').slice(0, 100) } }, '*');
  }
  // Walk ISO BMFF box headers structurally so ordinary text containing "tenc" or
  // "enca" (e.g. "sentence", "latency") never triggers false-positive DRM locks.
  const TOP_BOXES = new Set(['ftyp', 'styp', 'moov', 'moof', 'sidx', 'free', 'skip', 'mdat', 'pssh', 'emsg']);
  const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'sinf', 'schi', 'moof', 'traf', 'mvex', 'udta']);
  const FULL_CONTAINERS = new Set(['stsd']);
  const SAMPLE_ENTRY_OFFSETS = { encv: 78, enca: 28 };
  function readBoxType(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }
  function readU32(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }
  function encryptedInit(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 8) return null;
    const firstType = readBoxType(bytes, 4);
    if (!TOP_BOXES.has(firstType)) return null;
    let found = false; let system = '';
    const walk = (start, end, depth) => {
      if (depth > 8) return;
      let offset = start;
      let count = 0;
      while (offset + 8 <= end && count < 256) {
        count += 1;
        let size = readU32(bytes, offset);
        const type = readBoxType(bytes, offset + 4);
        let headerSize = 8;
        if (size === 1) {
          if (offset + 16 > end) break;
          const hi = readU32(bytes, offset + 8);
          const lo = readU32(bytes, offset + 12);
          size = hi * 0x100000000 + lo;
          headerSize = 16;
        } else if (size === 0) {
          size = end - offset;
        }
        if (size < headerSize || offset + size > end) break;
        const payloadStart = offset + headerSize;
        const boxEnd = offset + size;
        if (type === 'tenc' || type === 'encv' || type === 'enca') {
          found = true;
          const skip = SAMPLE_ENTRY_OFFSETS[type];
          if (skip && payloadStart + skip + 8 <= boxEnd) walk(payloadStart + skip, boxEnd, depth + 1);
        } else if (type === 'pssh') {
          found = true;
          if (!system && payloadStart + 20 <= boxEnd) {
            for (let i = payloadStart + 4; i < payloadStart + 20; i++) system += bytes[i].toString(16).padStart(2, '0');
          }
        } else if (FULL_CONTAINERS.has(type)) {
          if (payloadStart + 8 <= boxEnd) walk(payloadStart + 8, boxEnd, depth + 1);
        } else if (CONTAINER_BOXES.has(type)) {
          walk(payloadStart, boxEnd, depth + 1);
        }
        offset = boxEnd;
      }
    };
    walk(0, bytes.length, 0);
    return found ? { system } : null;
  }
  let initReported = false;
  let lastInitUrl = location.href;
  function sameDocumentWithoutHash(before, after) {
    try {
      const a = new URL(before); const b = new URL(after);
      if (a.hash !== b.hash && ([a.hash, b.hash].some(hash => /^#[/!]/.test(hash)))) return false;
      a.hash = ''; b.hash = '';
      return a.href === b.href;
    } catch { return before === after; }
  }
  function maybeResetInitForNav() {
    if (!sameDocumentWithoutHash(lastInitUrl, location.href)) {
      initReported = false;
    }
    lastInitUrl = location.href;
  }
  const initCandidate = (url, contentType) => {
    maybeResetInitForNav();
    return !initReported
      && (/\.(?:mp4|m4s|m4v|m4a|m4f|cmfv|cmfa|init)(?:[?#]|$)/i.test(url) || /^(?:video|audio)\/mp4/i.test(contentType));
  };
  function inspectInit(buffer, url, contentType) {
    if (!buffer || buffer.byteLength > MAX_INIT_SEGMENT || buffer.byteLength < 8 || !initCandidate(url, contentType)) return;
    const found = encryptedInit(buffer);
    if (found) { initReported = true; reportProtection('init', found.system); }
  }
  async function inspectInitResponse(response, url, contentType) {
    const length = Number(response.headers.get('content-length'));
    if (!(length > 0 && length <= MAX_INIT_SEGMENT) || !initCandidate(url, contentType)) return;
    try { inspectInit(await response.clone().arrayBuffer(), url, contentType); } catch { /* Unreadable responses are skipped. */ }
  }
  const originalAccess = typeof navigator === 'object' ? navigator?.requestMediaKeySystemAccess : undefined;
  if (typeof originalAccess === 'function') {
    navigator.requestMediaKeySystemAccess = function(...args) {
      const result = originalAccess.apply(this, args);
      Promise.resolve(result).then(access => reportProtection('access', access?.keySystem || args[0]), () => {});
      return result;
    };
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
      void inspectInitResponse(response, url, type);
      const nonManifestMime = /^(?:text\/(?:event-stream|html|css|javascript)|application\/(?:javascript|json)|image\/svg\+xml)/i.test(type);
      const manifestMimeCandidate = !nonManifestMime && (/mpegurl|dash\+xml|xml/i.test(type) || /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url) || !type || /^(?:text\/plain|application\/octet-stream|image\/)/i.test(type));
      if (manifestMimeCandidate && !(Number(size) > MAX_MANIFEST)) {
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
        else if (this.responseType === 'arraybuffer' && this.response?.byteLength <= MAX_MANIFEST) {
          inspectInit(this.response, url, contentType);
          if (!new Uint8Array(this.response, 0, Math.min(4, this.response.byteLength)).some(byte => byte === 0)) text = new TextDecoder().decode(this.response);
        } else if (this.responseType === 'blob' && this.response?.size <= MAX_MANIFEST) text = await this.response.text();
        if (text.length <= MAX_MANIFEST && manifestBody(text)) body = text;
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
      if (location.href !== before) {
        maybeResetInitForNav();
        window.postMessage({ source: CHANNEL, navigation: true }, '*');
      }
      return result;
    };
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('popstate', maybeResetInitForNav);
    window.addEventListener('hashchange', maybeResetInitForNav);
  }
})();
