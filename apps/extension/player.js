/* Preview player: owner pick A · Cinema (docs/design/prototypes/preview-player, ui-design-spec §5.5).
 * A custom control layer over one <video>. The popup opens this page with a short-lived worker session;
 * nothing is taken from other query parameters. Details and Snag it come from the worker, which looks up
 * the popup row the preview was opened from. */
(function bootstrapStreamPlayer() {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = $('player-root');
  const titleEl = $('title');
  const sourceEl = $('source');
  const statusEl = $('status');
  const videoEl = $('player');

  if (!root || !videoEl || !statusEl || !titleEl || !sourceEl) {
    return;
  }

  const copy = globalThis.SnagThisStrings;
  const text = copy ? copy.strings : {};
  const t = (key, values) => (copy ? copy.interpolate(key, values) : key);
  const rows = globalThis.SnagThisRows;
  const pixel = globalThis.SnagThisPixel;
  const RELEASES = 'https://snagthisvid.com/#download';
  const HIDE_AFTER_MS = 2400;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const sessionId = String(new URLSearchParams(window.location.search).get('session') || '').trim();

  let primaryUrl = '';
  let declaredType = '';
  let displayTitle = 'Preview';
  let sourcePageUrl = '';
  let requestHeaders = {};
  // Cookies travel only for media Chrome itself observed on the source tab.
  let credentialed = true;
  let apiBase = '';

  let hls = null;
  // What the worker offers for Snag it (null: not offered, e.g. DRM or the store build's site rules).
  let offer = null;

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
      // Autoplay can still need a gesture; the big play button waits for it.
    }
    render();
  }

  /* ── Icons: 12 × 12 pixel glyphs drawn as whole-pixel runs (the prototype's set). ── */
  const ICONS = {
    play: ['............', '..##........', '..####......', '..######....', '..########..', '..#########.', '..#########.', '..########..', '..######....', '..####......', '..##........', '............'],
    pause: ['............', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '............'],
    vol: ['............', '.....#......', '....##...#..', '...###.#..#.', '####.#..#.#.', '#..#.#..#.#.', '#..#.#..#.#.', '####.#..#.#.', '...###.#..#.', '....##...#..', '.....#......', '............'],
    low: ['............', '.....#......', '....##......', '...###.#....', '####.#..#...', '#..#.#..#...', '#..#.#..#...', '####.#..#...', '...###.#....', '....##......', '.....#......', '............'],
    mute: ['............', '.....#......', '....##......', '...###......', '####.#.#...#', '#..#.#..#.#.', '#..#.#...#..', '####.#..#.#.', '...###.#...#', '....##......', '.....#......', '............'],
    cc: ['............', '............', '############', '#..........#', '#.###.###..#', '#.#...#....#', '#.#...#....#', '#.###.###..#', '#..........#', '############', '............', '............'],
    fs: ['............', '.####..####.', '.#........#.', '.#........#.', '.#........#.', '............', '............', '.#........#.', '.#........#.', '.#........#.', '.####..####.', '............'],
    pip: ['............', '############', '#..........#', '#..........#', '#..........#', '#.....#####.', '#.....#####.', '#.....#####.', '#.....#####.', '######......', '............', '............'],
    info: ['............', '....####....', '...#....#...', '..#..##..#..', '.#........#.', '.#...##...#.', '.#...##...#.', '.#...##...#.', '..#..##..#..', '...#....#...', '....####....', '............'],
    down: ['............', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '..#..##..#..', '...#.##.#...', '....####....', '.....##.....', '............', '.##########.', '.##########.'],
    back: ['............', '....#.......', '...##.......', '..######....', '...##...#...', '....#....#..', '.........#..', '.........#..', '..#......#..', '...#....#...', '....####....', '............'],
    fwd: ['............', '.......#....', '.......##...', '....######..', '...#...##...', '..#....#....', '..#.........', '..#.........', '..#......#..', '...#....#...', '....####....', '............'],
    ext: ['............', '.......#####', '.........###', '........#.##', '.......#...#', '......#.....', '.#####......', '.#.......#..', '.#.......#..', '.#.......#..', '.#########..', '............'],
    close: ['............', '.##......##.', '..##....##..', '...##..##...', '....####....', '.....##.....', '.....##.....', '....####....', '...##..##...', '..##....##..', '.##......##.', '............'],
    keys: ['............', '............', '############', '#.#.#.#.#..#', '#..........#', '#.#.#.#.#..#', '#..........#', '#..######..#', '############', '............', '............', '............'],
  };
  function icon(name, size = 18) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('class', 'pl-i'); node.setAttribute('viewBox', '0 0 12 12');
    node.setAttribute('width', String(size)); node.setAttribute('height', String(size));
    node.setAttribute('aria-hidden', 'true'); node.setAttribute('focusable', 'false');
    let d = '';
    (ICONS[name] || []).forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        if (row[x] !== '#') { x++; continue; }
        let end = x; while (row[end + 1] === '#') end++;
        d += `M${x} ${y}h${end - x + 1}v1h-${end - x + 1}z`; x = end + 1;
      }
    });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d); node.append(path);
    return node;
  }
  function setIcon(button, name, size) { button.querySelector('svg.pl-i')?.remove(); button.prepend(icon(name, size)); }
  function el(tag, className = '', value = '') { const node = document.createElement(tag); if (className) node.className = className; if (value) node.textContent = value; return node; }
  function fmt(seconds) {
    const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const h = Math.floor(value / 3600); const m = Math.floor(value / 60) % 60; const s = Math.floor(value % 60);
    return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
  }
  function sizeLabel(bytes, estimated) { return bytes > 0 && rows ? rows.formatSize(bytes, { estimated }) : ''; }
  async function send(message) {
    try { return await chrome.runtime.sendMessage(message); } catch { return null; }
  }
  function openTab(url) {
    if (!url) return;
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url }).catch(() => {});
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ── State ── */
  const st = { started: false, failed: '', menu: null, menuTrigger: null, info: false, help: false, helpReturn: null,
    level: -1, speed: 1, lastSubtitle: 0, desktop: null, snagBusy: false, pairing: null };
  const scrub = $('scrub');
  const dock = $('dock');
  const guide = $('guide');
  const toastEl = $('toast');

  function setStatus(message) { statusEl.textContent = String(message || ''); }
  function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
  // Media URLs often carry signed tokens; show only where the video is from.
  function siteName() { return hostOf(sourcePageUrl || primaryUrl).replace(/^www\./, ''); }
  function pageUrl() { return getHttpOrigin(sourcePageUrl) ? sourcePageUrl : ''; }
  function isHlsUrl(url) { return /\.m3u8(\?|$)/i.test(String(url || '')); }
  function isDashUrl(url) { return /\.mpd(\?|$)/i.test(String(url || '')); }
  function isHls() { return declaredType === 'hls' || isHlsUrl(primaryUrl); }
  function kindLabel() {
    if (isHls()) return text.playerHlsStream || 'HLS stream';
    const extension = /\.(mp4|webm|mov|m4v|mkv)(?:[?#]|$)/i.exec(primaryUrl)?.[1];
    return extension ? `${extension.toUpperCase()} file` : text.playerVideoFile || 'Video file';
  }

  /* ── Playback surface ── */
  function destroyHls() {
    if (hls && typeof hls.destroy === 'function') {
      try { hls.destroy(); } catch { /* ignore */ }
    }
    hls = null;
  }

  // hls.js is only fetched for HLS sources.
  let hlsLibrary = null;
  function loadHlsLibrary() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsLibrary) {
      hlsLibrary = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/hls.min.js';
        script.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js unavailable')));
        script.onerror = () => { hlsLibrary = null; reject(new Error('hls.js unavailable')); };
        document.head.append(script);
      });
    }
    return hlsLibrary;
  }

  // The same Fetch loader for every fragment, except that WebVTT fragments load whole: with
  // progressive streaming, hls.js 1.5 hands the subtitle parser an empty payload.
  class WholeSubtitleLoader {
    constructor(config) { this.inner = new config.loader(config); }
    get stats() { return this.inner.stats; }
    get context() { return this.inner.context; }
    load(context, config, callbacks) {
      this.inner.load(context, context.frag?.type === 'subtitle' ? { ...config, highWaterMark: undefined } : config, callbacks);
    }
    abort() { this.inner.abort(); }
    destroy() { this.inner.destroy(); }
    getCacheAge() { return this.inner.getCacheAge ? this.inner.getCacheAge() : null; }
    getResponseHeader(name) { return this.inner.getResponseHeader ? this.inner.getResponseHeader(name) : null; }
  }

  function setLoading(on) { root.classList.toggle('is-loading', on); if (on) root.classList.remove('is-idle'); }

  function useDirectVideoUrl(url) {
    destroyHls();
    if (!getHttpOrigin(url)) { fail('unsupported'); return; }
    // Native playback streams/seeks the file without buffering an entire video
    // in extension memory. It does not replay captured request headers.
    videoEl.src = url;
    videoEl.load();
    void tryPlay();
  }

  async function loadCurrentSource() {
    const url = primaryUrl;
    clearFailure();
    if (!url) { fail('expired'); return; }
    // The browser cannot play a DASH manifest as a file, and this page has no
    // DASH player; say so instead of failing after a load.
    if (declaredType === 'dash' || isDashUrl(url)) { destroyHls(); fail('dash'); return; }
    setLoading(true);
    setStatus(text.playerLoading || 'Loading preview');
    if (!isHls()) { useDirectVideoUrl(url); return; }

    let Hls = null;
    try { Hls = await loadHlsLibrary(); } catch { Hls = null; }
    if (!Hls || !Hls.isSupported() || !window.fetch || !window.AbortController || !window.ReadableStream || !window.Request) {
      fail('browser');
      return;
    }

    destroyHls();
    const instance = new Hls({
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
      fLoader: WholeSubtitleLoader,
    });
    hls = instance;
    // Subtitles stay in hidden text tracks; this page draws the cues above the controls.
    instance.subtitleDisplay = false;
    let recovered = false;

    instance.on(Hls.Events.MEDIA_ATTACHED, () => { instance.loadSource(url); });
    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      renderLists();
      void tryPlay();
    });
    for (const name of ['LEVEL_SWITCHED', 'AUDIO_TRACKS_UPDATED', 'AUDIO_TRACK_SWITCHED', 'SUBTITLE_TRACKS_UPDATED', 'SUBTITLE_TRACK_SWITCH']) {
      if (Hls.Events[name]) instance.on(Hls.Events[name], () => { if (hls === instance) renderLists(); });
    }
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (!data || !data.fatal || hls !== instance) return;
      const responseCode = Number(data.response && data.response.code || 0);
      if (responseCode === 403) { fail('blocked'); return; }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; instance.recoverMediaError(); return; }
      fail('failed');
    });

    instance.attachMedia(videoEl);
  }

  /* ── Failure and expiry ── */
  function fail(kind) {
    st.failed = kind;
    if (kind !== 'expired') destroyHls();
    closeMenus(); toggleHelp(false);
    setLoading(false);
    root.classList.add('is-failed'); root.classList.remove('is-idle', 'is-buffering');
    const site = siteName();
    const blocked = kind === 'blocked';
    const pageOnly = blocked || kind === 'dash';
    const title = kind === 'expired' ? text.playerExpired : pageOnly ? text.playerOnlyOnPage : text.playerUnavailable;
    const lead = {
      blocked: t('playerBlocked', { site: site || text.drmThisSite }), failed: text.playerFailed, dash: text.playerDash,
      browser: text.playerNoBrowser, unsupported: text.playerUnsupported, expired: text.playerExpiredBody,
    }[kind] || text.playerFailed;
    const canRetry = ['blocked', 'failed'].includes(kind) && Boolean(primaryUrl);
    const canSnag = Boolean(offer) && kind !== 'expired';
    $('failTitle').textContent = title;
    const body = $('failBody'); body.replaceChildren();
    if (blocked && site) {
      // The site's name leads the sentence, emphasised as in the prototype.
      const [before, after] = lead.split(site);
      body.append(document.createTextNode(before || ''), el('b', '', site), document.createTextNode(after || ''));
    } else body.append(document.createTextNode(lead));
    if (canRetry) body.append(document.createTextNode(` ${canSnag ? text.playerStillSnag : text.playerStill}`));
    $('openPageBtn').hidden = !pageUrl();
    $('retryBtn').hidden = !canRetry;
    $('snagAnyway').hidden = !canSnag || !canRetry;
    const why = $('failWhy');
    why.hidden = !canRetry;
    if (canRetry) {
      why.querySelector('summary').textContent = text.playerWhy;
      why.querySelector('ul').replaceChildren(...[blocked ? text.playerWhyBlocked : '', text.playerWhyTied, text.playerWhyDrm].filter(Boolean).map(line => el('li', '', line)));
    }
    const mark = $('failMark');
    if (!mark.firstChild && pixel) mark.append(pixel.button(64, 'pause'));
    $('fail').hidden = false;
    setStatus(lead);
    render();
  }
  function clearFailure() {
    st.failed = '';
    root.classList.remove('is-failed');
    $('fail').hidden = true;
  }

  /* ── Rendering ── */
  function render() {
    const playing = !videoEl.paused && !videoEl.ended;
    const failed = Boolean(st.failed);
    const loading = root.classList.contains('is-loading');
    root.classList.toggle('is-playing', playing);
    root.classList.toggle('is-start', !st.started && !playing && !loading && !failed);
    root.classList.toggle('is-paused', st.started && !playing && !loading && !failed);
    for (const button of root.querySelectorAll('[data-act="play"]')) {
      setIcon(button, playing ? 'pause' : 'play', 20);
      button.setAttribute('aria-label', playing ? 'Pause (K)' : 'Play (K)');
    }
    $('bigPlay').setAttribute('aria-label', 'Play');
    const muted = videoEl.muted || videoEl.volume === 0;
    const mute = root.querySelector('[data-act="mute"]');
    setIcon(mute, muted ? 'mute' : videoEl.volume < 0.5 ? 'low' : 'vol');
    mute.setAttribute('aria-label', muted ? 'Unmute (M)' : 'Mute (M)');
    $('volume').value = String(muted ? 0 : videoEl.volume);
    const fullscreen = Boolean(document.fullscreenElement);
    root.querySelector('[data-act="fs"]').setAttribute('aria-label', fullscreen ? 'Exit full screen (F)' : 'Full screen (F)');
    const pip = root.querySelector('[data-act="pip"]');
    pip.hidden = !document.pictureInPictureEnabled || videoEl.disablePictureInPicture;
    pip.setAttribute('aria-pressed', String(document.pictureInPictureElement === videoEl));
    tick();
    if (!playing) showControls();
  }
  function bufferedEnd(time) {
    let end = 0;
    for (let index = 0; index < videoEl.buffered.length; index++) {
      if (videoEl.buffered.start(index) <= time + 0.5) end = Math.max(end, videoEl.buffered.end(index));
    }
    return end;
  }
  function tick() {
    const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0; const time = videoEl.currentTime || 0;
    $('cur').textContent = fmt(time); $('dur').textContent = fmt(duration);
    const played = duration ? Math.min(1, time / duration) : 0;
    const buffered = duration ? Math.min(1, bufferedEnd(time) / duration) : 0;
    scrub.querySelector('.pl-fill').style.width = `${played * 100}%`;
    scrub.querySelector('.pl-buf').style.width = `${Math.max(played, buffered) * 100}%`;
    scrub.querySelector('.pl-knob').style.left = `${played * 100}%`;
    scrub.setAttribute('aria-valuemax', String(Math.round(duration)));
    scrub.setAttribute('aria-valuenow', String(Math.round(time)));
    scrub.setAttribute('aria-valuetext', `${fmt(time)} of ${fmt(duration)}`);
  }
  let frame = 0;
  function loop() { tick(); frame = !videoEl.paused ? requestAnimationFrame(loop) : 0; }

  /* ── Controls visibility: shown on movement, while paused, and while a control has keyboard focus. ── */
  let hideTimer = 0;
  function overlayOpen() { return Boolean(st.menu || st.info || st.help || !guide.hidden || st.failed); }
  function showControls() {
    root.classList.remove('is-idle');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(maybeHide, HIDE_AFTER_MS);
  }
  function maybeHide() {
    if (videoEl.paused || overlayOpen() || root.querySelector('.pl-fade:hover, .pl-fade :focus-visible')) return;
    root.classList.add('is-idle');
  }

  let osdTimer = 0;
  function osd(label, iconName) {
    const node = $('osd'); node.replaceChildren();
    if (iconName) node.append(icon(iconName, 22));
    node.append(el('span', '', label));
    node.classList.remove('is-on'); void node.offsetWidth; node.classList.add('is-on');
    clearTimeout(osdTimer); osdTimer = setTimeout(() => node.classList.remove('is-on'), 950);
    setStatus(label);
  }
  let toastTimer = 0;
  function toast(message, tone = 'ok') {
    toastEl.textContent = message; toastEl.classList.toggle('is-warn', tone === 'warn'); toastEl.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 3200);
  }

  /* ── Actions ── */
  function togglePlay() {
    if (st.failed || root.classList.contains('is-loading')) return;
    if (videoEl.paused || videoEl.ended) { st.started = true; void tryPlay(); } else videoEl.pause();
    showControls();
  }
  function seekTo(seconds) {
    const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
    if (!duration) return;
    videoEl.currentTime = Math.max(0, Math.min(duration, seconds));
    tick();
  }
  function seekBy(delta) {
    seekTo((videoEl.currentTime || 0) + delta);
    osd(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}s`, delta > 0 ? 'fwd' : 'back');
    showControls();
  }
  function setVolume(value) {
    videoEl.volume = Math.max(0, Math.min(1, value));
    videoEl.muted = videoEl.volume === 0;
  }
  function toggleMute() {
    videoEl.muted = !videoEl.muted;
    if (!videoEl.muted && videoEl.volume === 0) videoEl.volume = 0.6;
    osd(videoEl.muted ? 'Muted' : `Volume ${Math.round(videoEl.volume * 100)}`, videoEl.muted ? 'mute' : 'vol');
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen?.().catch(() => {});
  }
  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoEl.requestPictureInPicture();
    } catch { osd('Picture in picture unavailable'); }
    render();
  }
  function setSpeed(value) {
    st.speed = value; videoEl.playbackRate = value;
    osd(value === 1 ? text.playerNormalSpeed || 'Normal' : `${value}×`);
    renderLists();
  }
  function subtitleTracks() { return hls ? hls.subtitleTracks || [] : []; }
  function audioTracks() { return hls ? hls.audioTracks || [] : []; }
  function setSubtitle(index) {
    if (!hls) return;
    if (index >= 0) st.lastSubtitle = index;
    hls.subtitleTrack = index;
    hls.subtitleDisplay = false;
    renderCues();
    renderLists();
  }
  function toggleSubtitles() {
    const tracks = subtitleTracks();
    if (!tracks.length) { osd('No subtitles', 'cc'); return; }
    const next = hls.subtitleTrack >= 0 ? -1 : Math.min(st.lastSubtitle, tracks.length - 1);
    setSubtitle(next);
    osd(next < 0 ? 'Subtitles off' : `Subtitles · ${trackName(tracks[next], next)}`, 'cc');
  }
  function setAudio(index) {
    if (!hls) return;
    hls.audioTrack = index;
    osd(`Audio · ${trackName(audioTracks()[index], index)}`);
    renderLists();
  }
  function setLevel(index) {
    if (!hls) return;
    st.level = index;
    // -1 returns to automatic selection; a fixed level flushes and reloads at the playhead.
    hls.currentLevel = index;
    osd(index < 0 ? text.playerAuto || 'Auto' : levelLabel(hls.levels[index]));
    renderLists();
    renderSnag();
  }
  function toggleInfo(force) {
    st.info = typeof force === 'boolean' ? force : !st.info;
    root.classList.toggle('info-open', st.info);
    $('info').inert = !st.info;
    $('infoBtn').setAttribute('aria-expanded', String(st.info));
    if (st.info) { renderInfo(); $('info').querySelector('.pl-info-close').focus({ preventScroll: true }); }
    else if ($('info').contains(document.activeElement)) $('infoBtn').focus({ preventScroll: true });
    showControls();
  }
  function toggleHelp(force) {
    const open = typeof force === 'boolean' ? force : !st.help;
    if (open === st.help) return;
    st.help = open;
    $('help').hidden = !open;
    if (open) { st.helpReturn = document.activeElement; $('help').querySelector('.pl-help-close').focus({ preventScroll: true }); }
    else if (st.helpReturn && st.helpReturn.isConnected) st.helpReturn.focus({ preventScroll: true });
    showControls();
  }
  function retry() {
    clearFailure();
    st.started = false;
    videoEl.removeAttribute('src');
    void loadCurrentSource();
  }

  /* ── Captions: drawn from the showing/hidden text track so they dodge the control bar. ── */
  const cuesEl = $('cues');
  function renderCues() {
    const lines = [];
    const active = hls ? hls.subtitleTrack >= 0 : true;
    if (active) {
      for (const track of videoEl.textTracks) {
        if (track.mode === 'disabled' || !['subtitles', 'captions'].includes(track.kind)) continue;
        for (const cue of track.activeCues || []) if (cue.text) lines.push(cue.text.replace(/<[^>]+>/g, ''));
        if (lines.length) break;
      }
    }
    cuesEl.replaceChildren(...lines.map(line => el('span', '', line)));
  }
  videoEl.textTracks.addEventListener('addtrack', event => { event.track.addEventListener('cuechange', renderCues); });
  videoEl.textTracks.addEventListener('change', renderCues);

  /* ── Menus: Speed, Quality (Auto + hls.levels), Audio + Subtitles. Keyboard: ↑/↓, Home/End, Enter, Esc. ── */
  function trackName(track, index) {
    if (!track) return `Track ${index + 1}`;
    const name = String(track.name || '').trim();
    if (name && !/^(?:track\s*\d*|audio|subtitles?|captions?)$/i.test(name)) return name;
    const lang = String(track.lang || '').trim();
    try { if (lang) return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang; } catch { /* keep the code */ }
    return lang || `Track ${index + 1}`;
  }
  function levelLabel(level) { return level?.height ? `${level.height}p` : level?.bitrate ? `${Math.round(level.bitrate / 1000)} kb/s` : ''; }
  function levelOrder() {
    return (hls?.levels || []).map((level, index) => ({ level, index })).sort((a, b) => (b.level.height || 0) - (a.level.height || 0) || (b.level.bitrate || 0) - (a.level.bitrate || 0));
  }
  function levelVariant(level) {
    if (!offer || !level) return null;
    const uris = [].concat(level.url || [], level.uri || []).map(String);
    return (offer.variants || []).find(variant => uris.includes(variant.variantUrl))
      || (offer.variants || []).find(variant => variant.height && variant.height === level.height) || null;
  }
  function option(list, label, meta, checked, pick) {
    const button = el('button', 'pl-opt'); button.type = 'button';
    button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(checked)); button.tabIndex = -1;
    button.append(el('span', 'pl-opt-l', label), el('span', 'pl-opt-m', meta));
    button.addEventListener('click', () => { pick(); closeMenus(true); });
    list.append(button);
  }
  function renderLists() {
    // hls.js reports level and track changes while a menu may be open; keep keyboard focus in place.
    const openPanel = st.menu ? $(`menu-${st.menu}`) : null;
    const focused = openPanel ? menuItems(openPanel).indexOf(document.activeElement) : -1;
    const speedList = root.querySelector('[data-list="speed"]'); speedList.replaceChildren();
    for (const value of SPEEDS) option(speedList, value === 1 ? text.playerNormalSpeed || 'Normal' : `${value}×`, '', value === st.speed, () => setSpeed(value));
    $('speedLabel').textContent = `${st.speed}×`;
    root.querySelector('[data-menu="speed"]').setAttribute('aria-label', `Speed, ${st.speed === 1 ? 'normal' : `${st.speed}×`}`);

    const levels = levelOrder();
    const qualityButton = root.querySelector('[data-menu="quality"]');
    qualityButton.hidden = levels.length < 2;
    const qualityList = root.querySelector('[data-list="quality"]'); qualityList.replaceChildren();
    if (levels.length > 1) {
      const current = hls.levels[hls.currentLevel];
      const auto = st.level < 0;
      option(qualityList, text.playerAuto || 'Auto', auto && current ? t('playerAutoNow', { quality: levelLabel(current) }) : '', auto, () => setLevel(-1));
      for (const { level, index } of levels) {
        const variant = levelVariant(level);
        option(qualityList, levelLabel(level), variant ? sizeLabel(variant.sizeBytes, variant.sizeEstimated) : '', !auto && st.level === index, () => setLevel(index));
      }
      const label = auto ? text.playerAuto || 'Auto' : levelLabel(hls.levels[st.level]);
      $('qualityLabel').textContent = label;
      qualityButton.setAttribute('aria-label', `Quality, ${label}`);
    }
    const foot = $('qualityFoot');
    foot.hidden = !offer; foot.textContent = text.playerSnagQuality || '';
    foot.setAttribute('aria-hidden', 'true');

    const audio = audioTracks(); const subtitles = subtitleTracks();
    const hasAudio = audio.length > 1; const hasSubs = subtitles.length > 0;
    root.querySelector('[data-menu="tracks"]').hidden = !hasAudio && !hasSubs;
    root.querySelector('[data-menu="tracks"]').setAttribute('aria-pressed', String(Boolean(hls && hls.subtitleTrack >= 0)));
    $('audioGroup').hidden = !hasAudio; $('subsGroup').hidden = !hasSubs;
    $('menu-tracks').classList.toggle('is-single', !(hasAudio && hasSubs));
    const audioList = root.querySelector('[data-list="audio"]'); audioList.replaceChildren();
    audio.forEach((track, index) => option(audioList, trackName(track, index), track.lang && trackName(track, index) !== track.lang ? track.lang : '', hls.audioTrack === index, () => setAudio(index)));
    const subsList = root.querySelector('[data-list="subs"]'); subsList.replaceChildren();
    if (hasSubs) {
      option(subsList, text.playerSubtitlesOff || 'Off', '', hls.subtitleTrack < 0, () => setSubtitle(-1));
      subtitles.forEach((track, index) => option(subsList, trackName(track, index), 'Subtitles', hls.subtitleTrack === index, () => setSubtitle(index)));
    }
    $('tracksFoot').hidden = !hasSubs; $('tracksFoot').textContent = text.playerSubtitlesKey || '';
    $('tracksFoot').setAttribute('aria-hidden', 'true');
    if (st.info) renderInfo();
    if (focused >= 0) menuItems(openPanel)[focused]?.focus({ preventScroll: true });
  }
  function menuItems(panel) { return [...panel.querySelectorAll('[role="menuitemradio"]')].filter(item => item.offsetParent !== null); }
  function openMenu(name, trigger) {
    const panel = $(`menu-${name}`);
    if (!panel) return;
    const wasOpen = st.menu === name;
    closeMenus(false);
    if (wasOpen) return;
    st.menu = name; st.menuTrigger = trigger;
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('menu-open');
    const items = menuItems(panel);
    (items.find(item => item.getAttribute('aria-checked') === 'true') || items[0])?.focus({ preventScroll: true });
    showControls();
  }
  function closeMenus(restoreFocus) {
    const trigger = st.menuTrigger;
    for (const panel of root.querySelectorAll('.pl-menu')) panel.hidden = true;
    for (const button of root.querySelectorAll('[data-menu]')) button.setAttribute('aria-expanded', 'false');
    root.classList.remove('menu-open');
    st.menu = null; st.menuTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  for (const panel of root.querySelectorAll('.pl-menu')) {
    panel.addEventListener('keydown', event => {
      const items = menuItems(panel); const index = items.indexOf(document.activeElement);
      let next = -1;
      if (event.key === 'ArrowDown') next = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenus(true); return; }
      else if (event.key === 'Tab') { closeMenus(false); return; }
      else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); document.activeElement?.click(); return; }
      else return;
      event.preventDefault(); event.stopPropagation();
      items[next]?.focus({ preventScroll: true });
    });
  }

  /* ── Details drawer ── */
  function renderInfo() {
    const list = $('infoList'); list.replaceChildren();
    const choice = snagChoice();
    const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
    const duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : offer?.durationSeconds || 0;
    let page = '';
    try { const parsed = new URL(pageUrl()); page = `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`; } catch { /* No page. */ }
    const audio = audioTracks(); const subtitles = subtitleTracks();
    const entries = [
      ['Site', siteName()], ['Page', page], ['Length', duration ? fmt(duration) : ''],
      ['Quality', choice?.height ? `${choice.height}p` : levelLabel(level) || (videoEl.videoHeight ? `${videoEl.videoHeight}p` : '')],
      ['Size', choice ? sizeLabel(choice.sizeBytes, choice.sizeEstimated) : ''], ['Type', kindLabel()],
      ['Audio', audio.length > 1 ? audio.map(trackName).join(', ') : ''],
      ['Subtitles', subtitles.length ? subtitles.map(trackName).join(', ') : ''],
    ];
    // Figures use the pixel face, as in the prototype.
    for (const [name, value] of entries) if (value) list.append(el('dt', '', name), el('dd', ['Length', 'Quality', 'Size'].includes(name) ? 'pl-px' : '', value));
  }

  /* ── Snag it: the popup row's download, through the worker. ── */
  function snagChoice() {
    if (!offer) return null;
    if (hls && st.level >= 0) return levelVariant(hls.levels[st.level]) || offer;
    return offer;
  }
  function snagMeta(choice) {
    if (!choice) return '';
    return [choice.height ? `${choice.height}p` : '', sizeLabel(choice.sizeBytes, choice.sizeEstimated)].filter(Boolean).join(' · ');
  }
  function snagSub(choice) {
    if (!choice) return '';
    if (choice.backend === 'browser') return text.playerViaChrome;
    return st.desktop && st.desktop !== 'ready' ? text.playerNeedsDesktop : text.playerViaDesktop;
  }
  function renderSnag() {
    const choice = snagChoice();
    $('snagWrap').hidden = !offer;
    for (const button of root.querySelectorAll('.pl-snag')) {
      button.hidden = !offer;
      button.setAttribute('aria-busy', String(st.snagBusy));
      button.querySelector('.pl-snag-label').textContent = st.snagBusy ? text.playerSnagging : text.playerSnag;
      const meta = snagMeta(choice);
      button.querySelector('.pl-snag-meta').textContent = meta;
      button.setAttribute('aria-label', [text.playerSnag, meta, snagSub(choice)].filter(Boolean).join(', '));
    }
    for (const node of root.querySelectorAll('[data-role="snag-sub"]')) node.textContent = offer ? snagSub(choice) : '';
    $('snagAnyway').textContent = text.playerSnagAnyway;
  }
  async function refreshDesktop() {
    if (!offer) return;
    const result = await send({ cmd: 'PREVIEW_DESKTOP_STATE', sessionId });
    st.desktop = result?.state || 'offline';
    renderSnag();
  }
  async function snag(origin) {
    const choice = snagChoice();
    if (!choice || st.snagBusy) return;
    if (choice.backend === 'desktop' && st.desktop && st.desktop !== 'ready') { showGuide(st.desktop); return; }
    st.snagBusy = true; renderSnag();
    const result = await send({ cmd: 'SNAG_STREAM_SESSION', sessionId, variantUrl: choice.variantUrl || '' });
    st.snagBusy = false;
    if (result?.ok) {
      const backend = result.backend || choice.backend;
      const meta = snagMeta(choice);
      toast([backend === 'browser' ? text.playerSentChrome : text.playerSentDesktop, meta].filter(Boolean).join(' · '));
      hideGuide();
      pixel?.snag(origin, null);
      for (const button of root.querySelectorAll('.pl-snag')) {
        button.classList.add('is-snagged'); setTimeout(() => button.classList.remove('is-snagged'), 2600);
      }
    } else if (choice.backend === 'desktop') {
      await refreshDesktop();
      if (st.desktop !== 'ready') showGuide(st.desktop);
      else toast(result?.error || 'Could not start the download.', 'warn');
    } else toast(result?.error || 'Could not start the download.', 'warn');
    renderSnag();
  }

  /* ── Desktop guidance: the popup banner's sentence and action, inline. ── */
  const PAIR_MESSAGES = { denied: 'pairDenied', blocked: 'pairBlocked', expired: 'pairExpired', conflict: 'pairConflict', limited: 'pairLimited', offline: 'pairOffline', failed: 'pairFailed', cancelled: 'pairOffer' };
  let getAppFallback = false; let openTimer = 0; let pairTimer = 0;
  function guideButton(label, handler, primary) {
    const button = el('button', primary ? 'pl-bevel' : 'pl-ghost', label); button.type = 'button';
    button.addEventListener('click', handler); return button;
  }
  function fillGuide(sentence, actions = [], extra = null) {
    const close = el('button', 'pl-cb pl-guide-close'); close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.append(icon('close', 14));
    close.addEventListener('click', () => hideGuide(true));
    const row = el('div', 'pl-guide-actions'); row.append(...actions);
    guide.replaceChildren(close, ...(extra ? [extra] : []), el('p', '', sentence), ...(actions.length ? [row] : []));
  }
  function showGuide(state) {
    clearTimeout(pairTimer);
    if (state === 'unpaired') fillGuide(text.pairOffer, [guideButton(text.pairConnect, startPairing, true)]);
    else if (state === 'update-app') fillGuide(text.playerUpdateApp, [guideButton('Update', () => openTab(RELEASES), true)]);
    else if (state === 'update-extension') fillGuide(text.playerUpdateExtension, [guideButton('Update Chrome extension', () => openTab(`chrome://extensions/?id=${chrome.runtime.id}`), true)]);
    else {
      fillGuide(text.playerDesktopNeeded, [guideButton(getAppFallback ? 'Get the app' : 'Open SnagThis', openDesktop, true)]);
    }
    guide.hidden = false;
    guide.querySelector('.pl-bevel')?.focus({ preventScroll: true });
    showControls();
  }
  function hideGuide(restoreFocus) {
    clearTimeout(pairTimer);
    if (guide.hidden) return;
    const hadFocus = guide.contains(document.activeElement);
    guide.hidden = true; guide.replaceChildren();
    if (restoreFocus || hadFocus) root.querySelector('.pl-top .pl-snag')?.focus({ preventScroll: true });
  }
  function openDesktop() {
    if (getAppFallback) { openTab(RELEASES); return; }
    openTab('snagthis://open');
    clearTimeout(openTimer);
    // As in the popup: still unreachable after 3s offers Get the app instead.
    openTimer = setTimeout(async () => {
      await refreshDesktop();
      if (st.desktop === 'offline') { getAppFallback = true; if (!guide.hidden) showGuide('offline'); }
      else if (st.desktop === 'ready') hideGuide();
      else if (!guide.hidden) showGuide(st.desktop);
    }, 3000);
  }
  async function startPairing() {
    const result = await send({ cmd: 'PAIR_START', apiBase });
    renderPairing(result?.state || { status: 'failed' });
  }
  function renderPairing(state) {
    clearTimeout(pairTimer);
    if (state.status === 'waiting') {
      const digits = el('div', 'pl-digits'); digits.setAttribute('aria-label', `Digits ${String(state.matchCode).split('').join(' ')}`);
      for (const digit of String(state.matchCode || '')) digits.append(el('span', '', digit));
      const lead = el('p'); lead.append(el('b', '', text.pairConnecting));
      fillGuide(text.pairChooseAllow, [guideButton('Cancel', async () => { await send({ cmd: 'PAIR_CANCEL' }); showGuide('unpaired'); })], lead);
      guide.querySelector('.pl-guide-actions').before(digits);
      pairTimer = setTimeout(async () => { const next = await send({ cmd: 'PAIR_STATE' }); if (!guide.hidden) renderPairing(next?.state || { status: 'failed' }); }, 1000);
    } else if (state.status === 'connected') {
      fillGuide(text.pairConnected);
      void send({ cmd: 'PAIR_ACK' });
      void refreshDesktop().then(() => { pairTimer = setTimeout(() => hideGuide(), 1500); });
    } else {
      fillGuide(text[PAIR_MESSAGES[state.status] || 'pairFailed'], [guideButton(text.pairConnect, startPairing, true)]);
      void send({ cmd: 'PAIR_ACK' });
    }
    guide.hidden = false;
  }

  /* ── Events ── */
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) {
      if (st.menu && !event.target.closest('.pl-menu')) closeMenus(false);
      return;
    }
    if (button.dataset.menu) { event.stopPropagation(); openMenu(button.dataset.menu, button); return; }
    const act = button.dataset.act || (button.id === 'bigPlay' ? 'play' : button.id === 'infoBtn' ? 'info' : '');
    if (!act) return;
    if (st.menu && !button.closest('.pl-menu')) closeMenus(false);
    ({
      play: togglePlay, mute: toggleMute, fs: toggleFullscreen, pip: togglePip, help: () => toggleHelp(),
      back: () => seekBy(-10), fwd: () => seekBy(10), info: () => toggleInfo(), retry,
      open: () => openTab(pageUrl()), snag: () => snag(button),
    })[act]?.();
  });
  $('stage').addEventListener('click', () => { if (st.menu) { closeMenus(false); return; } togglePlay(); });
  $('stage').addEventListener('dblclick', toggleFullscreen);
  $('help').addEventListener('click', event => { if (event.target === $('help')) toggleHelp(false); });
  $('volume').addEventListener('input', () => { videoEl.muted = false; setVolume(Number($('volume').value)); });
  root.addEventListener('pointermove', showControls);
  root.addEventListener('pointerleave', () => { if (!videoEl.paused && !overlayOpen()) root.classList.add('is-idle'); });
  root.addEventListener('focusin', showControls);
  document.addEventListener('fullscreenchange', render);
  videoEl.addEventListener('enterpictureinpicture', render);
  videoEl.addEventListener('leavepictureinpicture', render);

  // Scrub bar: pointer drag, hover time, and slider keys.
  function scrubRatio(event) { const rect = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (event.clientX - rect.left) / (rect.width || 1))); }
  function hoverScrub(event) {
    const ratio = scrubRatio(event); const width = scrub.clientWidth;
    const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
    $('tipTime').textContent = fmt(ratio * duration);
    scrub.querySelector('.pl-tip').style.left = `${Math.max(24, Math.min(width - 24, ratio * width))}px`;
    scrub.querySelector('.pl-hov').style.width = `${ratio * 100}%`;
    return ratio;
  }
  scrub.addEventListener('pointermove', event => {
    const ratio = hoverScrub(event);
    if (scrub.classList.contains('is-dragging')) seekTo(ratio * (videoEl.duration || 0));
  });
  scrub.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    scrub.setPointerCapture(event.pointerId); scrub.classList.add('is-dragging');
    seekTo(hoverScrub(event) * (videoEl.duration || 0));
  });
  for (const name of ['pointerup', 'pointercancel']) scrub.addEventListener(name, () => scrub.classList.remove('is-dragging'));
  scrub.addEventListener('keydown', event => {
    const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
    const moves = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -10, PageUp: 10 };
    if (event.key in moves) seekBy(moves[event.key]);
    else if (event.key === 'Home') seekTo(0);
    else if (event.key === 'End') seekTo(duration);
    else return;
    event.preventDefault(); event.stopPropagation();
  });

  // Keyboard: Space/K, J/L ±10s, ←/→ ±5s, ↑/↓ volume, M, F, C, I, P, 0–9, < / >, ?, Esc.
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const key = event.key;
    if (st.help) {
      if (key === 'Escape' || key === '?') { event.preventDefault(); toggleHelp(false); }
      else if (key === 'Tab') { event.preventDefault(); $('help').querySelector('.pl-help-close').focus(); }
      return;
    }
    if (key === 'Escape') {
      if (st.menu) closeMenus(true);
      else if (!guide.hidden) hideGuide(true);
      else if (st.info) toggleInfo(false);
      else return;
      event.preventDefault(); return;
    }
    if (target?.closest?.('.pl-menu')) return;
    const onRange = target?.matches?.('input[type="range"]');
    const onButton = target?.closest?.('button, summary');
    let used = true;
    if (key === ' ' || key === 'k' || key === 'K') {
      if (key === ' ' && onButton) return;
      togglePlay(); osd(videoEl.paused ? 'Paused' : 'Play', videoEl.paused ? 'pause' : 'play');
    } else if (key === 'j' || key === 'J') seekBy(-10);
    else if (key === 'l' || key === 'L') seekBy(10);
    else if ((key === 'ArrowLeft' || key === 'ArrowRight') && !onRange) seekBy(key === 'ArrowLeft' ? -5 : 5);
    else if ((key === 'ArrowUp' || key === 'ArrowDown') && !onRange) {
      videoEl.muted = false; setVolume(videoEl.volume + (key === 'ArrowUp' ? 0.1 : -0.1));
      osd(`Volume ${Math.round(videoEl.volume * 100)}`, 'vol');
    } else if (key === 'm' || key === 'M') toggleMute();
    else if (key === 'f' || key === 'F') toggleFullscreen();
    else if (key === 'c' || key === 'C') toggleSubtitles();
    else if (key === 'i' || key === 'I') toggleInfo();
    else if (key === 'p' || key === 'P') void togglePip();
    else if (/^[0-9]$/.test(key) && !st.failed) { seekTo((videoEl.duration || 0) * Number(key) / 10); osd(`${Number(key) * 10}%`); }
    else if (key === '>' || key === '<') { const next = SPEEDS[SPEEDS.indexOf(st.speed) + (key === '>' ? 1 : -1)]; if (next) setSpeed(next); }
    else if (key === '?') toggleHelp(true);
    else used = false;
    if (used) { event.preventDefault(); showControls(); }
  });

  for (const name of ['play', 'pause', 'volumechange', 'ratechange', 'durationchange', 'ended']) videoEl.addEventListener(name, render);
  for (const name of ['timeupdate', 'progress', 'seeked']) videoEl.addEventListener(name, tick);
  videoEl.addEventListener('play', () => { st.started = true; if (!frame) frame = requestAnimationFrame(loop); });
  videoEl.addEventListener('loadedmetadata', () => { renderLists(); if (st.info) renderInfo(); });
  videoEl.addEventListener('waiting', () => root.classList.add('is-buffering'));
  videoEl.addEventListener('playing', () => {
    root.classList.remove('is-buffering');
    if (root.classList.contains('is-loading')) { setLoading(false); setStatus('Playing preview.'); }
    render(); showControls();
  });
  videoEl.addEventListener('canplay', () => {
    root.classList.remove('is-buffering');
    if (root.classList.contains('is-loading')) { setLoading(false); setStatus(''); render(); }
  });
  videoEl.addEventListener('error', () => {
    if (!videoEl.getAttribute('src') || hls) return;
    fail('failed');
  });

  /* ── Start ── */
  async function loadStreamSession(id) {
    if (!id || !globalThis.chrome || !chrome.runtime || !chrome.runtime.sendMessage) return null;
    const response = await send({ cmd: 'GET_STREAM_SESSION', sessionId: id });
    if (!response || !response.ok || !response.session) return null;
    return response;
  }

  async function init() {
    for (const node of root.querySelectorAll('[data-icon]')) node.prepend(icon(node.dataset.icon, node.closest('.pl-ghost') ? 14 : 18));
    if (pixel) { $('mark').append(pixel.button(30, 'play')); $('bigPlay').append(pixel.button(104, 'play')); }
    $('loadingText').textContent = text.playerLoading || 'Loading preview';
    $('previewLabel').textContent = text.playerPreview || 'Preview';

    const response = sessionId ? await loadStreamSession(sessionId) : null;
    const session = response?.session;
    if (session) {
      primaryUrl = String(session.sourceUrl || '').trim();
      declaredType = String(session.declaredType || '').trim().toLowerCase();
      displayTitle = String(session.title || displayTitle).trim();
      sourcePageUrl = String(session.sourcePageUrl || '').trim();
      requestHeaders = session.requestHeaders && typeof session.requestHeaders === 'object' ? session.requestHeaders : {};
      credentialed = session.credentialed !== false;
      apiBase = String(session.apiBase || '');
      offer = response.snag && typeof response.snag === 'object' ? response.snag : null;
    }

    titleEl.textContent = displayTitle || 'Preview';
    document.title = `${displayTitle || 'Preview'} - SnagThis`;
    sourceEl.textContent = siteName();
    $('kind').textContent = primaryUrl ? kindLabel() : '';
    // The page, not the raw media URL, plays the video with its own cookies and headers.
    for (const button of root.querySelectorAll('[data-act="open"]')) button.hidden = !pageUrl();
    if (offer?.poster) videoEl.poster = offer.poster;
    renderSnag();
    renderLists();
    render();
    void loadCurrentSource();
    void refreshDesktop();
  }

  void init();

  window.addEventListener('beforeunload', () => {
    destroyHls();
  });
})();
