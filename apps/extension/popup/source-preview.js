/* Small, ephemeral source previews. No desktop job, persistent media or remote redirect. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnagThisSourcePreview = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_REQUESTS = 32;
  const DIRECT_BYTES = 8 * 1024 * 1024;
  const POSTER_BYTES = 2 * 1024 * 1024;
  // hls.js (415 KB) loads only when a preview or sample first needs it, never with the popup.
  const HLS_SCRIPT = 'vendor/hls.min.js';
  let hlsLoading = null;
  function loadHls() {
    if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
    if (typeof document === 'undefined') return Promise.reject(new Error('HLS playback is unavailable'));
    hlsLoading ||= new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = HLS_SCRIPT; script.async = true;
      script.addEventListener('load', () => { if (globalThis.Hls) resolve(globalThis.Hls); else { hlsLoading = null; reject(new Error('HLS playback is unavailable')); } }, { once: true });
      script.addEventListener('error', () => { hlsLoading = null; script.remove(); reject(new Error('HLS playback is unavailable')); }, { once: true });
      document.head.append(script);
    });
    return hlsLoading;
  }
  // Runs `start(Hls)` now when hls.js is present, otherwise once it loads; `fail` when it can't play here.
  function withHls(start, fail, isDisposed) {
    const run = Hls => { if (isDisposed()) return; if (!Hls?.isSupported()) fail(); else start(Hls); };
    if (globalThis.Hls) run(globalThis.Hls);
    else loadHls().then(run, () => { if (!isDisposed()) fail(); });
  }
  const blockedHeaders = /^(?:origin|referer|host|user-agent|cookie|content-length|connection|range|sec-|proxy-)/i;
  function sourceFor(item) {
    // DRM-protected media is never fetched or played for a preview.
    if (!item || item.drm || item.mediaKind === 'protected' || item.mediaKind === 'youtube-page' || item.mediaKind === 'dash-manifest' || /^audio\//i.test(item.contentType || '')) return null;
    try {
      const primary = new URL(item.url);
      if (!/^https?:$/.test(primary.protocol) || primary.username || primary.password) return null;
      const hls = item.type === 'hls' || item.streamType === 'hls';
      const variant = hls && [...(item.variants || item.manifest?.variants || [])].filter(value => value.url).sort((a, b) => (a.height || Infinity) - (b.height || Infinity) || (a.bandwidth || Infinity) - (b.bandwidth || Infinity))[0];
      // A URL only reported by page script is an untrusted hint: preview it
      // without cookies or captured headers. Chrome-observed media keeps its context.
      const trusted = item.networkObserved === true;
      return { url: variant?.url || primary.href, hls, trusted, origin: item.requestHeadersOrigin || primary.origin, headers: trusted ? item.requestHeaders || {} : {}, duration: Number(item.durationSeconds) || 0, contentType: item.contentType || 'video/mp4' };
    } catch { return null; }
  }
  function fetchOptions(source, url, headers = {}, signal) {
    const target = new URL(url);
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new Error('Unsupported preview source');
    const sameOrigin = source.trusted === true && target.origin === source.origin;
    const safeHeaders = new Headers();
    if (sameOrigin) for (const [key, value] of Object.entries(source.headers)) {
      if (/^[!#$%&'*+.^_`|~0-9a-z-]{1,64}$/i.test(key) && !blockedHeaders.test(key) && typeof value === 'string' && value.length <= 8192 && !/[\r\n\x00]/.test(value)) safeHeaders.set(key, value);
    }
    // Only loader-owned range headers travel between origins.
    for (const [key, value] of Object.entries(headers)) if (/^range$/i.test(key)) safeHeaders.set(key, value);
    return { headers: safeHeaders, signal, credentials: sameOrigin ? 'include' : 'omit', cache: 'no-store', redirect: 'error', referrer: '', referrerPolicy: 'no-referrer' };
  }
  function sceneCandidates(duration) {
    // Short media gets a shorter excerpt; reserving ten seconds forced its
    // selected scene back to the opening frame.
    const lastStart = Math.max(0, duration - .1);
    return [...new Set([.35, .5, .25, .65, .8].map(fraction => Math.min(lastStart, Math.max(0, duration * fraction))))];
  }
  function sceneStart(duration) { return sceneCandidates(duration)[0]; }
  function nonblack(pixels) {
    let light = 0; let sum = 0; let squared = 0;
    const count = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
      const value = .2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2];
      sum += value; squared += value * value; if (value > 20) light++;
    }
    return count > 0 && light / count > .12 && sum / count > 12 && squared / count - (sum / count) ** 2 > 18;
  }
  // Fetch cannot set Origin or Referer itself. A trusted worker session restores
  // only the page context captured for this media host, for the session's lifetime.
  function openOriginSession(source, tabId, mediaId, onClosed) {
    if (!Object.keys(source.headers).some(name => /^(origin|referer)$/i.test(name)) || !globalThis.chrome?.runtime?.connect) return { ready: Promise.resolve(), close() {} };
    let close = () => {};
    const ready = new Promise((resolve, reject) => {
      let port; let heartbeat;
      close = () => {
        clearInterval(heartbeat);
        try { port?.disconnect(); } catch { /* Popup already closed. */ }
        reject(new Error('Preview stopped'));
      };
      try {
        port = chrome.runtime.connect({ name: 'snagthis-source-preview' });
        port.onMessage.addListener(message => {
          if (message?.cmd !== 'ready') return;
          if (message.ok) resolve();
          else reject(new Error('Preview request context is unavailable'));
        });
        port.onDisconnect.addListener(() => {
          clearInterval(heartbeat);
          reject(new Error('Preview request context closed'));
          onClosed?.();
        });
        port.postMessage({ cmd: 'start', tabId, mediaId });
        heartbeat = setInterval(() => {
          try { port.postMessage({ cmd: 'keepalive' }); } catch { onClosed?.(); }
        }, 10000);
      } catch (error) { reject(error); }
    });
    return { ready, close: () => close() };
  }
  // Every preview byte passes through this counter: bounded bytes, requests and time.
  function createBoundedFetch({ source, ready, isDisposed, maxBytes = MAX_BYTES, maxRequests = MAX_REQUESTS }) {
    let bytes = 0; let requests = 0;
    const controllers = new Set();
    async function fetchBytes(url, range = {}, controller = new AbortController(), limit = maxBytes, requireComplete = false) {
      await ready;
      if (isDisposed() || bytes >= maxBytes || ++requests > maxRequests) throw new Error('Preview request limit reached');
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, fetchOptions(source, url, range, controller.signal));
        if (!response.ok || !response.body) throw new Error('Preview unavailable');
        const reader = response.body.getReader(); const chunks = []; let length = 0; let ended = false;
        while (!isDisposed()) {
          const chunk = await reader.read(); if (chunk.done) { ended = true; break; }
          const allowed = Math.min(chunk.value.length, limit - length, maxBytes - bytes);
          if (allowed > 0) { chunks.push(chunk.value.subarray(0, allowed)); length += allowed; bytes += allowed; }
          if (allowed < chunk.value.length || length >= limit || bytes >= maxBytes) {
            if (requireComplete && allowed === chunk.value.length) ended = (await reader.read()).done;
            await reader.cancel(); break;
          }
        }
        if (isDisposed()) throw new Error('Preview stopped');
        const data = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        const rangeTotal = /\/([0-9]+)$/.exec(response.headers.get('content-range') || '')?.[1];
        const fullLength = response.status === 206 ? Number(rangeTotal) : Number(response.headers.get('content-length'));
        const complete = fullLength > 0 ? length >= fullLength : response.status === 200 && ended;
        return { response, data, complete, ended, fullLength };
      } finally {
        // An HTTP error can still carry a streaming body. Cancel it before
        // dropping the controller, so a failed preview cannot keep downloading.
        controller.abort(); clearTimeout(timeout); controllers.delete(controller);
      }
    }
    return {
      fetchBytes,
      exhausted: () => bytes >= maxBytes || requests >= maxRequests,
      abort() { for (const controller of controllers) controller.abort(); controllers.clear(); },
    };
  }
  // Hls.js loader API backed exclusively by bounded fetch, never XHR/native redirects.
  // `skip(context)` may stop loading before a fragment outside the excerpt is fetched.
  function boundedHlsLoader(fetchBytes, { isDisposed, skip = () => false }) {
    return class BoundedFetchLoader {
      constructor() { this.controller = new AbortController(); this.stats = { aborted: false, loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0, loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } }; }
      load(context, _config, callbacks) {
        this.context = context; this.stats.loading.start = performance.now();
        if (skip(context)) return;
        const range = context.rangeEnd > 0 ? { Range: `bytes=${context.rangeStart || 0}-${context.rangeEnd - 1}` } : {};
        const playlist = context.responseType !== 'arraybuffer';
        fetchBytes(context.url, range, this.controller, playlist ? 5 * 1024 * 1024 : 8 * 1024 * 1024, playlist).then(({ response, data, ended }) => {
          if (this.stats.aborted || isDisposed()) return;
          if (playlist && !ended) throw new Error('Preview playlist exceeds the supported size');
          this.response = response; this.stats.loaded = this.stats.total = data.byteLength;
          this.stats.loading.first = this.stats.loading.end = performance.now();
          callbacks.onSuccess({ url: response.url, data: context.responseType === 'arraybuffer' ? data.buffer : new TextDecoder().decode(data), code: response.status }, this.stats, context, response);
        }).catch(error => { if (!this.stats.aborted && !isDisposed()) callbacks.onError({ code: 0, text: error.message }, context, this.response, this.stats); });
      }
      abort() { this.stats.aborted = true; this.controller.abort(); }
      destroy() { this.abort(); }
      getCacheAge() { return null; }
      getResponseHeader(name) { return this.response?.headers.get(name) || null; }
    };
  }
  function create({ item, video, tabId, mediaId, posterOnly = false, sceneOffset, sceneScope, onPoster, onMetadata, onPlaying, onError }) {
    const source = sourceFor(item);
    if (!source) return null;
    let partialDirect = false; let partialSceneReady = false; let directFraction = 1;
    let directLimit = posterOnly ? POSTER_BYTES : DIRECT_BYTES;
    // A truncated MP4 can report its entire indexed duration as buffered.
    // Bound a seek estimate by the received fraction, then verify the actual
    // decoded frame timestamp before allowing that frame to become a poster.
    const bufferedPrefixEnd = () => video.buffered.length && video.buffered.start(0) <= .1
      ? Math.min(video.buffered.end(0), source.duration * directFraction) : 0;
    const candidates = () => partialDirect
      ? [...new Set([.7, .85, .5, .35].map(fraction => Math.max(0, bufferedPrefixEnd() * fraction))) ]
      : sceneCandidates(source.duration);
    const selectedStart = () => sceneScope !== 'prefix' && Number.isFinite(sceneOffset) && sceneOffset >= source.duration * .25 && sceneOffset < source.duration
      ? sceneOffset : sceneStart(source.duration);
    let disposed = false; let hls = null; let objectUrl = '';
    let start = selectedStart();
    let end = start + 10; let captured = false; let sampleAt = -1; let frameAttempts = 0;
    const triedScenes = new Set();
    const listeners = [];
    let frameCallback = null; let decodedTime = null;
    const listen = (name, callback) => { video.addEventListener(name, callback); listeners.push([name, callback]); };
    const destroy = () => {
      if (disposed) return; disposed = true; clearTimeout(deadline);
      if (frameCallback !== null) video.cancelVideoFrameCallback?.(frameCallback);
      origin.close();
      fetcher.abort();
      if (hls) { hls.destroy(); hls = null; }
      for (const [name, callback] of listeners) video.removeEventListener(name, callback);
      video.pause(); video.removeAttribute('src'); video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    const fail = () => { if (!disposed) { destroy(); onError?.(); } };
    const deadline = setTimeout(fail, 15000);
    const origin = openOriginSession(source, tabId, mediaId, () => { if (!disposed) fail(); });
    // The media loader attaches asynchronously after the video is mounted.
    origin.ready.catch(fail);
    const fetcher = createBoundedFetch({ source, ready: origin.ready, isDisposed: () => disposed });
    const fetchBytes = fetcher.fetchBytes;
    function nextScene() {
      triedScenes.add(start);
      const next = candidates().find(candidate => !triedScenes.has(candidate));
      if ((!hls && !objectUrl) || next === undefined || (hls && fetcher.exhausted())) { fail(); return; }
      hls?.stopLoad(); start = next; end = Math.min(start + 10, (partialDirect ? bufferedPrefixEnd() : source.duration) - .05); frameAttempts = 0; sampleAt = -1;
      video.currentTime = start; hls?.startLoad(start);
    }
    function updateDirectBounds() {
      if (!partialDirect) return;
      const available = bufferedPrefixEnd();
      if (!partialSceneReady && available > .2) {
        // The downloaded prefix may not reach the full source's middle. Use
        // its later decoded footage, and mark that offset as prefix-scoped.
        start = Math.min(selectedStart(), available * .7);
        end = Math.min(start + 10, available - .05);
        partialSceneReady = true;
        if (Math.abs(video.currentTime - start) > .05) video.currentTime = start;
      }
      if (available > start + .1) end = Math.min(start + 10, available - .05);
    }
    function capture() {
      updateDirectBounds();
      if (disposed || captured || (partialDirect && !partialSceneReady) || video.seeking || !video.videoWidth || video.readyState < 2 || video.currentTime < start - .1 || video.currentTime >= end || Math.abs(video.currentTime - sampleAt) < .5) return;
      if (video.requestVideoFrameCallback && (decodedTime === null || Math.abs(decodedTime - video.currentTime) > .25 || decodedTime < start - .1)) return;
      sampleAt = video.currentTime;
      try {
        const sample = document.createElement('canvas'); sample.width = 32; sample.height = 18;
        const context = sample.getContext('2d', { willReadFrequently: true });
        const drawCover = (width, height) => {
          const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
          const sourceWidth = width / scale; const sourceHeight = height / scale;
          context.drawImage(video, (video.videoWidth - sourceWidth) / 2, (video.videoHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
        };
        drawCover(32, 18);
        if (!nonblack(context.getImageData(0, 0, 32, 18).data)) {
          if (++frameAttempts >= 3 || video.currentTime >= end - .5) nextScene();
          else if (posterOnly && video.currentTime + 1 < end) video.currentTime += 1;
          return;
        }
        sample.width = 320; sample.height = 180; drawCover(320, 180);
        let poster = sample.toDataURL('image/jpeg', .65);
        if (poster.length > 20480) { sample.width = 224; sample.height = 126; drawCover(224, 126); poster = sample.toDataURL('image/jpeg', .5); }
        if (poster.length > 20480) return;
        // Keep a later usable frame as the loop boundary when earlier frames
        // in this candidate were blank, rather than replaying that blank lead-in.
        if (video.currentTime > start + .1) { start = video.currentTime; end = Math.min(start + 10, (partialDirect ? bufferedPrefixEnd() : source.duration) - .05); }
        captured = true; clearTimeout(deadline); onPoster?.(poster, start, partialDirect ? 'prefix' : 'source');
        if (hls && !posterOnly) { hls.config.maxBufferLength = 10; hls.config.maxMaxBufferLength = 10; hls.startLoad(video.currentTime); }
        if (!posterOnly && !video.paused) onPlaying?.();
        if (posterOnly) destroy();
      } catch { /* Tainted or unavailable frames retain the page poster. */ }
    }
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.preload = 'auto';
    listen('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : source.duration;
      if (!source.hls && duration > 0) { source.duration = duration; start = selectedStart(); partialSceneReady = false; }
      if (!source.hls && duration > 0) onMetadata?.({ durationSeconds: duration, height: video.videoHeight });
      if (duration > 0) end = Math.min(start + 10, duration - .05);
      if (!partialDirect && start > 0 && Math.abs(video.currentTime - start) > .05) video.currentTime = start;
    });
    listen('loadeddata', () => { capture(); if (!posterOnly && !disposed) video.play().catch(fail); });
    listen('seeked', capture);
    listen('progress', updateDirectBounds);
    listen('playing', () => { if (!disposed && captured) onPlaying?.(); });
    const repeatScene = () => { updateDirectBounds(); if (!disposed && !posterOnly && video.currentTime >= end - .15) { if (!captured) nextScene(); else { video.currentTime = start; video.play().catch(fail); } } };
    listen('timeupdate', () => { capture(); repeatScene(); });
    // A stopped bounded loader cannot provide more frames to settle an end seek.
    listen('seeking', repeatScene);
    listen('waiting', repeatScene);
    listen('ended', () => { if (!posterOnly && !disposed) { if (!captured) nextScene(); else { video.currentTime = start; video.play().catch(fail); } } });
    listen('error', () => {
      // Some MP4 files need more than the small poster probe to expose a
      // playable frame. Retry within the existing eight-MiB direct limit.
      if (!source.hls && posterOnly && directLimit < DIRECT_BYTES && !disposed) loadDirect(DIRECT_BYTES);
      else fail();
    });
    const observeFrame = () => {
      if (!video.requestVideoFrameCallback || disposed || captured) return;
      frameCallback = video.requestVideoFrameCallback((_now, metadata) => {
        frameCallback = null; decodedTime = metadata.mediaTime;
        capture(); observeFrame();
      });
    };
    observeFrame();
    if (source.hls) {
      if (globalThis.Hls && !globalThis.Hls.isSupported()) { queueMicrotask(fail); return { destroy }; }
      withHls(startHls, fail, () => disposed);
    } else loadDirect(directLimit);
    function startHls(Hls) {
      // An unknown-duration VOD playlist must choose its scene before
      // any opening fragment is fetched. LEVEL_LOADED restarts at 35%.
      const PreviewFetchLoader = boundedHlsLoader(fetchBytes, { isDisposed: () => disposed,
        skip: context => { if ((context.frag && !source.duration) || context.frag?.start >= end) { hls?.stopLoad(); return true; } return false; } });
      hls = new Hls({ loader: PreviewFetchLoader, enableWorker: false, autoStartLoad: false, startPosition: start, startLevel: 0, capLevelToPlayerSize: true,
        maxBufferLength: 2, maxMaxBufferLength: 2, maxBufferSize: MAX_BYTES, backBufferLength: 10, lowLatencyMode: false,
        manifestLoadingMaxRetry: 0, levelLoadingMaxRetry: 0, fragLoadingMaxRetry: 0, enableWebVTT: false, enableIMSC1: false });
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(source.url));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        let lowest = 0; hls.levels.forEach((level, index) => { if (level.bitrate < hls.levels[lowest].bitrate) lowest = index; });
        hls.loadLevel = lowest; hls.autoLevelCapping = lowest; hls.startLoad(start);
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        // This is the actual source's complete VOD playlist, even if page
        // discovery missed its body or the proxy regenerated its child URL.
        if (data.details?.live === false && data.details.totalduration > 0) onMetadata?.({ durationSeconds: data.details.totalduration });
        if (!source.duration && data.details?.totalduration > 0) {
          source.duration = data.details.totalduration; start = selectedStart(); end = Math.min(start + 10, source.duration - .05);
          if (start > 0) hls.startLoad(start);
        }
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { for (let index = 0; index < video.buffered.length; index++) if (video.buffered.start(index) <= start + .1 && video.buffered.end(index) >= end - .2) hls.stopLoad(); });
      hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
      hls.attachMedia(video);
    }
    function loadDirect(limit) {
      directLimit = limit;
      fetchBytes(source.url, { Range: `bytes=0-${limit - 1}` }, new AbortController(), limit).then(({ response, data, complete, fullLength }) => {
        if (disposed) return;
        // A faststart MP4 prefix can expose real early frames without the rest
        // of the file. Its index still reports the full duration, so restrict
        // seeking and looping to footage the decoder actually buffered.
        partialDirect = !complete;
        directFraction = !complete && fullLength > 0 ? Math.min(1, data.byteLength / fullLength) : 1;
        partialSceneReady = false;
        decodedTime = null;
        const previousUrl = objectUrl;
        objectUrl = URL.createObjectURL(new Blob([data], { type: response.headers.get('content-type') || source.contentType }));
        video.src = objectUrl; video.load();
        if (previousUrl) URL.revokeObjectURL(previousUrl);
      }).catch(fail);
    }
    return { destroy };
  }
  // Hover-to-hear: a short excerpt of one HLS audio rendition, from 25% in,
  // fetched through the same bounded loader and restored request context.
  const SAMPLE_SECONDS = 10;
  const SAMPLE_BYTES = 4 * 1024 * 1024;
  const SAMPLE_REQUESTS = 16;
  const SAMPLE_VOLUME = .5;
  function audioSampleSource(item, rendition) {
    const base = sourceFor(item);
    if (!base?.hls || typeof rendition?.url !== 'string') return null;
    try {
      const url = new URL(rendition.url);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? { ...base, url: url.href } : null;
    } catch { return null; }
  }
  function createAudioSample({ item, rendition, tabId, mediaId, audio = new Audio(), seconds = SAMPLE_SECONDS, volume = SAMPLE_VOLUME, onPlaying, onProgress, onEnded, onError }) {
    const source = audioSampleSource(item, rendition);
    if (!source || (globalThis.Hls && !globalThis.Hls.isSupported())) return null;
    let disposed = false; let playing = false; let finishing = false; let hls = null; let fadeTimer = 0;
    // 25% in catches dialogue rather than an intro. A CDN can lack a segment
    // there, so a sample that cannot start moves a little later instead.
    const fractions = [.25, .3, .4, .5]; let attempt = 0;
    let start = source.duration > 0 ? source.duration * .25 : 0;
    let end = source.duration > 0 ? Math.min(start + seconds, source.duration - .05) : Infinity;
    const listeners = [];
    const listen = (name, callback) => { audio.addEventListener(name, callback); listeners.push([name, callback]); };
    const destroy = () => {
      if (disposed) return; disposed = true; clearTimeout(deadline); clearInterval(fadeTimer);
      origin.close(); fetcher.abort();
      if (hls) { hls.destroy(); hls = null; }
      for (const [name, callback] of listeners) audio.removeEventListener(name, callback);
      audio.pause(); audio.removeAttribute('src'); audio.load();
    };
    const fail = () => { if (!disposed) { destroy(); onError?.(); } };
    const deadline = setTimeout(fail, 15000);
    const fade = (target, duration, done) => {
      clearInterval(fadeTimer);
      const from = audio.volume; const began = performance.now();
      fadeTimer = setInterval(() => {
        const progress = Math.min(1, (performance.now() - began) / duration);
        audio.volume = Math.max(0, Math.min(1, from + (target - from) * progress));
        if (progress >= 1) { clearInterval(fadeTimer); done?.(); }
      }, 30);
    };
    // Fade out, then release everything. `ended` distinguishes a finished sample.
    const stop = (ended = false) => {
      if (disposed || finishing) return; finishing = true;
      if (!playing) { destroy(); if (ended) onEnded?.(); return; }
      fade(0, 200, () => { destroy(); if (ended) onEnded?.(); });
    };
    const origin = openOriginSession(source, tabId, mediaId, fail);
    origin.ready.catch(fail);
    const fetcher = createBoundedFetch({ source, ready: origin.ready, isDisposed: () => disposed, maxBytes: SAMPLE_BYTES, maxRequests: SAMPLE_REQUESTS });
    const Loader = boundedHlsLoader(fetcher.fetchBytes, { isDisposed: () => disposed,
      // The excerpt starts at 25% of the rendition's own duration, known only
      // once its playlist loads; never fetch an opening or trailing fragment.
      skip: context => { if (context.frag && context.frag.sn !== 'initSegment' && (!(end < Infinity) || context.frag.start >= end)) { hls?.stopLoad(); return true; } return false; } });
    audio.preload = 'auto'; audio.muted = false; audio.volume = 0;
    listen('canplay', () => {
      if (disposed || playing || finishing) return;
      if (Math.abs(audio.currentTime - start) > .5) { audio.currentTime = start; return; }
      audio.play().then(() => {
        if (disposed) return;
        playing = true; clearTimeout(deadline); fade(volume, 400); onPlaying?.();
      }).catch(fail);
    });
    listen('timeupdate', () => {
      if (!playing || disposed) return;
      onProgress?.(Math.max(0, Math.min(1, (audio.currentTime - start) / Math.max(.1, end - start))));
      if (audio.currentTime >= end - .1) stop(true);
    });
    listen('ended', () => stop(true));
    listen('error', fail);
    withHls(Hls => {
      hls = new Hls({ loader: Loader, enableWorker: false, autoStartLoad: false, startPosition: start,
        maxBufferLength: seconds, maxMaxBufferLength: seconds, maxBufferSize: SAMPLE_BYTES, backBufferLength: 0, lowLatencyMode: false,
        // One retry absorbs a CDN's transient 5xx; the request bound still applies.
        manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1, enableWebVTT: false, enableIMSC1: false });
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(source.url));
      hls.on(Hls.Events.MANIFEST_PARSED, () => hls.startLoad(start));
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        const total = data.details?.totalduration;
        if (data.details?.live !== false || !(total > 0) || end < Infinity && Math.abs(total - source.duration) < 1) return;
        // The rendition's own playlist is authoritative for where 25% falls.
        source.duration = total; start = total * fractions[attempt]; end = Math.min(start + seconds, total - .05);
        hls.startLoad(start); audio.currentTime = start;
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        for (let index = 0; index < audio.buffered.length; index++) if (audio.buffered.start(index) <= start + .1 && audio.buffered.end(index) >= end - .2) hls.stopLoad();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || disposed) return;
        const missingPiece = data.type === Hls.ErrorTypes.NETWORK_ERROR && data.frag;
        // Already audible: a missing later piece ends the sample where its buffer ends.
        if (missingPiece && playing) {
          let buffered = audio.currentTime;
          for (let index = 0; index < audio.buffered.length; index++) if (audio.buffered.start(index) <= audio.currentTime + .1) buffered = Math.max(buffered, audio.buffered.end(index));
          end = Math.min(end, buffered);
          if (audio.currentTime >= end - .1) stop(true);
          return;
        }
        if (missingPiece && source.duration > 0 && attempt + 1 < fractions.length && !fetcher.exhausted()) {
          attempt += 1; start = source.duration * fractions[attempt]; end = Math.min(start + seconds, source.duration - .05);
          audio.currentTime = start; hls.startLoad(start);
          return;
        }
        fail();
      });
      hls.attachMedia(audio);
    }, fail, () => disposed);
    return { destroy, stop: () => stop(false) };
  }
  return { create, createAudioSample, loadHls, audioSampleSource, sourceFor, fetchOptions, nonblack, sceneStart, sceneCandidates, MAX_BYTES, MAX_REQUESTS, DIRECT_BYTES, POSTER_BYTES, SAMPLE_SECONDS };
});
