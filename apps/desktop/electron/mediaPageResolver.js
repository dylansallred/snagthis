const { BrowserWindow, session } = require('electron');
const { randomUUID } = require('node:crypto');
const { parseHlsManifest } = require('@m3u8/contracts');

const MAX_MANIFEST_BYTES = 1_000_000;
const pageMetadataScript = `(() => {
  const videos = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const video = videos[0];
  if (video && video.paused) { video.muted = true; video.play().catch(() => {}); }
  const meta = (selector) => document.querySelector(selector)?.content || '';
  return {
    title: navigator.mediaSession?.metadata?.title || document.querySelector('h1')?.textContent
      || meta('meta[property="og:title"]') || document.title || '',
    thumbnailUrl: video?.poster || '',
    currentSrc: video?.currentSrc || '',
    duration: Number.isFinite(video?.duration) ? video.duration : 0,
    videoCount: videos.length
  };
})()`;

function publicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host === '::1' || host === '::' || /^(?:(?:fc|fd)[0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(host)
      || /^(?:0|10|127)\./.test(host) || /^169\.254\./.test(host)
      || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      || /^::ffff:/i.test(host)) return null;
    return url.href;
  } catch { return null; }
}

function mediaHeaders(input) {
  const headers = {};
  for (const [name, rawValue] of Object.entries(input || {})) {
    const key = name.toLowerCase();
    const value = String(rawValue || '');
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key) || /[\r\n]/.test(value)) continue;
    if (key.startsWith('sec-') || ['host', 'connection', 'content-length', 'accept-encoding', 'range', 'if-range'].includes(key)) continue;
    headers[key] = value;
  }
  return headers;
}

