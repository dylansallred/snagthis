/* Workbench popup. Jobs belong to the worker/desktop, never to this window. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isDemo = location.protocol !== 'chrome-extension:' && ['localhost', '127.0.0.1', ''].includes(location.hostname) && params.has('demo');
  const model = VidSnagPopupModel;
  const rows = VidSnagRows;
  const titles = VidSnagTitles;
  const runtimeVersion = isDemo ? '1.0.0' : chrome.runtime.getManifest().version;
  const apiBase = (!isDemo && !chrome.runtime.getManifest().update_url && model.localApiBase(params.get('apiBase'))) || 'http://127.0.0.1:49732';
  const RELEASES = 'https://github.com/dylansallred/vidsnag/releases';
  const HELP = 'https://github.com/dylansallred/vidsnag/blob/main/README.md#troubleshooting';
  const DEFAULT_PREFERENCES = { preferredQuality: 'best', subtitleLanguage: 'none', notifyOnComplete: true, launchAtLogin: false };
  let preferences = { ...DEFAULT_PREFERENCES };
  let appToken = ''; let activeTab = null; let mediaItems = []; let mappings = {}; let queue = []; let desktopQueue = []; let browserQueue = []; let visit = '';
  let reachable = false; let compatible = true; let getAppFallback = false; let refreshBusy = false; let healthBusy = false;
  let compatibilityIssue = 'desktop';
  let discoveryPending = !isDemo; let discoveryError = false; let connectionChecked = isDemo;
  let menuTrigger = null; let selected = new Map(); let customTitles = {}; let pending = new Map(); let failures = new Map();
  let noticeTimer; let openTimer; let queueTimer; let healthTimer;
  let posterPreparation = null; let popupClosed = false;
  const rowElements = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const icons = {
    // Lucide Settings, matching the desktop icon (vendor/lucide.LICENSE.txt).
    gear: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    play: '<path d="m7 4 9 6-9 6Z"/>', pause: '<path d="M7 4v12M13 4v12"/>',
    download: '<path d="M10 3v9m-4-4 4 4 4-4M4 12v4h12v-4"/>',
    screen: '<path d="M3 4h14v9H3zM7 17h6M10 13v4"/>', captions: '<path d="M3 5h14v10H3zM6 12h3M12 12h2M6 9h2M11 9h3"/>', bell: '<path d="M5 8a5 5 0 0 1 10 0c0 5 2 6 2 6H3s2-1 2-6M8.5 17a1.7 1.7 0 0 0 3 0"/>', external: '<path d="M12 3h5v5M9 11l8-8M15 11v5H4V5h5"/>', next: '<path d="m8 5 5 5-5 5"/>',
    close: '<path d="m5 5 10 10M15 5 5 15"/>', down: '<path d="m5 8 5 5 5-5"/>', check: '<path d="m4 10 4 4 8-8"/>',
  };
  function icon(name) { const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.setAttribute('viewBox', name === 'gear' ? '0 0 24 24' : '0 0 20 20'); node.setAttribute('aria-hidden', 'true'); node.classList.add('icon'); node.innerHTML = icons[name] || icons.play; return node; }
  function el(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
  function metadataSeparator() { const node = el('span', 'meta-separator'); node.setAttribute('aria-hidden', 'true'); return node; }
  function qualityMark(label) {
    const quality = rows.formatQualityBadge(label);
    const mark = el('span', `quality-mark${quality.tier ? '' : ' is-unknown'}`);
    if (quality.tier) { mark.setAttribute('aria-label', `${quality.name}, ${quality.label}`); mark.append(el('span', 'tier-badge', quality.tier)); }
    mark.append(el('span', 'resolution', quality.label));
    return mark;
  }
  function appendMetadata(status, content) {
    if (!status.childElementCount) { status.append(content); return; }
    const part = el('span', 'row-meta-part'); part.append(metadataSeparator(), content); status.append(part);
  }
  function action(label, handler, style = '', iconName = '') {
    const button = el('button', `action ${style}`); button.type = 'button'; button.setAttribute('aria-label', label);
    const iconOnly = style.split(/\s+/).includes('icon-only') && iconName;
    if (iconName) button.append(icon(iconName)); if (!iconOnly) button.append(document.createTextNode(label));
    if (iconOnly) button.title = label;
    button.addEventListener('click', handler); return button;
  }
  function notice(message) { $('notice').textContent = String(message); $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
  function external(url) { if (isDemo) { notice('Preview only — no app or page was opened.'); return; } chrome.tabs.create({ url }).catch(() => notice('Open VidSnag from your Applications folder.')); }
  async function request(path, options = {}) {
    if (isDemo) throw new Error('Demo cannot access the desktop app.');
    const headers = { 'X-Client': 'vidsnag-extension', 'X-Protocol-Version': '1', 'X-Extension-Version': runtimeVersion, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.public ? {} : { Authorization: `Bearer ${appToken}` }) };
    const response = await fetch(`${apiBase}${path}`, { method: options.body ? 'POST' : 'GET', headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(5000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error?.message || data.error || 'VidSnag could not finish that action.'); error.status = response.status; error.compatibility = data.compatibility; throw error; }
    return data;
  }
  async function message(value) { return isDemo ? { ok: true } : chrome.runtime.sendMessage(value); }
  function desktopReady() { return reachable && compatible && Boolean(appToken); }
  function browserSupported(item) { return !isDemo && VidSnagBrowserDownloads.isSupported(item); }
  function openDesktop(view) {
    const appUrl = view === 'settings' ? 'vidsnag://open/settings' : 'vidsnag://open';
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
      banner.append(el('span', '', 'Save supported files in Chrome. Open VidSnag for streams and more.'), action(getAppFallback ? 'Get the app' : 'Open VidSnag', () => openDesktop(), 'primary'));
    } else if (!compatible) {
      if (compatibilityIssue === 'extension') banner.append(el('span', '', 'Update the Chrome extension to use desktop downloads.'), action('Update Chrome extension', showExtensionUpdate, 'primary'));
      else banner.append(el('span', '', 'Update VidSnag to use desktop downloads.'), action('Update', () => external(RELEASES), 'primary'));
    } else if (!appToken) {
      banner.append(el('span', '', 'Save supported files in Chrome. Connect VidSnag for streams and more.'), action('Connect', showPairing, 'primary'));
    }
    $('help-button').hidden = connectionChecked && !reachable;
    const activeCount = queue.filter(job => job.backend !== 'browser' && ['downloading', 'queued'].includes(job.queueStatus)).length;
    const openButton = $('open-app');
    openButton.replaceChildren(document.createTextNode(connectionChecked && !reachable ? "Don't have the app? Get it" : 'Open VidSnag'));
    if (reachable && activeCount) openButton.append(el('span', 'count-badge', String(activeCount)));
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
      thumb.dataset.source = source; thumb.querySelector('.thumb-poster')?.remove();
      const poster = source ? el('img', 'thumb-poster') : el('div', 'thumb-poster placeholder');
      if (source) { poster.alt = ''; poster.src = source; poster.referrerPolicy = 'no-referrer'; poster.addEventListener('error', () => { if (thumb.dataset.source === source) { thumb.dataset.failedSource = source; delete thumb.dataset.source; updateThumb(thumb, { ...(thumb.closest('.video-row')?.current?.row || row), thumbnailUrl: null }); preparePosters(); } }, { once: true }); }
      else { poster.setAttribute('aria-hidden', 'true'); for (let index = 0; index < 3; index++) poster.append(el('span', 'thumb-loading-dot')); }
      thumb.prepend(poster);
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
    const node = [...rowElements.values()].find(candidate => !candidate.posterAttempted && visible(candidate) && !candidate.querySelector('.thumb').dataset.source && VidSnagSourcePreview.sourceFor(candidate.current?.item));
    if (!node) return;
    const item = node.current.item; const previewVisit = visit;
    const video = el('video', 'poster-probe'); video.hidden = true; video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
    node.posterAttempted = true; node.querySelector('.thumb').append(video);
    const preparation = { node, video, controller: null }; posterPreparation = preparation;
    const finish = () => { if (posterPreparation !== preparation) return; stopPosterPreparation(); queueMicrotask(preparePosters); };
    preparation.controller = VidSnagSourcePreview.create({ item, video, tabId: activeTab?.id, mediaId: item.id, posterOnly: true, sceneOffset: node.sourceSceneStart, sceneScope: node.sourceSceneScope,
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
    const demoName = isDemo && { sintel: 'sintel', bunny: 'big-buck-bunny', steel: 'tears-of-steel' }[item.id];
    let clipUrl = demoName ? `popup/media/${demoName}.mp4` : reachable && compatible && appToken ? model.previewClipUrl(row.source.previewClipUrl || (node.previewJobId === jobId ? node.previewClipUrl : ''), apiBase) : '';
    if (clipUrl && node.previewFailedUrl === new URL(clipUrl, location.href).pathname) clipUrl = '';
    if (!clipUrl) {
      if (!node.sourcePreview && !node.sourcePreviewFailed && (item.mediaKind === 'youtube-page' || VidSnagSourcePreview.sourceFor(item))) {
        stopThumbPreview(node);
        const previewVisit = visit;
        const thumb = node.querySelector('.thumb'); const video = el('video', 'thumb-preview'); video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
        node.previewVideo = video; thumb.append(video);
        const callbacks = {
          onPlaying: () => { if (node.previewVideo === video) thumb.classList.add('is-previewing'); },
          onError: () => { if (node.previewVideo === video) { node.sourcePreviewFailed = true; stopThumbPreview(node); } },
        };
        node.sourcePreview = item.mediaKind === 'youtube-page'
          ? VidSnagPagePreview.create({ video, send: message, tabId: activeTab?.id, mediaId: item.id, ...callbacks })
          : VidSnagSourcePreview.create({ item, video, tabId: activeTab?.id, mediaId: item.id, sceneOffset: node.sourceSceneStart, sceneScope: node.sourceSceneScope, ...callbacks,
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
    return { row: result, choice, jobId };
  }
  function mediaSizeLabel(choice) {
    return rows.formatSize(choice.sizeBytes, { estimated: choice.sizeEstimated }) || 'N/A';
  }
  function renderRows() {
    const list = $('video-list');
    const view = mediaItems.length ? 'rows' : discoveryPending ? 'loading' : discoveryError ? 'error' : 'empty';
    const changed = list.dataset.view !== view;
    list.dataset.view = view; list.setAttribute('aria-busy', String(view === 'loading'));
    $('page-count').textContent = mediaItems.length ? `${mediaItems.length} video${mediaItems.length === 1 ? '' : 's'} on this page` : view === 'loading' ? 'Checking this page…' : view === 'error' ? 'Check this page' : 'No videos yet';
    if (!mediaItems.length) {
      for (const node of rowElements.values()) stopThumbPreview(node);
      rowElements.clear(); stopPosterPreparation();
      if (changed) list.replaceChildren(view === 'empty' ? emptyState() : discoveryState(view));
      renderConnection(); return;
    }
    list.querySelector('.empty-state,.discovery-state')?.remove();
    const valid = new Set();
    for (const item of mediaItems) {
      const { row, choice, jobId } = rowModel(item); if (!row) continue;
      valid.add(item.id);
      let node = rowElements.get(item.id);
      if (!node) {
        node = el('div', 'video-row'); node.dataset.rowKey = item.id; node.tabIndex = 0; node.setAttribute('role', 'group');
        const pieces = el('div', 'progress-pieces'); pieces.setAttribute('aria-hidden', 'true');
        // These cells represent aggregate progress, not individual source segments.
        for (let index = 0; index < 40; index++) pieces.append(el('span', 'progress-piece'));
        const thumb = el('div', 'thumb'); const body = el('div', 'row-body'); const titleLine = el('div', 'row-title-line'); titleLine.append(el('div', 'row-title'));
        const metadata = el('div', 'row-meta'); const durationMeta = el('span', 'row-meta-part row-duration-meta'); durationMeta.append(metadataSeparator(), el('span', 'row-duration')); metadata.append(el('div', 'row-status'), durationMeta); body.append(titleLine, metadata);
        node.append(thumb, body, pieces); node.addEventListener('contextmenu', event => { event.preventDefault(); showContext(node.current.item, event); });
        node.addEventListener('pointerenter', () => { node.previewHovered = true; node.previewRequestedFor = ''; node.previewFailedUrl = ''; node.sourcePreviewFailed = false; syncThumbPreview(node); });
        node.addEventListener('pointerleave', () => { node.previewHovered = false; syncThumbPreview(node); });
        node.addEventListener('focusin', () => { if (!node.previewFocused) { node.previewRequestedFor = ''; node.previewFailedUrl = ''; node.sourcePreviewFailed = false; } node.previewFocused = true; syncThumbPreview(node); });
        node.addEventListener('focusout', event => { node.previewFocused = node.contains(event.relatedTarget); syncThumbPreview(node); });
        rowElements.set(item.id, node);
      }
      node.current = { item, row, choice, jobId };
      node.setAttribute('aria-label', row.title);
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
      const duration = node.querySelector('.row-duration'); duration.textContent = row.durationLabel; duration.parentElement.hidden = !row.durationLabel;
      const status = node.querySelector('.row-status'); status.className = `row-status tone-${row.tone}`; status.title = row.statusLine;
      if (row.state === 'detected') {
        status.removeAttribute('role'); status.removeAttribute('aria-valuenow'); status.removeAttribute('aria-valuetext');
        const variants = item.variants || [];
        const sizeLabel = mediaSizeLabel(choice);
        const signature = `${choice.qualityLabel}|${sizeLabel}|${variants.length}`;
        status.title = [choice.qualityLabel, sizeLabel].filter(Boolean).join(' · ');
        if (status.dataset.signature !== signature) {
          status.dataset.signature = signature; status.classList.add('status-meta');
          let quality = variants.length > 1 ? status.querySelector('.quality-button') : null;
          if (quality) { while (quality.nextSibling) quality.nextSibling.remove(); }
          else status.replaceChildren();
          if (variants.length > 1) {
            if (!quality) {
              quality = el('button', 'quality-button'); quality.type = 'button'; quality.setAttribute('aria-haspopup', 'menu'); quality.setAttribute('aria-expanded', 'false'); quality.setAttribute('aria-label', 'Choose quality');
              quality.addEventListener('click', () => showQuality(node.current.item, quality)); status.append(quality);
            }
            quality.replaceChildren(qualityMark(choice.qualityLabel || 'Quality'), icon('down'));
          } else if (choice.qualityLabel) status.append(qualityMark(choice.qualityLabel));
          appendMetadata(status, el('span', '', sizeLabel));
        } else status.classList.add('status-meta');
      } else if (row.state === 'saved') {
        delete status.dataset.signature; status.replaceChildren(); status.className = 'row-status status-meta tone-muted';
        for (const attribute of ['role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) status.removeAttribute(attribute);
        if (row.qualityLabel) appendMetadata(status, qualityMark(row.qualityLabel));
        if (row.sizeLabel) appendMetadata(status, el('span', '', row.sizeLabel));
        const saved = el('span', 'saved-copy'); saved.append(icon('check'), document.createTextNode(row.statusLine)); appendMetadata(status, saved);
      } else {
        delete status.dataset.signature; status.textContent = row.statusLine;
        if (['downloading', 'finishing', 'paused', 'problem'].includes(row.state)) {
          status.setAttribute('role', 'progressbar'); status.setAttribute('aria-valuemin', '0'); status.setAttribute('aria-valuemax', '100'); status.setAttribute('aria-valuenow', String(row.percent)); status.setAttribute('aria-valuetext', row.statusLine);
        } else { for (const attribute of ['role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) status.removeAttribute(attribute); }
      }
      node.querySelector('.row-duration-meta > .meta-separator').hidden = !status.textContent.trim();
      const busy = pending.has(item.id) && !pending.get(item.id).optimistic;
      const actionKey = busy ? 'sending' : row.action ? `${row.action.id}:${row.action.style}` : '';
      if (node.dataset.actionKey !== actionKey) {
        node.querySelector(':scope > .action')?.remove(); node.dataset.actionKey = actionKey;
        if (busy) { const button = action('Starting download', () => {}, 'primary'); button.replaceChildren(el('span', 'spinner')); button.disabled = true; node.append(button); }
        else if (row.action) {
          const iconName = row.action.id === 'download' ? 'download' : ['pause', 'resume', 'play'].includes(row.action.id) ? row.action.id === 'pause' ? 'pause' : 'play' : '';
          const style = row.action.id === 'download' ? 'primary icon-only' : row.action.style === 'icon' ? 'icon-only' : row.action.style;
          node.append(action(row.action.label, () => handleAction(node.current), style, iconName));
        }
      }
      if (node.parentElement !== list) list.append(node);
      syncThumbPreview(node);
    }
    for (const [key, node] of rowElements) if (!valid.has(key)) { stopThumbPreview(node); node.remove(); rowElements.delete(key); }
    for (const [index, key] of Array.from(valid).entries()) {
      const node = rowElements.get(key);
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
    }
    renderConnection();
    preparePosters();
  }
  function emptyState() {
    const node = el('section', 'empty-state'); const tile = el('div', 'empty-icon'); tile.append(icon('play'));
    node.append(tile, el('h2', '', 'Press play on the video'), el('p', '', 'VidSnag spots a video once it starts playing. Start it, then open this again.'), action('Check again', checkAgain, 'bordered')); return node;
  }
  function discoveryState(view) {
    const node = el('section', 'discovery-state'); node.setAttribute('role', 'status');
    if (view === 'error') {
      node.append(el('p', '', "Couldn't check this page."), action('Try again', checkAgain, 'bordered'));
    } else {
      const dots = el('span', 'discovery-dots'); dots.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 3; index++) dots.append(el('i', 'thumb-loading-dot'));
      node.append(dots, el('p', '', 'Looking for videos…'));
    }
    return node;
  }
  async function checkAgain() {
    if (isDemo) return;
    discoveryPending = true; discoveryError = false; renderRows();
    if (activeTab?.id) await chrome.tabs.sendMessage(activeTab.id, { cmd: 'SCAN_PAGE' }).catch(() => {});
    // A scan acknowledges its writes; read after any earlier snapshot finishes.
    if (refreshBusy) await refreshBusy;
    discoveryPending = false; await refresh();
  }
  async function handleAction(current) {
    const { item, row, jobId } = current;
    if (isDemo) { if (row.action.id === 'play') { showDemoVideo(item); return; } VidSnagDemo.act(item.id, row.action.id); queue = VidSnagDemo.state.queue; renderRows(); return; }
    if (row.action.id === 'use-desktop') { useDesktop(item); return; }
    if (row.source.backend === 'browser') {
      if (row.action.id === 'chrome-details') { showBrowserDetails(current); return; }
      if (row.action.id === 'retry') { await startDownload(item); return; }
      await browserAction(jobId, row.action.id); return;
    }
    if (row.action.id === 'download' || (row.action.id === 'retry' && !jobId)) { await startDownload(item); return; }
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
  function useDesktop(item) {
    if (desktopReady()) { startDownload(item, 'desktop'); return; }
    if (reachable && !compatible) { if (compatibilityIssue === 'extension') showExtensionUpdate(); else external(RELEASES); return; }
    if (reachable && !appToken) { showPairing(); return; }
    const content = openSheet('Use desktop app'); const pad = el('div', 'sheet-pad');
    pad.append(el('p', '', 'Open VidSnag and connect Chrome to try this download. The desktop app handles supported streams, audio and subtitle choices, and your VidSnag library.'), action(getAppFallback ? 'Get the app' : 'Open VidSnag', () => openDesktop(), 'primary'));
    content.append(pad);
  }
  async function browserAction(jobId, command) {
    try { const result = await message({ cmd: 'BROWSER_DOWNLOAD_ACTION', jobId, action: command }); if (!result?.ok) throw new Error(result?.error || 'Chrome could not finish that action.'); await refresh(); }
    catch (error) { notice(error.message); }
  }
  function showBrowserDetails(current) {
    const content = openSheet('Chrome download'); const pad = el('div', 'sheet-pad'); const job = current.row.source;
    pad.append(el('p', '', 'Chrome manages this file in your browser’s download folder. It is separate from the VidSnag desktop library.'));
    if (job.fileName) pad.append(el('p', '', job.fileName));
    if (job.error) pad.append(el('p', '', typeof job.error === 'string' ? job.error : job.error.message || job.error.code || 'Check this download in Chrome.'));
    pad.append(action('Open Chrome downloads', () => external('chrome://downloads/'), 'primary')); content.append(pad);
  }
  function closeMenu(restoreFocus = true) { $('menu').hidden = true; $('menu').replaceChildren(); if (menuTrigger?.isConnected) { menuTrigger.setAttribute('aria-expanded', 'false'); if (restoreFocus) menuTrigger.focus({ preventScroll: true }); } menuTrigger = null; }
  function openMenu(trigger, point) {
    const menu = $('menu'); menu.replaceChildren(); menu.hidden = false;
    menuTrigger?.setAttribute('aria-expanded', 'false'); menuTrigger = trigger?.focus ? trigger : null; menuTrigger?.setAttribute('aria-expanded', 'true');
    const bounds = trigger?.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min($('popup').getBoundingClientRect().right - 256, point?.clientX ?? bounds?.left ?? 130))}px`;
    menu.style.top = `${Math.max(4, Math.min(window.innerHeight - 42, point?.clientY ?? bounds?.bottom ?? 60))}px`;
    return menu;
  }
  function fitMenu(menu) {
    const top = Number.parseFloat(menu.style.top);
    const bounds = $('popup').getBoundingClientRect();
    const minTop = Math.max(0, bounds.top) + 6;
    const bottom = Math.min(window.innerHeight, bounds.bottom) - 6;
    menu.style.maxHeight = `${Math.max(0, bottom - minTop)}px`;
    menu.style.top = `${Math.max(minTop, Math.min(top, bottom - menu.offsetHeight))}px`;
    menu.querySelector('button')?.focus({ preventScroll: true });
  }
  function menuItem(menu, label, handler, options = {}) {
    const button = el('button', 'menu-item'); button.type = 'button'; button.setAttribute('role', options.radio ? 'menuitemradio' : 'menuitem');
    if (options.radio) { button.setAttribute('aria-checked', String(Boolean(options.checked))); const check = el('span', 'menu-check'); if (options.checked) check.append(icon('check')); button.append(check); }
    button.append(document.createTextNode(label)); if (options.value) button.append(el('span', 'menu-value', options.value));
    button.addEventListener('click', event => { closeMenu(event.detail === 0); handler(); }); menu.append(button); return button;
  }
  function showQuality(item, trigger) {
    const menu = openMenu(trigger); const choice = model.selectMedia(item, preferences, selected.get(item.id));
    const choose = update => { selected.set(item.id, { ...(selected.get(item.id) || {}), ...update }); renderRows(); };
    for (const [index, variant] of (item.variants || []).entries()) {
      const variantChoice = model.selectMedia(item, preferences, { variantUrl: variant.url });
      menuItem(menu, variant.height ? `${variant.height}p` : `Quality ${index + 1}`, () => choose({ variantUrl: variant.url, audioOnly: false }), { radio: true, checked: !choice.selection.audioOnly && choice.selection.variantUrl === variant.url, value: mediaSizeLabel(variantChoice) });
    }
    if ((item.audio || []).some(audio => audio.url)) menuItem(menu, 'Audio only', () => choose({ audioOnly: true }), { radio: true, checked: choice.selection.audioOnly });
    if ((item.subtitles || []).length) {
      menu.append(el('hr'), el('div', 'menu-title', 'Subtitles'));
      for (const subtitle of item.subtitles) { const language = subtitle.language || subtitle.name; menuItem(menu, subtitle.name || language, () => choose({ subtitleLang: language }), { radio: true, checked: choice.selection.subtitleLang === language }); }
      menuItem(menu, 'None', () => choose({ subtitleLang: 'none' }), { radio: true, checked: choice.selection.subtitleLang === 'none' });
    }
    fitMenu(menu);
  }
  function showContext(item, event) {
    const menu = openMenu(null, event); const job = model.jobFor(item, mappings, queue); const jobId = job?.id || job?.jobId || null;
    menuItem(menu, 'Rename', () => showRename(item));
    menuItem(menu, 'Hide', async () => { const ids = (item.detectedStreams || [item]).map(value => value.id); if (isDemo) mediaItems = mediaItems.filter(value => value.id !== item.id); else await message({ cmd: 'HIDE_MEDIA', tabId: activeTab.id, mediaIds: ids }); renderRows(); await refresh(); });
    menuItem(menu, 'Preview', () => preview(item));
    if ((!jobId || (job?.backend === 'browser' && ['failed', 'completed', 'cancelled'].includes(job.queueStatus))) && browserSupported(model.selectMedia(item, preferences, selected.get(item.id)))) menuItem(menu, 'Download with desktop', () => useDesktop(item));
    if (!jobId) {
      const expired = queue.filter(job => job.queueStatus === 'failed' && job.sourcePageUrl === item.sourcePageUrl && rows.classifyProblem(job.error).code === 'expired');
      if (expired.length === 1) menuItem(menu, 'Continue previous download', async () => {
        if (isDemo) return;
        try { const choice = model.selectMedia(item, preferences, selected.get(item.id)); const result = await message({ cmd: 'REFRESH_MEDIA_SOURCE', tabId: activeTab.id, mediaId: item.id, jobId: expired[0].id, payload: model.buildDownloadPayload(choice, customTitles[item.id] || ''), apiBase }); if (!result.ok) throw new Error(result.error || 'This video could not be matched to the previous download.'); await refresh(); } catch (error) { notice(error.message); }
      });
    }
    if (!jobId && ((item.audio || []).length || (item.subtitles || []).length)) menuItem(menu, 'Quality and subtitles', () => showQuality(item, rowElements.get(item.id)?.querySelector('.row-status')));
    menu.append(el('hr'));
    menuItem(menu, 'Show all detected streams', async () => { await message({ cmd: 'SHOW_ALL_MEDIA', tabId: activeTab?.id }); await refresh(); });
    if (job?.backend === 'browser') {
      menuItem(menu, 'Download details', () => showBrowserDetails(rowElements.get(item.id).current));
      if (['downloading', 'queued', 'paused'].includes(job.queueStatus)) menuItem(menu, 'Cancel download', () => browserAction(jobId, 'cancel'));
    } else if (jobId) menuItem(menu, 'Open in VidSnag', () => openDesktop());
    fitMenu(menu);
  }
  async function preview(item) {
    if (item.mediaKind === 'youtube-page') { external(item.sourcePageUrl || item.url); return; }
    if (isDemo) { showDemoVideo(item); return; }
    const result = await message({ cmd: 'CREATE_STREAM_SESSION', session: { sourceUrl: item.url, sourcePageUrl: item.sourcePageUrl, title: customTitles[item.id] || titles.getDisplayTitle(item), declaredType: item.type, requestHeaders: item.requestHeaders } });
    if (result.ok) external(chrome.runtime.getURL(`player.html?session=${encodeURIComponent(result.sessionId)}`)); else notice(result.error || 'Preview is unavailable.');
  }
  function showDemoVideo(item) {
    if (!isDemo) return;
    const filename = { sintel: 'sintel', bunny: 'big-buck-bunny', steel: 'tears-of-steel' }[item.id];
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
  function openSheet(title) { closeMenu(); $('sheet-title').textContent = title; $('sheet-content').replaceChildren(); $('popup').style.minHeight = '430px'; if (!$('sheet').open) $('sheet').showModal(); syncThumbPreviews(); return $('sheet-content'); }
  function showProblem(row) {
    const content = openSheet('Video details'); const pad = el('div', 'sheet-pad');
    const youtube = VidSnagDetection.youtubeId(row.source.sourcePageUrl) || VidSnagDetection.youtubeId(row.source.url || row.source.mediaUrl);
    pad.append(el('p', '', row.statusLine));
    if (row.problem?.code === 'authentication' && youtube) {
      pad.append(el('p', '', 'Open VidSnag and choose Use Chrome sign-in for this video. VidSnag will ask before using your Chrome sign-in for this download.'));
      pad.append(action('Open VidSnag', () => openDesktop(), 'primary'));
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
  function showHelp() { const content = openSheet('No video?'); content.append(emptyState()); const pad = el('div', 'sheet-pad'); pad.append(el('p', '', 'Start playback, then check again. Some protected videos cannot be saved. During this prerelease, installation instructions are in the project README.'), action('Troubleshooting', () => external(HELP), 'bordered')); content.append(pad); }
  function showPairing() {
    const content = openSheet('Connect VidSnag'); const form = el('form', 'sheet-pad');
    form.append(el('p', '', '1. In the VidSnag desktop app, open Settings → Chrome extension → Show connection code.'), el('p', '', '2. Paste that code below, then choose Connect. You only need to do this once.'));
    const label = el('label', '', 'Connection code'); label.htmlFor = 'pairing-code'; const input = el('input', 'text-input'); input.id = 'pairing-code'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.pattern = '[0-9]{6}'; input.maxLength = 6; input.required = true; input.placeholder = '000000';
    const help = el('p', '', 'Six digits from the desktop app. Codes expire after 5 minutes.'); help.id = 'pairing-code-help'; input.setAttribute('aria-describedby', help.id);
    const errorText = el('p', 'sheet-error'); errorText.setAttribute('role', 'alert'); const actions = el('div', 'sheet-actions');
    actions.append(action('Connect', () => form.requestSubmit(), 'primary'), action('Open app settings', () => openDesktop('settings'), 'bordered'));
    form.append(label, input, help, actions, errorText); content.append(form);
    form.addEventListener('submit', async event => { event.preventDefault(); if (!form.reportValidity() || isDemo) return; const submit = actions.firstElementChild; submit.disabled = true; errorText.textContent = '';
      try { const result = await request('/v1/pair/complete', { body: { code: input.value.trim() }, public: true }); if (!result.token) throw new Error('Enter the code currently shown in VidSnag.'); appToken = result.token; await chrome.storage.local.set({ appToken }); $('sheet').close(); notice('Connected to VidSnag. Play a video in Chrome, then choose Download.'); await loadPreferences(); await refresh(); renderConnection(); }
      catch (error) { errorText.textContent = [400, 401, 403].includes(error.status) ? 'This code is incorrect or expired. In the desktop app, get the current code from Settings → Chrome extension and try again.' : error.status === 429 ? 'Too many attempts. Wait up to 5 minutes, then try again with a current code.' : !error.status ? 'Could not reach VidSnag. Open the desktop app, then try again.' : error.message; }
      finally { submit.disabled = false; }
    }); input.focus();
  }
  async function savePreference(key, value) {
    const previous = preferences[key]; preferences[key] = value;
    try { if (!isDemo) { if (reachable && appToken) await request('/v1/settings', { body: { [key]: value } }); await chrome.storage.local.set({ preferences }); } renderRows(); }
    catch (error) { preferences[key] = previous; notice(error.message); showSettings(); }
  }
  function showSettings() {
    const content = openSheet('Settings');
    function setting(label, note, control) { const row = el('div', 'setting-row'); const description = el('div', 'setting-description'); const labelNode = el('label', '', label); if (control.id) labelNode.htmlFor = control.id; description.append(labelNode); if (note) description.append(el('small', '', note)); row.append(description, control); content.append(row); }
    function select(key, values) { const control = el('select', 'setting-control'); control.disabled = !reachable || !appToken; control.id = `setting-${key}`; for (const [value, label] of values) { const option = el('option', '', label); option.value = value; control.append(option); } control.value = preferences[key]; control.addEventListener('change', () => savePreference(key, control.value)); return control; }
    function toggle(key) { const control = el('input', 'switch'); control.disabled = !reachable || !appToken; control.type = 'checkbox'; control.id = `setting-${key}`; control.setAttribute('role', 'switch'); control.checked = Boolean(preferences[key]); control.addEventListener('change', () => savePreference(key, control.checked)); return control; }
    // Only what makes sense from the browser lives here; everything else is one link into the app.
    const group = el('div', 'setting-group'); const list = content; const title = el('h3', 'setting-group-title', 'This browser'); list.append(title, group);
    const into = (label, note, control, glyph) => { setting(label, note, control); const row = list.lastElementChild; const badge = el('span', 'setting-icon'); badge.setAttribute('aria-hidden', 'true'); badge.append(icon(glyph)); row.prepend(badge); group.append(row); };
    into('Preferred quality', 'Used when a video offers it', select('preferredQuality', [['best', 'Best'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']]), 'screen');
    into('Subtitles', 'Included when available', select('subtitleLanguage', [['none', 'None'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']]), 'captions');
    into('Tell me when desktop downloads finish', '', toggle('notifyOnComplete'), 'bell');
    const more = el('button', 'setting-link'); more.type = 'button'; more.append(icon('external'), el('span', '', 'Desktop folder, speed and more in VidSnag'), icon('next')); more.addEventListener('click', () => openDesktop('settings')); list.append(more);
    if (!appToken) { const connect = action('Connect Chrome', showPairing, 'bordered'); connect.classList.add('setting-connect'); list.append(connect); }
  }
  async function loadPreferences() {
    if (!appToken || !reachable || isDemo) return;
    try { const data = await request('/v1/settings'); preferences = { ...preferences, ...(data.settings || data) }; await chrome.storage.local.set({ preferences }); } catch { /* Existing local preferences remain usable while the app starts. */ }
  }
  function showExtensionUpdate() {
    const content = openSheet('Update Chrome extension'); const pad = el('div', 'sheet-pad');
    const fromStore = !isDemo && Boolean(chrome.runtime.getManifest().update_url);
    pad.append(el('p', '', fromStore
      ? 'Chrome updates extensions from the Chrome Web Store automatically. To check now, open Extensions, turn on Developer mode, and choose Update. Close VidSnag’s popup so Chrome can apply the update.'
      : 'For this unpacked copy, download the latest extension ZIP, replace the files in the same folder, and choose Reload in Chrome Extensions. Keep the same installation to preserve its connection to VidSnag.'));
    pad.append(el('p', '', 'Refresh the video page after updating so detection uses the new version.'));
    pad.append(action('Open Chrome extensions', () => external('chrome://extensions/'), 'primary'));
    if (!fromStore) pad.append(action('Download extension ZIP', () => external(RELEASES), 'bordered'));
    content.append(pad);
  }
  async function checkHealth() {
    if (healthBusy || isDemo) return; healthBusy = true;
    const wasReachable = reachable;
    try { const health = await request('/v1/health', { public: true }); reachable = health.status === 'ok'; compatibilityIssue = model.compatibilityIssue(health, runtimeVersion); compatible = !compatibilityIssue; if (reachable) getAppFallback = false; }
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
      if (results[1].status === 'fulfilled' && results[1].value) desktopQueue = results[1].value.queue || [];
      queue = [...desktopQueue, ...browserQueue];
      if (results[1].status === 'rejected' && results[1].reason?.status === 401) { appToken = ''; await chrome.storage.local.remove('appToken'); }
      if (results[1].status === 'rejected' && results[1].reason?.status === 426) { compatible = false; compatibilityIssue = model.compatibilityIssue(results[1].reason.compatibility, runtimeVersion); }
      renderRows();
    })().finally(() => { refreshBusy = false; });
    return refreshBusy;
  }
  async function initialize() {
    $('sheet').addEventListener('close', () => { $('popup').style.minHeight = ''; syncThumbPreviews(); });
    reducedMotion.addEventListener('change', syncThumbPreviews);
    document.addEventListener('visibilitychange', syncThumbPreviews);
    $('video-list').addEventListener('scroll', preparePosters, { passive: true });
    $('settings-button').append(icon('gear')); $('close-sheet').append(icon('close'));
    $('settings-button').addEventListener('click', showSettings); $('close-sheet').addEventListener('click', () => $('sheet').close()); $('help-button').addEventListener('click', showHelp);
    $('open-app').addEventListener('click', () => !reachable ? external(RELEASES) : !appToken ? showPairing() : openDesktop());
    document.addEventListener('pointerdown', event => { if (!$('menu').hidden && !$('menu').contains(event.target) && event.target !== menuTrigger) closeMenu(); });
    $('menu').addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const buttons = Array.from($('menu').querySelectorAll('button')); const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus();
    });
    if (isDemo) {
      const data = VidSnagDemo.init(params.get('demo')); activeTab = data.tab; mediaItems = model.sortMediaByDuration(data.items); mappings = data.mappings; queue = data.queue; preferences = { ...preferences, ...data.preferences }; reachable = data.reachable; appToken = params.get('demo') === 'pairing' ? '' : 'demo-only'; compatible = data.compatible; titles.setActiveTab(activeTab); renderRows();
      if (params.get('demo') === 'pairing') showPairing(); if (params.get('demo') === 'settings') showSettings(); if (params.get('demo') === 'quality') showQuality(mediaItems[0], rowElements.get(mediaItems[0].id).querySelector('.quality-button'));
      return;
    }
    const stored = await chrome.storage.local.get(['appToken', 'preferences']); appToken = stored.appToken || ''; preferences = { ...preferences, ...(stored.preferences || {}) };
    const tabId = Number(params.get('tab'));
    activeTab = tabId > 0 ? await chrome.tabs.get(tabId).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
    titles.setActiveTab(activeTab);
    // Cached detections paint immediately; desktop health never gates the scan.
    await refresh();
    const health = checkHealth();
    await checkAgain();
    await health;
    queueTimer = setInterval(refresh, 1000); healthTimer = setInterval(checkHealth, 2000);
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && activeTab?.id && changes[`vidsnag:tab:${activeTab.id}`]) refresh(); });
  }
  window.addEventListener('pagehide', () => { popupClosed = true; stopPosterPreparation(); clearInterval(queueTimer); clearInterval(healthTimer); clearTimeout(openTimer); for (const node of rowElements.values()) stopThumbPreview(node); });
  initialize().catch(error => { discoveryPending = false; discoveryError = true; renderRows(); notice(error.message); });
})();
