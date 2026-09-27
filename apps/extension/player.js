(function bootstrapStreamPlayer() {
  const titleEl = document.getElementById('title');
  const sourceEl = document.getElementById('source');
  const statusEl = document.getElementById('status');
  const videoEl = document.getElementById('player');
  const openPageBtn = document.getElementById('openPageBtn');
  const retryBtn = document.getElementById('retryBtn');

  if (!videoEl || !statusEl || !titleEl || !sourceEl) {
    return;
  }

  // The popup opens this page with a short-lived session the worker created;
  // nothing is taken from other query parameters.
  const sessionId = String(new URLSearchParams(window.location.search).get('session') || '').trim();

  let primaryUrl = '';
  let declaredType = '';
  let displayTitle = 'Preview';
  let sourcePageUrl = '';
  let requestHeaders = {};
  // Cookies travel only for media Chrome itself observed on the source tab.
  let credentialed = true;

  let hls = null;

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

  function setStatus(message, tone = 'ok') {
    statusEl.textContent = String(message || '');
    statusEl.className = `status ${tone}`;
  }

  // Media URLs often carry signed tokens; show only where the video is from.
  function setSourceLabel() {
    let host = '';
    try { host = new URL(sourcePageUrl || primaryUrl).hostname; } catch { /* No source. */ }
    sourceEl.textContent = host;
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

  function isDashUrl(url) {
    return /\.mpd(\?|$)/i.test(String(url || ''));
  }

  function loadCurrentSource() {
    const url = primaryUrl;
    if (!url) {
      setStatus('This preview has expired. Choose Preview in SnagThis again.', 'error');
      return;
    }

    setSourceLabel();
    // The browser cannot play a DASH manifest as a file, and this page has no
    // DASH player; say so instead of failing after a load.
    if (declaredType === 'dash' || isDashUrl(url)) {
      destroyHls();
      setStatus('This video can only be previewed on its page. Open the page to play it.', 'warn');
      return;
    }

    const hlsCandidate = declaredType === 'hls' || isHlsUrl(url);
    if (!hlsCandidate) {
      setStatus('Loading video…', 'ok');
      useDirectVideoUrl(url);
      return;
    }

    if (typeof window.Hls === 'undefined' || !window.Hls || !window.Hls.isSupported()
      || !window.fetch || !window.AbortController || !window.ReadableStream || !window.Request) {
      setStatus('This browser cannot preview this video. Open the page to play it.', 'error');
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
      fetchSetup: (context, initParams) => new Request(context.url, buildFetchOptions(context.url, initParams || {})),
    });

    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(url);
    });

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      setStatus('Playing preview.', 'ok');
      void tryPlay();
    });

    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      const responseCode = Number(data && data.response && data.response.code || 0);
      if (!data || !data.fatal) return;
      if (responseCode === 403) {
        setStatus('This video needs its original page to play. Open the page to continue.', 'error');
        return;
      }
      setStatus('Preview unavailable. Open the page to play this video.', 'error');
    });

    hls.attachMedia(videoEl);
    setStatus('Loading video…', 'ok');
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
    declaredType = String(session.declaredType || '').trim().toLowerCase();
    displayTitle = String(session.title || displayTitle).trim();
    sourcePageUrl = String(session.sourcePageUrl || '').trim();
    requestHeaders = session.requestHeaders && typeof session.requestHeaders === 'object'
      ? session.requestHeaders
      : {};
    credentialed = session.credentialed !== false;
  }

  async function init() {
    await initializeFromSessionIfAvailable();

    titleEl.textContent = displayTitle || 'Preview';
    document.title = `${displayTitle || 'Preview'} - SnagThis`;

    // The page, not the raw media URL, plays the video with its own cookies
    // and headers.
    const pageUrl = getHttpOrigin(sourcePageUrl) ? sourcePageUrl : '';
    openPageBtn?.addEventListener('click', () => openInNewTab(pageUrl));
    if (openPageBtn) openPageBtn.hidden = !pageUrl;

    retryBtn?.addEventListener('click', () => loadCurrentSource());
    if (retryBtn) retryBtn.hidden = !primaryUrl;

    videoEl.addEventListener('error', () => {
      if (!videoEl.getAttribute('src')) return;
      setStatus('Preview unavailable. Open the page to play this video.', 'error');
    });

    setSourceLabel();
    loadCurrentSource();
  }

  void init();

  window.addEventListener('beforeunload', () => {
    destroyHls();
  });
})();
