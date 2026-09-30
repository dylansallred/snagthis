const { BrowserWindow, session } = require('electron');
const { parseHlsManifest } = require('@m3u8/contracts');
const { isPublicAddress, assertPublicUrl } = require('@m3u8/downloader-api/src/utils/publicAddress');

const MAX_MANIFEST_BYTES = 1_000_000;
const NETWORK_BUFFERS = { maxTotalBufferSize: 8_000_000, maxResourceBufferSize: MAX_MANIFEST_BYTES };
const MAX_CHILD_SESSIONS = 16;
const MAX_OBSERVED_URLS = 32;
const CLICK_TO_PLAY_DELAY_MS = 6000;
const pageMetadataScript = `(() => {
  const videos = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const video = videos[0];
  if (video && video.paused) { video.muted = true; video.play().catch(() => {}); }
  const meta = (selector) => document.querySelector(selector)?.content || '';
  return {
    title: navigator.mediaSession?.metadata?.title || document.querySelector('h1')?.textContent
      || meta('meta[property="og:title"]') || document.title || '',
    thumbnailUrl: video?.poster || '',
    pageTitle: document.title || '',
    siteName: meta('meta[property="og:site_name"]'),
    uploader: meta('meta[name="author"]') || document.querySelector('[itemprop="author"] [itemprop="name"]')?.content || '',
    currentSrc: video?.currentSrc || '',
    duration: Number.isFinite(video?.duration) ? video.duration : 0,
    videoCount: videos.length
  };
})()`;
// Locate the one element that a person would click to start playback: the
// largest visible <video>, else the largest iframe when it is player-sized.
// A covering element is accepted only when it sits inside the player's box and
// is not a link, so overlays such as ads are never clicked.
const clickTargetScript = `(() => {
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0;
  };
  const area = (el) => { const rect = el.getBoundingClientRect(); return rect.width * rect.height; };
  const largest = (selector) => [...document.querySelectorAll(selector)].filter(visible).sort((a, b) => area(b) - area(a))[0];
  let target = largest('video');
  if (!target) {
    const frame = largest('iframe');
    const rect = frame?.getBoundingClientRect();
    if (rect && rect.width >= 200 && rect.height >= 150) target = frame;
  }
  if (!target) return null;
  target.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = target.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  if (hit !== target && !target.contains(hit)) {
    const box = hit.getBoundingClientRect();
    const inside = box.left >= rect.left - 2 && box.top >= rect.top - 2 && box.right <= rect.right + 2 && box.bottom <= rect.bottom + 2;
    if (!inside || hit.closest('a[href]')) return null;
  }
  return { x, y, kind: target.tagName.toLowerCase() };
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
      || /^::ffff:/i.test(host) || (/^[\d.]+$|:/.test(host) && !isPublicAddress(host))) return null;
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

// Electron never frees a partition's session. Reuse a small fixed pool of
// in-memory partitions, give each resolve exclusive use of one, and wipe it
// afterwards so every page still starts from an empty, isolated profile.
const RESOLVER_SESSION_COUNT = 2;
const idleResolverSlots = Array.from({ length: RESOLVER_SESSION_COUNT }, (_, index) => index);
const resolverWaiters = [];

function acquireResolverSlot() {
  if (idleResolverSlots.length) return Promise.resolve(idleResolverSlots.shift());
  return new Promise((resolve) => resolverWaiters.push(resolve));
}

function releaseResolverSlot(slot) {
  const next = resolverWaiters.shift();
  if (next) next(slot); else idleResolverSlots.push(slot);
}

/** Resolve only media that a fresh, isolated browser actually observes loading. */
async function resolveMediaPage(options) {
  const slot = await acquireResolverSlot();
  try {
    return await resolveWithSession(session.fromPartition(`snagthis-resolve-${slot}`, { cache: false }), options);
  } finally {
    releaseResolverSlot(slot);
  }
}

async function resolveWithSession(pageSession, { url, timeoutMs = 25_000, onStage, lookup }) {
  const startedAt = Date.now();
  let stage = 'browser-setup';
  const reportStage = (value) => {
    stage = value;
    try { onStage?.({ stage, elapsedMs: Date.now() - startedAt }); } catch { /* Diagnostics never control resolution. */ }
  };
  const sourcePageUrl = publicHttpUrl(url);
  if (!sourcePageUrl) throw new Error('This page must use a public HTTP or HTTPS address.');
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
  // Successful public responses from every target, used to report which child
  // playlists the page's own player actually loaded.
  const loadedUrls = new Set();
  const childSessions = new Set();
  const diagnostics = {
    documentLoaded: false, videoCount: 0, manifestResponses: 0, failedRequests: 0, detectedDrm: false,
    childTargets: 0, clickedToPlay: false,
  };
  const timeoutLimit = Math.min(30_000, Math.max(1000, Number(timeoutMs) || 25_000));
  let metadata = {};
  let clickTimer;
  let clickAttempted = false;
  let observationExtended = false;
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
      ? 'This page uses a protected stream that SnagThis cannot download.'
      : 'The page did not expose a playable video. Open it in your browser and use the SnagThis extension.');
    error.code = diagnostics.detectedDrm ? 'DRM_UNSUPPORTED' : 'PAGE_VIDEO_UNAVAILABLE';
    error.details = { stage, ...diagnostics };
    finish(error);
  }, timeoutLimit);
  const send = (method, params, sessionId) => (sessionId
    ? contents.debugger.sendCommand(method, params, sessionId)
    : contents.debugger.sendCommand(method, params));
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
    const observedUrls = chosen.manifest?.isMaster ? observedChildren(chosen.manifest) : [];
    if (chosen.manifest?.isMaster && !observedUrls.length && !observationExtended) {
      // A master often arrives just before the player's first variant request.
      // Wait briefly, once, so the result can report which rendition played.
      observationExtended = true;
      scheduleAfter(1500);
      return;
    }
    finish(null, {
      mediaUrl: chosen.mediaUrl, mediaType: chosen.mediaType, sourcePageUrl,
      title: String(metadata.title || '').trim().slice(0, 255),
      // Kept with the saved video to name where it came from; plain text only.
      pageTitle: String(metadata.pageTitle || '').trim().slice(0, 255) || undefined,
      siteName: String(metadata.siteName || '').trim().slice(0, 80) || undefined,
      uploader: String(metadata.uploader || '').trim().slice(0, 180) || undefined,
      thumbnailUrl: publicHttpUrl(metadata.thumbnailUrl) || undefined,
      headers: mediaHeaders(requestHeaders.get(chosen.mediaUrl) || chosen.headers),
      ...(chosen.manifestText ? { manifestText: chosen.manifestText } : {}),
      ...(observedUrls.length ? { observedUrls } : {}),
    });
  };
  const loadedKey = (value) => { try { const parsed = new URL(value); return parsed.origin + parsed.pathname; } catch { return ''; } };
  const observedChildren = (manifest) => {
    const loadedPaths = new Set([...loadedUrls].map(loadedKey));
    const children = [...manifest.variants.map((variant) => variant.url), ...manifest.audio.map((rendition) => rendition.url)];
    const observed = [];
    for (const child of children) {
      const childUrl = child && publicHttpUrl(child);
      if (!childUrl || observed.includes(childUrl) || observed.length >= MAX_OBSERVED_URLS) continue;
      if (loadedUrls.has(childUrl) || loadedPaths.has(loadedKey(childUrl))) observed.push(childUrl);
    }
    return observed;
  };
  const scheduleAfter = (delay) => {
    if (candidateTimer) clearTimeout(candidateTimer);
    candidateDeadline = Date.now() + delay;
    candidateTimer = setTimeout(() => {
      candidateTimer = undefined;
      candidateDeadline = 0;
      chooseCandidate().catch(() => {});
    }, delay);
  };
  const clickToPlay = async () => {
    if (settled || clickAttempted || candidates.size || contents.isDestroyed()) return;
    clickAttempted = true;
    try {
      const point = await contents.executeJavaScript(clickTargetScript);
      if (settled || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const click = { x: point.x, y: point.y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...click });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...click });
      diagnostics.clickedToPlay = true;
    } catch { /* The page may be navigating; one attempt is the limit. */ }
  };
  const scheduleCandidate = (master) => {
    const deadline = Date.now() + (master ? 300 : 1200);
    // Live playlists can refresh faster than the selection delay. Keep the
    // earliest decision; a master may accelerate it but never postpone it.
    if (candidateTimer && candidateDeadline <= deadline) return;
    scheduleAfter(Math.max(0, deadline - Date.now()));
  };

  // Every page, frame, redirect and subresource request goes only to hosts whose
  // DNS answers are public: never this computer or the local network (including
  // CGNAT and unique-local IPv6). Answers are cached for this resolve.
  const hostChecks = new Map();
  const publicDestination = (value) => {
    const host = new URL(value).host;
    if (!hostChecks.has(host)) hostChecks.set(host, assertPublicUrl(value, { lookup }).then(() => true, () => false));
    return hostChecks.get(host);
  };
  pageSession.webRequest.onBeforeRequest((details, callback) => {
    if (components.has(details.url)) { callback({ cancel: true }); return; }
    if (details.url === 'about:blank' || /^(?:data|blob):/i.test(details.url)) { callback({ cancel: false }); return; }
    if (!publicHttpUrl(details.url)) { callback({ cancel: true }); return; }
    publicDestination(details.url).then((allowed) => callback({ cancel: settled || !allowed }), () => callback({ cancel: true }));
  });
  pageSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (requestHeaders.size < 500 && publicHttpUrl(details.url)) requestHeaders.set(details.url, details.requestHeaders);
    callback({ requestHeaders: details.requestHeaders });
  });

  // Cross-origin iframe players run in their own renderer targets. Observe
  // them through flattened auto-attach sessions with the same limits as the
  // top page, and always let a paused target continue.
  const attachChild = async (params) => {
    const childId = params.sessionId;
    const type = params.targetInfo?.type;
    try {
      if (!childId || settled || !['iframe', 'worker'].includes(type) || childSessions.size >= MAX_CHILD_SESSIONS) return;
      childSessions.add(childId);
      diagnostics.childTargets += 1;
      await Promise.allSettled([
        send('Network.enable', NETWORK_BUFFERS, childId),
        type === 'iframe' ? send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, childId) : null,
      ]);
    } finally {
      if (childId && !settled) send('Runtime.runIfWaitingForDebugger', {}, childId).catch(() => {});
    }
  };
  const onDebugMessage = async (_event, method, params, sessionId) => {
    if (settled) return;
    const requestKey = `${sessionId || ''}:${params?.requestId}`;
    if (method === 'Target.attachedToTarget') {
      await attachChild(params);
    } else if (method === 'Target.detachedFromTarget') {
      childSessions.delete(params.sessionId);
      for (const key of requests.keys()) if (key.startsWith(`${params.sessionId}:`)) requests.delete(key);
    } else if (method === 'Network.responseReceived') {
      const response = params.response;
      const mediaUrl = publicHttpUrl(response.url);
      if (!mediaUrl || response.status < 200 || response.status >= 300) return;
      if (loadedUrls.size < 500) loadedUrls.add(mediaUrl);
      const mime = String(response.mimeType || '').toLowerCase();
      const bodyCandidate = /mpegurl|text\/plain|octet-stream|image\//.test(mime)
        || /\.m3u8(?:[?#]|$)/i.test(mediaUrl) || ['XHR', 'Fetch'].includes(params.type);
      const contentLength = Number(Object.entries(response.headers || {}).find(([name]) => name.toLowerCase() === 'content-length')?.[1] || 0);
      if (bodyCandidate && contentLength <= MAX_MANIFEST_BYTES && requests.size < 500) {
        requests.set(requestKey, { mediaUrl, headers: response.requestHeaders });
      }
      if (/^video\/(?!mp2t)/.test(mime) && !components.has(mediaUrl)) {
        candidates.set(mediaUrl, { mediaUrl, mediaType: 'file', headers: response.requestHeaders });
        scheduleCandidate(false);
      }
    } else if (method === 'Network.loadingFailed') {
      const failed = requests.get(requestKey);
      if (failed) loadedUrls.delete(failed.mediaUrl);
      requests.delete(requestKey);
      diagnostics.failedRequests += 1;
    } else if (method === 'Network.loadingFinished') {
      const response = requests.get(requestKey);
      requests.delete(requestKey);
      if (!response || params.encodedDataLength > MAX_MANIFEST_BYTES) return;
      try {
        const value = await send('Network.getResponseBody', { requestId: params.requestId }, sessionId);
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
    await Promise.race([send('Network.enable', NETWORK_BUFFERS), result]);
    await Promise.race([send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }), result]);
    contents.on('dom-ready', () => {
      diagnostics.documentLoaded = true;
      reportStage('observing-page');
      readMetadata().catch(() => {});
      // One bounded click on the player when nothing has started by itself.
      if (!clickTimer) clickTimer = setTimeout(() => { clickToPlay().catch(() => {}); }, Math.min(CLICK_TO_PLAY_DELAY_MS, timeoutLimit / 3));
    });
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
    clearTimeout(clickTimer);
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
      Promise.allSettled([pageSession.closeAllConnections(), pageSession.clearStorageData(), pageSession.clearCache(), pageSession.clearAuthCache()]),
      new Promise((resolve) => { cleanupTimer = setTimeout(resolve, 2000); }),
    ]);
    clearTimeout(cleanupTimer);
    pageSession.setPermissionRequestHandler(null);
    pageSession.setPermissionCheckHandler(null);
    reportStage('closed');
  }
}

module.exports = { resolveMediaPage };
