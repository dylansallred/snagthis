/* Workbench popup. Jobs belong to the worker/desktop, never to this window. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isDemo = location.protocol !== 'chrome-extension:' && ['localhost', '127.0.0.1', ''].includes(location.hostname) && params.has('demo');
  const model = SnagThisPopupModel;
  const rows = SnagThisRows;
  const titles = SnagThisTitles;
  const strings = SnagThisStrings.strings;
  const accent = SnagThisPopupAccent;
  const pixel = SnagThisPixel;
  const storeBuild = globalThis.SnagThisBuild?.storeBuild === true;
  const friendly = SnagThisDetection.friendlyError;
  const runtimeVersion = isDemo ? '1.0.0' : chrome.runtime.getManifest().version;
  const apiBase = (!isDemo && !chrome.runtime.getManifest().update_url && model.localApiBase(params.get('apiBase'))) || 'http://127.0.0.1:49732';
  // Public pages: the GitHub repository stays private until launch, and store reviewers must be able to open these.
  const RELEASES = 'https://snagthisvid.com/#download';
  const HELP = 'https://snagthisvid.com/help';
  const DEFAULT_PREFERENCES = { preferredQuality: 'best', subtitleLanguage: 'none', notifyOnComplete: true, launchAtLogin: false };
  let preferences = { ...DEFAULT_PREFERENCES };
  let appToken = ''; let activeTab = null; let mediaItems = []; let mappings = {}; let queue = []; let desktopQueue = []; let browserQueue = []; let visit = '';
  let reachable = false; let compatible = true; let getAppFallback = false; let refreshBusy = false; let healthBusy = false;
  let compatibilityIssue = 'desktop';
  let discoveryPending = !isDemo; let discoveryError = false; let connectionChecked = isDemo;
  let menuTrigger = null; let selected = new Map(); let customTitles = {}; let pending = new Map(); let failures = new Map();
  let noticeTimer; let openTimer; let queueTimer; let healthTimer;
  let posterPreparation = null; let popupClosed = false; let pageNeedsRefresh = false;
  let rowsPainted = false; let breathed = false; let menuExit = null;
  let desktopAudioTracks = isDemo; let sample = null; let sampleDwell = 0; let dwellRow = null;
  let accentPush = null;
  const rowElements = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const icons = {
    // Lucide Settings, matching the desktop icon (vendor/lucide.LICENSE.txt).
    gear: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    play: '<path d="m7 4 9 6-9 6Z"/>', resume: '<circle cx="10" cy="10" r="7.5"/><path d="m8.5 7.2 4.2 2.8-4.2 2.8Z"/>', pause: '<path d="M7 4v12M13 4v12"/>',
    download: '<path d="M10 3v9m-4-4 4 4 4-4M4 12v4h12v-4"/>',
    screen: '<path d="M3 4h14v9H3zM7 17h6M10 13v4"/>', captions: '<path d="M3 5h14v10H3zM6 12h3M12 12h2M6 9h2M11 9h3"/>', bell: '<path d="M5 8a5 5 0 0 1 10 0c0 5 2 6 2 6H3s2-1 2-6M8.5 17a1.7 1.7 0 0 0 3 0"/>', external: '<path d="M12 3h5v5M9 11l8-8M15 11v5H4V5h5"/>', next: '<path d="m8 5 5 5-5 5"/>',
    close: '<path d="m5 5 10 10M15 5 5 15"/>', more: '<circle cx="4.5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/>', down: '<path d="m5 8 5 5 5-5"/>', check: '<path d="m4 10 4 4 8-8"/>',
    // Lucide Palette, matching the desktop's Appearance icon.
    palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
    // Lucide icons for the Settings tabs and rows, matching the desktop's sections.
    section: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    app: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    lifebuoy: '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
  };
  const lucide = new Set(['gear', 'palette', 'section', 'plug', 'info', 'app', 'alert', 'refresh', 'lifebuoy']);
  function icon(name) { const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.setAttribute('viewBox', lucide.has(name) ? '0 0 24 24' : '0 0 20 20'); node.setAttribute('aria-hidden', 'true'); node.classList.add('icon'); node.innerHTML = icons[name] || icons.play; return node; }
  function el(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
  function qualityMark(label) {
    const quality = rows.formatQualityBadge(label);
    const mark = el('span', `quality-mark${quality.tier ? '' : ' is-unknown'}`);
    if (quality.tier) { mark.setAttribute('aria-label', `${quality.name}, ${quality.label}`); mark.append(el('span', 'tier-badge', quality.tier)); }
    mark.append(el('span', 'resolution', quality.label));
    return mark;
  }
  // Each item draws its own leading separator; the list clips it wherever an item starts a line.
  function appendMetadata(status, content) { const part = el('span', 'meta-item'); part.append(content); status.append(part); }
  function action(label, handler, style = '', iconName = '') {
    const button = el('button', `action ${style}`); button.type = 'button'; button.setAttribute('aria-label', label);
    const iconOnly = style.split(/\s+/).includes('icon-only') && iconName;
    if (iconName) button.append(icon(iconName)); if (!iconOnly) button.append(document.createTextNode(label));
    if (iconOnly) button.title = label;
    button.addEventListener('click', handler); return button;
  }
  function notice(message) { $('notice').textContent = String(message); $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
  function external(url) { if (isDemo) { notice('Preview only — no app or page was opened.'); return; } chrome.tabs.create({ url }).catch(() => notice('Open SnagThis from your Applications folder.')); }
  async function request(path, options = {}) {
    if (isDemo) throw new Error('Demo cannot access the desktop app.');
    const headers = { 'X-Client': 'snagthis-extension', 'X-Protocol-Version': '1', 'X-Extension-Version': runtimeVersion, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.public ? {} : { Authorization: `Bearer ${appToken}` }) };
    let response;
    try { response = await fetch(`${apiBase}${path}`, { method: options.body ? 'POST' : 'GET', headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(5000) }); }
    catch (error) { throw new Error(friendly(error)); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error?.message || data.error || 'SnagThis could not finish that action.'); error.status = response.status; error.compatibility = data.compatibility; throw error; }
    return data;
  }
  async function message(value) { return isDemo ? { ok: true } : chrome.runtime.sendMessage(value); }
  function desktopReady() { return reachable && compatible && Boolean(appToken); }
  function browserSupported(item) { return !isDemo && SnagThisBrowserDownloads.isSupported(item); }
  function openDesktop(view) {
    const appUrl = view === 'settings' ? 'snagthis://open/settings' : 'snagthis://open';
    if (!reachable) {
      if (getAppFallback) { external(RELEASES); return; }
      external(appUrl); clearTimeout(openTimer);
      openTimer = setTimeout(() => { if (!reachable) { getAppFallback = true; renderConnection(); } }, 3000);
      return;
    }
    if (!appToken) { external(appUrl); return; }
    request('/v1/app/focus', { body: view ? { view } : {} }).catch(error => notice(error.message));
  }
  function renderConnection() {
    const banner = $('connection-banner'); banner.replaceChildren();
    const unavailable = !reachable || !compatible || !appToken;
    $('video-list').classList.toggle('unavailable', unavailable);
    $('video-list').inert = false;
    for (const node of rowElements.values()) {
      const button = node.querySelector(':scope > .action'); const current = node.current;
      if (button) button.disabled = button.getAttribute('aria-label') === 'Starting download'
        || Boolean(current?.jobId && current.row.source.backend !== 'browser' && unavailable && !['open-page', 'details'].includes(current.row.action?.id));
    }
    banner.hidden = !unavailable || !connectionChecked;
    if (!connectionChecked) {
      // A connection check in flight is not evidence that the app is offline.
    } else if (!reachable) {
      banner.append(el('span', '', 'Save supported files in Chrome. Open SnagThis for streams and more.'), action(getAppFallback ? 'Get the app' : 'Open SnagThis', () => openDesktop(), 'primary'));
    } else if (!compatible) {
      if (compatibilityIssue === 'extension') banner.append(el('span', '', 'Update the Chrome extension to use desktop downloads.'), action('Update Chrome extension', showExtensionUpdate, 'primary'));
      else banner.append(el('span', '', 'Update SnagThis to use desktop downloads.'), action('Update', () => external(RELEASES), 'primary'));
    } else if (!appToken && disconnectedNotice) {
      banner.append(el('span', '', 'Disconnected from SnagThis. Supported files still save in Chrome.'), action('Connect again', showPairing, 'primary'));
    } else if (!appToken) {
      banner.append(el('span', '', 'Save supported files in Chrome. Connect SnagThis for streams and more.'), action('Connect', showPairing, 'primary'));
    }
    $('help-button').hidden = connectionChecked && !reachable;
    const activeCount = queue.filter(job => job.backend !== 'browser' && ['downloading', 'queued'].includes(job.queueStatus)).length;
    const openButton = $('open-app');
    openButton.replaceChildren(document.createTextNode(connectionChecked && !reachable ? "Don't have the app? Get it" : 'Open SnagThis'));
    if (reachable && activeCount) {
      const badge = el('span', 'count-badge', String(activeCount)); badge.setAttribute('aria-hidden', 'true'); openButton.append(badge);
      openButton.setAttribute('aria-label', `Open SnagThis, ${activeCount} active download${activeCount === 1 ? '' : 's'}`);
    } else openButton.removeAttribute('aria-label');
    syncSettings();
  }
  function updateThumb(thumb, row) {
    const localPoster = model.resolveThumbnailUrl(row.thumbnailUrl, apiBase);
    const node = thumb.closest('.video-row');
    const item = node?.current?.item;
    const verified = item?.sourcePreviewPoster ? item : item?.detectedStreams?.find(stream => stream.sourcePreviewPoster);
    const sourcePoster = node?.sourcePoster || verified?.sourcePreviewPoster;
    if (node && verified) {
      node.sourcePoster ||= verified.sourcePreviewPoster;
      if (node.sourceSceneStart === undefined) node.sourceSceneStart = verified.sourcePreviewSceneStart;
      if (node.sourceSceneScope === undefined) node.sourceSceneScope = verified.sourcePreviewSceneScope;
    }
    const resolved = isDemo ? row.thumbnailUrl : (reachable && localPoster.startsWith(`${apiBase}/downloads/`) ? localPoster : sourcePoster || localPoster);
    const source = resolved && resolved !== thumb.dataset.failedSource ? resolved : '';
    if (thumb.dataset.source !== source) {
      thumb.dataset.source = source;
      const stale = [...thumb.querySelectorAll('.thumb-poster, .thumb-poster-leaving')];
      for (const node of stale) node.classList.replace('thumb-poster', 'thumb-poster-leaving');
      const poster = source ? el('img', 'thumb-poster') : el('div', 'thumb-poster placeholder');
      if (source) {
        // The new poster fades in over whatever it replaces, then the old layer goes.
        poster.alt = ''; poster.classList.add('is-loading'); poster.referrerPolicy = 'no-referrer';
        poster.addEventListener('load', () => { poster.classList.remove('is-loading'); setTimeout(() => { for (const node of stale) node.remove(); }, reducedMotion.matches ? 0 : 150); }, { once: true });
        poster.src = source; poster.addEventListener('error', () => { if (thumb.dataset.source === source) { thumb.dataset.failedSource = source; delete thumb.dataset.source; updateThumb(thumb, { ...(thumb.closest('.video-row')?.current?.row || row), thumbnailUrl: null }); preparePosters(); } }, { once: true });
        if (stale.length) stale.at(-1).after(poster); else thumb.prepend(poster);
      } else {
        poster.setAttribute('aria-hidden', 'true'); for (let index = 0; index < 3; index++) poster.append(el('span', 'thumb-loading-dot'));
        for (const node of stale) node.remove(); thumb.prepend(poster);
      }
    }
  }
  function storeSourcePoster(node, item, previewVisit, poster, sceneStart, sceneScope) {
    if (!node.isConnected || visit !== previewVisit || node.current?.item.id !== item.id || node.current?.item.url !== item.url) return;
    node.sourcePoster = poster; node.sourceSceneStart = sceneStart; node.sourceSceneScope = sceneScope; updateThumb(node.querySelector('.thumb'), node.current.row);
    message({ cmd: 'STORE_MEDIA_PREVIEW_POSTER', tabId: activeTab?.id, mediaId: item.id, mediaUrl: item.url, visit: previewVisit, poster, sceneStart, sceneScope }).catch(() => {});
  }
  function storeSourceMetadata(node, item, previewVisit, metadata) {
    if (!node.isConnected || visit !== previewVisit || node.current?.item.id !== item.id || node.current?.item.url !== item.url) return;
    message({ cmd: 'STORE_MEDIA_PREVIEW_METADATA', tabId: activeTab?.id, mediaId: item.id, mediaUrl: item.url, visit: previewVisit, ...metadata }).catch(() => {});
  }
  function stopPosterPreparation(retry = false) {
    const preparation = posterPreparation; posterPreparation = null;
    if (!preparation) return;
    if (retry) preparation.node.posterAttempted = false;
    preparation.controller?.destroy(); preparation.video.remove();
  }
  function preparePosters() {
    const list = $('video-list'); const bounds = list.getBoundingClientRect();
    const visible = node => { const rect = node.getBoundingClientRect(); return node.isConnected && rect.bottom > bounds.top && rect.top < bounds.bottom; };
    const suspended = popupClosed || isDemo || document.hidden || $('sheet').open || [...rowElements.values()].some(node => node.previewVideo);
    if (posterPreparation) {
      if (suspended || !visible(posterPreparation.node) || posterPreparation.node.querySelector('.thumb').dataset.source) stopPosterPreparation(true);
      else return;
    }
    if (suspended) return;
    // Unprompted previews fetch only media Chrome observed for this tab; page
    // script can report any URL, so those rows wait for a hover instead.
    const node = [...rowElements.values()].find(candidate => !candidate.posterAttempted && visible(candidate) && !candidate.querySelector('.thumb').dataset.source && SnagThisSourcePreview.sourceFor(candidate.current?.item)?.trusted);
    if (!node) return;
    const item = node.current.item; const previewVisit = visit;
    const video = el('video', 'poster-probe'); video.hidden = true; video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
    node.posterAttempted = true; node.querySelector('.thumb').append(video);
    const preparation = { node, video, controller: null }; posterPreparation = preparation;
    const finish = () => { if (posterPreparation !== preparation) return; stopPosterPreparation(); queueMicrotask(preparePosters); };
    preparation.controller = SnagThisSourcePreview.create({ item, video, tabId: activeTab?.id, mediaId: item.id, posterOnly: true, sceneOffset: node.sourceSceneStart, sceneScope: node.sourceSceneScope,
      onMetadata: metadata => storeSourceMetadata(node, item, previewVisit, metadata),
      onPoster: (poster, sceneStart, sceneScope) => { if (posterPreparation !== preparation) return; storeSourcePoster(node, item, previewVisit, poster, sceneStart, sceneScope); finish(); },
      onError: finish,
    });
    if (!preparation.controller) finish();
  }
  function stopThumbPreview(node) {
    if (!node) return;
    node.sourcePreview?.destroy(); node.sourcePreview = null;
    const video = node.previewVideo;
    node.previewVideo = null;
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); }
    node.querySelector('.thumb')?.classList.remove('is-previewing');
  }
  function syncThumbPreview(node) {
    const active = (node.previewHovered || node.previewFocused) && !reducedMotion.matches && !document.hidden && !$('sheet').open;
    if (!active || !node.current) { stopThumbPreview(node); return; }
    stopPosterPreparation(true);
    const { row, jobId, item } = node.current;
    const demoName = isDemo && { neon: 'neon-rain', hop: 'sky-hop', tide: 'ember-tide' }[item.id];
    let clipUrl = demoName ? `popup/media/${demoName}.mp4` : reachable && compatible && appToken ? model.previewClipUrl(row.source.previewClipUrl || (node.previewJobId === jobId ? node.previewClipUrl : ''), apiBase) : '';
    if (clipUrl && node.previewFailedUrl === new URL(clipUrl, location.href).pathname) clipUrl = '';
    if (!clipUrl) {
      if (!node.sourcePreview && !node.sourcePreviewFailed && (item.mediaKind === 'youtube-page' || SnagThisSourcePreview.sourceFor(item))) {
        stopThumbPreview(node);
        const previewVisit = visit;
        const thumb = node.querySelector('.thumb'); const video = el('video', 'thumb-preview'); video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
        node.previewVideo = video; thumb.append(video);
        const callbacks = {
          onPlaying: () => { if (node.previewVideo === video) thumb.classList.add('is-previewing'); },
          onError: () => { if (node.previewVideo === video) { node.sourcePreviewFailed = true; stopThumbPreview(node); } },
        };
        node.sourcePreview = item.mediaKind === 'youtube-page'
          ? SnagThisPagePreview.create({ video, send: message, tabId: activeTab?.id, mediaId: item.id, ...callbacks })
          : SnagThisSourcePreview.create({ item, video, tabId: activeTab?.id, mediaId: item.id, sceneOffset: node.sourceSceneStart, sceneScope: node.sourceSceneScope, ...callbacks,
            onMetadata: metadata => storeSourceMetadata(node, item, previewVisit, metadata),
            onPoster: (poster, sceneStart, sceneScope) => {
              if (node.previewVideo === video) storeSourcePoster(node, item, previewVisit, poster, sceneStart, sceneScope);
            },
          });
      }
      const key = `${jobId}:${row.state}`;
      if (!isDemo && reachable && compatible && appToken && jobId && row.source.backend !== 'browser' && node.previewRequestedFor !== key) {
        node.previewRequestedFor = key;
        message({ cmd: 'REQUEST_MEDIA_PREVIEW', tabId: activeTab?.id, mediaId: item.id, jobId, apiBase }).then(result => {
          if (!result.ok || node.current?.jobId !== jobId || !node.isConnected) return;
          node.previewJobId = jobId; node.previewClipUrl = result.previewClipUrl || '';
          if (result.status === 'ready') syncThumbPreview(node);
        }).catch(() => {});
      }
      return;
    }
    const clipKey = new URL(clipUrl, location.href).pathname;
    if (node.previewFailedUrl === clipKey || node.previewVideo?.dataset.clipKey === clipKey) return;
    stopThumbPreview(node);
    const thumb = node.querySelector('.thumb'); const video = el('video', 'thumb-preview');
    video.dataset.clipKey = clipKey; video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true; video.preload = 'none'; video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
    const failed = () => { if (node.previewVideo === video) { node.previewFailedUrl = clipKey; stopThumbPreview(node); syncThumbPreview(node); } };
    video.addEventListener('playing', () => { if (node.previewVideo === video) thumb.classList.add('is-previewing'); });
    video.addEventListener('error', failed, { once: true });
    node.previewVideo = video; thumb.append(video); video.src = clipUrl; video.play().catch(failed);
  }
  function syncThumbPreviews() {
    for (const node of rowElements.values()) syncThumbPreview(node);
    preparePosters();
  }
  function rowModel(item) {
    const choice = model.selectMedia(item, preferences, selected.get(item.id));
    const job = model.jobFor(item, mappings, queue);
    const jobId = job?.id || job?.jobId || null;
    const optimistic = pending.get(item.id)?.optimistic ? { queueStatus: 'downloading', progress: 0 } : null;
    const failure = failures.get(item.id);
    const title = customTitles[item.id] || titles.getDisplayTitle(item);
    const source = { ...choice, ...(job || optimistic || (failure ? { queueStatus: 'failed', error: failure, progress: 0 } : {})), title: customTitles[item.id] || job?.title || title };
    const audioOnly = job ? job.selection?.audioOnly === true : choice.selection.audioOnly === true;
    const jobHeight = [job?.height, job?.resolutionHeight, job?.selection?.height].find(height => Number.isFinite(height) && height > 0);
    if (audioOnly) { source.height = null; source.resolutionHeight = null; source.resolution = ''; }
    else if (jobHeight) source.height = jobHeight;
    const firstWaiting = queue.find(candidate => candidate.queueStatus === 'queued')?.id;
    const result = model.browserRow(rows.toRowModel(source, { surface: 'popup', firstQueuedId: firstWaiting, folder: preferences.outputDirectory }), job);
    if (result && audioOnly) { result.qualityLabel = 'Audio only'; if (result.state === 'detected') result.statusLine = 'Audio only'; }
    if (result && !isDemo && !job && ['detected', 'problem'].includes(result.state) && !browserSupported(choice) && !desktopReady()) result.action = { id: 'use-desktop', label: 'Use desktop app', style: 'bordered' };
    if (result && storeBuild && !job && youtubeItem(item)) {
      // Chrome Web Store policy: the store build neither downloads YouTube nor points to another way to.
      Object.assign(result, { state: 'external', tone: 'muted', statusLine: "SnagThis doesn't save videos from this site", action: null });
    }
    // Its URL only works inside the page's own Service Worker; a download would fail as "expired".
    if (result && !job && (item.serviceWorkerServed || choice.serviceWorkerServed)) Object.assign(result, { state: 'external', tone: 'muted', statusLine: 'This video only plays inside its own player', action: null });
    // DRM-protected: never a download, desktop handoff or preview; only an explanation.
    if (result && (item.drm || choice.drm)) Object.assign(result, { state: 'protected', tone: 'muted', statusLine: SnagThisStrings.interpolate('drmProtected', { site: protectedSite(item) }), action: { id: 'drm-why', label: strings.drmWhy, style: '' } });
    return { row: result, choice, jobId };
  }
  function protectedSite(item) { return SnagThisDetection.protectedSiteName(item) || strings.drmThisSite; }
  function showProtectedHelp(item) {
    const content = openSheet(strings.drmHelpTitle); const pad = el('div', 'sheet-pad');
    pad.append(el('p', '', SnagThisStrings.interpolate('drmHelpBody', { site: protectedSite(item) })), el('p', '', strings.drmHelpOthers));
    const link = el('button', 'text-link', 'Troubleshooting'); link.type = 'button'; link.addEventListener('click', () => external(HELP));
    pad.append(link); content.append(pad);
  }
  // YouTube pages, and its video servers when a YouTube player is embedded on another site.
  function youtubeItem(item) { return item.mediaKind === 'youtube-page' || Boolean(SnagThisDetection.youtubeId(item.url)) || SnagThisDetection.isYoutubeMediaHost(item.url); }
  function mediaSizeLabel(choice) {
    return rows.formatSize(choice.sizeBytes, { estimated: choice.sizeEstimated }) || 'N/A';
  }
  function progressAttributes(status, row) {
    if (['downloading', 'finishing', 'paused', 'problem'].includes(row.state)) {
      status.setAttribute('role', 'progressbar'); status.setAttribute('aria-valuemin', '0'); status.setAttribute('aria-valuemax', '100'); status.setAttribute('aria-valuenow', String(row.percent)); status.setAttribute('aria-valuetext', row.statusLine);
    } else { for (const attribute of ['role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) status.removeAttribute(attribute); }
  }
  function actionIcon(id) { return id === 'download' || id === 'continue' ? 'download' : { pause: 'pause', resume: 'resume', play: 'play' }[id] || ''; }
  function createRow(item) {
    const node = el('div', 'video-row'); node.dataset.rowKey = item.id; node.tabIndex = 0; node.setAttribute('role', 'group');
    const pieces = el('div', 'progress-pieces'); pieces.setAttribute('aria-hidden', 'true');
    // These cells represent aggregate progress, not individual source segments.
    for (let index = 0; index < 40; index++) pieces.append(el('span', 'progress-piece'));
    const thumb = el('div', 'thumb'); const body = el('div', 'row-body'); const titleLine = el('div', 'row-title-line');
    // Problem rows keep their duration beside the title so the explanation can use two lines.
    titleLine.append(el('div', 'row-title'), el('span', 'row-title-duration'));
    const metadata = el('div', 'row-meta'); const durationMeta = el('span', 'meta-item row-duration-meta'); durationMeta.append(el('span', 'row-duration')); metadata.append(el('div', 'row-status'), durationMeta); body.append(titleLine, metadata);
    // Row extras stay hidden at rest and appear on hover or keyboard focus.
    const more = el('button', 'row-more'); more.type = 'button'; more.title = 'More';
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.append(icon('more'));
    more.addEventListener('click', () => { if (menuTrigger === more) closeMenu(); else showContext(node.current.item, null, more); });
    node.append(thumb, body, more, pieces); node.addEventListener('contextmenu', event => { event.preventDefault(); showContext(node.current.item, event.button === 2 ? event : null, more); });
    // Shift+F10 and the context-menu key open the same menu from the focused row.
    node.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); showContext(node.current.item, null, more); } });
    node.addEventListener('pointerenter', () => { node.previewHovered = true; node.previewRequestedFor = ''; node.previewFailedUrl = ''; node.sourcePreviewFailed = false; syncThumbPreview(node); });
    node.addEventListener('pointerleave', () => { node.previewHovered = false; syncThumbPreview(node); });
    node.addEventListener('focusin', () => { if (!node.previewFocused) { node.previewRequestedFor = ''; node.previewFailedUrl = ''; node.sourcePreviewFailed = false; } node.previewFocused = true; syncThumbPreview(node); });
    node.addEventListener('focusout', event => { node.previewFocused = node.contains(event.relatedTarget); syncThumbPreview(node); });
    return node;
  }
  // Rows that arrive after the first paint slide in; removed rows collapse away. Re-renders never replay either.
  function enterRow(node) {
    if (reducedMotion.matches) return;
    node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function exitRow(node) {
    stopThumbPreview(node); node.trace?.destroy(); node.trace = null;
    if (reducedMotion.matches || !node.isConnected) { node.remove(); return; }
    node.dataset.exiting = 'true'; node.inert = true;
    const height = `${node.offsetHeight}px`;
    const animation = node.animate([{ height, minHeight: height, opacity: 1 }, { height: '0px', minHeight: '0px', opacity: 0, borderTopWidth: '0px' }], { duration: 180, easing: 'ease-in' });
    animation.onfinish = () => node.remove(); animation.oncancel = () => node.remove();
  }
  function renderRows() {
    const list = $('video-list');
    const view = mediaItems.length ? 'rows' : discoveryPending ? 'loading' : discoveryError ? 'error' : 'empty';
    const changed = list.dataset.view !== view;
    list.dataset.view = view; list.setAttribute('aria-busy', String(view === 'loading'));
    $('page-count').textContent = mediaItems.length ? `${mediaItems.length} video${mediaItems.length === 1 ? '' : 's'} on this page` : view === 'loading' ? 'Checking this page…' : view === 'error' ? 'Check this page' : 'No videos yet';
    titles.setPageItems(mediaItems);
    if (!mediaItems.length) {
      for (const node of rowElements.values()) { stopThumbPreview(node); node.trace?.destroy(); node.trace = null; }
      rowElements.clear(); stopPosterPreparation();
      if (changed) list.replaceChildren(view === 'empty' ? emptyState() : discoveryState(view));
      renderConnection(); return;
    }
    list.querySelector('.empty-state,.discovery-state')?.remove();
    const firstPaint = !rowsPainted; rowsPainted = true;
    const valid = new Set();
    for (const item of mediaItems) {
      const { row, choice, jobId } = rowModel(item); if (!row) continue;
      valid.add(item.id);
      let node = rowElements.get(item.id);
      const created = !node;
      if (created) { node = createRow(item); rowElements.set(item.id, node); }
      const previousState = node.dataset.state;
      node.current = { item, row, choice, jobId };
      node.querySelector('.row-more').setAttribute('aria-label', `More actions: ${row.title}`);
      node.dataset.state = row.state;
      const rowProgress = Math.max(0, Math.min(100, Number(row.progress) || 0));
      node.dataset.progress = String(rowProgress);
      const progressActive = ['downloading', 'finishing'].includes(row.state);
      node.dataset.progressVisible = String(progressActive || (['paused', 'problem'].includes(row.state) && rowProgress > 0));
      node.dataset.progressActive = String(progressActive);
      const pieces = node.querySelector('.progress-pieces');
      const completedCells = Math.floor(rowProgress / 100 * pieces.children.length);
      // Spark only cells finished while the popup watched; reopening never replays the whole lane.
      const previousCells = pieces.dataset.cells === undefined ? null : Number(pieces.dataset.cells);
      const sparkFrom = progressActive && previousCells !== null && completedCells - previousCells <= 3 ? previousCells : completedCells;
      pieces.dataset.cells = String(completedCells);
      for (const [index, cell] of Array.from(pieces.children).entries()) {
        cell.classList.toggle('done', index < completedCells);
        cell.classList.toggle('current', index === completedCells && rowProgress < 100);
        cell.style.setProperty('--piece-fill', index === completedCells ? String(rowProgress / 100 * pieces.children.length - completedCells) : '1');
        if (index >= sparkFrom && index < completedCells) { cell.classList.add('spark'); cell.addEventListener('animationend', () => cell.classList.remove('spark'), { once: true }); }
      }
      updateThumb(node.querySelector('.thumb'), row);
      const title = node.querySelector('.row-title'); title.textContent = row.title; title.title = row.title;
      const problem = ['problem', 'missing'].includes(row.state);
      for (const duration of node.querySelectorAll('.row-duration, .row-title-duration')) duration.textContent = row.durationLabel;
      node.querySelector('.row-title-duration').hidden = !row.durationLabel || !problem;
      node.querySelector('.row-duration-meta').hidden = !row.durationLabel || problem;
      const status = node.querySelector('.row-status'); status.className = `row-status tone-${row.tone}`; status.title = row.statusLine;
      if (row.state === 'detected') {
        status.removeAttribute('role'); status.removeAttribute('aria-valuenow'); status.removeAttribute('aria-valuetext');
        const variants = item.variants || [];
        const sizeLabel = mediaSizeLabel(choice);
        const audioLabel = choice.audioTrack && !choice.selection.audioOnly ? choice.audioTrack.shortLabel : '';
        const signature = `${choice.qualityLabel}|${audioLabel}|${sizeLabel}|${variants.length}`;
        status.title = [choice.qualityLabel, sizeLabel].filter(Boolean).join(' · ');
        status.classList.add('status-meta');
        if (status.dataset.signature !== signature) {
          status.dataset.signature = signature;
          // The quality button survives a size change so it keeps keyboard focus.
          let quality = variants.length > 1 ? status.querySelector('.quality-button') : null;
          if (quality) { const part = quality.parentElement; while (part.nextSibling) part.nextSibling.remove(); }
          else status.replaceChildren();
          if (variants.length > 1) {
            if (!quality) {
              quality = el('button', 'quality-button'); quality.type = 'button'; quality.setAttribute('aria-haspopup', 'menu'); quality.setAttribute('aria-expanded', 'false'); quality.setAttribute('aria-label', 'Choose quality');
              quality.addEventListener('click', () => showQuality(node.current.item, quality)); appendMetadata(status, quality);
            }
            quality.replaceChildren(qualityMark(choice.qualityLabel || 'Quality'), ...(audioLabel ? [el('span', 'aud', `· ${audioLabel}`)] : []), icon('down'));
            quality.setAttribute('aria-label', audioLabel ? `Choose quality and audio, ${audioLabel}` : 'Choose quality');
          } else if (choice.qualityLabel) appendMetadata(status, qualityMark(choice.qualityLabel));
          appendMetadata(status, el('span', '', sizeLabel));
        }
      } else if (row.state === 'saved') {
        progressAttributes(status, row); status.className = 'row-status status-meta tone-muted';
        const signature = `saved|${row.qualityLabel}|${row.sizeLabel}|${row.statusLine}`;
        if (status.dataset.signature !== signature) {
          status.dataset.signature = signature; status.replaceChildren();
          if (row.qualityLabel) appendMetadata(status, qualityMark(row.qualityLabel));
          if (row.sizeLabel) appendMetadata(status, el('span', '', row.sizeLabel));
          const saved = el('span', 'saved-copy'); saved.append(icon('check'), document.createTextNode(row.statusLine)); appendMetadata(status, saved);
        }
        // Completion moment: the check draws in once when a watched download finishes.
        if (previousState && previousState !== 'saved') status.querySelector('.saved-copy')?.classList.add('just-saved');
        if (['downloading', 'finishing'].includes(previousState)) node.snagPending = true;
      } else {
        delete status.dataset.signature; status.classList.add('meta-item'); status.textContent = row.statusLine;
        progressAttributes(status, row);
      }
      // Screen readers hear the same status line sighted users see.
      node.setAttribute('aria-label', [row.title, status.title].filter(Boolean).join('. '));
      const busy = pending.has(item.id) && !pending.get(item.id).optimistic;
      const actionKey = busy ? 'sending' : row.action ? `${row.action.id}:${row.action.style}` : '';
      if (node.dataset.actionKey !== actionKey) {
        node.querySelector(':scope > .action')?.remove(); node.dataset.actionKey = actionKey;
        if (busy) { const button = action('Starting download', () => {}, 'primary'); button.replaceChildren(el('span', 'spinner')); button.disabled = true; node.append(button); }
        else if (row.action) {
          const primary = ['download', 'continue'].includes(row.action.id);
          const style = primary ? 'primary icon-only' : row.action.style === 'icon' ? 'icon-only' : row.action.style;
          // Resume carries its own icon and name so it never reads as Play.
          const label = row.action.id === 'resume' ? strings.resumeDownload : row.action.label;
          node.append(action(label, () => handleAction(node.current), style, actionIcon(row.action.id)));
        }
      }
      syncTrace(node, row, jobId, previousState);
      // Snag moment: only for a download this popup watched finish, never on opening.
      if (node.snagPending) { node.snagPending = false; pixel.snag(node.querySelector(':scope > .action') || status, row.source.backend === 'browser' ? null : $('open-app')); }
      if (created && !firstPaint) enterRow(node);
      syncThumbPreview(node);
    }
    for (const [key, node] of rowElements) if (!valid.has(key)) { rowElements.delete(key); exitRow(node); }
    // Order live rows around any that are still collapsing away.
    let anchor = list.firstElementChild;
    for (const key of valid) {
      const node = rowElements.get(key);
      while (anchor && anchor.dataset.exiting) anchor = anchor.nextElementSibling;
      if (anchor === node) anchor = anchor.nextElementSibling; else list.insertBefore(node, anchor);
    }
    // Only the first Download button of this popup opening breathes, twice.
    if (!breathed) { const first = list.querySelector('.video-row > .action.primary.icon-only:not(:disabled)'); if (first) { breathed = true; first.classList.add('breathe'); } }
    renderConnection();
    preparePosters();
  }
  // Speed trace (desktop jobs only): downloading, paused and finishing rows keep one; a watched save turns it mint and fades it.
  function syncTrace(node, row, jobId, previousState) {
    const desktopJob = Boolean(jobId) && row.source.backend !== 'browser';
    if (row.state === 'saved' && ['downloading', 'finishing'].includes(previousState)) node.traceSavedUntil = performance.now() + 1100;
    const saving = row.state === 'saved' && performance.now() < (node.traceSavedUntil || 0);
    const state = !desktopJob ? null : ['downloading', 'paused', 'finishing'].includes(row.state) ? row.state : saving ? 'saved' : null;
    const body = node.querySelector('.row-body');
    if (!state) { node.trace?.destroy(); node.trace = null; body.classList.remove('has-trace'); return; }
    if (!node.trace) { node.trace = SnagThisSpeedTrace.create(); body.append(node.trace.element); }
    body.classList.add('has-trace');
    node.trace.set(String(jobId), state);
    if (state === 'saved') { clearTimeout(node.traceTimer); node.traceTimer = setTimeout(() => { if (node.current) syncTrace(node, node.current.row, node.current.jobId, 'saved'); }, node.traceSavedUntil - performance.now() + 20); }
  }
  function speedJobs(jobs) { return jobs.filter(job => job.backend !== 'browser' && job.queueStatus === 'downloading' && !/finaliz|convert|remux/i.test(job.status || '')); }
  function emptyState() {
    const node = el('section', 'empty-state'); const tile = pixel.mascot('waiting');
    // A tab opened before install or update can refuse injection (for example
    // while it is still loading). Only a reload attaches detection then.
    if (pageNeedsRefresh) node.append(tile, el('h2', '', 'Refresh this page to find videos'), el('p', '', 'SnagThis was installed or updated after this page opened. Refresh it, then open this again.'), action('Refresh page', refreshPage, 'bordered'));
    else node.append(tile, el('h2', '', 'Press play on the video'), el('p', '', 'SnagThis spots a video once it starts playing. Start it, then open this again.'), action('Check again', checkAgain, 'bordered'));
    return node;
  }
  function refreshPage() { if (isDemo || !activeTab?.id) return; chrome.tabs.reload(activeTab.id).catch(() => {}); window.close(); }
  function discoveryState(view) {
    const node = el('section', 'discovery-state'); node.setAttribute('role', 'status');
    if (view === 'error') {
      node.append(pixel.mascot('dozing'), el('p', '', "Couldn't check this page."), action('Try again', checkAgain, 'bordered'));
    } else {
      // Skeleton rows hold the shape of the list while the page is checked.
      node.classList.add('is-loading');
      for (let index = 0; index < 3; index++) { const row = el('div', 'skeleton-row'); row.setAttribute('aria-hidden', 'true'); row.append(el('span', 'skeleton-thumb'), el('span', 'skeleton-bar'), el('span', 'skeleton-bar short')); node.append(row); }
      node.append(el('p', 'sr-only', 'Looking for videos…'));
      loadingMascot(node);
    }
    return node;
  }
  // While the page is checked, the first skeleton thumbnail holds the pixel button, pressing now and then.
  function loadingMascot(node) {
    const thumb = node?.querySelector('.skeleton-thumb');
    if (!thumb || thumb.querySelector('.pixel-button')) return;
    const holder = el('span', 'skeleton-mascot'); holder.setAttribute('aria-hidden', 'true'); holder.append(pixel.button(32)); thumb.append(holder);
  }
  async function checkAgain() {
    if (isDemo) return;
    discoveryPending = true; discoveryError = false; renderRows();
    if (activeTab?.id) {
      const scanFrame = frameId => chrome.tabs.sendMessage(activeTab.id, { cmd: 'SCAN_PAGE' }, { frameId }).then(() => true, () => false);
      // An untargeted message resolves with whichever frame answers first, so an
      // ad iframe could hide a top frame without SnagThis. Scan every frame, and
      // judge the page by its top frame.
      const scan = async () => {
        const frames = await chrome.webNavigation?.getAllFrames({ tabId: activeTab.id }).catch(() => null) || [];
        const [top] = await Promise.all([scanFrame(0), ...frames.filter(frame => frame.frameId > 0).map(frame => scanFrame(frame.frameId))]);
        return top;
      };
      // No receiver means this tab predates the installed content script.
      let reached = await scan();
      if (!reached && /^https?:/.test(activeTab.url || '') && (await message({ cmd: 'PREPARE_PAGE', tabId: activeTab.id }).catch(() => null))?.ok) reached = await scan();
      pageNeedsRefresh = !reached && /^https?:/.test(activeTab.url || '');
    }
    // A scan acknowledges its writes; read after any earlier snapshot finishes.
    if (refreshBusy) await refreshBusy;
    discoveryPending = false; await refresh();
  }
  async function handleAction(current) {
    const { item, row, jobId } = current;
    if (row.action.id === 'drm-why') { showProtectedHelp(item); return; }
    if (isDemo) { if (row.action.id === 'play') { showDemoVideo(item); return; } SnagThisDemo.act(item.id, row.action.id); queue = SnagThisDemo.state.queue; renderRows(); return; }
    if (row.action.id === 'use-desktop') { useDesktop(item); return; }
    if (row.source.backend === 'browser') {
      if (row.action.id === 'chrome-details') { showBrowserDetails(current); return; }
      if (row.action.id === 'retry') { await startDownload(item); return; }
      await browserAction(jobId, row.action.id); return;
    }
    if (row.action.id === 'download' || (row.action.id === 'retry' && !jobId)) { await startDownload(item); return; }
    if (row.action.id === 'continue') { await continueDownload(item, jobId); return; }
    if (row.action.id === 'open-page') { external(item.sourcePageUrl || activeTab?.url); return; }
    if (['choose-folder', 'locate', 'details'].includes(row.action.id)) {
      if (row.action.id === 'details') showProblem(row); else openDesktop(row.action.id === 'choose-folder' ? 'settings' : undefined); return;
    }
    if (row.action.id === 'retry') {
      try { const result = await message({ cmd: 'RETRY_MEDIA', tabId: activeTab.id, mediaId: item.id, jobId, apiBase }); if (!result.ok) throw new Error(result.error || 'Could not retry the download.'); await refresh(); } catch (error) { notice(error.message); } return;
    }
    const endpoint = { pause: 'pause', resume: 'resume', play: 'open' }[row.action.id];
    if (!endpoint || !jobId) return;
    try { await request(`/v1/jobs/${encodeURIComponent(jobId)}/${endpoint}`, { body: {} }); await refresh(); } catch (error) { notice(error.message); }
  }
  async function startDownload(item, backend) {
    if (pending.has(item.id)) return;
    failures.delete(item.id); pending.set(item.id, { optimistic: false }); renderRows();
    const timer = setTimeout(() => { if (pending.has(item.id)) { pending.set(item.id, { optimistic: true }); renderRows(); } }, 300);
    try {
      const sourcePoster = rowElements.get(item.id)?.sourcePoster;
      const choice = model.selectMedia(sourcePoster ? { ...item, thumbnailUrl: sourcePoster } : item, preferences, selected.get(item.id));
      const payload = model.buildDownloadPayload(choice, customTitles[item.id] || '');
      if (payload.selection?.audioTrack && !desktopAudioTracks) throw new Error('Update SnagThis to download a chosen audio track.');
      // Preserve processing intent before payload normalization can flatten a
      // directly observed alternative back into a standalone file.
      const chosenBackend = backend || (browserSupported(choice) ? 'browser' : 'desktop');
      const result = await message({ cmd: 'DOWNLOAD_MEDIA', tabId: activeTab.id, mediaId: item.id, payload, apiBase, backend: chosenBackend });
      if (!result.ok || !result.jobId) throw new Error(result.error || 'Could not start the download.');
      mappings[item.id] = result.jobId;
      queue.push(result.job || { id: result.jobId, backend: result.backend, title: payload.title, queueStatus: result.status === 'queued' ? 'queued' : 'downloading', progress: 0 });
      await refresh();
    } catch (error) { failures.set(item.id, error.message); } finally { clearTimeout(timer); pending.delete(item.id); renderRows(); }
  }
  // An expired link continues from its saved pieces with the address the page is playing now.
  async function continueDownload(item, jobId) {
    if (isDemo || !jobId) return;
    try { const choice = model.selectMedia(item, preferences, selected.get(item.id)); const result = await message({ cmd: 'REFRESH_MEDIA_SOURCE', tabId: activeTab.id, mediaId: item.id, jobId, payload: model.buildDownloadPayload(choice, customTitles[item.id] || ''), apiBase }); if (!result.ok) throw new Error(result.error || 'This video could not be matched to the previous download.'); await refresh(); } catch (error) { notice(error.message); }
  }
  function useDesktop(item) {
    if (desktopReady()) { startDownload(item, 'desktop'); return; }
    if (reachable && !compatible) { if (compatibilityIssue === 'extension') showExtensionUpdate(); else external(RELEASES); return; }
    if (reachable && !appToken) { showPairing(); return; }
    const content = openSheet('Use desktop app'); const pad = el('div', 'sheet-pad');
    pad.append(el('p', '', 'Open SnagThis and connect Chrome to try this download. The desktop app handles supported streams, audio and subtitle choices, and your SnagThis library.'), action(getAppFallback ? 'Get the app' : 'Open SnagThis', () => openDesktop(), 'primary'));
    content.append(pad);
  }
  async function browserAction(jobId, command) {
    try { const result = await message({ cmd: 'BROWSER_DOWNLOAD_ACTION', jobId, action: command }); if (!result?.ok) throw new Error(result?.error || 'Chrome could not finish that action.'); await refresh(); }
    catch (error) { notice(error.message); }
  }
  function showBrowserDetails(current) {
    const content = openSheet('Chrome download'); const pad = el('div', 'sheet-pad'); const job = current.row.source;
    pad.append(el('p', '', 'Chrome manages this file in your browser’s download folder. It is separate from the SnagThis desktop library.'));
    if (job.fileName) pad.append(el('p', '', job.fileName));
    if (job.error) pad.append(el('p', '', typeof job.error === 'string' ? job.error : job.error.message || job.error.code || 'Check this download in Chrome.'));
    pad.append(action('Open Chrome downloads', () => external('chrome://downloads/'), 'primary')); content.append(pad);
  }
  // A short popup grows while a menu or sheet is open so neither is clipped.
  // Settings keeps the height of its tallest tab so switching tabs never resizes Chrome's popup.
  function syncPopupHeight(menuNeed = 0) { $('popup').style.minHeight = $('sheet').open ? `${$('sheet').dataset.view === 'settings' && settingsHeight ? settingsHeight : 430}px` : menuNeed ? `${Math.min(560, Math.max(300, menuNeed))}px` : ''; }
  function closeMenu(restoreFocus = true) {
    stopSample('close');
    const menu = $('menu');
    const finish = () => { menuExit = null; menu.hidden = true; menu.replaceChildren(); menu.style.pointerEvents = ''; syncPopupHeight(); };
    if (menuTrigger?.isConnected) { menuTrigger.setAttribute('aria-expanded', 'false'); if (restoreFocus) menuTrigger.focus({ preventScroll: true }); }
    menuTrigger = null;
    if (menu.hidden || menuExit) return;
    menuExit = menu.animate(reducedMotion.matches ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.97)' }], { duration: reducedMotion.matches ? 80 : 100, easing: 'ease-out' });
    menuExit.onfinish = finish; menu.style.pointerEvents = 'none';
  }
  // Menu keyboard support is wired once, independent of startup succeeding.
  $('menu').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!stopSample('escape')) closeMenu(); return; }
    if (event.key === 'Tab') { event.preventDefault(); closeMenu(); return; }
    const track = event.target.closest?.('.atrack');
    if (track && event.key === ' ') { event.preventDefault(); if (sample?.row === track) stopSample('user'); else startSample(track); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const buttons = Array.from($('menu').querySelectorAll('button')); const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus();
  });
  function openMenu(trigger, point) {
    const menu = $('menu');
    menu.getAnimations().forEach(animation => animation.cancel()); menuExit = null; menu.style.pointerEvents = '';
    menu.replaceChildren(); menu.hidden = false; menu.style.maxHeight = ''; menu.classList.remove('wide');
    menuTrigger?.setAttribute('aria-expanded', 'false'); menuTrigger = trigger?.focus ? trigger : null; menuTrigger?.setAttribute('aria-expanded', 'true');
    const bounds = trigger?.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min($('popup').getBoundingClientRect().right - 256, point?.clientX ?? bounds?.left ?? 130))}px`;
    // The menu opens below its trigger (or pointer), flipping above only when the popup cannot grow enough.
    menu.anchor = point ? { x: point.clientX, top: point.clientY, bottom: point.clientY } : bounds ? { x: bounds.left + bounds.width / 2, top: bounds.top - 4, bottom: bounds.bottom + 4 } : { x: 130, top: 60, bottom: 60 };
    return menu;
  }
  function fitMenu(menu) {
    const { anchor } = menu; const height = menu.offsetHeight;
    const popupTop = $('popup').getBoundingClientRect().top;
    syncPopupHeight(anchor.bottom + height + 6 - popupTop);
    const bounds = $('popup').getBoundingClientRect();
    const minTop = Math.max(0, bounds.top) + 6; const bottom = bounds.bottom - 6;
    const below = anchor.bottom + height <= bottom; const above = anchor.top - height >= minTop;
    const top = below || !above ? Math.max(minTop, Math.min(anchor.bottom, bottom - height)) : anchor.top - height;
    menu.style.top = `${top}px`;
    // Cap the menu at the space below where it actually opens, so a long menu (quality plus
    // many audio tracks) scrolls inside the popup instead of running past its bottom edge.
    menu.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    menu.style.transformOrigin = `${Math.max(0, anchor.x - Number.parseFloat(menu.style.left))}px ${!below && above ? '100%' : '0'}`;
    menu.animate(reducedMotion.matches ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: reducedMotion.matches ? 80 : 140, easing: 'ease-out' });
    menu.querySelector('button')?.focus({ preventScroll: true });
  }
  function menuItem(menu, label, handler, options = {}) {
    const button = el('button', 'menu-item'); button.type = 'button'; button.setAttribute('role', options.radio ? 'menuitemradio' : 'menuitem');
    if (options.radio) { button.setAttribute('aria-checked', String(Boolean(options.checked))); const check = el('span', 'menu-check'); if (options.checked) check.append(icon('check')); button.append(check); }
    button.append(document.createTextNode(label)); if (options.value) button.append(el('span', 'menu-value', options.value));
    button.addEventListener('click', event => { closeMenu(event.detail === 0); handler(); }); menu.append(button); return button;
  }
  const speaker = '<svg class="px" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M2 6h3v4h-3zM5 5h1v6h-1zM6 4h1v8h-1zM7 3h1v10h-1z"/><path class="waves" fill="currentColor" d="M10 6h1v4h-1zM12 4h1v8h-1zM14 3h1v10h-1z"/></svg>';
  function audioTrackItem(menu, item, track, checked, choose) {
    const row = el('div', 'atrack'); row.dataset.track = track.key; row.sampleItem = item; row.sampleTrack = track;
    const button = el('button', 'menu-item'); button.type = 'button'; button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(checked)); button.setAttribute('aria-label', track.ariaLabel); button.setAttribute('aria-describedby', 'sample-hint');
    const check = el('span', 'menu-check'); if (checked) check.append(icon('check'));
    const label = el('span', 'alabel'); const name = el('b', '', track.title);
    for (const tag of track.tags) { const chip = el('span', tag === 'AD' ? 'chip ad' : 'chip', tag); if (tag === 'AD') chip.title = 'Audio description'; name.append(chip); }
    label.append(name, el('small', '', track.detail)); label.lastChild.hidden = !track.detail;
    button.append(check, label);
    const hear = el('span', 'hear'); hear.setAttribute('aria-hidden', 'true'); hear.innerHTML = speaker;
    const progress = el('span', 'aprog'); progress.append(el('i'));
    row.append(button, hear, progress, el('span', 'hear-dwell'));
    button.addEventListener('click', event => { stopSample('choose'); closeMenu(event.detail === 0); choose(); });
    // Resting the pointer, or keyboard focus, on a track for half a second plays it.
    row.addEventListener('pointerenter', () => armSample(row));
    row.addEventListener('pointerleave', () => disarmSample(row));
    button.addEventListener('focus', () => armSample(row));
    button.addEventListener('blur', () => disarmSample(row));
    menu.append(row);
  }
  function announceSample(text) { $('sample-status').textContent = text; }
  function armSample(row) {
    if (dwellRow === row || sample?.row === row) return;
    clearTimeout(sampleDwell); dwellRow?.classList.remove('dwelling');
    dwellRow = row; row.classList.add('dwelling');
    sampleDwell = setTimeout(() => { row.classList.remove('dwelling'); if (dwellRow === row) dwellRow = null; if (row.isConnected && sample?.row !== row) startSample(row); }, 500);
  }
  function disarmSample(row) {
    const focused = row.contains(document.activeElement); const hovered = row.matches(':hover');
    if (focused || hovered) return;
    if (dwellRow === row) { clearTimeout(sampleDwell); row.classList.remove('dwelling'); dwellRow = null; }
    if (sample?.row === row) stopSample('leave');
  }
  function paintSample(row, state, progress = 0) {
    row.classList.toggle('is-loading', state === 'loading'); row.classList.toggle('is-playing', state === 'playing');
    row.style.setProperty('--p', String(reducedMotion.matches ? Math.floor(progress * 10) / 10 : progress));
  }
  // One sample at a time. Returns whether a sample was playing or loading.
  function stopSample(reason) {
    clearTimeout(sampleDwell); dwellRow?.classList.remove('dwelling'); dwellRow = null;
    if (!sample) return false;
    const current = sample; sample = null;
    current.controller?.stop();
    paintSample(current.row, 'idle');
    if (['escape', 'user'].includes(reason)) announceSample('Sample stopped.');
    return true;
  }
  function startSample(row) {
    const item = row.sampleItem; const track = row.sampleTrack;
    if (!item || !track) return;
    stopSample('switch');
    const current = { row }; sample = current;
    row.classList.remove('is-failed'); paintSample(row, 'loading');
    const detail = row.querySelector('.alabel small'); detail.textContent = track.detail; detail.hidden = !track.detail;
    announceSample(`Loading a sample of ${track.title}…`);
    const failed = () => {
      if (sample !== current) return;
      sample = null; paintSample(row, 'idle'); row.classList.add('is-failed');
      detail.textContent = 'Sample unavailable · you can still choose it'; detail.hidden = false;
      announceSample(`Sample unavailable for ${track.title}. You can still choose it.`);
    };
    const callbacks = {
      onPlaying: () => { if (sample === current) { paintSample(row, 'playing'); announceSample(`Playing a sample of ${track.title} from 25% in. Press Escape to stop.`); } },
      onProgress: progress => { if (sample === current) paintSample(row, 'playing', progress); },
      onEnded: () => { if (sample === current) { sample = null; paintSample(row, 'idle'); announceSample('Sample finished.'); } },
      onError: failed,
    };
    current.controller = isDemo ? demoSample(item, track, callbacks)
      : SnagThisSourcePreview.createAudioSample?.({ item, rendition: track.renditions.find(rendition => rendition.url), tabId: activeTab?.id, mediaId: item.id, ...callbacks }) || null;
    if (!current.controller) failed();
  }
  // Development gallery only: each fixture track plays a different sample clip's soundtrack.
  function demoSample(item, track, { onPlaying, onProgress, onEnded, onError }) {
    const audio = new Audio(`popup/media/${['neon-rain', 'sky-hop', 'ember-tide', 'star-courier'][(track.ordinal - 1) % 4]}.mp4`);
    let start = 0; let stopped = false;
    const stop = () => { stopped = true; audio.pause(); audio.removeAttribute('src'); audio.load(); };
    audio.volume = .5;
    audio.addEventListener('loadedmetadata', () => { start = audio.duration * .25; audio.currentTime = start; audio.play().then(() => { if (!stopped) onPlaying(); }).catch(() => { if (!stopped) { stop(); onError(); } }); });
    audio.addEventListener('timeupdate', () => { if (stopped) return; const progress = (audio.currentTime - start) / 10; onProgress(progress); if (progress >= 1) { stop(); onEnded(); } });
    audio.addEventListener('error', () => { if (!stopped) { stop(); onError(); } });
    return { stop };
  }
  function showQuality(item, trigger) {
    const menu = openMenu(trigger); const choice = model.selectMedia(item, preferences, selected.get(item.id));
    const choose = update => { selected.set(item.id, { ...(selected.get(item.id) || {}), ...update }); renderRows(); };
    for (const [index, variant] of (item.variants || []).entries()) {
      const variantChoice = model.selectMedia(item, preferences, { variantUrl: variant.url });
      menuItem(menu, variant.height ? `${variant.height}p` : `Quality ${index + 1}`, () => choose({ variantUrl: variant.url, audioOnly: false }), { radio: true, checked: !choice.selection.audioOnly && choice.selection.variantUrl === variant.url, value: mediaSizeLabel(variantChoice) });
    }
    if ((item.audio || []).some(audio => audio.url)) menuItem(menu, 'Audio only', () => choose({ audioOnly: true }), { radio: true, checked: choice.selection.audioOnly });
    const tracks = choice.audioTracks || [];
    if (tracks.length > 1) {
      // Labels 2 · Plain language, with Sample 3 · Hover to hear (docs/design/prototypes/audio-tracks).
      menu.classList.add('wide');
      menu.style.left = `${Math.max(6, Math.min($('popup').getBoundingClientRect().right - 292, Number.parseFloat(menu.style.left)))}px`;
      menu.prepend(el('div', 'menu-title', 'Quality'));
      const title = el('div', 'menu-title', 'Audio '); title.append(el('small', '', `${tracks.length} tracks`));
      menu.append(el('hr'), title);
      for (const track of tracks) audioTrackItem(menu, item, track, track === choice.audioTrack, () => choose({ audioTrack: track.key }));
      if (tracks.some(track => track.unknown)) menu.append(el('p', 'menu-note', 'This site doesn’t name its tracks. Rest on one to check.'));
    }
    if ((item.subtitles || []).length) {
      menu.append(el('hr'), el('div', 'menu-title', 'Subtitles'));
      for (const subtitle of item.subtitles) { const language = subtitle.language || subtitle.name; menuItem(menu, subtitle.name || language, () => choose({ subtitleLang: language }), { radio: true, checked: choice.selection.subtitleLang === language }); }
      menuItem(menu, 'None', () => choose({ subtitleLang: 'none' }), { radio: true, checked: choice.selection.subtitleLang === 'none' });
    }
    fitMenu(menu);
  }
  function showContext(item, event, trigger) {
    const menu = openMenu(trigger, event); const job = model.jobFor(item, mappings, queue); const jobId = job?.id || job?.jobId || null;
    const storeYoutube = storeBuild && youtubeItem(item);
    if (!storeYoutube) menuItem(menu, 'Rename', () => showRename(item));
    menuItem(menu, 'Hide', async () => { const ids = [...new Set([item.id, ...(item.detectedStreams || []).map(value => value.id)])]; if (isDemo) mediaItems = mediaItems.filter(value => value.id !== item.id); else await message({ cmd: 'HIDE_MEDIA', tabId: activeTab.id, mediaIds: ids }); renderRows(); await refresh(); });
    if (item.drm || storeYoutube) { menu.append(el('hr')); menuItem(menu, 'Show all detected streams', async () => { await message({ cmd: 'SHOW_ALL_MEDIA', tabId: activeTab?.id }); await refresh(); }); fitMenu(menu); return; }
    menuItem(menu, 'Preview', () => preview(item));
    if (!item.serviceWorkerServed && (!jobId || (job?.backend === 'browser' && ['failed', 'completed', 'cancelled'].includes(job.queueStatus))) && browserSupported(model.selectMedia(item, preferences, selected.get(item.id)))) menuItem(menu, 'Download with desktop', () => useDesktop(item));
    if (!jobId && !storeYoutube) {
      const expired = queue.filter(job => job.queueStatus === 'failed' && job.sourcePageUrl === item.sourcePageUrl && rows.classifyProblem(job.error).code === 'expired');
      if (expired.length === 1) menuItem(menu, 'Continue previous download', () => continueDownload(item, expired[0].id));
    }
    if (!jobId && ((item.audio || []).length || (item.subtitles || []).length)) menuItem(menu, 'Quality and subtitles', () => showQuality(item, rowElements.get(item.id)?.querySelector('.row-status')));
    menu.append(el('hr'));
    menuItem(menu, 'Show all detected streams', async () => { await message({ cmd: 'SHOW_ALL_MEDIA', tabId: activeTab?.id }); await refresh(); });
    if (job?.backend === 'browser') {
      menuItem(menu, 'Download details', () => showBrowserDetails(rowElements.get(item.id).current));
      if (['downloading', 'queued', 'paused'].includes(job.queueStatus)) menuItem(menu, 'Cancel download', () => browserAction(jobId, 'cancel'));
    } else if (jobId) menuItem(menu, 'Open in SnagThis', () => openDesktop());
    fitMenu(menu);
  }
  async function preview(item) {
    if (item.mediaKind === 'youtube-page') { external(item.sourcePageUrl || item.url); return; }
    if (isDemo) { showDemoVideo(item); return; }
    const credentialed = item.networkObserved === true;
    const result = await message({ cmd: 'CREATE_STREAM_SESSION', session: { sourceUrl: item.url, sourcePageUrl: item.sourcePageUrl, title: customTitles[item.id] || titles.getDisplayTitle(item), declaredType: item.type, credentialed, requestHeaders: credentialed ? item.requestHeaders : {} } });
    if (result.ok) external(chrome.runtime.getURL(`player.html?session=${encodeURIComponent(result.sessionId)}`)); else notice(result.error || 'Preview is unavailable.');
  }
  function showDemoVideo(item) {
    if (!isDemo) return;
    const filename = { neon: 'neon-rain', hop: 'sky-hop', tide: 'ember-tide' }[item.id];
    if (!filename) return;
    $('sheet-content').querySelector('video')?.pause();
    const content = openSheet(customTitles[item.id] || titles.getDisplayTitle(item));
    const pad = el('div', 'sheet-pad');
    const video = el('video');
    video.controls = true; video.playsInline = true; video.preload = 'metadata';
    video.poster = `popup/media/${filename}.jpg`;
    video.src = `popup/media/${filename}.mp4`;
    video.style.width = '100%'; video.style.display = 'block'; video.style.borderRadius = '6px';
    video.setAttribute('aria-label', `Play ${titles.getDisplayTitle(item)}`);
    pad.append(video); content.append(pad);
    $('sheet').addEventListener('close', () => { video.pause(); video.removeAttribute('src'); video.load(); }, { once: true });
    video.play().catch(() => {});
  }
  function openSheet(title) { closeMenu(); clearInterval(pairingTick); delete $('sheet').dataset.view; $('sheet-link').hidden = true; $('sheet-title').textContent = title; $('sheet-content').replaceChildren(); if (!$('sheet').open) $('sheet').showModal(); syncPopupHeight(); syncThumbPreviews(); return $('sheet-content'); }
  function showProblem(row) {
    const content = openSheet('Video details'); const pad = el('div', 'sheet-pad');
    const youtube = SnagThisDetection.youtubeId(row.source.sourcePageUrl) || SnagThisDetection.youtubeId(row.source.url || row.source.mediaUrl);
    pad.append(el('p', '', row.statusLine));
    if (row.problem?.code === 'authentication' && youtube) {
      pad.append(el('p', '', 'Open SnagThis and choose Use Chrome sign-in for this video. SnagThis will ask before using your Chrome sign-in for this download.'));
      pad.append(action('Open SnagThis', () => openDesktop(), 'primary'));
      pad.append(action('Open page', () => external(row.source.sourcePageUrl || `https://www.youtube.com/watch?v=${youtube}`)));
    } else {
      pad.append(el('p', '', row.problem?.raw || 'Open the source page and try again.'));
      pad.append(action('Open page', () => external(row.source.sourcePageUrl), 'bordered'));
    }
    content.append(pad);
  }
  function showRename(item) {
    const content = openSheet('Rename video'); const form = el('form', 'sheet-pad'); const input = el('input', 'text-input'); input.id = 'video-title'; input.value = customTitles[item.id] || titles.getDisplayTitle(item); input.maxLength = 255; input.required = true;
    const label = el('label', '', 'Video title'); label.htmlFor = input.id;
    const save = action('Save', () => form.requestSubmit(), 'primary'); form.append(label, input, el('div', 'sheet-actions')); form.lastChild.append(save); content.append(form);
    form.addEventListener('submit', async event => { event.preventDefault(); const title = input.value.trim(); if (!title) return; customTitles[item.id] = title; titles.setCustomTitleOverride(item, title); await message({ cmd: 'RENAME_MEDIA', tabId: activeTab?.id, mediaId: item.id, title }); $('sheet').close(); renderRows(); }); input.focus(); input.select();
  }
  function showHelp() {
    const content = openSheet('No video?'); const help = emptyState();
    const link = el('button', 'text-link', 'troubleshooting'); link.type = 'button'; link.addEventListener('click', () => external(HELP));
    const note = el('p', 'help-note', 'Some sites protect their videos. See '); note.append(link, '.');
    help.querySelector('p').after(note); content.append(help);
  }
  /* ── One-click pairing (owner pick: docs/design/prototypes/pairing-polish option 4 · Cartridge).
   * The worker owns the request; this sheet shows its public state and the same four digits
   * SnagThis shows, in one pixel-bevel housing with a 12-pip countdown (one pip per 10 s). ── */
  const PAIRING_KEY = 'snagthis:pairing';
  let pairingTick = null; let disconnectedNotice = false;
  const PAIR_PIPS = 12; const PAIR_PIP_MS = 10000;
  const pairingCopy = {
    expired: ['Timed out', 'Nothing was connected.'],
    denied: ['Not connected', 'SnagThis chose Deny. Chrome can ask again in an hour.'],
    blocked: ['Not connected', 'SnagThis chose Deny less than an hour ago, so Chrome can’t ask again yet.'],
    conflict: ['Two requests at once', 'Something else asked to connect at the same moment, so SnagThis cancelled both.'],
    cancelled: ['Cancelled', 'Nothing was connected.'],
    limited: ['Too many requests', 'Wait a few minutes, then try again.'],
    offline: ['SnagThis isn’t reachable', 'Open the desktop app, then try again.'],
    failed: ['Couldn’t connect', 'SnagThis couldn’t finish connecting.'],
  };
  /** The four digits in one frame built like the logo's bevel button; `code` empty draws a blank housing. */
  function pairingDigits(code, tone = 'hot') {
    const box = el('div', `pair-cart ${tone}`);
    if (code) { box.classList.add('pair-digits'); box.dataset.code = code; box.setAttribute('role', 'img'); box.setAttribute('aria-label', `Match code ${[...code].join(' ')}`); } else box.setAttribute('aria-hidden', 'true');
    (code ? [...code] : ['', '', '', '']).forEach((digit, index) => { const cell = el('span', 'pair-digit'); cell.setAttribute('aria-hidden', 'true'); cell.style.setProperty('--i', index); if (digit) cell.append(pixel.text(digit, 6)); box.append(cell); });
    return box;
  }
  const pipsGone = remaining => Math.min(PAIR_PIPS, Math.max(0, PAIR_PIPS - Math.ceil(Math.max(0, remaining) / PAIR_PIP_MS)));
  function pairingPips(tone = '') {
    const row = el('div', `pair-pips ${tone}`); row.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < PAIR_PIPS; index++) row.append(el('i', 'pair-pip'));
    return row;
  }
  function drawPips(row, remaining) { const gone = pipsGone(remaining); [...row.children].forEach((pip, index) => { pip.className = `pair-pip${index < gone ? ' gone' : index === gone ? ' now' : ''}`; }); }
  // Screen readers hear the countdown only at 1:00 and 0:15; the ticking clock is hidden from them.
  const countdownNote = seconds => (seconds <= 15 ? '15 seconds left to choose Allow in SnagThis.' : seconds <= 60 ? '1 minute left to choose Allow in SnagThis.' : '');
  const clock = ms => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
  function pairingSheetOpen() { return $('sheet').open && $('sheet').dataset.view === 'pairing'; }
  // Unpacked copies get a quiet header chip instead of a leading note; the store build shows none.
  function devBuild() { return isDemo ? new URLSearchParams(location.search).get('build') !== 'store' : !chrome.runtime.getManifest().update_url; }
  function pairingDevChip() {
    const header = $('sheet').querySelector('.sheet-header'); header.querySelector('.pair-devchip')?.remove();
    if (!devBuild()) return;
    const chip = el('span', 'pair-devchip', 'DEV BUILD'); chip.title = 'Unpacked copy. SnagThis will label it Not Web Store.'; header.querySelector('h2').after(chip);
  }
  function pairingSheet() { const content = openSheet('Connect SnagThis'); $('sheet').dataset.view = 'pairing'; clearInterval(pairingTick); pairingDevChip(); return content; }
  function codeLink() { const link = el('button', 'text-link pair-code-link', 'Use a code instead'); link.type = 'button'; link.addEventListener('click', useCode); return link; }
  function useCode() { if (!isDemo) message({ cmd: 'PAIR_CANCEL' }).catch(() => {}); showCodePairing(); }
  function pairingFoot(lead, label) {
    const foot = el('div', 'pair-foot'); const link = el('button', 'pair-foot-link', label); link.type = 'button'; link.addEventListener('click', useCode);
    foot.append(lead, link); return foot;
  }
  async function showPairing() {
    if (isDemo) { renderPairing({ status: 'waiting', matchCode: '4719', expiresAt: Date.now() + 112000 }); return; }
    disconnectedNotice = false;
    renderPairing({ status: 'starting' });
    try { const result = await message({ cmd: 'PAIR_START', tabId: activeTab?.id, apiBase }); renderPairing(result?.state || { status: 'failed' }); }
    catch { renderPairing({ status: 'failed' }); }
  }
  function renderPairing(state) {
    if (state?.status === 'connected') { celebrateConnection(); return; }
    const status = state?.status || 'failed';
    // The same waiting request can arrive twice (reply + storage change); keep the sheet steady.
    if (status === 'waiting' && state.requestId && pairingSheetOpen() && $('sheet').dataset.pairRequest === state.requestId) return;
    const content = pairingSheet(); const pad = el('div', 'sheet-pad pair-pad'); const center = el('div', 'pair-center'); pad.append(center);
    if (status === 'waiting' && state.requestId) $('sheet').dataset.pairRequest = state.requestId; else delete $('sheet').dataset.pairRequest;
    if (status === 'starting' || status === 'waiting') {
      const say = el('p', 'pair-say'); say.append('Then choose ', el('b', '', 'Allow'), ' there.');
      const live = el('div', 'sr-only'); live.setAttribute('role', 'status');
      const line = el('div', 'pair-status'); const lead = el('span', '');
      if (status === 'starting') {
        lead.textContent = 'Asking SnagThis for four digits…'; live.textContent = 'Asking SnagThis to connect.'; line.append(lead);
        center.append(el('p', 'pair-kicker', 'Match in SnagThis'), pairingDigits('', 'off'), say, live, pairingPips('idle'), line);
      } else {
        const opening = () => Date.now() - (state.startedAt || 0) < 1500;
        const sep = el('span', '', '·'); sep.setAttribute('aria-hidden', 'true'); const tick = el('span', 'pair-tick'); tick.setAttribute('aria-hidden', 'true'); line.append(lead, sep, tick);
        const pips = pairingPips();
        live.textContent = opening() ? 'Opening SnagThis. Check that it shows the same digits.' : 'Waiting for you to choose Allow in SnagThis.';
        const actions = el('div', 'sheet-actions pair-actions');
        actions.append(action('Show SnagThis', () => { if (!isDemo) message({ cmd: 'PAIR_OPEN_APP' }).catch(() => {}); }, 'bordered'), action('Cancel', async () => { if (!isDemo) await message({ cmd: 'PAIR_CANCEL' }).catch(() => {}); $('sheet').close(); }));
        center.append(el('p', 'pair-kicker', 'Match in SnagThis'), pairingDigits(state.matchCode), say, live, pips, line, actions);
        let note = '';
        const update = () => {
          const remaining = state.expiresAt - Date.now();
          lead.textContent = opening() ? 'Opening SnagThis…' : 'Waiting for Allow'; tick.textContent = clock(remaining); drawPips(pips, remaining);
          const next = countdownNote(Math.ceil(remaining / 1000)); if (next !== note) { if (note || next) live.textContent = next; note = next; }
        };
        note = countdownNote(Math.ceil((state.expiresAt - Date.now()) / 1000)); update();
        pairingTick = setInterval(update, 1000);
      }
      pad.append(pairingFoot('SnagThis didn’t open? ', 'Use a code'));
    } else {
      const [title, body] = pairingCopy[status] || pairingCopy.failed;
      const refused = ['blocked', 'denied'].includes(status);
      center.append(pairingDigits(state.matchCode || '', 'off'));
      const heading = el('p', 'pair-state-title', title); heading.setAttribute('role', 'alert');
      const actions = el('div', 'sheet-actions pair-actions');
      // One clear primary: a refused extension can only connect with a code for now; anything else can try again.
      if (refused) actions.append(action('Use a code', useCode, 'primary'));
      else actions.append(action('Try again', async () => { if (!isDemo) await message({ cmd: 'PAIR_ACK' }).catch(() => {}); showPairing(); }, 'primary'));
      actions.append(action('Close', () => $('sheet').close()));
      center.append(heading, el('p', 'pair-state-body', body), actions);
      if (!refused) pad.append(pairingFoot('Or ', 'use a code'));
      if (!isDemo) message({ cmd: 'PAIR_ACK' }).catch(() => {});
    }
    content.append(pad);
  }
  // Chrome closes this popup when SnagThis takes focus, so the next opening celebrates once.
  async function celebrateConnection() {
    const content = openSheet('Connect SnagThis'); $('sheet').dataset.view = 'connected'; clearInterval(pairingTick); delete $('sheet').dataset.pairRequest;
    const pad = el('div', 'sheet-pad pair-pad'); const center = el('div', 'pair-center pair-yay'); const art = el('div', 'pair-yay-art'); const burst = el('div', 'pair-burst'); burst.setAttribute('aria-hidden', 'true');
    [0, 45, 90, 135, 180, 225, 270, 315, 20, 200].forEach((angle, index) => { const dot = el('i'); dot.style.setProperty('--a', `${angle}deg`); dot.style.setProperty('--d', `${index > 7 ? 40 : 58}px`); dot.style.setProperty('--c', ['var(--accent-bevel-face)', 'var(--accent-bevel-light)', '#80bfa6', '#fff4e6'][index % 4]); burst.append(dot); });
    const mark = pixel.button(64); art.append(burst, mark);
    const title = el('h3', 'pair-yay-title'); title.setAttribute('role', 'status'); title.append(el('span', 'sr-only', 'Connected'), pixel.word('Connected', 3));
    const done = action('Done', () => $('sheet').close(), 'primary');
    center.append(art, title, el('p', 'pair-say', 'Play a video, then choose Download.'), pairingPips('good'), done); pad.append(center); content.append(pad);
    // Focus Done rather than the close button; the ring still shows only for keyboard users.
    done.focus({ focusVisible: false });
    requestAnimationFrame(() => pixel.press(mark));
    if (isDemo) return;
    await message({ cmd: 'PAIR_ACK' }).catch(() => {});
    appToken = (await chrome.storage.local.get('appToken')).appToken || ''; disconnectedNotice = false;
    await loadPreferences(); await refresh(); renderConnection();
  }
  function onPairingChange(state) {
    if (!state) return;
    if (state.status === 'connected') { celebrateConnection(); return; }
    if (pairingSheetOpen()) renderPairing(state);
  }
  function showCodePairing() {
    const content = openSheet('Connect with a code'); $('sheet').dataset.view = 'code'; clearInterval(pairingTick); const form = el('form', 'sheet-pad');
    form.append(el('p', '', '1. In the SnagThis desktop app, open Settings → Chrome extension → Show connection code.'), el('p', '', '2. Paste that code below. It connects as soon as all six digits are in, and you only need to do this once.'));
    const label = el('label', '', 'Connection code'); label.htmlFor = 'pairing-code'; const input = el('input', 'text-input'); input.id = 'pairing-code'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.pattern = '[0-9]{6}'; input.maxLength = 16; input.required = true; input.placeholder = '000000';
    const help = el('p', '', 'Six digits from the desktop app. Codes expire after 5 minutes.'); help.id = 'pairing-code-help'; input.setAttribute('aria-describedby', help.id);
    const errorText = el('p', 'sheet-error'); errorText.setAttribute('role', 'alert'); const actions = el('div', 'sheet-actions');
    actions.append(action('Connect', () => form.requestSubmit(), 'primary'), action('Open app settings', () => openDesktop('settings'), 'bordered'));
    form.append(label, input, help, actions, errorText); content.append(form);
    // Pasted codes may carry spaces or dashes; six digits submit on their own.
    let submitted = '';
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value !== digits) input.value = digits;
      if (digits.length === 6 && digits !== submitted && !actions.firstElementChild.disabled) form.requestSubmit();
    });
    form.addEventListener('submit', async event => { event.preventDefault(); if (!form.reportValidity() || isDemo) return; const submit = actions.firstElementChild; submitted = input.value; submit.disabled = true; errorText.textContent = '';
      try { const result = await request('/v1/pair/complete', { body: { code: input.value.trim() }, public: true }); if (!result.token) throw new Error('Enter the code currently shown in SnagThis.'); appToken = result.token; await chrome.storage.local.set({ appToken, appTokenVersion: 2 }); await chrome.storage.session?.remove('snagthis:disconnected').catch(() => {}); disconnectedNotice = false; $('sheet').close(); notice('Connected to SnagThis. Play a video in Chrome, then choose Download.'); await loadPreferences(); await refresh(); renderConnection(); }
      catch (error) { errorText.textContent = [400, 401, 403].includes(error.status) ? 'This code is incorrect or expired. In the desktop app, get the current code from Settings → Chrome extension and try again.' : error.status === 429 ? 'Too many attempts. Wait up to 5 minutes, then try again with a current code.' : !error.status ? 'Could not reach SnagThis. Open the desktop app, then try again.' : error.message; }
      finally { submit.disabled = false; }
    }); input.focus();
  }
  async function disconnectBrowser(button) {
    if (isDemo) { appToken = ''; disconnectedNotice = true; $('sheet').close(); renderConnection(); return; }
    button.disabled = true;
    try { const result = await message({ cmd: 'PAIR_DISCONNECT', apiBase }); if (!result?.ok) throw new Error(result?.error || 'SnagThis could not disconnect this browser.'); appToken = ''; disconnectedNotice = true; desktopQueue = []; $('sheet').close(); renderRows(); }
    catch (error) { notice(error.message); button.disabled = false; }
  }
  async function savePreference(key, value, confirm) {
    const previous = preferences[key]; preferences[key] = value;
    try { if (!isDemo) { if (reachable && appToken) await request('/v1/settings', { body: { [key]: value } }); await chrome.storage.local.set({ preferences }); } renderRows(); confirm?.(); }
    catch (error) { preferences[key] = previous; notice(error.message); showSettings(); }
  }
  // Accent: kept in this browser, shared with the desktop when it is connected; the later change wins.
  function syncAccent(remote) {
    const result = accent.reconcile(remote);
    if (result === 'push') pushAccent();
    if (result === 'pulled') for (const input of document.querySelectorAll('.accent-swatch input')) input.checked = input.value === accent.current().accent;
  }
  function pushAccent() {
    if (isDemo || accentPush || !desktopReady()) return;
    const { accent: id, changedAt } = accent.current();
    accentPush = request('/v1/settings', { body: { accent: id, accentChangedAt: changedAt } })
      .then(reply => { if (reply.appearance) accent.reconcile(reply.appearance); })
      .catch(() => { /* Kept locally; the next queue poll or reconnect tries again. */ })
      .finally(() => { accentPush = null; });
  }
  async function chooseAccent(id, confirm) {
    await accent.choose(id); confirm();
    pushAccent();
  }
  // A brief green "Saved" beside a setting, as on the desktop, also announced.
  function savedConfirmation(row, label) {
    return () => {
      const title = row.querySelector('.setting-description label, .setting-description .setting-title');
      row.querySelector('.saved-mark')?.remove(); clearTimeout(row.savedTimer);
      const mark = el('span', 'saved-mark'); mark.append(icon('check'), document.createTextNode('Saved')); title?.append(mark);
      $('sample-status').textContent = `${label} saved`;
      row.savedTimer = setTimeout(() => mark.remove(), 2000);
    };
  }
  function accentPicker() {
    const row = el('div', 'setting-row accent-row'); const description = el('div', 'setting-description');
    const title = el('span', 'setting-title', 'Accent colour'); title.id = 'accent-colour-label';
    const hint = el('small', '', 'Buttons, focus, the logo and the toolbar icon. Shared with the desktop app.'); hint.id = 'accent-colour-hint';
    const group = el('div', 'accent-swatches'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', title.id); group.setAttribute('aria-describedby', hint.id);
    const confirm = savedConfirmation(row, 'Accent colour');
    for (const { id, name, swatch } of SnagThisAccents.ACCENTS) {
      const label = el('label', 'accent-swatch'); label.style.setProperty('--swatch', swatch);
      const input = el('input'); input.type = 'radio'; input.name = 'accent-colour'; input.value = id; input.checked = accent.current().accent === id;
      input.addEventListener('change', () => { if (input.checked) chooseAccent(id, confirm); });
      const dot = el('span', 'accent-dot'); dot.setAttribute('aria-hidden', 'true'); dot.append(icon('check'));
      label.append(input, dot, el('span', 'accent-name', name)); group.append(label);
    }
    description.append(title, hint, group); row.append(description);
    return row;
  }
  /* ── Settings: Downloads · Appearance · Connection · About, an icon tab bar under the header
   * (docs/design/prototypes/popup-settings option 3). The last tab is kept while the popup is open. ── */
  const SETTINGS_TABS = [['downloads', 'Downloads', 'section'], ['appearance', 'Appearance', 'palette'], ['connection', 'Connection', 'plug'], ['about', 'About', 'info']];
  const CONNECTION_STATES = { paired: ['ok', 'Connected'], offline: ['amber', 'SnagThis not open'], unpaired: ['grey', 'Not connected'] };
  let settingsTab = 'downloads'; let settingsHeight = 0; let settingsState = '';
  function settingsConnection() { return !appToken ? 'unpaired' : !reachable ? 'offline' : 'paired'; }
  function settingsOpen() { return $('sheet').open && $('sheet').dataset.view === 'settings'; }
  function settingIcon(glyph, tone = '') { const badge = el('span', `setting-icon${tone ? ` ${tone}` : ''}`); badge.setAttribute('aria-hidden', 'true'); badge.append(icon(glyph)); return badge; }
  function paneHeading(title, description) { return [el('h3', 'settings-pane-title', title), el('p', 'settings-pane-description', description)]; }
  // One explanation for every disabled row, at the top of the card, with the fix as a button.
  function settingsGate(state) {
    if (state === 'paired') return null;
    const gate = el('div', `settings-gate${state === 'unpaired' ? ' neutral' : ''}`); gate.setAttribute('role', 'note'); gate.id = 'settings-gate';
    const text = el('span', '', state === 'offline' ? 'SnagThis isn’t open, so these can’t change right now.' : 'Connect Chrome to SnagThis to choose these.'); text.id = 'settings-gate-text';
    gate.append(icon(state === 'offline' ? 'alert' : 'plug'), text, state === 'offline' ? action(getAppFallback ? 'Get the app' : 'Open SnagThis', () => openDesktop(), 'bordered') : action('Connect', showPairing, 'primary'));
    return gate;
  }
  function downloadsPanel(state) {
    const on = state === 'paired'; const group = el('div', 'setting-group');
    const confirmSaved = (control, label) => () => { const row = control.closest('.setting-row'); if (row) savedConfirmation(row, label)(); };
    const describe = control => { control.disabled = !on; if (!on) control.setAttribute('aria-describedby', 'settings-gate-text'); return control; };
    function select(key, values, label) { const control = describe(el('select', 'setting-control')); control.id = `setting-${key}`; for (const [value, text] of values) { const option = el('option', '', text); option.value = value; control.append(option); } control.value = preferences[key]; control.addEventListener('change', () => savePreference(key, control.value, confirmSaved(control, label))); return control; }
    function toggle(key, label) { const control = describe(el('input', 'switch')); control.type = 'checkbox'; control.id = `setting-${key}`; control.setAttribute('role', 'switch'); control.checked = Boolean(preferences[key]); control.addEventListener('change', () => savePreference(key, control.checked, confirmSaved(control, label))); return control; }
    function row(label, note, control, glyph) {
      const node = el('div', `setting-row${on ? '' : ' is-off'}`); const description = el('div', 'setting-description'); const labelNode = el('label', '', label); labelNode.htmlFor = control.id;
      description.append(labelNode); if (note) description.append(el('small', '', note)); node.append(settingIcon(glyph), description, control); group.append(node);
    }
    const gate = settingsGate(state); if (gate) group.append(gate);
    row('Preferred quality', 'Used when a video offers it', select('preferredQuality', [['best', 'Best'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']], 'Preferred quality'), 'screen');
    row('Subtitles', 'Included when available', select('subtitleLanguage', [['none', 'None'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']], 'Subtitles'), 'captions');
    row('Tell me when desktop downloads finish', '', toggle('notifyOnComplete', 'Tell me when desktop downloads finish'), 'bell');
    return [...paneHeading('Downloads', 'Used for downloads you send to SnagThis from Chrome.'), group];
  }
  // Appearance works without the app; it is shared with the desktop once they are connected.
  function appearancePanel(state) {
    const group = el('div', 'setting-group'); const row = accentPicker(); row.prepend(settingIcon('palette', 'warm')); group.append(row);
    const nodes = [...paneHeading('Appearance', 'How SnagThis looks in Chrome. Works without the app.'), group];
    if (state !== 'paired') nodes.push(el('p', 'settings-hint', state === 'offline' ? 'Saved in Chrome now. SnagThis picks it up the next time it’s open.' : 'Saved in Chrome. Connect to share it with the desktop app.'));
    return nodes;
  }
  function connectionPanel(state) {
    const nodes = paneHeading('Connection', 'How this browser reaches the SnagThis app.'); const group = el('div', 'setting-group connection-card');
    const row = (glyph, tone, title, note, control) => { const node = el('div', 'setting-row'); const text = el('div', 'setting-description'); text.append(el('span', 'setting-title', title), el('small', '', note)); node.append(settingIcon(glyph, tone), text, control); group.append(node); };
    if (state === 'unpaired') {
      row('plug', 'grey', 'Not connected', 'Supported files still save in Chrome. Connect for streams and more.', action(disconnectedNotice ? 'Connect again' : 'Connect', showPairing, 'primary'));
      const hint = el('p', 'settings-hint', 'SnagThis shows four digits to check, then you choose Allow there. '); hint.append(codeLink());
      return [...nodes, group, hint];
    }
    const offline = state === 'offline';
    const disconnect = action('Disconnect', () => disconnectBrowser(disconnect), 'danger'); disconnect.disabled = offline;
    row(offline ? 'alert' : 'check', offline ? 'amber' : 'connected', 'Connected to SnagThis', offline ? 'SnagThis isn’t open right now' : 'This browser · downloads, library and accent', disconnect);
    if (offline) row('app', '', 'Open SnagThis', 'Needed to send downloads, change settings or disconnect', action(getAppFallback ? 'Get the app' : 'Open', () => openDesktop(), 'bordered'));
    return [...nodes, group, el('p', 'settings-hint', offline ? 'Open SnagThis to disconnect this browser.' : 'Disconnecting here forgets this browser in SnagThis too. You can reconnect any time.')];
  }
  function aboutPanel() {
    const brand = el('div', 'settings-brand'); const version = el('span', 'settings-version', 'for Chrome '); version.append(el('b', '', `v${runtimeVersion}`));
    brand.append(document.querySelector('.popup-header .logo-wordmark').cloneNode(true), version);
    const group = el('div', 'setting-group');
    const link = (glyph, title, note, trailing, handler) => { const node = el('button', 'setting-row setting-row-link'); node.type = 'button'; const text = el('span', 'setting-description'); text.append(el('span', 'setting-title', title), el('small', '', note)); node.append(settingIcon(glyph), text, icon(trailing)); node.addEventListener('click', handler); group.append(node); };
    const fromStore = !isDemo && Boolean(chrome.runtime.getManifest().update_url);
    link('refresh', 'Update Chrome extension', fromStore || isDemo ? 'Chrome updates it from the Web Store on its own' : 'Replace this unpacked copy with the latest ZIP', 'next', showExtensionUpdate);
    link('lifebuoy', 'Troubleshooting', 'Some sites protect their videos', 'external', () => external(HELP));
    return [...paneHeading('About', 'Version, updates and help.'), brand, group];
  }
  function settingsPanel(tab, state) { return { downloads: downloadsPanel, appearance: appearancePanel, connection: connectionPanel, about: aboutPanel }[tab](state); }
  function selectSettingsTab(tab, focus = false) {
    settingsTab = tab;
    for (const node of $('sheet-content').querySelectorAll('[role="tab"]')) { const selected = node.dataset.tab === tab; node.setAttribute('aria-selected', String(selected)); node.tabIndex = selected ? 0 : -1; if (selected && focus) node.focus({ preventScroll: true }); }
    const pane = $('settings-panel'); pane.setAttribute('aria-labelledby', `settings-tab-${tab}`); pane.replaceChildren(...settingsPanel(tab, settingsState)); pane.scrollTop = 0;
  }
  // Measures every tab once so the sheet (and Chrome's window) stays at the tallest one's height.
  function measureSettings() {
    const pane = $('settings-panel'); const fixed = $('sheet').querySelector('.sheet-header').offsetHeight + $('sheet-content').querySelector('.settings-tabs').offsetHeight;
    const padding = Number.parseFloat(getComputedStyle(pane).paddingBottom) || 0; let tallest = 0;
    for (const [tab] of SETTINGS_TABS) { const body = el('div', 'settings-measure'); body.append(...settingsPanel(tab, settingsState)); pane.replaceChildren(body); tallest = Math.max(tallest, body.offsetHeight); }
    settingsHeight = Math.min(560, Math.max(430, Math.ceil(fixed + tallest + padding)));
    syncPopupHeight();
  }
  function renderSettingsTabs() {
    const list = el('div', 'settings-tabs'); list.setAttribute('role', 'tablist'); list.setAttribute('aria-label', 'Settings sections');
    const [tone, stateText] = CONNECTION_STATES[settingsState];
    for (const [id, label, glyph] of SETTINGS_TABS) {
      const tab = el('button'); tab.type = 'button'; tab.id = `settings-tab-${id}`; tab.dataset.tab = id; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'settings-panel');
      tab.append(icon(glyph), el('span', '', label));
      // The square repeats the connection state; the tab's name says it in words.
      if (id === 'connection') { const status = el('span', `settings-tab-status ${tone}`); status.setAttribute('aria-hidden', 'true'); tab.append(status); tab.setAttribute('aria-label', `Connection, ${stateText}`); }
      tab.addEventListener('click', () => selectSettingsTab(id, true)); list.append(tab);
    }
    list.addEventListener('keydown', event => {
      const tabs = [...list.querySelectorAll('[role="tab"]')]; const index = tabs.indexOf(event.target.closest('[role="tab"]'));
      if (index < 0) return;
      const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); selectSettingsTab(tabs[next].dataset.tab, true);
    });
    return list;
  }
  function showSettings(tab) {
    const content = openSheet('Settings'); $('sheet').dataset.view = 'settings'; $('sheet-link').hidden = false;
    if (SETTINGS_TABS.some(([id]) => id === tab)) settingsTab = tab;
    settingsState = settingsConnection();
    const pane = el('div', 'settings-pane'); pane.id = 'settings-panel'; pane.setAttribute('role', 'tabpanel'); pane.tabIndex = 0;
    content.append(renderSettingsTabs(), pane);
    measureSettings(); selectSettingsTab(settingsTab, true);
  }
  // A connection change while Settings is open redraws it in place, keeping the tab and tab focus.
  function syncSettings() {
    if (!settingsOpen() || settingsConnection() === settingsState) return;
    const tabFocused = document.activeElement?.getAttribute('role') === 'tab'; const paneFocused = $('settings-panel')?.contains(document.activeElement);
    settingsState = settingsConnection();
    const list = $('sheet-content').querySelector('.settings-tabs'); list.replaceWith(renderSettingsTabs());
    measureSettings(); selectSettingsTab(settingsTab, tabFocused);
    if (paneFocused) $('settings-panel').focus({ preventScroll: true });
  }
  async function loadPreferences() {
    if (!appToken || !reachable || isDemo) return;
    try {
      const data = await request('/v1/settings'); const { accent: remoteAccent, accentChangedAt, ...remote } = data.settings || data;
      preferences = { ...preferences, ...remote }; await chrome.storage.local.set({ preferences });
      syncAccent({ accent: remoteAccent, accentChangedAt });
    } catch { /* Existing local preferences remain usable while the app starts. */ }
  }
  function showExtensionUpdate() {
    const content = openSheet('Update Chrome extension'); const pad = el('div', 'sheet-pad');
    const fromStore = !isDemo && Boolean(chrome.runtime.getManifest().update_url);
    pad.append(el('p', '', fromStore
      ? 'Chrome updates extensions from the Chrome Web Store automatically. To check now, open Extensions, turn on Developer mode, and choose Update. Close SnagThis’s popup so Chrome can apply the update.'
      : 'For this unpacked copy, download the latest extension ZIP, replace the files in the same folder, and choose Reload in Chrome Extensions. Keep the same installation to preserve its connection to SnagThis.'));
    pad.append(el('p', '', 'Refresh the video page after updating so detection uses the new version.'));
    pad.append(action('Open Chrome extensions', () => external('chrome://extensions/'), 'primary'));
    if (!fromStore) pad.append(action('Download extension ZIP', () => external(RELEASES), 'bordered'));
    content.append(pad);
  }
  async function checkHealth() {
    if (healthBusy || isDemo) return; healthBusy = true;
    const wasReachable = reachable;
    try { const health = await request('/v1/health', { public: true }); reachable = health.status === 'ok'; desktopAudioTracks = Array.isArray(health.features) && health.features.includes('audio-track'); compatibilityIssue = model.compatibilityIssue(health, runtimeVersion); compatible = !compatibilityIssue; if (reachable) getAppFallback = false; }
    catch { reachable = false; }
    finally { healthBusy = false; connectionChecked = true; renderRows(); }
    if (reachable && !wasReachable) { await loadPreferences(); await refresh(); }
  }
  function refresh() {
    if (isDemo) return Promise.resolve();
    if (refreshBusy) return refreshBusy;
    refreshBusy = (async () => {
      const tasks = [activeTab?.id ? message({ cmd: 'GET_TAB_MEDIA', tabId: activeTab.id }) : Promise.resolve(null), reachable && compatible && appToken ? request('/v1/queue') : Promise.resolve(null)];
      const results = await Promise.allSettled(tasks);
      const media = results[0].status === 'fulfilled' ? results[0].value : null;
      if (media?.ok) {
        discoveryError = false;
        if (visit && media.visit !== visit) { selected.clear(); pending.clear(); failures.clear(); customTitles = {}; }
        visit = media.visit; mediaItems = model.sortMediaByDuration(media.items || []); mappings = media.mappings || {}; customTitles = media.titles || customTitles; browserQueue = media.browserQueue || [];
      } else if (activeTab?.id) discoveryError = true;
      if (results[1].status === 'fulfilled' && results[1].value) { desktopQueue = results[1].value.queue || []; syncAccent(results[1].value.appearance); }
      queue = [...desktopQueue, ...browserQueue];
      SnagThisSpeedTrace.record(speedJobs(desktopQueue));
      if (results[1].status === 'rejected' && results[1].reason?.status === 401) { appToken = ''; disconnectedNotice = true; await chrome.storage.local.remove(['appToken', 'appTokenVersion']); await chrome.storage.session?.set({ 'snagthis:disconnected': true }).catch(() => {}); }
      if (results[1].status === 'rejected' && results[1].reason?.status === 426) { compatible = false; compatibilityIssue = model.compatibilityIssue(results[1].reason.compatibility, runtimeVersion); }
      renderRows();
    })().finally(() => { refreshBusy = false; });
    return refreshBusy;
  }
  async function initialize() {
    $('sheet').addEventListener('close', () => { clearInterval(pairingTick); delete $('sheet').dataset.view; syncPopupHeight(); syncThumbPreviews(); });
    reducedMotion.addEventListener('change', syncThumbPreviews);
    document.addEventListener('visibilitychange', syncThumbPreviews);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopSample('hidden'); });
    $('video-list').addEventListener('scroll', preparePosters, { passive: true });
    // One logo shine per pointer entry, at most once a second; CSS removes it under reduced motion.
    const logo = document.querySelector('.logo-finish'); let lastShine = -Infinity;
    logo.addEventListener('pointerenter', () => { const now = performance.now(); if (now - lastShine < 1000) return; lastShine = now; logo.classList.remove('shining'); void logo.offsetWidth; logo.classList.add('shining'); });
    logo.addEventListener('animationend', () => logo.classList.remove('shining'));
    $('settings-button').append(icon('gear')); $('close-sheet').append(icon('close'));
    $('settings-button').addEventListener('click', () => showSettings()); $('sheet-link').prepend(icon('app')); $('sheet-link').append(icon('external')); $('sheet-link').addEventListener('click', () => openDesktop('settings')); $('close-sheet').addEventListener('click', () => $('sheet').close()); $('help-button').addEventListener('click', showHelp);
    $('open-app').addEventListener('click', () => { $('open-app').classList.remove('snag-pip'); if (!reachable) external(RELEASES); else if (!appToken) showPairing(); else openDesktop(); });
    loadingMascot($('video-list').querySelector('.discovery-state'));
    document.addEventListener('pointerdown', event => { if (!$('menu').hidden && !$('menu').contains(event.target) && !menuTrigger?.contains(event.target)) closeMenu(false); });
    if (isDemo) {
      const data = SnagThisDemo.init(params.get('demo')); discoveryPending = params.get('demo') === 'loading'; discoveryError = params.get('demo') === 'error'; activeTab = data.tab; mediaItems = model.sortMediaByDuration(data.items); mappings = data.mappings; queue = data.queue; preferences = { ...preferences, ...data.preferences }; reachable = data.reachable; appToken = params.get('demo') === 'pairing' ? '' : 'demo-only'; compatible = data.compatible; titles.setActiveTab(activeTab);
      SnagThisSpeedTrace.record(speedJobs(queue)); renderRows();
      // Sample speeds keep moving so the gallery shows live traces; 'snag' also finishes a download.
      SnagThisDemo.live?.(() => { queue = SnagThisDemo.state.queue; SnagThisSpeedTrace.record(speedJobs(queue)); renderRows(); });
      if (params.get('demo') === 'pairing') { if (params.get('pair') === 'connected') celebrateConnection(); else if (params.get('pair') === 'code') showCodePairing(); else if (params.get('pair')) renderPairing({ status: params.get('pair'), matchCode: params.get('pair') === 'starting' ? '' : '4719', expiresAt: Date.now() + 112000 }); else showPairing(); } if (params.get('demo') === 'settings') { if (params.get('conn') === 'offline') reachable = false; if (params.get('conn') === 'unpaired') appToken = ''; renderConnection(); showSettings(params.get('tab')); } if (['quality', 'audio'].includes(params.get('demo'))) showQuality(mediaItems[0], rowElements.get(mediaItems[0].id).querySelector('.quality-button'));
      return;
    }
    const stored = await chrome.storage.local.get(['appToken', 'appTokenVersion', 'preferences']); appToken = stored.appToken || ''; preferences = { ...preferences, ...(stored.preferences || {}) };
    disconnectedNotice = !appToken && Boolean((await chrome.storage.session?.get('snagthis:disconnected').catch(() => null))?.['snagthis:disconnected']);
    // Connections made before per-browser keys trade the shared key for this browser's own.
    if (appToken && stored.appTokenVersion !== 2) { await message({ cmd: 'PAIR_UPGRADE', apiBase }).catch(() => {}); appToken = (await chrome.storage.local.get('appToken')).appToken || ''; }
    await accent.load();
    const tabId = Number(params.get('tab'));
    activeTab = tabId > 0 ? await chrome.tabs.get(tabId).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
    titles.setActiveTab(activeTab);
    // Cached detections paint immediately; desktop health never gates the scan.
    await refresh();
    const health = checkHealth();
    await checkAgain();
    await health;
    queueTimer = setInterval(refresh, 1000); healthTimer = setInterval(checkHealth, 2000);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && activeTab?.id && changes[`snagthis:tab:${activeTab.id}`]) refresh();
      if (area === 'session' && changes[PAIRING_KEY]) onPairingChange(changes[PAIRING_KEY].newValue);
    });
    // A request that finished or is still waiting while the popup was closed.
    const pairing = (await message({ cmd: 'PAIR_STATE' }).catch(() => null))?.state;
    if (pairing?.status === 'connected') celebrateConnection();
    else if (pairing) renderPairing(pairing);
  }
  window.addEventListener('pagehide', () => { stopSample('hidden'); popupClosed = true; stopPosterPreparation(); clearInterval(queueTimer); clearInterval(healthTimer); clearTimeout(openTimer); clearInterval(pairingTick); for (const node of rowElements.values()) stopThumbPreview(node); });
  initialize().catch(error => { discoveryPending = false; discoveryError = true; renderRows(); notice(error.message); });
})();