/** Resolve only media that a fresh, isolated browser actually observes loading. */
async function resolveMediaPage({ url, timeoutMs = 25_000, onStage }) {
  const startedAt = Date.now();
  let stage = 'browser-setup';
  const reportStage = (value) => {
    stage = value;
    try { onStage?.({ stage, elapsedMs: Date.now() - startedAt }); } catch { /* Diagnostics never control resolution. */ }
  };
  const sourcePageUrl = publicHttpUrl(url);
  if (!sourcePageUrl) throw new Error('This page must use a public HTTP or HTTPS address.');
  const pageSession = session.fromPartition(`vidsnag-resolve-${randomUUID()}`, { cache: false });
  pageSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  pageSession.setPermissionCheckHandler(() => false);
  const denyDownload = (event) => event.preventDefault();
  pageSession.on('will-download', denyDownload);
  const window = new BrowserWindow({
    show: false, width: 1100, height: 760,
    webPreferences: {
      session: pageSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false,
    },
  });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event, target) => { if (!publicHttpUrl(target)) event.preventDefault(); });

  const requests = new Map();
  const requestHeaders = new Map();
  const candidates = new Map();
  const components = new Set();
  const diagnostics = { documentLoaded: false, videoCount: 0, manifestResponses: 0, failedRequests: 0, detectedDrm: false };
  let metadata = {};
  let settled = false;
  let metadataBusy = false;
  let timeout;
  let metadataTimer;
  let candidateTimer;
  let candidateDeadline = 0;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    if (error) rejectResult(error); else resolveResult(value);
  };
  timeout = setTimeout(() => {
    const error = new Error(diagnostics.detectedDrm
      ? 'This page uses a protected stream that VidSnag cannot download.'
      : 'The page did not expose a playable video. Open it in your browser and use the VidSnag extension.');
    error.code = diagnostics.detectedDrm ? 'DRM_UNSUPPORTED' : 'PAGE_VIDEO_UNAVAILABLE';
    error.details = { stage, ...diagnostics };
    finish(error);
  }, Math.min(30_000, Math.max(1000, Number(timeoutMs) || 25_000)));
  const readMetadata = async () => {
    if (settled || metadataBusy || contents.isDestroyed()) return;
    metadataBusy = true;
    try {
      metadata = await contents.executeJavaScript(pageMetadataScript);
      diagnostics.videoCount = metadata.videoCount || 0;
    } catch { /* The document can be between navigations. */ }
    finally { metadataBusy = false; }
  };
  const chooseCandidate = async () => {
    if (settled) return;
    await readMetadata();
    const streams = [...candidates.values()].filter((entry) => !components.has(entry.mediaUrl));
    const chosen = streams.find((entry) => entry.manifest?.isMaster && entry.manifest.variants.length)
      || streams.find((entry) => entry.mediaType === 'hls')
      || streams.find((entry) => entry.mediaType === 'file' && entry.mediaUrl === metadata.currentSrc && metadata.duration > 0);
    if (!chosen) return;
    finish(null, {
      mediaUrl: chosen.mediaUrl, mediaType: chosen.mediaType, sourcePageUrl,
      title: String(metadata.title || '').trim().slice(0, 255),
      thumbnailUrl: publicHttpUrl(metadata.thumbnailUrl) || undefined,
      headers: mediaHeaders(requestHeaders.get(chosen.mediaUrl) || chosen.headers),
      ...(chosen.manifestText ? { manifestText: chosen.manifestText } : {}),
    });
  };
  const scheduleCandidate = (master) => {
    const deadline = Date.now() + (master ? 300 : 1200);
    // Live playlists can refresh faster than the selection delay. Keep the
    // earliest decision; a master may accelerate it but never postpone it.
    if (candidateTimer && candidateDeadline <= deadline) return;
    if (candidateTimer) clearTimeout(candidateTimer);
    candidateDeadline = deadline;
    candidateTimer = setTimeout(() => {
      candidateTimer = undefined;
      candidateDeadline = 0;
      chooseCandidate().catch(() => {});
    }, Math.max(0, deadline - Date.now()));
  };

  pageSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: (details.url !== 'about:blank' && !publicHttpUrl(details.url) && !/^(?:data|blob):/i.test(details.url)) || components.has(details.url) });
  });
  pageSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (requestHeaders.size < 500 && publicHttpUrl(details.url)) requestHeaders.set(details.url, details.requestHeaders);
    callback({ requestHeaders: details.requestHeaders });
  });

  const onDebugMessage = async (_event, method, params) => {
    if (settled) return;
    if (method === 'Network.responseReceived') {
      const response = params.response;
      const mediaUrl = publicHttpUrl(response.url);
      if (!mediaUrl || response.status < 200 || response.status >= 300) return;
      const mime = String(response.mimeType || '').toLowerCase();
      const bodyCandidate = /mpegurl|text\/plain|octet-stream|image\//.test(mime)
        || /\.m3u8(?:[?#]|$)/i.test(mediaUrl) || ['XHR', 'Fetch'].includes(params.type);
      const contentLength = Number(Object.entries(response.headers || {}).find(([name]) => name.toLowerCase() === 'content-length')?.[1] || 0);
      if (bodyCandidate && contentLength <= MAX_MANIFEST_BYTES && requests.size < 500) {
        requests.set(params.requestId, { mediaUrl, headers: response.requestHeaders });
      }
      if (/^video\/(?!mp2t)/.test(mime) && !components.has(mediaUrl)) {
        candidates.set(mediaUrl, { mediaUrl, mediaType: 'file', headers: response.requestHeaders });
        scheduleCandidate(false);
      }
    } else if (method === 'Network.loadingFailed') {
      requests.delete(params.requestId);
      diagnostics.failedRequests += 1;
    } else if (method === 'Network.loadingFinished') {
      const response = requests.get(params.requestId);
      requests.delete(params.requestId);
      if (!response || params.encodedDataLength > MAX_MANIFEST_BYTES) return;
      try {
        const value = await contents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        if (settled || value.body.length > MAX_MANIFEST_BYTES * 1.4) return;
        const text = value.base64Encoded ? Buffer.from(value.body, 'base64').toString('utf8') : value.body;
        if (Buffer.byteLength(text) > MAX_MANIFEST_BYTES || !text.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) return;
        const manifest = parseHlsManifest(text, response.mediaUrl);
        diagnostics.manifestResponses += 1;
        for (const component of [...manifest.segmentUrls, ...manifest.initializationUrls]) components.add(component);
        if (manifest.isDrm) { diagnostics.detectedDrm = true; return; }
        candidates.set(response.mediaUrl, { ...response, mediaType: 'hls', manifestText: text, manifest });
        scheduleCandidate(manifest.isMaster);
      } catch { /* Evicted, oversized, or non-playlist responses are not media evidence. */ }
    }
  };

  try {
    reportStage('renderer-starting');
    await Promise.race([window.loadURL('about:blank'), result]);
    reportStage('network-observation-starting');
    contents.debugger.attach('1.3');
    contents.debugger.on('message', onDebugMessage);
    await Promise.race([contents.debugger.sendCommand('Network.enable', {
      maxTotalBufferSize: 8_000_000, maxResourceBufferSize: MAX_MANIFEST_BYTES,
    }), result]);
    contents.on('dom-ready', () => { diagnostics.documentLoaded = true; reportStage('observing-page'); readMetadata().catch(() => {}); });
    contents.on('render-process-gone', () => finish(new Error('The page closed before its video could be found.')));
    metadataTimer = setInterval(() => { readMetadata().catch(() => {}); }, 500);
    reportStage('page-loading');
    window.loadURL(sourcePageUrl).catch(() => {
      if (!diagnostics.documentLoaded) finish(new Error('The video page could not be loaded.'));
    });
    return await result;
  } finally {
    reportStage('cleanup');
    settled = true;
    clearTimeout(timeout);
    clearTimeout(candidateTimer);
    clearInterval(metadataTimer);
    pageSession.webRequest.onBeforeRequest(null);
    pageSession.webRequest.onBeforeSendHeaders(null);
    if (!contents.isDestroyed()) {
      contents.debugger.removeListener('message', onDebugMessage);
      if (contents.debugger.isAttached()) contents.debugger.detach();
      window.destroy();
    }
    pageSession.removeListener('will-download', denyDownload);
    let cleanupTimer;
    await Promise.race([
      Promise.allSettled([pageSession.closeAllConnections(), pageSession.clearStorageData()]),
      new Promise((resolve) => { cleanupTimer = setTimeout(resolve, 2000); }),
    ]);
    clearTimeout(cleanupTimer);
    pageSession.setPermissionRequestHandler(null);
    pageSession.setPermissionCheckHandler(null);
    reportStage('closed');
  }
}

module.exports = { resolveMediaPage };
