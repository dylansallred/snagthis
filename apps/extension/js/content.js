/* Isolated-world page metadata and video observation. Source pages never receive app credentials. */
(() => {
  'use strict';
  // The worker injects this file into tabs opened before install or update.
  // A live copy from the manifest keeps ownership; an orphaned one does not.
  if (globalThis.__snagthisContent?.live()) return;
  const CHANNEL = 'snagthis:media';
  const MAX_MANIFEST = 5 * 1024 * 1024;
  let lastPage = location.href;
  let scanTimer;
  let retired = false;
  let pagePreview = null;
  const events = new AbortController();
  const watchedVideos = new WeakMap();
  const reportedWorkerMedia = new Set();
  // DRM (EME) observation: which players decrypt, and the key system the page
  // asked for. Observed only; SnagThis never records or decrypts protected video.
  let encryptedVideos = new WeakMap();
  let requestedKeySystem = '';
  let encryptedInit = '';
  let resourceObserver = null;
  globalThis.__snagthisContent = { live: () => { try { return !retired && Boolean(chrome.runtime?.id); } catch { return false; } } };
  function retire() {
    if (retired) return;
    retired = true;
    cancelPagePreview();
    clearTimeout(scanTimer);
    observer.disconnect();
    resourceObserver?.disconnect();
    events.abort();
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch { /* The extension may already be unloaded. */ }
  }
  function messagingFailed(error) {
    if (/extension context invalidated/i.test(String(error?.message || error || ''))) retire();
  }
  function send(message) {
    if (retired) return false;
    try {
      // Reloading an extension invalidates old isolated worlds. Chrome can throw
      // before returning a promise, so a promise rejection handler alone is not enough.
      return Promise.resolve(chrome.runtime.sendMessage(message)).catch(error => { messagingFailed(error); return { ok: false }; });
    } catch (error) {
      messagingFailed(error);
      return false;
    }
  }
  function absolute(value) {
    if (!value) return '';
    try { const url = new URL(value, document.baseURI); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function meta(selector) { return document.querySelector(selector)?.getAttribute('content')?.trim() || ''; }
  function videoState(video) {
    let state = watchedVideos.get(video);
    if (!state) { state = { watching: false }; watchedVideos.set(video, state); }
    const source = `${location.href}\n${video.currentSrc || video.src || ''}`;
    if (state.source !== source) Object.assign(state, { source, prepared: false, attempts: 0, attemptedAt: -1 });
    return state;
  }
  function representativeFrameAvailable(video) {
    return video && Number.isFinite(video.duration) && video.duration > 0 && Number.isFinite(video.currentTime)
      && video.currentTime >= video.duration * .35 && video.currentTime <= video.duration * .8
      && video.readyState >= 2 && video.videoWidth > 0;
  }
  function isProtectedVideo(video) {
    try { return Boolean(video && (video.mediaKeys || encryptedVideos.has(video))); } catch { return false; }
  }
  // DRM on this player or page stops frame reads, even when it appears after a
  // capture started. A granted key-system request alone is not protection: many
  // players (YouTube included) probe EME for capability, as protectionState() does.
  function drmObserved(video) { return isProtectedVideo(video) || Boolean(encryptedInit); }
  // Key-system IDs inside the 'encrypted' event's init data (pssh boxes).
  function keySystemFromInitData(data) {
    try {
      const bytes = new Uint8Array(data || new ArrayBuffer(0)); let hex = '';
      for (let index = 0; index + 28 <= bytes.length; index++) {
        if (bytes[index] !== 0x70 || bytes[index + 1] !== 0x73 || bytes[index + 2] !== 0x73 || bytes[index + 3] !== 0x68) continue;
        for (let offset = index + 8; offset < index + 24; offset++) hex += bytes[offset].toString(16).padStart(2, '0');
        hex += ' ';
      }
      return keySystemName(hex);
    } catch { return ''; }
  }
  function keySystemName(value) {
    const text = String(value || '');
    if (/edef8ba979d64acea3c827dcd51d21ed|edef8ba9-79d6|widevine/i.test(text)) return 'widevine';
    if (/9a04f07998404286ab92e65be0885f95|9a04f079-9840|playready/i.test(text)) return 'playready';
    if (/94ce86fb07ff4f43adb893d2fa968ca2|94ce86fb-07ff|fairplay|com\.apple\.fps/i.test(text)) return 'fairplay';
    if (/e2719d58a985b3c9781ab030af78d30e|1077efecc0b24d02ace33c1e52e2fb4b|clearkey/i.test(text)) return 'clearkey';
    return '';
  }
  function onEncrypted(event) {
    const video = event.target;
    if (retired || !/^(?:VIDEO|AUDIO)$/i.test(String(video?.tagName || ''))) return;
    encryptedVideos.set(video, keySystemFromInitData(event.initData) || encryptedVideos.get(video) || '');
    scheduleScan();
  }
  function siteName() {
    const named = meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || meta('meta[name="apple-mobile-web-app-title"]');
    let host = ''; try { host = new URL(location.href).hostname.replace(/^www\./, ''); } catch { /* No usable page URL. */ }
    return (named || host).slice(0, 80);
  }
  function protectionState(videos) {
    const video = videos.find(isProtectedVideo);
    if (!video && !encryptedInit) return null;
    const source = String(video?.currentSrc || video?.src || '');
    return {
      keySystem: requestedKeySystem || (video && encryptedVideos.get(video)) || encryptedInit || '',
      signal: video?.mediaKeys ? 'mediakeys' : video ? 'encrypted' : 'init', siteName: siteName(),
      mediaSourceUrl: source.startsWith('blob:') ? 'blob:' : absolute(source),
      durationSeconds: video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      poster: absolute(video?.poster),
    };
  }
  function preparePagePoster(video) {
    if (retired || document.hidden || video.isConnected === false || isProtectedVideo(video) || !representativeFrameAvailable(video)) return;
    const state = videoState(video);
    if (state.prepared || state.attempts >= 3 || (state.attemptedAt >= 0 && Math.abs(video.currentTime - state.attemptedAt) < 1)) return;
    const source = absolute(video.currentSrc || video.src);
    // A blob can only be associated with the sole page player; its playlist
    // duration is checked again by the worker before accepting the frame.
    if (!source && (document.querySelectorAll('video').length !== 1 || !String(video.currentSrc || video.src).startsWith('blob:'))) return;
    state.attempts++; state.attemptedAt = video.currentTime;
    const context = collectPageContext(source);
    if (context.sourcePreviewPoster) send({ cmd: 'PAGE_CONTEXT', context });
  }
  function frameGrab(video) {
    // Protected (DRM) frames are never read, drawn or recorded.
    if (!video || drmObserved(video) || video.readyState < 2 || !video.videoWidth) return '';
    try {
      const canvas = document.createElement('canvas'); canvas.width = 208; canvas.height = 116;
      const context = canvas.getContext('2d'); if (!context) return '';
      context.drawImage(video, 0, 0, 208, 116);
      const pixels = context.getImageData(0, 0, 208, 116).data;
      let total = 0;
      let squared = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const gray = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
        total += gray;
        squared += gray * gray;
      }
      const count = pixels.length / 4;
      const average = total / count;
      const variance = squared / count - average * average;
      if (!(average > 22 && average < 240 && variance > 36)) return '';
      for (const quality of [0.65, 0.4, 0.2]) { const data = canvas.toDataURL('image/jpeg', quality); if (data.length <= 20480) return data; }
    } catch { /* Cross-origin video frames may have a tainted canvas. */ }
    return '';
  }
  const previewUnavailable = () => ({ ok: false, status: 'unavailable' });
  function cancelPagePreview(requestId) {
    if (!pagePreview || (requestId && pagePreview.requestId !== requestId)) return;
    const capture = pagePreview;
    pagePreview = null;
    capture.cancelled = true;
    capture.stop();
    for (const settle of capture.pending) settle(previewUnavailable());
  }
  function startPagePreview(message) {
    const metadata = collectPageContext().youtubeMetadata;
    if (!metadata || metadata.videoId !== message.videoId) return null;
    if (pagePreview?.requestId === message.requestId && pagePreview.videoId === metadata.videoId) return pagePreview;
    cancelPagePreview();
    const video = Array.from(document.querySelectorAll('video'))
      .filter(item => !item.paused && !item.ended && item.readyState >= 2 && item.videoWidth > 0)
      .sort((first, second) => second.videoWidth * second.videoHeight - first.videoWidth * first.videoHeight)[0];
    // Read only frames already decoded by the page. Never start or seek its player.
    if (!video || document.querySelector('.html5-video-player.ad-showing') || typeof MediaRecorder === 'undefined'
      || !MediaRecorder.isTypeSupported('video/webm;codecs=vp8') || !frameGrab(video)) return null;
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d');
    if (!context || typeof canvas.captureStream !== 'function') return null;
    const recorders = [];
    const timers = [];
    let stream;
    let frameTimer;
    const capture = { requestId: message.requestId, videoId: metadata.videoId, cancelled: false, pending: [],
      stop() {
        clearInterval(frameTimer);
        for (const timer of timers) clearTimeout(timer);
        for (const recorder of recorders) if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Already closing. */ } }
        for (const track of stream?.getTracks() || []) track.stop();
      },
    };
    pagePreview = capture;
    try {
      context.drawImage(video, 0, 0, 320, 180);
      stream = canvas.captureStream(12); // A canvas stream contains no audio track.
      const pageUrl = location.href;
      const sourceUrl = video.currentSrc;
      let lastTime = video.currentTime;
      const startedAt = performance.now();
      frameTimer = setInterval(() => {
        if (retired || location.href !== pageUrl || video.currentSrc !== sourceUrl || video.paused || video.ended || drmObserved(video)) {
          cancelPagePreview(capture.requestId); return;
        }
        if (video.readyState < 2 || video.currentTime === lastTime) return;
        lastTime = video.currentTime;
        try { context.drawImage(video, 0, 0, 320, 180); } catch { cancelPagePreview(capture.requestId); }
      }, 1000 / 12);
      const record = (seconds, complete) => new Promise(resolve => {
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 350000 });
        recorders.push(recorder);
        const chunks = [];
        let bytes = 0;
        let settled = false;
        const settle = result => { if (!settled) { settled = true; resolve(result); } };
        capture.pending.push(settle);
        recorder.ondataavailable = event => {
          if (capture.cancelled || !event.data.size) return;
          bytes += event.data.size;
          if (bytes > 1024 * 1024) { cancelPagePreview(capture.requestId); return; }
          chunks.push(event.data);
        };
        recorder.onerror = () => cancelPagePreview(capture.requestId);
        recorder.onstop = () => {
          if (capture.cancelled || !chunks.length) { settle(previewUnavailable()); return; }
          const blob = new Blob(chunks, { type: 'video/webm' });
          chunks.length = 0;
          const reader = new FileReader();
          reader.onerror = () => settle(previewUnavailable());
          reader.onload = () => settle(capture.cancelled ? previewUnavailable() : {
            ok: true, status: 'ready', sourcePreviewDataUrl: reader.result, complete,
            durationSeconds: Math.min(seconds, (performance.now() - startedAt) / 1000),
          });
          reader.readAsDataURL(blob);
        };
        recorder.start(250);
        timers.push(setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, seconds * 1000));
      });
      // Each response is a finished, playable WebM rather than a partial container.
      const failed = () => { cancelPagePreview(capture.requestId); return previewUnavailable(); };
      capture.quick = record(2, false).catch(failed);
      capture.full = record(10, true).catch(failed);
      capture.full.finally(() => capture.stop());
      return capture;
    } catch {
      cancelPagePreview(capture.requestId);
      return null;
    }
  }
  function collectPageContext(mediaUrl = '') {
    const videos = Array.from(document.querySelectorAll('video'));
    // A response can belong to a trailer or another player. Only the page-wide
    // context may use the sole video; request metadata needs its exact source.
    const video = mediaUrl ? videos.find(item => absolute(item.currentSrc || item.src) === mediaUrl)
      : videos.length === 1 ? videos[0] : null;
    const candidates = [
      { source: 'document.title', value: document.title },
      { source: 'meta.og:title', value: meta('meta[property="og:title"]') },
      { source: 'meta.twitter:title', value: meta('meta[name="twitter:title"]') },
      { source: 'dom.h1', value: document.querySelector('h1')?.textContent || '' },
    ].map(item => ({ source: item.source, value: String(item.value || '').trim().slice(0, 255) })).filter(item => item.value);
    const url = new URL(location.href);
    const id = /(^|\.)youtube\.com$/.test(url.hostname) ? url.searchParams.get('v') || /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1] : url.hostname === 'youtu.be' ? url.pathname.slice(1) : '';
    // YouTube keeps the first page's share tags (or its generic logo card)
    // after in-page navigation, so trust them only when they name this video.
    const shareTagsCurrent = Boolean(id) && String(meta('meta[property="og:url"]') || '').includes(id);
    const shareImage = shareTagsCurrent ? absolute(meta('meta[property="og:image"]')) : '';
    const youtube = /^[\w-]{6,20}$/.test(id || '') ? {
      videoId: id, title: ((shareTagsCurrent && meta('meta[property="og:title"]')) || document.title).replace(/^\(\d+\)\s*/, '').replace(/\s*[-|]\s*YouTube\s*$/i, ''),
      thumbnailUrl: /^https:\/\/i\d?\.ytimg\.com\//.test(shareImage) && shareImage.includes(`/${id}/`) ? shareImage : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      durationSeconds: video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      channelName: document.querySelector('[itemprop="author"] [itemprop="name"]')?.getAttribute('content') || '',
    } : null;
    // Social artwork often describes the site rather than this video. Only
    // YouTube has page artwork tied to a known video identity.
    const frame = !youtube && representativeFrameAvailable(video) ? frameGrab(video) : '';
    if (frame) videoState(video).prepared = true;
    const thumbnailUrl = youtube?.thumbnailUrl || frame || absolute(video?.poster);
    let pageEpisodeHint = null;
    let decodedPath = url.pathname; try { decodedPath = decodeURIComponent(url.pathname); } catch { /* Keep the encoded path if it is malformed. */ }
    const episode = /(?:^|\W)s(\d{1,2})e(\d{1,3})(?:\W|$)|(?:^|\W)(\d{1,2})x(\d{1,3})(?:\W|$)/i.exec(`${document.title} ${decodedPath}`);
    if (episode) pageEpisodeHint = { source: 'page', matchedPattern: 'explicit-season-episode', seasonNumber: Number(episode[1] || episode[3]), episodeNumber: Number(episode[2] || episode[4]) };
    return {
      sourcePageUrl: location.href, sourcePageTitle: document.title.slice(0, 255), pageTitleCandidates: candidates,
      ...(video || youtube ? {
        mediaSourceUrl: String(video?.currentSrc || video?.src || '').startsWith('blob:') ? 'blob:' : absolute(video?.currentSrc || video?.src),
        thumbnailUrl, poster: absolute(video?.poster), durationSeconds: video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
        height: video?.videoHeight || null,
        ...(video ? { presentation: presentation(video) } : {}),
        ...(frame ? { sourcePreviewPoster: frame, sourcePreviewSceneStart: video.currentTime, sourcePreviewSceneScope: 'source' } : {}),
      } : {}),
      youtubeMetadata: youtube, pageEpisodeHint, pageIsTvContext: Boolean(pageEpisodeHint), pageContextCollectedAt: Date.now(),
      protection: protectionState(videos),
    };
  }
  // How the element is shown: a tiny looping or muted autoplay clip is a
  // banner, not the page's video. The worker weighs this with its duration.
  function presentation(video) {
    let rect = null; try { rect = video.getBoundingClientRect(); } catch { /* Detached element. */ }
    return { width: Math.round(rect?.width || 0), height: Math.round(rect?.height || 0), loop: Boolean(video.loop), muted: Boolean(video.muted), autoplay: Boolean(video.autoplay) };
  }
  // A response answered by this frame's Service Worker (workerStart > 0) can
  // be a URL that only that worker understands. Report direct media files.
  function reportWorkerServedMedia(entries) {
    if (retired) return;
    const urls = [];
    for (const entry of entries) {
      if (!(entry.workerStart > 0)) continue;
      const url = absolute(entry.name).split('#')[0];
      if (!url || reportedWorkerMedia.has(url)) continue;
      if (!['video', 'audio'].includes(entry.initiatorType) && !/\.(?:mp4|m4v|mov|webm|mkv)(?:[?#]|$)/i.test(url)) continue;
      reportedWorkerMedia.add(url); urls.push(url);
    }
    if (urls.length) send({ cmd: 'SERVICE_WORKER_MEDIA', pageUrl: location.href, urls: urls.slice(0, 20) });
  }
  function watchWorkerServedMedia() {
    try {
      reportWorkerServedMedia(performance.getEntriesByType('resource'));
      resourceObserver = new PerformanceObserver(list => reportWorkerServedMedia(list.getEntries()));
      resourceObserver.observe({ type: 'resource' });
    } catch { /* Resource timing is unavailable in this frame. */ }
  }
  function navigation() {
    if (retired) return;
    if (lastPage === location.href) return;
    cancelPagePreview();
    reportedWorkerMedia.clear();
    // DRM signals describe the previous page; a reused player element must not
    // carry them to a clear video. A still-attached MediaKeys is re-read live.
    encryptedVideos = new WeakMap();
    requestedKeySystem = '';
    encryptedInit = '';
    lastPage = location.href;
    send({ cmd: 'PAGE_NAVIGATED', pageUrl: lastPage });
    scheduleScan();
  }
  function scan() {
    if (retired) return;
    navigation();
    if (retired) return;
    clearTimeout(scanTimer);
    scanTimer = undefined;
    const updates = [];
    const publish = message => { const pending = send(message); if (pending) updates.push(pending); return pending; };
    const context = collectPageContext();
    if (!publish({ cmd: 'PAGE_CONTEXT', context })) return;
    if (context.youtubeMetadata) {
      if (!publish({ cmd: 'STORE_DETECTED_MEDIA', media: { ...context, url: `https://www.youtube.com/watch?v=${context.youtubeMetadata.videoId}`, type: 'youtube', mediaKind: 'youtube-page', contentType: 'video/youtube' } })) return;
    }
    for (const video of Array.from(document.querySelectorAll('video')).slice(0, 20)) {
      const state = videoState(video);
      if (!state.watching) {
        state.watching = true;
        for (const event of ['loadedmetadata', 'loadeddata', 'playing', 'durationchange', 'seeked']) video.addEventListener(event, scheduleScan, { passive: true, signal: events.signal });
        video.addEventListener('timeupdate', () => preparePagePoster(video), { passive: true, signal: events.signal });
      }
      const sources = [video.currentSrc, video.getAttribute('src'), ...Array.from(video.querySelectorAll('source')).map(source => source.src)];
      for (const candidate of new Set(sources.map(absolute).filter(Boolean))) {
        if (!publish({ cmd: 'STORE_DETECTED_MEDIA', media: { ...collectPageContext(candidate), url: candidate, delivery: 'element', contentType: video.querySelector('source')?.type || 'video/unknown', detectedAt: Date.now() } })) return;
      }
    }
    return Promise.all(updates).then(results => ({ ok: !retired && results.every(result => result?.ok !== false) }));
  }
  function scheduleScan() {
    if (retired || scanTimer !== undefined) return;
    scanTimer = setTimeout(scan, 150);
  }
  function affectsContext(mutation) {
    const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
    if (target?.closest('video,source,title,h1,[itemprop="author"],[itemprop="name"]')) return true;
    if (mutation.type === 'attributes') return target?.matches('meta');
    if (mutation.type !== 'childList') return false;
    const selector = 'video,source,title,h1,meta,[itemprop="author"],[itemprop="name"]';
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector)));
  }
  window.addEventListener('message', event => {
    if (retired || event.source !== window || event.data?.source !== CHANNEL) return;
    if (event.data.navigation) { navigation(); return; }
    if (event.data.pageUrl && event.data.pageUrl !== location.href) return;
    // A page-world hint: which key system EME granted, or an encrypted init
    // segment the page's player fetched. It can only mark this page protected.
    const drm = event.data.protection;
    if (drm && typeof drm === 'object') {
      const keySystem = keySystemName(drm.keySystem);
      if (drm.signal === 'access' && keySystem) requestedKeySystem = keySystem;
      if (drm.signal === 'init') encryptedInit = keySystem || encryptedInit || 'unknown';
      scheduleScan(); return;
    }
    const incoming = event.data.media;
    if (!incoming || typeof incoming.url !== 'string' || !absolute(incoming.url)) return;
    const manifestText = typeof incoming.manifestText === 'string' ? incoming.manifestText : '';
    if (manifestText.length > MAX_MANIFEST) return;
    // Any page script can post on this channel. Forward only a detection hint;
    // request context (Origin, Referer, credentials) comes from Chrome's own
    // network events, never from page-supplied fields.
    const url = absolute(incoming.url);
    const method = /^[A-Z]{3,7}$/.test(String(incoming.method || '')) ? incoming.method : 'GET';
    send({ cmd: 'STORE_DETECTED_MEDIA', media: { url, contentType: String(incoming.contentType || '').slice(0, 200),
      contentLength: Number(incoming.contentLength) || 0, manifestText, method, delivery: 'script', ...collectPageContext(url) } });
  }, { signal: events.signal });
  function onRuntimeMessage(message, sender, respond) {
    if (message?.cmd === 'SCAN_PAGE') {
      Promise.resolve(scan()).then(result => respond?.(result || { ok: false }));
      return true;
    }
    if (!['GET_PAGE_VIDEO_PREVIEW', 'CANCEL_PAGE_VIDEO_PREVIEW'].includes(message?.cmd)) return;
    if (retired || sender?.id !== chrome.runtime.id || sender?.tab || !/^[a-zA-Z0-9-]{8,80}$/.test(message.requestId || '')) {
      respond(previewUnavailable()); return;
    }
    if (message.cmd === 'CANCEL_PAGE_VIDEO_PREVIEW') { cancelPagePreview(message.requestId); respond({ ok: true }); return; }
    if (!['quick', 'full'].includes(message.phase)) { respond(previewUnavailable()); return; }
    const capture = message.phase === 'quick' ? startPagePreview(message)
      : pagePreview?.requestId === message.requestId && pagePreview.videoId === message.videoId ? pagePreview : null;
    if (!capture) { respond(previewUnavailable()); return; }
    capture[message.phase].then(respond, () => respond(previewUnavailable()));
    return true;
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  window.addEventListener('popstate', navigation, { signal: events.signal }); window.addEventListener('hashchange', navigation, { signal: events.signal });
  window.addEventListener('pagehide', () => cancelPagePreview(), { signal: events.signal });
  // 'encrypted' does not bubble; a capturing listener still sees every player.
  document.addEventListener('encrypted', onEncrypted, { capture: true, passive: true, signal: events.signal });
  const observer = new MutationObserver(mutations => { if (!retired && mutations.some(affectsContext)) scheduleScan(); });
  function start() {
    if (retired) return;
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'poster', 'content', 'name', 'property', 'itemprop', 'type'] });
    scan();
    watchWorkerServedMedia();
  }
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true, signal: events.signal });
})();
