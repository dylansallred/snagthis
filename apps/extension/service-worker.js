/* Download ownership and ephemeral page detections survive popup closure. */
importScripts('shared/hls.js', 'js/detection.js', 'js/preview-origin.js', 'js/browser-downloads.js');
const D = VidSnagDetection;
const browserDownloads = VidSnagBrowserDownloads.createManager({ chrome });
const API_BASE = 'http://127.0.0.1:49732';
const MAX_ITEMS_PER_TAB = 60;
const inFlightRequests = new Map();
const tabWrites = new Map();
const pendingDownloads = new Map();
const PREFIX = 'vidsnag:tab:';
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
function getStorageKey(tabId) { return `${PREFIX}${tabId}`; }
function serializeTab(tabId, task) {
  const previous = tabWrites.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  tabWrites.set(tabId, next);
  next.finally(() => { if (tabWrites.get(tabId) === next) tabWrites.delete(tabId); }).catch(() => {});
  return next;
}
async function readPage(tabId) {
  const key = getStorageKey(tabId); const data = await chrome.storage.session.get(key);
  return data[key] || { url: '', visit: crypto.randomUUID(), items: [], hidden: [], mappings: {}, contexts: {} };
}
async function writePage(tabId, page) {
  await chrome.storage.session.set({ [getStorageKey(tabId)]: page });
  const items = D.withoutManifestSegments(page.items).filter(item => !page.hidden.includes(item.id));
  const count = VidSnagHls.collapseDetections(items).length;
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc4505' });
}
async function resetPage(tabId, url, force = false, documentId = '', navigationAt = Date.now()) {
  return serializeTab(tabId, async () => {
    const page = await readPage(tabId);
    // Content observations and onCommitted can arrive in either order. The
    // same committed document must not erase its already-parsed manifest.
    if (page.url === url && documentId && page.documentId === documentId) {
      if (!page.navigationAt && navigationAt) { page.navigationAt = navigationAt; await writePage(tabId, page); }
      return;
    }
    if (!force && page.url === url) return;
    await writePage(tabId, { url, documentId, navigationAt, visit: crypto.randomUUID(), items: [], hidden: [], mappings: {}, contexts: {} });
  });
}
function cleanContext(input = {}, pageUrl = '') {
  const text = value => String(value || '').trim().slice(0, 255);
  const result = { sourcePageUrl: D.httpUrl(pageUrl || input.sourcePageUrl) };
  if (text(input.sourcePageTitle)) result.sourcePageTitle = text(input.sourcePageTitle);
  if (Object.hasOwn(input, 'mediaSourceUrl')) result.mediaSourceUrl = input.mediaSourceUrl === 'blob:' ? 'blob:' : D.httpUrl(input.mediaSourceUrl, input.sourcePageUrl || pageUrl);
  for (const name of ['thumbnailUrl', 'poster']) {
    // An explicit empty candidate clears old generic page artwork. Header-only
    // observations omit these fields and must keep the existing video metadata.
    if (Object.hasOwn(input, name)) result[name] = D.thumbnailUrl(input[name], input.sourcePageUrl || pageUrl);
  }
  for (const name of ['durationSeconds', 'height']) { const value = Number(input[name]); if (Number.isFinite(value) && value > 0) result[name] = value; }
  const frame = String(input.sourcePreviewPoster || '');
  const sceneStart = Number(input.sourcePreviewSceneStart);
  if (result.mediaSourceUrl && frame.startsWith('data:image/jpeg;base64,') && D.thumbnailUrl(frame)
    && Number.isFinite(sceneStart) && result.durationSeconds > 0
    && sceneStart >= result.durationSeconds * .35 && sceneStart <= result.durationSeconds * .8) {
    result.sourcePreviewPoster = frame;
    result.sourcePreviewSceneStart = sceneStart;
    result.sourcePreviewSceneScope = 'source';
  }
  if (Array.isArray(input.pageTitleCandidates)) result.pageTitleCandidates = input.pageTitleCandidates.slice(0, 24).map(item => ({ source: text(item.source), value: text(item.value) })).filter(item => item.value);
  if (input.pageEpisodeHint && Number.isInteger(input.pageEpisodeHint.seasonNumber) && Number.isInteger(input.pageEpisodeHint.episodeNumber)) result.pageEpisodeHint = { ...input.pageEpisodeHint, seasonNumber: Math.min(60, input.pageEpisodeHint.seasonNumber), episodeNumber: Math.min(999, input.pageEpisodeHint.episodeNumber) };
  result.pageIsTvContext = Boolean(result.pageEpisodeHint);
  const yt = input.youtubeMetadata;
  if (yt && /^[\w-]{6,20}$/.test(yt.videoId || '')) result.youtubeMetadata = { videoId: yt.videoId, title: text(yt.title), channelName: text(yt.channelName), thumbnailUrl: D.thumbnailUrl(yt.thumbnailUrl), durationSeconds: Number(yt.durationSeconds) > 0 ? Number(yt.durationSeconds) : null };
  return result;
}
function scopedContext(context = {}, item, sourceSpecific = false) {
  const result = { ...context };
  const duration = !item.manifest?.isMaster && Number(item.manifest?.durationSeconds) > 0 ? Number(item.manifest.durationSeconds) : null;
  const matches = (sourceSpecific && !Object.hasOwn(context, 'mediaSourceUrl'))
    || context.mediaSourceUrl === item.url
    || (item.mediaKind === 'youtube-page' && context.youtubeMetadata?.videoId === D.youtubeId(item.url))
    || (context.mediaSourceUrl === 'blob:' && duration && Math.abs(duration - Number(context.durationSeconds)) < 0.1);
  if (!matches) {
    for (const field of ['mediaSourceUrl', 'durationSeconds', 'height', 'thumbnailUrl', 'poster', 'youtubeMetadata', 'sourcePreviewPoster', 'sourcePreviewSceneStart', 'sourcePreviewSceneScope']) delete result[field];
  } else if (context.mediaSourceUrl && context.mediaSourceUrl === item.mediaSourceUrl && result.thumbnailUrl === '' && item.thumbnailUrl) {
    // A temporarily blank frame must not erase artwork already bound to this
    // same source. Unscoped page artwork still receives no such fallback.
    delete result.thumbnailUrl;
  }
  // Playlist duration belongs to this source; later page scans or response
  // headers must not replace it with the current player's trailer/movie data.
  if (duration) result.durationSeconds = duration;
  return result;
}
async function pageForObservation(page, tabId, frameId, topUrl, observed) {
  const changed = (topUrl && page.url && topUrl !== page.url)
    || (frameId === 0 && observed.documentId && page.documentId && observed.documentId !== page.documentId);
  if (!changed) return page;
  if (!observed.fromContent || !observed.documentId) return null;
  // A new document can report its playlist before onCommitted is delivered.
  // Confirm it against Chrome instead of discarding that one-time body, or
  // accepting a delayed message from the page that was just left.
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null);
  if (frame?.documentId !== observed.documentId) return null;
  const top = frameId === 0 ? frame : await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  if (!top?.documentId || D.httpUrl(top.url) !== topUrl) return null;
  return { url: topUrl, documentId: top.documentId, navigationAt: 0, visit: crypto.randomUUID(), items: [], hidden: [], mappings: {}, contexts: {} };
}
async function storeMedia(tabId, incoming, frameId = 0, topUrl = '', observed = {}) {
  return serializeTab(tabId, async () => {
    const page = await pageForObservation(await readPage(tabId), tabId, frameId, topUrl, observed);
    if (!page || (observed.startedAt && page.navigationAt && observed.startedAt < page.navigationAt)) return { ok: true, ignored: true };
    const url = D.httpUrl(incoming.url, incoming.sourcePageUrl || topUrl); if (!url) return { ok: true, ignored: true };
    const existing = page.items.find(item => item.url === url);
    const youtube = incoming.mediaKind === 'youtube-page' && D.youtubeId(url);
    const source = { ...existing, url, ...(youtube ? { mediaKind: 'youtube-page' } : {}) };
    const incomingContext = cleanContext(incoming, topUrl || page.url);
    let context = { ...scopedContext(page.contexts[frameId], source), ...scopedContext(incomingContext, source, true) };
    const type = youtube ? 'youtube' : D.mediaType(url, incoming.contentType, incoming.manifestText);
    if (!type || D.isYoutubeAuxiliaryResource(url, topUrl || page.url || context.sourcePageUrl, incoming.mediaKind)) return { ok: true, ignored: true };
    if (!page.url) page.url = topUrl || context.sourcePageUrl;
    if (frameId === 0 && observed.documentId && !page.documentId) page.documentId = observed.documentId;
    let manifest = existing?.manifest;
    try { if (type === 'hls' && incoming.manifestText) manifest = VidSnagHls.parseHlsManifest(incoming.manifestText, url, { durationSeconds: context.durationSeconds }); } catch { /* Detection still works if a manifest is incomplete. */ }
    // A newly parsed media playlist can establish which blob player this is.
    source.manifest = manifest;
    context = { ...scopedContext(page.contexts[frameId], source), ...scopedContext(incomingContext, source, true) };
    const incomingContentType = String(incoming.contentType || '').slice(0, 200);
    const contentType = incomingContentType.split(';')[0].trim().toLowerCase() === 'video/unknown'
      ? existing?.contentType || incomingContentType : incomingContentType || existing?.contentType || '';
    const item = {
      ...existing, ...context, id: existing?.id || crypto.randomUUID(), url, type: type === 'hls' ? 'hls' : 'file',
      mediaKind: youtube ? 'youtube-page' : type === 'hls' ? 'hls-manifest' : type === 'dash' ? 'dash-manifest' : 'video',
      streamType: type === 'hls' || type === 'dash' ? type : null,
      filename: (() => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; } })(),
      contentType,
      contentLength: Number(incoming.contentLength) > 0 ? Number(incoming.contentLength) : existing?.contentLength || 0,
      requestHeaders: { ...(existing?.requestHeaders || {}), ...D.sanitizeHeaders(incoming.requestHeaders) },
      requestHeadersOrigin: new URL(url).origin,
      detectedAt: existing?.detectedAt || Date.now(), frameId,
      ...(manifest ? { manifest, durationSeconds: manifest.durationSeconds || context.durationSeconds || existing?.durationSeconds || null } : {}),
    };
    if (existing) page.items[page.items.indexOf(existing)] = item; else if (page.items.length < MAX_ITEMS_PER_TAB) page.items.push(item);
    await writePage(tabId, page); return { ok: true, item };
  });
}
function localApiBase(candidate) {
  try { const url = new URL(candidate); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : API_BASE; } catch { return API_BASE; }
}
async function appRequest(path, body, apiBase = API_BASE, method = 'POST') {
  const { appToken } = await chrome.storage.local.get('appToken');
  if (!appToken) throw new Error('Connect VidSnag before downloading.');
  const response = await fetch(`${apiBase}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appToken}`, 'X-Client': 'vidsnag-extension', 'X-Protocol-Version': '1', 'X-Extension-Version': chrome.runtime.getManifest().version }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || data.error || 'Could not start the download.'); error.status = response.status; throw error; }
  return data;
}
async function downloadMedia(message) {
  const key = `${message.tabId}:${message.mediaId}:${message.backend || 'auto'}`;
  if (pendingDownloads.has(key)) return pendingDownloads.get(key);
  const task = (async () => {
    const page = await readPage(message.tabId);
    const observed = D.withoutManifestSegments(page.items);
    const item = observed.find(value => value.id === message.mediaId);
    if (!item) throw new Error('This video is no longer on the page.');
    const apiBase = !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE;
    const existing = page.mappings[message.mediaId];
    if (existing && !String(existing).startsWith('browser:')) {
      // Desktop cancel/Undo can leave this mapping cancelled or absent. Read
      // the extension bridge; /api/jobs is intentionally desktop-only.
      const { queue = [] } = await appRequest('/v1/queue', undefined, apiBase, 'GET');
      const job = queue.find(candidate => candidate.id === existing || candidate.jobId === existing);
      if (job && job.queueStatus !== 'cancelled' && job.status !== 'cancelled') return { ok: true, jobId: existing, backend: 'desktop', status: job.queueStatus || job.status };
    }
    const requestedUrl = D.httpUrl(message.payload?.mediaUrl);
    const choice = { ...item, url: requestedUrl, selection: message.payload?.selection || {} };
    const source = VidSnagBrowserDownloads.resolveSource(choice, observed);
    if (source && source.url !== requestedUrl) throw new Error('The selected file no longer matches this video. Choose it again.');
    if (message.backend === 'browser' && !source) throw new Error('This video needs the desktop app. Chrome can save standalone MP4 and WebM files.');
    const useBrowser = message.backend !== 'desktop' && source && browserDownloads.available;
    const result = useBrowser
      ? await browserDownloads.start({ source, pageUrl: page.url, title: message.payload?.title || page.titles?.[message.mediaId] })
      : { ...await appRequest('/v1/jobs', message.payload, apiBase), backend: 'desktop' };
    await serializeTab(message.tabId, async () => {
      const current = await readPage(message.tabId);
      if (current.visit === page.visit) {
        current.mappings[message.mediaId] = result.jobId;
        if (useBrowser) current.mappings[source.id] = result.jobId;
        await writePage(message.tabId, current);
      }
    });
    return { ok: true, ...result };
  })();
  pendingDownloads.set(key, task);
  try { return await task; } finally { pendingDownloads.delete(key); }
}
function trustedPage(sender) { return sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL('')); }
registerPreviewOriginSessions({ readPage, trustedPage });
async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (['STORE_DETECTED_MEDIA', 'PAGE_CONTEXT'].includes(message.cmd) && Number.isInteger(tabId) && sender.frameId === 0) {
    const sourcePageUrl = D.httpUrl((message.media || message.context)?.sourcePageUrl);
    // A queued observation can outlive a same-document navigation. Compare
    // top-frame observations with the current tab URL: sender.url retains the
    // original document URL after pushState. Child frames have their own URLs
    // and continue through the frame/document validation below.
    if (sourcePageUrl && sender.tab.url && sourcePageUrl !== D.httpUrl(sender.tab.url)) return { ok: true, ignored: true };
  }
  if (message.cmd === 'STORE_DETECTED_MEDIA' && Number.isInteger(tabId)) return storeMedia(tabId, message.media || {}, sender.frameId || 0, sender.tab.url, { documentId: sender.documentId, fromContent: true });
  if (message.cmd === 'PAGE_NAVIGATED' && Number.isInteger(tabId) && sender.frameId === 0) {
    const current = await chrome.tabs.get(tabId);
    const nextUrl = D.httpUrl(message.pageUrl);
    if (nextUrl && D.httpUrl(current.url) === nextUrl) await resetPage(tabId, nextUrl, false, sender.documentId);
    return { ok: true };
  }
  if (message.cmd === 'PAGE_CONTEXT' && Number.isInteger(tabId)) return serializeTab(tabId, async () => {
    const page = await pageForObservation(await readPage(tabId), tabId, sender.frameId || 0, sender.tab.url, { documentId: sender.documentId, fromContent: true });
    if (!page) return { ok: true, ignored: true };
    if (!page.url) page.url = sender.tab.url;
    if (sender.frameId === 0 && sender.documentId && !page.documentId) page.documentId = sender.documentId;
    const context = cleanContext(message.context, sender.tab.url);
    page.contexts[sender.frameId || 0] = context;
    page.items = page.items.map(item => item.frameId === (sender.frameId || 0) ? { ...item, ...scopedContext(context, item) } : item);
    await writePage(tabId, page); return { ok: true };
  });
  if (!trustedPage(sender)) return { ok: false, error: 'Unavailable to this page.' };
  if (message.cmd === 'STORE_MEDIA_PREVIEW_METADATA') {
    if (!Number.isInteger(message.tabId) || !Number.isFinite(message.durationSeconds) || message.durationSeconds <= 0) return { ok: false };
    return serializeTab(message.tabId, async () => {
      const page = await readPage(message.tabId);
      const item = page.items.find(value => value.id === message.mediaId && value.url === message.mediaUrl);
      if (page.visit !== message.visit || !item || item.mediaKind === 'youtube-page') return { ok: false, ignored: true };
      // The bounded preview read belongs to this exact source and visit. Keep
      // an observed media playlist authoritative; enrich a header-only/master row.
      if (!item.manifest || item.manifest.isMaster) item.durationSeconds = message.durationSeconds;
      if (!item.height && Number.isInteger(message.height) && message.height > 0 && message.height <= 16384) item.height = message.height;
      await writePage(message.tabId, page);
      return { ok: true };
    });
  }
  if (message.cmd === 'STORE_MEDIA_PREVIEW_POSTER') {
    const poster = typeof message.poster === 'string' && message.poster.length <= 20480
      && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(message.poster) ? message.poster : '';
    if (!Number.isInteger(message.tabId) || !poster) return { ok: false };
    return serializeTab(message.tabId, async () => {
      const page = await readPage(message.tabId);
      const item = page.items.find(value => value.id === message.mediaId && value.url === message.mediaUrl);
      if (page.visit !== message.visit || !item || item.mediaKind === 'youtube-page') return { ok: false, ignored: true };
      item.sourcePreviewPoster = poster;
      if (Number.isFinite(message.sceneStart) && message.sceneStart >= 0) item.sourcePreviewSceneStart = message.sceneStart;
      item.sourcePreviewSceneScope = message.sceneScope === 'prefix' ? 'prefix' : 'source';
      await writePage(message.tabId, page);
      return { ok: true };
    });
  }
  if (['GET_PAGE_VIDEO_PREVIEW', 'CANCEL_PAGE_VIDEO_PREVIEW'].includes(message.cmd)) {
    if (!Number.isInteger(message.tabId) || !/^[a-zA-Z0-9-]{8,80}$/.test(message.requestId || '')
      || (message.cmd === 'GET_PAGE_VIDEO_PREVIEW' && !['quick', 'full'].includes(message.phase))) return { ok: false, status: 'unavailable' };
    const page = await readPage(message.tabId);
    const item = page.items.find(value => value.id === message.mediaId);
    const videoId = item && D.youtubeId(item.url);
    if (!videoId || item.mediaKind !== 'youtube-page') return { ok: false, status: 'unavailable' };
    const result = await chrome.tabs.sendMessage(message.tabId, {
      cmd: message.cmd, requestId: message.requestId, phase: message.phase, videoId,
    }, { frameId: item.frameId || 0 }).catch(() => ({ ok: false, status: 'unavailable' }));
    if (message.cmd === 'CANCEL_PAGE_VIDEO_PREVIEW') return { ok: true };
    const current = await readPage(message.tabId);
    if (current.visit !== page.visit || !result?.ok || typeof result.sourcePreviewDataUrl !== 'string'
      || result.sourcePreviewDataUrl.length > 1400000 || !/^data:video\/webm;base64,[A-Za-z0-9+/=]+$/.test(result.sourcePreviewDataUrl)) return { ok: false, status: 'unavailable' };
    return { ok: true, status: 'ready', sourcePreviewDataUrl: result.sourcePreviewDataUrl,
      complete: result.complete === true, durationSeconds: Math.max(0, Math.min(10, Number(result.durationSeconds) || 0)) };
  }
  if (message.cmd === 'GET_TAB_MEDIA') {
    const page = await readPage(message.tabId);
    const rawItems = D.withoutManifestSegments(page.items).filter(item => !page.hidden.includes(item.id));
    const browser = await browserDownloads.snapshot(rawItems, page.mappings);
    return { ok: true, items: page.showAll ? rawItems : VidSnagHls.collapseDetections(rawItems), rawItems, mappings: browser.mappings, browserQueue: browser.queue, visit: page.visit, showAll: Boolean(page.showAll), titles: page.titles || {} };
  }
  if (['HIDE_MEDIA', 'SHOW_ALL_MEDIA', 'RENAME_MEDIA'].includes(message.cmd)) return serializeTab(message.tabId, async () => {
    const page = await readPage(message.tabId);
    if (message.cmd === 'HIDE_MEDIA') page.hidden = [...new Set([...page.hidden, ...(message.mediaIds || [message.mediaId])])];
    if (message.cmd === 'SHOW_ALL_MEDIA') { page.showAll = true; page.hidden = []; }
    if (message.cmd === 'RENAME_MEDIA') { page.titles ||= {}; page.titles[message.mediaId] = String(message.title || '').trim().slice(0, 255); }
    await writePage(message.tabId, page); return { ok: true };
  });
  if (message.cmd === 'DOWNLOAD_MEDIA') return downloadMedia(message);
  if (message.cmd === 'BROWSER_DOWNLOAD_ACTION') return browserDownloads.action(message.jobId, message.action);
  if (message.cmd === 'REQUEST_MEDIA_PREVIEW') {
    const page = await readPage(message.tabId);
    if (!page.items.some(item => item.id === message.mediaId) || !Object.values(page.mappings).includes(message.jobId)) return { ok: false, error: 'This video is no longer linked to a download.' };
    const result = await appRequest(`/v1/jobs/${encodeURIComponent(message.jobId)}/preview`, {}, !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE);
    return { ok: true, ...result };
  }
  if (message.cmd === 'RETRY_MEDIA' || message.cmd === 'REFRESH_MEDIA_SOURCE') {
    const page = await readPage(message.tabId);
    if (!page.items.some(item => item.id === message.mediaId)) return { ok: false, error: 'The video is no longer on this page.' };
    const action = message.cmd === 'RETRY_MEDIA' ? 'retry' : 'refresh-source';
    const result = await appRequest(`/v1/jobs/${encodeURIComponent(message.jobId)}/${action}`, action === 'retry' ? {} : message.payload, !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE);
    const jobId = result.jobId || result.id || message.jobId;
    await serializeTab(message.tabId, async () => { const current = await readPage(message.tabId); if (current.visit === page.visit) { current.mappings[message.mediaId] = jobId; await writePage(message.tabId, current); } });
    return { ok: true, ...result, jobId };
  }
  if (message.cmd === 'CREATE_STREAM_SESSION') {
    const id = crypto.randomUUID(); const value = message.session || {};
    const sourceUrl = D.httpUrl(value.sourceUrl); if (!sourceUrl) return { ok: false, error: 'Invalid video URL.' };
    await chrome.storage.session.set({ [`vidsnag:preview:${id}`]: { sourceUrl, title: String(value.title || '').slice(0, 255), declaredType: value.declaredType, sourcePageUrl: D.httpUrl(value.sourcePageUrl), requestHeaders: D.sanitizeHeaders(value.requestHeaders), createdAt: Date.now() } });
    return { ok: true, sessionId: id };
  }
  if (message.cmd === 'GET_STREAM_SESSION') {
    const key = `vidsnag:preview:${String(message.sessionId)}`; const result = await chrome.storage.session.get(key); const session = result[key];
    if (!session || Date.now() - session.createdAt > 600000) { await chrome.storage.session.remove(key); return { ok: false }; }
    return { ok: true, session };
  }
  return { ok: false };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handleMessage(message || {}, sender).then(respond).catch(error => respond({ ok: false, error: error.message })); return true;
});
// Register synchronously so Chrome can wake a suspended worker. Progress bytes
// are read on popup snapshots, never by keeping this worker alive with a timer.
chrome.downloads?.onChanged.addListener(delta => { browserDownloads.changed(delta).catch(() => {}); });
chrome.downloads?.onErased.addListener(id => { browserDownloads.erased(id).catch(() => {}); });
chrome.webNavigation.onCommitted.addListener(details => { if (details.frameId === 0) resetPage(details.tabId, details.url, true, details.documentId, details.timeStamp).catch(() => {}); });
chrome.webNavigation.onHistoryStateUpdated.addListener(details => { if (details.frameId === 0) resetPage(details.tabId, details.url, false, details.documentId, details.timeStamp).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(getStorageKey(tabId)); });
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  if (details.tabId < 0) return;
  inFlightRequests.set(details.requestId, { url: details.url, headers: D.sanitizeHeaders(details.requestHeaders), time: details.timeStamp || Date.now(), documentId: details.documentId });
  if (inFlightRequests.size > 1000) inFlightRequests.delete(inFlightRequests.keys().next().value);
}, { urls: ['http://*/*', 'https://*/*'] }, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.tabId < 0 || details.statusCode >= 400) return;
  const headers = Object.fromEntries((details.responseHeaders || []).map(item => [item.name.toLowerCase(), item.value]));
  if (!D.mediaType(details.url, headers['content-type'])) return;
  const captured = inFlightRequests.get(details.requestId);
  chrome.tabs.get(details.tabId).then(tab => storeMedia(details.tabId, { url: details.url, contentType: headers['content-type'], contentLength: Number(headers['content-length']), requestHeaders: captured?.url === details.url ? captured.headers : {}, sourcePageTitle: tab.title }, details.frameId, tab.url, { documentId: details.documentId || captured?.documentId, startedAt: captured?.time })).catch(() => {});
}, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders']);
for (const event of [chrome.webRequest.onCompleted, chrome.webRequest.onErrorOccurred]) event.addListener(details => { inFlightRequests.delete(details.requestId); }, { urls: ['http://*/*', 'https://*/*'] });
