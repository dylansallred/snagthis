(function bootstrapStreamPlayer() {
  const titleEl = document.getElementById('title');
  const sourceEl = document.getElementById('source');
  const statusEl = document.getElementById('status');
  const videoEl = document.getElementById('player');
  const debugLogEl = document.getElementById('debugLog');
  const openSourceBtn = document.getElementById('openSourceBtn');
  const openFallbackBtn = document.getElementById('openFallbackBtn');
  const retryBtn = document.getElementById('retryBtn');

  if (!videoEl || !statusEl || !titleEl || !sourceEl) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const sessionId = String(params.get('session') || '').trim();

  let primaryUrl = String(params.get('src') || '').trim();
  let fallbackUrl = String(params.get('fallback') || '').trim();
  let declaredType = String(params.get('type') || '').trim().toLowerCase();
  let displayTitle = String(params.get('title') || 'Stream Player').trim();
  let sourcePageUrl = '';
  let requestHeaders = {};
  // Cookies travel only for media Chrome itself observed on the source tab.
  let credentialed = true;

  let hls = null;
  let usingFallback = false;
  const debugLines = [];

  const BLOCKED_HEADER_NAMES = new Set([
    'origin',
    'referer',
    'host',
    'user-agent',
    'cookie',
    'content-length',
    'connection',
  ]);
  const CROSS_ORIGIN_HEADER_NAMES = new Set([
    'accept', 'accept-language', 'cache-control', 'pragma', 'range', 'if-range',
  ]);

  function getHttpOrigin(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.origin : '';
    } catch {
      return '';
    }
  }

  function isHlsUrl(url) {
    return /\.m3u8(\?|$)/i.test(String(url || ''));
  }

  function getCurrentUrl() {
    if (usingFallback && fallbackUrl) return fallbackUrl;
    return primaryUrl || fallbackUrl || '';
  }

  function setStatus(message, tone = 'ok') {
    statusEl.textContent = String(message || '');
    statusEl.className = `status ${tone}`;
  }

  function setSourceLabel() {
    const src = getCurrentUrl();
    sourceEl.textContent = src || 'No stream URL provided.';
  }

  function appendDebug(message, data = null) {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${String(message || '').trim()}`;
    if (!line.trim()) return;
    debugLines.push(data ? `${line} ${JSON.stringify(data)}` : line);
    while (debugLines.length > 40) {
      debugLines.shift();
    }
    if (debugLogEl) {
      debugLogEl.textContent = debugLines.join('\n');
      debugLogEl.scrollTop = debugLogEl.scrollHeight;
    }
  }

  function destroyHls() {
    if (hls && typeof hls.destroy === 'function') {
      try {
        hls.destroy();
      } catch {
        // ignore
      }
    }
    hls = null;
  }

  function normalizeRequestHeaders(rawHeaders) {
    if (!rawHeaders || typeof rawHeaders !== 'object') {
      return {};
    }
    const output = {};
    const entries = Object.entries(rawHeaders);
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey || '').trim();
      const value = String(rawValue || '').trim();
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) || !value || /[\r\n]/.test(value)) continue;
      const lower = key.toLowerCase();
      if (BLOCKED_HEADER_NAMES.has(lower)) continue;
      if (lower.startsWith('sec-')) continue;
      if (lower.startsWith('proxy-')) continue;
      if (lower.startsWith(':')) continue;
      output[key.slice(0, 64)] = value.slice(0, 1000);
      if (Object.keys(output).length >= 30) break;
    }
    return output;
  }

  function buildFetchOptions(targetUrl, extra = {}) {
    const targetOrigin = getHttpOrigin(targetUrl);
    if (!targetOrigin) throw new Error('Only HTTP and HTTPS preview sources are supported.');
    const sameOrigin = targetOrigin === getHttpOrigin(primaryUrl);
    const headers = new Headers();
    for (const [key, value] of Object.entries(normalizeRequestHeaders(requestHeaders))) {
      if (sameOrigin || CROSS_ORIGIN_HEADER_NAMES.has(key.toLowerCase())) headers.set(key, value);
    }
    // HLS.js supplies byte ranges per fragment. They must override the original
    // media request's range, while credentials stay bound to its exact origin.
    new Headers(extra.headers || {}).forEach((value, key) => {
      if (sameOrigin || CROSS_ORIGIN_HEADER_NAMES.has(key.toLowerCase())) headers.set(key, value);
    });
    return {
      ...extra,
      headers,
      credentials: sameOrigin && credentialed ? 'include' : 'omit',
      cache: 'no-store',
      // XHR cannot control redirect credential forwarding. Fetch rejects a
      // redirect before captured site headers can reach another destination.
      redirect: 'error',
      referrer: '',
      referrerPolicy: 'no-referrer',
    };
  }

  async function tryPlay() {
    try {
      await videoEl.play();
    } catch {
      // user gesture may still be required in some cases
    }
  }

  function useDirectVideoUrl(url) {
    destroyHls();
    if (!getHttpOrigin(url)) {
      setStatus('This preview source is unsupported. Open the page to play the video.', 'error');
      return;
    }
    // Native playback streams/seeks the file without buffering an entire video
    // in extension memory. It does not replay captured request headers.
    videoEl.src = url;
    videoEl.load();
    void tryPlay();
  }

  function fallbackToDirectIfAvailable(reason) {
    if (!fallbackUrl || usingFallback) {
      appendDebug('No fallback available', { reason });
      setStatus('Preview unavailable. Open the page to play this video.', 'error');
      return false;
    }
    usingFallback = true;
    setSourceLabel();
    appendDebug('Switching to fallback source', { reason, fallbackUrl });
    setStatus(`HLS unavailable (${reason}). Using fallback source.`, 'warn');
    useDirectVideoUrl(fallbackUrl);
    return true;
  }

  async function loadCurrentSource() {
    const url = getCurrentUrl();
    if (!url) {
      setStatus('No source URL available for playback.', 'error');
      return;
    }

    setSourceLabel();
    appendDebug('Loading source', {
      url,
      declaredType,
      usingFallback,
      hasSourcePageUrl: !!sourcePageUrl,
      forwardedHeaderKeys: Object.keys(normalizeRequestHeaders(requestHeaders)),
    });

    const hlsCandidate = declaredType === 'hls' || isHlsUrl(url);
    if (!hlsCandidate) {
      setStatus('Loading direct media source.', 'ok');
      useDirectVideoUrl(url);
      return;
    }

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      appendDebug('Native HLS support detected, but forcing HLS.js to preserve request context');
    }

    if (typeof window.Hls === 'undefined' || !window.Hls || !window.Hls.isSupported()
      || !window.fetch || !window.AbortController || !window.ReadableStream || !window.Request) {
      const switched = fallbackToDirectIfAvailable('browser does not support HLS.js');
      if (!switched) {
        setStatus('This browser cannot preview this video. Open the page to play it.', 'error');
      }
      return;
    }

    destroyHls();
    hls = new window.Hls({
      enableWorker: true,
      // In the bundled HLS.js version this selects FetchLoader, which honours
      // redirect:error for manifests, keys and all fragment requests.
      progressive: true,
      lowLatencyMode: true,
      backBufferLength: 60,
      xhrSetup: (xhr) => {
        xhr.abort();
        throw new Error('Safe HLS preview requires the Fetch loader. Open the source page.');
      },
      fetchSetup: (context, initParams) => {
        const request = new Request(context.url, buildFetchOptions(context.url, initParams || {}));
        appendDebug('Configured HLS fetch request', {
          url: context.url,
          sameOrigin: getHttpOrigin(context.url) === getHttpOrigin(primaryUrl),
          headerKeys: [...request.headers.keys()],
        });
        return request;
      },
    });

    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
      appendDebug('HLS media attached', { url });
      hls.loadSource(url);
    });

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      appendDebug('HLS manifest parsed successfully');
      setStatus('Streaming HLS manifest.', 'ok');
      void tryPlay();
    });

    hls.on(window.Hls.Events.LEVEL_LOADED, (_event, data) => {
      appendDebug('HLS level loaded', {
        level: data && data.level,
        url: data && data.details && data.details.url,
      });
    });

    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      const reason = data && (data.details || data.type) || 'unknown HLS error';
      const responseCode = Number(data && data.response && data.response.code || 0);
      appendDebug('HLS error', {
        fatal: !!(data && data.fatal),
        type: data && data.type,
        details: data && data.details,
        responseCode,
        url: data && data.context && data.context.url,
      });
      if (!data || !data.fatal) return;
      if (fallbackToDirectIfAvailable(reason)) return;
      if (responseCode === 403) {
        setStatus('This video needs its original page to play. Open the page to continue.', 'error');
        return;
      }
      setStatus('Preview unavailable. Open the page to play this video.', 'error');
    });

    hls.attachMedia(videoEl);
    setStatus('Loading HLS stream with captured request context...', 'ok');
  }

  function openInNewTab(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function loadStreamSession(id) {
    if (!id || !chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      return null;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        cmd: 'GET_STREAM_SESSION',
        sessionId: id,
      });
      if (!response || !response.ok || !response.session) return null;
      return response.session;
    } catch {
      return null;
    }
  }

  async function initializeFromSessionIfAvailable() {
    if (!sessionId) return;
    const session = await loadStreamSession(sessionId);
    if (!session) return;

    primaryUrl = String(session.sourceUrl || '').trim();
    fallbackUrl = String(session.fallbackUrl || '').trim();
    declaredType = String(session.declaredType || '').trim().toLowerCase();
    displayTitle = String(session.title || displayTitle || 'Stream Player').trim();
    sourcePageUrl = String(session.sourcePageUrl || '').trim();
    requestHeaders = session.requestHeaders && typeof session.requestHeaders === 'object'
      ? session.requestHeaders
      : {};
    credentialed = session.credentialed !== false;
  }

  async function init() {
    await initializeFromSessionIfAvailable();
    appendDebug('Stream session initialized', {
      hasPrimaryUrl: !!primaryUrl,
      hasFallbackUrl: !!fallbackUrl,
      declaredType,
      sourcePageUrl: sourcePageUrl || null,
      forwardedHeaderKeys: Object.keys(normalizeRequestHeaders(requestHeaders)),
    });

    titleEl.textContent = displayTitle || 'Stream Player';
    document.title = `${displayTitle || 'Stream Player'} - Stream Player`;

    openSourceBtn?.addEventListener('click', () => openInNewTab(sourcePageUrl || primaryUrl));
    if (!sourcePageUrl && !primaryUrl && openSourceBtn) {
      openSourceBtn.disabled = true;
    }

    openFallbackBtn?.addEventListener('click', () => openInNewTab(fallbackUrl));
    if (!fallbackUrl && openFallbackBtn) {
      openFallbackBtn.disabled = true;
    }

    retryBtn?.addEventListener('click', () => {
      usingFallback = false;
      appendDebug('Retry requested');
      loadCurrentSource();
    });

    videoEl.addEventListener('error', () => {
      appendDebug('Video element emitted error');
      const switched = fallbackToDirectIfAvailable('video element error');
      if (!switched) {
        setStatus('Preview unavailable. Open the page to play this video.', 'error');
      }
    });

    setSourceLabel();
    loadCurrentSource();
  }

  void init();

  window.addEventListener('beforeunload', () => {
    destroyHls();
  });
})();
