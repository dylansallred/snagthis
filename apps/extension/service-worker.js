/* Download ownership and ephemeral page detections survive popup closure. */
importScripts('js/build-config.js', 'shared/hls.js', 'js/detection.js', 'js/preview-origin.js', 'js/browser-downloads.js');
// The toolbar icon and badge follow the shared accent colour.
importScripts('shared/accents.js', 'js/accent-icon.js');
const D = SnagThisDetection;
const browserDownloads = SnagThisBrowserDownloads.createManager({ chrome });
const API_BASE = 'http://127.0.0.1:49732';
const MAX_ITEMS_PER_TAB = 60;
const MAX_IN_FLIGHT = 200;
const MAX_OBSERVED_REQUESTS = 200;
const OBSERVED_REQUEST_MS = 120000;
const TRIMMED_SEGMENT_LIST = 200;
// A playlist answered to a POST exists only as the text the page received.
// storage.session is shared by every tab, so these copies are bounded.
const MAX_MANIFEST_SNAPSHOT = 2 * 1024 * 1024;
const MAX_PAGE_SNAPSHOTS = 4 * 1024 * 1024;
const NETWORK_URLS = ['http://*/*', 'https://*/*'];
// Detection needs media elements, fetch/XHR playlists and plugin-style loads.
// Pages, scripts, styles, images and fonts never need their headers read.
const REQUEST_TYPES = ['media', 'xmlhttprequest', 'other'];
const DRM_MESSAGE = "This video is protected by DRM. SnagThis can't save it.";
const YOUTUBE_STORE_MESSAGE = "SnagThis doesn't save videos from this site.";
const inFlightRequests = new Map();
const observedRequests = new Map();
const removedTabs = new Set();
const prerenderKeys = new Map();
const tabWrites = new Map();
const pendingDownloads = new Map();
const PREFIX = 'snagthis:tab:';
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
// A prerendered document keeps its detections apart until Chrome activates it.
function getStorageKey(tabId, slot = '') { return slot ? `${PREFIX}${tabId}:prerender:${slot}` : `${PREFIX}${tabId}`; }
function emptyPage(values = {}) { return { url: '', visit: crypto.randomUUID(), items: [], hidden: [], mappings: {}, contexts: {}, ...values }; }
function logFailure(error) { console.warn('SnagThis could not record page media.', error); }
function serializeTab(tabId, task) {
  const previous = tabWrites.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  tabWrites.set(tabId, next);
  next.finally(() => { if (tabWrites.get(tabId) === next) tabWrites.delete(tabId); }).catch(() => {});
  return next;
}
async function readPage(tabId, slot = '') {
  const key = getStorageKey(tabId, slot); const data = await chrome.storage.session.get(key);
  return data[key] || emptyPage();
}
function trimSegmentLists(page) {
  // Snapshots are the largest values and go first.
  for (const item of page.items) delete item.manifestSnapshot;
  for (const item of page.items) {
    const manifest = item.manifest;
    if (!manifest || (manifest.segmentUrls || []).length <= TRIMMED_SEGMENT_LIST) continue;
    // Keep the playlist identity (an array) and its segment directories, so
    // later piece requests are still recognised without thousands of URLs.
    const bases = new Set(manifest.segmentBases || []);
    for (const url of manifest.segmentUrls) { const path = url.split(/[?#]/)[0]; bases.add(path.slice(0, path.lastIndexOf('/') + 1)); if (bases.size >= 16) break; }
    manifest.segmentBases = [...bases];
    manifest.segmentUrls = [];
  }
}
async function freeSessionSpace(key, page) {
  trimSegmentLists(page);
  // storage.session has one quota for every tab. Evict the least recently
  // updated half of the other pages and expired player sessions.
  const all = await chrome.storage.session.get(null);
  const others = Object.entries(all).filter(([name]) => name !== key && name.startsWith(PREFIX))
    .sort((first, second) => (first[1]?.updatedAt || 0) - (second[1]?.updatedAt || 0));
  const evicted = others.slice(0, Math.ceil(others.length / 2)).map(([name]) => name);
  const expired = Object.entries(all).filter(([name, value]) => name.startsWith('snagthis:preview:') && !(Date.now() - value?.createdAt <= 600000)).map(([name]) => name);
  if (evicted.length || expired.length) await chrome.storage.session.remove([...evicted, ...expired]);
  for (const name of evicted) {
    const tabId = Number(/^snagthis:tab:(\d+)$/.exec(name)?.[1]);
    if (tabId) chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
}
async function writePage(tabId, page, slot = '') {
  // A write queued before its tab closed must not recreate the removed key.
  if (removedTabs.has(tabId)) return;
  const key = getStorageKey(tabId, slot);
  page.updatedAt = Date.now();
  try { await chrome.storage.session.set({ [key]: page }); }
  catch (error) {
    if (!/quota/i.test(String(error?.message || error))) throw error;
    console.warn('SnagThis session storage is full; trimming older detections and retrying.', error);
    await freeSessionSpace(key, page);
    if (removedTabs.has(tabId)) return;
    await chrome.storage.session.set({ [key]: page });
  }
  if (slot) { if (!prerenderKeys.has(tabId)) prerenderKeys.set(tabId, new Set()); prerenderKeys.get(tabId).add(key); return; }
  const count = listedItems(page).length;
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: SnagThisAccentIcon.badgeColor() });
}
// An in-page anchor or media-time fragment (#comments, #t=90) stays on the
// same video. Hash routes (#/watch/2, #!/2) are navigations.
function fragmentOnlyChange(previous, next) {
  try {
    const before = new URL(previous); const after = new URL(next);
    if (before.hash === after.hash || [before.hash, after.hash].some(hash => /^#[/!]/.test(hash))) return false;
    before.hash = ''; after.hash = '';
    return before.href === after.href;
  } catch { return false; }
}
function visibleItems(page) {
  return D.markProtected(D.withoutManifestSegments(page.items), page.contexts)
    .filter(item => !page.hidden.includes(item.id) && (page.showAll || (!D.isJunkMedia(item, page.mappings) && !D.isStreamFragment(item, page.items, page.mappings))));
}
// Rows as the popup lists them: grouped streams, and one row for a
// DRM-protected title in place of its manifests and pieces.
function listedItems(page, items = visibleItems(page)) {
  return page.showAll ? items : D.withProtectedRow(SnagThisHls.collapseDetections(items), page);
}
// The popup polls every second; it learns that a snapshot exists, and the
// worker attaches the text itself when a job is sent.
function popupItem({ manifestSnapshot, ...item }) { return manifestSnapshot ? { ...item, hasManifestSnapshot: true } : item; }
function withManifestSnapshot(payload, items) {
  const result = { ...payload }; delete result.manifestText;
  const mediaUrl = D.httpUrl(result.mediaUrl);
  const owner = mediaUrl && items.find(item => item.url === mediaUrl && item.manifestSnapshot);
  if (owner) result.manifestText = owner.manifestSnapshot;
  return result;
}
// Newer snapshots win; older ones on the same page are dropped past the budget.
function boundSnapshots(page, keep) {
  let total = keep?.manifestSnapshot?.length || 0;
  const others = page.items.filter(item => item !== keep && item.manifestSnapshot).sort((first, second) => (second.detectedAt || 0) - (first.detectedAt || 0));
  for (const item of others) {
    if (total + item.manifestSnapshot.length > MAX_PAGE_SNAPSHOTS) delete item.manifestSnapshot;
    else total += item.manifestSnapshot.length;
  }
}
function withoutFragment(url) { return String(url || '').split('#')[0]; }
async function resetPageNow(tabId, url, force = false, documentId = '', navigationAt = Date.now()) {
  const page = await readPage(tabId);
  // Content observations and onCommitted can arrive in either order. The
  // same committed document must not erase its already-parsed manifest.
  if (page.url === url && documentId && page.documentId === documentId) {
    if (!page.navigationAt && navigationAt) { page.navigationAt = navigationAt; await writePage(tabId, page); }
    return;
  }
  if (!force && page.url === url) return;
  // Keep one-time manifest bodies and download mappings; only the URL moves.
  if (!force && fragmentOnlyChange(page.url, url)) { page.url = url; await writePage(tabId, page); return; }
  await writePage(tabId, emptyPage({ url, documentId, navigationAt }));
}
function resetPage(tabId, url, force = false, documentId = '', navigationAt = Date.now()) {
  return serializeTab(tabId, () => resetPageNow(tabId, url, force, documentId, navigationAt));
}
// Slots are tracked in memory so ordinary navigation never reads all of
// storage.session. After a worker restart, quota eviction still reclaims them.
function takePrerenderSlots(tabId) {
  const keys = [...(prerenderKeys.get(tabId) || [])];
  prerenderKeys.delete(tabId);
  return keys;
}
function startPrerender(details) {
  return serializeTab(details.tabId, async () => {
    const key = getStorageKey(details.tabId, details.documentId);
    const stored = (await chrome.storage.session.get(key))[key];
    if (stored) return;
    await writePage(details.tabId, emptyPage({ url: D.httpUrl(details.url), documentId: details.documentId, navigationAt: details.timeStamp }), details.documentId);
  });
}
function commitPage(details) {
  return serializeTab(details.tabId, async () => {
    const key = details.documentId ? getStorageKey(details.tabId, details.documentId) : '';
    const prepared = key ? (await chrome.storage.session.get(key))[key] : null;
    // Activation commits the prerendered document again (same documentId,
    // non-zero frameId). Its detections become the tab's page.
    if (prepared) await writePage(details.tabId, { ...prepared, url: details.url, documentId: details.documentId });
    else await resetPageNow(details.tabId, details.url, true, details.documentId, details.timeStamp);
    const stale = takePrerenderSlots(details.tabId);
    if (stale.length) await chrome.storage.session.remove(stale);
  });
}
async function outermostFrame(tabId, frameId) {
  let current = frameId;
  let frame = await chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null);
  for (let depth = 0; frame && frame.parentFrameId >= 0 && depth < 16; depth++) {
    current = frame.parentFrameId;
    frame = await chrome.webNavigation.getFrame({ tabId, frameId: current }).catch(() => null);
  }
  return frame ? { ...frame, frameId: current } : null;
}
// Chrome's recommended identity: frameType/documentLifecycle, not frameId 0.
// A prerendered page's outermost frame has a non-zero frameId and keeps it
// after activation. Returns null for cached or unloading documents.
async function observationScope(tabId, { frameId = 0, frameType, documentLifecycle }) {
  if (documentLifecycle && !['active', 'prerender'].includes(documentLifecycle)) return null;
  let outermost = frameType ? frameType === 'outermost_frame' : frameId === 0;
  if (!frameType && frameId !== 0) outermost = (await chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null))?.parentFrameId === -1;
  if (documentLifecycle !== 'prerender') return { outermost, slot: '', url: '' };
  const top = await outermostFrame(tabId, frameId);
  if (!top?.documentId || top.documentLifecycle === 'active') return top?.documentId ? { outermost, slot: '', url: '' } : null;
  return { outermost, slot: top.documentId, url: D.httpUrl(top.url) };
}
function isOutermostEvent(details) { return details.frameType ? details.frameType === 'outermost_frame' : details.frameId === 0; }
function rememberRequest(tabId, url, headers) {
  const key = `${tabId} ${url}`;
  observedRequests.delete(key);
  observedRequests.set(key, { headers, time: Date.now() });
  if (observedRequests.size > MAX_OBSERVED_REQUESTS) observedRequests.delete(observedRequests.keys().next().value);
}
function observedRequest(tabId, url) {
  const entry = observedRequests.get(`${tabId} ${url}`);
  return entry && Date.now() - entry.time <= OBSERVED_REQUEST_MS ? entry : null;
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
  // The frame's player uses DRM (EME). Kept per frame; never copied onto items.
  const locked = input.protection;
  if (locked && typeof locked === 'object') {
    const seconds = Number(locked.durationSeconds);
    result.protection = {
      keySystem: ['widevine', 'playready', 'fairplay', 'clearkey'].includes(locked.keySystem) ? locked.keySystem : '',
      signal: ['mediakeys', 'encrypted', 'init'].includes(locked.signal) ? locked.signal : 'mediakeys',
      siteName: String(locked.siteName || '').trim().slice(0, 80),
      mediaSourceUrl: locked.mediaSourceUrl === 'blob:' ? 'blob:' : D.httpUrl(locked.mediaSourceUrl, input.sourcePageUrl || pageUrl),
      durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      poster: D.thumbnailUrl(locked.poster, input.sourcePageUrl || pageUrl),
    };
  }
  const shown = input.presentation;
  if (shown && typeof shown === 'object') {
    const size = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(100000, Math.round(Number(value))) : 0);
    result.presentation = { width: size(shown.width), height: size(shown.height), loop: shown.loop === true, muted: shown.muted === true, autoplay: shown.autoplay === true };
  }
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
  delete result.protection;
  const duration = !item.manifest?.isMaster && Number(item.manifest?.durationSeconds) > 0 ? Number(item.manifest.durationSeconds) : null;
  const matches = (sourceSpecific && !Object.hasOwn(context, 'mediaSourceUrl'))
    || context.mediaSourceUrl === item.url
    || (item.mediaKind === 'youtube-page' && context.youtubeMetadata?.videoId === D.youtubeId(item.url))
    || (context.mediaSourceUrl === 'blob:' && duration && Math.abs(duration - Number(context.durationSeconds)) < 0.1);
  if (!matches) {
    for (const field of ['mediaSourceUrl', 'durationSeconds', 'height', 'presentation', 'thumbnailUrl', 'poster', 'youtubeMetadata', 'sourcePreviewPoster', 'sourcePreviewSceneStart', 'sourcePreviewSceneScope']) delete result[field];
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
    || (observed.outermost && observed.documentId && page.documentId && observed.documentId !== page.documentId);
  if (!changed) return page;
  if (!observed.fromContent || !observed.documentId) return null;
  // A new document can report its playlist before onCommitted is delivered.
  // Confirm it against Chrome instead of discarding that one-time body, or
  // accepting a delayed message from the page that was just left.
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null);
  if (frame?.documentId !== observed.documentId) return null;
  const top = observed.outermost ? frame : await outermostFrame(tabId, frameId);
  if (!top?.documentId || D.httpUrl(top.url) !== topUrl) return null;
  return emptyPage({ url: topUrl, documentId: top.documentId, navigationAt: 0 });
}
async function pageFor(tabId, frameId, topUrl, observed) {
  if (!observed.slot) return pageForObservation(await readPage(tabId), tabId, frameId, topUrl, observed);
  const page = await readPage(tabId, observed.slot);
  page.url ||= topUrl; page.documentId ||= observed.slot;
  return page;
}
function evictOldest(page) {
  // Keep rows with a download; otherwise the oldest detection makes room.
  const candidates = page.items.filter(item => !page.mappings[item.id]).sort((first, second) => (first.detectedAt || 0) - (second.detectedAt || 0));
  const oldest = candidates[0];
  if (!oldest) return false;
  page.items = page.items.filter(item => item !== oldest);
  page.hidden = page.hidden.filter(id => id !== oldest.id);
  if (page.titles) delete page.titles[oldest.id];
  return true;
}
// Only a response Chrome itself delivered to this tab may carry request context
// or authorize a credentialed preview. Page messages are detection hints.
async function storeMedia(tabId, incoming, frameId = 0, topUrl = '', observed = {}) {
  return serializeTab(tabId, async () => {
    const page = await pageFor(tabId, frameId, topUrl, observed);
    if (!page || (observed.startedAt && page.navigationAt && observed.startedAt < page.navigationAt)) return { ok: true, ignored: true };
    const url = D.httpUrl(incoming.url, incoming.sourcePageUrl || topUrl); if (!url) return { ok: true, ignored: true };
    const existing = page.items.find(item => item.url === url);
    const network = observed.fromNetwork ? { headers: incoming.requestHeaders } : observedRequest(tabId, url);
    const youtube = incoming.mediaKind === 'youtube-page' && D.youtubeId(url);
    const source = { ...existing, url, ...(youtube ? { mediaKind: 'youtube-page' } : {}) };
    const incomingContext = cleanContext(incoming, topUrl || page.url);
    let context = { ...scopedContext(page.contexts[frameId], source), ...scopedContext(incomingContext, source, true) };
    const type = youtube ? 'youtube' : D.mediaType(url, incoming.contentType, incoming.manifestText);
    if (!type || D.isYoutubeAuxiliaryResource(url, topUrl || page.url || context.sourcePageUrl, incoming.mediaKind)) return { ok: true, ignored: true };
    // fMP4 pieces look like MP4 files. A listed piece is never a new video and
    // must not rewrite the whole page (and its playlist) once per segment.
    if (!existing && type === 'file' && !youtube && D.manifestComponent(url, page.items)) return { ok: true, ignored: true };
    if (!page.url) page.url = topUrl || context.sourcePageUrl;
    if (observed.outermost && observed.documentId && !page.documentId) page.documentId = observed.documentId;
    let manifest = existing?.manifest;
    let parsed = false;
    try {
      if (type === 'hls' && incoming.manifestText) { manifest = SnagThisHls.parseHlsManifest(incoming.manifestText, url, { durationSeconds: context.durationSeconds }); parsed = true; }
      else if (type === 'dash' && incoming.manifestText) { manifest = SnagThisHls.parseDashManifest(incoming.manifestText, url); parsed = true; }
    } catch { /* Detection still works if a manifest is incomplete. */ }
    // A newly parsed media playlist can establish which blob player this is.
    source.manifest = manifest;
    context = { ...scopedContext(page.contexts[frameId], source), ...scopedContext(incomingContext, source, true) };
    const incomingContentType = String(incoming.contentType || '').slice(0, 200);
    const contentType = incomingContentType.split(';')[0].trim().toLowerCase() === 'video/unknown'
      ? existing?.contentType || incomingContentType : incomingContentType || existing?.contentType || '';
    // How the page loaded it: a media element (or a direct load) plays a whole
    // file; page script fetching it usually feeds pieces to a stream player.
    const requestType = String(incoming.requestType || '');
    const reported = ['element', 'script'].includes(incoming.delivery) ? incoming.delivery
      : ['media', 'main_frame', 'sub_frame', 'object'].includes(requestType) ? 'element' : requestType === 'xmlhttprequest' ? 'script' : '';
    const delivery = existing?.delivery === 'element' ? 'element' : reported || existing?.delivery || '';
    // A 206 answer's Content-Length is one byte range; the total follows the slash.
    const range = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(incoming.contentRange || '').trim());
    const rangeTotal = range && range[3] !== '*' ? Number(range[3]) : 0;
    const item = {
      ...existing, ...context, id: existing?.id || crypto.randomUUID(), url, type: type === 'hls' ? 'hls' : 'file',
      mediaKind: youtube ? 'youtube-page' : type === 'hls' ? 'hls-manifest' : type === 'dash' ? 'dash-manifest' : 'video',
      streamType: type === 'hls' || type === 'dash' ? type : null,
      filename: (() => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; } })(),
      contentType,
      contentLength: rangeTotal || (Number(incoming.contentLength) > 0 ? Number(incoming.contentLength) : existing?.contentLength || 0),
      ...(delivery ? { delivery } : {}),
      ...(range && delivery === 'script' ? { rangeRequested: true } : {}),
      requestHeaders: { ...(existing?.requestHeaders || {}), ...D.sanitizeHeaders(network?.headers) },
      requestHeadersOrigin: new URL(url).origin,
      networkObserved: Boolean(existing?.networkObserved || network),
      detectedAt: existing?.detectedAt || Date.now(), frameId,
      ...(manifest ? { manifest, durationSeconds: manifest.durationSeconds || context.durationSeconds || existing?.durationSeconds || null } : {}),
    };
    // A GET of this URL makes it replayable; a POST answer is kept as text.
    const method = /^[A-Z]{3,7}$/.test(String(incoming.method || '')) ? incoming.method : '';
    if (method) item.requestMethod = method;
    if (method === 'GET') delete item.manifestSnapshot;
    else if (method && parsed && type === 'hls') {
      if (incoming.manifestText.length <= MAX_MANIFEST_SNAPSHOT) item.manifestSnapshot = incoming.manifestText;
      else delete item.manifestSnapshot;
    }
    if (item.manifestSnapshot) boundSnapshots(page, item);
    // A URL that only this frame's Service Worker answers cannot be replayed.
    // Chrome delivering the same URL to the tab itself proves it is fetchable.
    if (!item.networkObserved && (existing?.serviceWorkerServed || (page.serviceWorkerUrls || []).includes(withoutFragment(url)))) item.serviceWorkerServed = true;
    else delete item.serviceWorkerServed;
    if (parsed) {
      // Pieces seen before their playlist are dropped now, unless downloading.
      const pieces = new Set([...(manifest.segmentUrls || []), ...(manifest.initializationUrls || [])]);
      page.items = page.items.filter(other => other === existing || other.mediaKind !== 'video' || page.mappings[other.id]
        || !(pieces.has(other.url) || SnagThisHls.matchesSegmentTemplate(other.url, manifest.segmentTemplates)));
    }
    if (existing) page.items[page.items.indexOf(existing)] = item;
    else {
      if (page.items.length >= MAX_ITEMS_PER_TAB && !evictOldest(page)) return { ok: true, ignored: true };
      page.items.push(item);
    }
    await writePage(tabId, page, observed.slot); return { ok: true, item };
  });
}
function localApiBase(candidate) {
  try { const url = new URL(candidate); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : API_BASE; } catch { return API_BASE; }
}
function bridgeHeaders(token) {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Client': 'snagthis-extension', 'X-Protocol-Version': '1', 'X-Extension-Version': chrome.runtime.getManifest().version };
}
async function appRequest(path, body, apiBase = API_BASE, method = 'POST') {
  const appToken = await ensureCurrentToken(apiBase);
  if (!appToken) throw new Error('Connect SnagThis before downloading.');
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, { method, headers: bridgeHeaders(appToken), ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  } catch (error) { throw new Error(D.friendlyError(error)); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || data.error || 'Could not start the download.'); error.status = response.status; throw error; }
  return data;
}

/* ── Pairing (docs/design/prototypes/pairing-simple: B · Pair from the desktop, with A's one-tap banner) ──
 * The worker owns the request, so it survives the popup closing. The request secret lives only in
 * storage.session, which is memory-only and limited to trusted extension contexts; the popup sees just
 * the public state. SnagThis surfaces its own approve card for a new request, so no snagthis:// link is
 * opened (and Chrome never asks "Open SnagThis?") while the app is running. */
const PAIRING_KEY = 'snagthis:pairing';
const PAIRING_SECRET_KEY = 'snagthis:pairing-secret';
// What automatic requests have been made: at most one per desktop "Waiting for Chrome…" session, none
// while a Deny block or the request limit applies.
const PAIRING_AUTO_KEY = 'snagthis:pairing-auto';
const PAIRING_POLL_MS = 1000;
const PAIRING_BLOCK_MS = 60 * 60_000;
const PAIRING_LIMIT_MS = 5 * 60_000;
const CONNECTED_BADGE_MS = 10_000;
let pairingPoll = null; let autoPairing = null;
let tokenUpgrade = null; let tokenUpgradeUnavailable = false;
async function bridgePost(apiBase, path, body, token) {
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: bridgeHeaders(token), body: JSON.stringify(body || {}), signal: AbortSignal.timeout(8000) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function pairingState() { return (await chrome.storage.session.get(PAIRING_KEY))[PAIRING_KEY] || null; }
async function autoMemory() { return (await chrome.storage.session.get(PAIRING_AUTO_KEY))[PAIRING_AUTO_KEY] || { sessions: [] }; }
async function rememberAuto(patch) { await chrome.storage.session.set({ [PAIRING_AUTO_KEY]: { ...(await autoMemory()), ...patch } }); }
async function refreshTabBadge(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const count = SnagThisHls.collapseDetections(visibleItems(await readPage(tabId))).length;
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' }).catch(() => {});
}
// While waiting, the toolbar badge repeats the four digits, so they stay visible if the popup closes.
async function pairingBadge(text, tabId) {
  await chrome.action.setBadgeBackgroundColor({ color: text === '✓' ? '#1f9d55' : SnagThisAccentIcon.badgeColor() }).catch(() => {});
  await chrome.action.setBadgeText({ text }).catch(() => {});
  if (Number.isInteger(tabId) && tabId >= 0) {
    if (text) await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
    else await refreshTabBadge(tabId).catch(() => {});
  }
  if (!text) await chrome.action.setBadgeBackgroundColor({ color: SnagThisAccentIcon.badgeColor() }).catch(() => {});
}
/** Only an explicit "Show SnagThis" opens the link; a running app comes forward by itself. */
async function openPairingApp() { await chrome.tabs.create({ url: 'snagthis://open/pair' }).catch(() => {}); }
async function finishPairing(state, status, token) {
  if (token) await chrome.storage.local.set({ appToken: token, appTokenVersion: 2 });
  await chrome.storage.session.remove([PAIRING_SECRET_KEY, ...(token ? ['snagthis:disconnected'] : [])]);
  // Kept (memory only) so a popup that was closed shows the outcome once, as one inline line.
  const next = { ...state, status, finishedAt: Date.now() };
  await chrome.storage.session.set({ [PAIRING_KEY]: next });
  if (status === 'denied') await rememberAuto({ blockedUntil: Date.now() + PAIRING_BLOCK_MS });
  await pairingBadge(status === 'connected' ? '✓' : '', state.tabId);
  // The ✓ is a brief trace, not a state: it goes after a few seconds or when the popup opens.
  if (status === 'connected') setTimeout(() => { pairingState().then(latest => { if (!latest || latest.requestId === state.requestId) pairingBadge('', state.tabId); }).catch(() => {}); }, CONNECTED_BADGE_MS);
  return next;
}
async function pollPairing() {
  for (;;) {
    const stored = await chrome.storage.session.get([PAIRING_KEY, PAIRING_SECRET_KEY]);
    const state = stored[PAIRING_KEY]; const ticket = stored[PAIRING_SECRET_KEY];
    if (!state || state.status !== 'waiting' || !ticket || ticket.requestId !== state.requestId) return;
    let result = null;
    try { result = await bridgePost(ticket.apiBase, '/v1/pair/status', { requestId: ticket.requestId, secret: ticket.secret }); } catch { /* SnagThis closed or busy; keep waiting until expiry. */ }
    const status = result?.status === 200 ? result.data.status : result?.status === 404 ? 'failed' : null;
    if (status === 'approved' && result.data.token) { await finishPairing(state, 'connected', result.data.token); return; }
    if (['denied', 'expired', 'conflict', 'cancelled', 'failed'].includes(status)) { await finishPairing(state, status); return; }
    if (status === 'approved') { await finishPairing(state, 'failed'); return; }
    if (Date.now() > state.expiresAt + 5000) { await finishPairing(state, 'expired'); return; }
    await new Promise(resolve => setTimeout(resolve, PAIRING_POLL_MS));
  }
}
function resumePairingPoll() {
  if (!pairingPoll) pairingPoll = pollPairing().catch(error => console.warn('SnagThis could not check its connection request.', error)).finally(() => { pairingPoll = null; });
  return pairingPoll;
}
async function startPairing(message) {
  const apiBase = !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE;
  const tabId = Number.isInteger(message.tabId) ? message.tabId : null;
  // One request at a time: a second Connect (or popup opening) joins the one already waiting.
  const current = await pairingState();
  if (current?.status === 'waiting' && current.expiresAt > Date.now()) { resumePairingPoll(); return current; }
  const secret = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  let result;
  try { result = await bridgePost(apiBase, '/v1/pair/request', { secret }); }
  catch { const state = { status: 'offline', finishedAt: Date.now(), auto: Boolean(message.auto) }; await chrome.storage.session.set({ [PAIRING_KEY]: state }); return state; }
  if (result.status !== 201 || !/^\d{4}$/.test(String(result.data.matchCode)) || !/^[0-9a-f]{32}$/.test(String(result.data.requestId))) {
    const status = result.status === 409 ? 'conflict' : result.status === 429 ? 'limited' : result.data.code === 'PAIRING_BLOCKED' ? 'blocked' : 'failed';
    if (status === 'blocked') await rememberAuto({ blockedUntil: Date.now() + Math.min(Math.max(Number(result.data.retryAfterMs) || PAIRING_BLOCK_MS, 0), PAIRING_BLOCK_MS) });
    if (status === 'limited') await rememberAuto({ limitedUntil: Date.now() + PAIRING_LIMIT_MS });
    const state = { status, finishedAt: Date.now(), auto: Boolean(message.auto) };
    await chrome.storage.session.set({ [PAIRING_KEY]: state });
    return state;
  }
  const expiresInMs = Math.min(Math.max(Number(result.data.expiresInMs) || 120000, 1000), 120000);
  const state = { status: 'waiting', requestId: result.data.requestId, matchCode: result.data.matchCode, expiresAt: Date.now() + expiresInMs, startedAt: Date.now(), tabId, auto: Boolean(message.auto) };
  await chrome.storage.session.set({ [PAIRING_KEY]: state, [PAIRING_SECRET_KEY]: { requestId: state.requestId, secret, apiBase } });
  await pairingBadge(state.matchCode, tabId);
  resumePairingPoll();
  return state;
}
/**
 * Pair from the desktop: when SnagThis shows "Waiting for Chrome…" and this browser isn't connected,
 * ask without a click. Never twice for the same waiting card, never while a request waits, never after
 * a Disconnect in this session, and never while SnagThis's Deny block or the request limit applies.
 * Approval is unchanged: the person still checks the digits and chooses Allow in SnagThis.
 */
function autoPair(message = {}) {
  if (autoPairing) return autoPairing;
  autoPairing = (async () => {
    const apiBase = !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE;
    if ((await chrome.storage.local.get('appToken')).appToken) return null;
    const current = await pairingState();
    if (current?.status === 'waiting' && current.expiresAt > Date.now()) { resumePairingPoll(); return current; }
    if ((await chrome.storage.session.get('snagthis:disconnected'))['snagthis:disconnected']) return null;
    const memory = await autoMemory();
    if ((memory.blockedUntil || 0) > Date.now() || (memory.limitedUntil || 0) > Date.now()) return null;
    let health = null;
    try {
      const response = await fetch(`${apiBase}/v1/health`, { headers: bridgeHeaders(), signal: AbortSignal.timeout(4000) });
      if (response.ok) health = await response.json();
    } catch { return null; }
    const session = health?.pairing?.listening === true ? String(health.pairing.session || '') : '';
    if (!/^[0-9a-f]{16}$/.test(session) || (memory.sessions || []).includes(session)) return null;
    await rememberAuto({ sessions: [...(memory.sessions || []), session].slice(-20) });
    return startPairing({ ...message, auto: true });
  })().finally(() => { autoPairing = null; });
  return autoPairing;
}
async function cancelPairing() {
  const stored = await chrome.storage.session.get([PAIRING_KEY, PAIRING_SECRET_KEY]);
  const ticket = stored[PAIRING_SECRET_KEY];
  if (ticket) await bridgePost(ticket.apiBase, '/v1/pair/cancel', { requestId: ticket.requestId, secret: ticket.secret }).catch(() => {});
  await chrome.storage.session.remove([PAIRING_KEY, PAIRING_SECRET_KEY]);
  await pairingBadge('', stored[PAIRING_KEY]?.tabId);
}
/** The popup has shown the outcome (one inline line); clear it and the badge so it never replays. */
async function acknowledgePairing() {
  const state = await pairingState();
  if (!state || state.status === 'waiting') return;
  await chrome.storage.session.remove(PAIRING_KEY);
  await pairingBadge('', state.tabId);
}
/** Extensions paired before per-extension tokens swap the shared credential for their own, once. */
async function ensureCurrentToken(apiBase = API_BASE) {
  const { appToken, appTokenVersion } = await chrome.storage.local.get(['appToken', 'appTokenVersion']);
  if (!appToken || appTokenVersion === 2 || tokenUpgradeUnavailable) return appToken || '';
  if (!tokenUpgrade) tokenUpgrade = (async () => {
    try {
      const result = await bridgePost(apiBase, '/v1/pair/upgrade', {}, appToken);
      if (result.status === 200 && typeof result.data.token === 'string' && result.data.token.length >= 32) {
        await chrome.storage.local.set({ appToken: result.data.token, appTokenVersion: 2 });
        return result.data.token;
      }
      if (result.status === 409) await chrome.storage.local.set({ appTokenVersion: 2 });
      // An older SnagThis without per-browser keys keeps the shared one; ask again after a restart.
      if (result.status === 404) tokenUpgradeUnavailable = true;
    } catch { /* SnagThis is closed; upgrade on the next request. */ }
    return appToken;
  })().finally(() => { tokenUpgrade = null; });
  return tokenUpgrade;
}
async function disconnectApp(message) {
  const apiBase = !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE;
  const appToken = await ensureCurrentToken(apiBase);
  if (appToken) {
    const result = await bridgePost(apiBase, '/v1/pair/disconnect', {}, appToken);
    if (result.status !== 200 && result.status !== 401) throw new Error(result.data.error || 'SnagThis could not disconnect this browser.');
  }
  await chrome.storage.local.remove(['appToken', 'appTokenVersion']);
  await chrome.storage.session.set({ 'snagthis:disconnected': true });
  return { ok: true };
}
pairingState().then(state => { if (state?.status === 'waiting') resumePairingPoll(); }).catch(() => {});
// The installed store build also asks when Chrome starts or the extension is added while SnagThis is
// waiting for it, so the desktop card can show the digits (the badge repeats them). Unpacked copies
// only ask from their popup, which knows which local app it talks to.
function autoPairOnStartup() { if (chrome.runtime.getManifest().update_url) autoPair({}).catch(() => {}); }
chrome.runtime.onStartup?.addListener(autoPairOnStartup);
async function downloadMedia(message) {
  const key = `${message.tabId}:${message.mediaId}:${message.backend || 'auto'}`;
  if (pendingDownloads.has(key)) return pendingDownloads.get(key);
  const task = (async () => {
    const page = await readPage(message.tabId);
    // DRM-protected media is never downloaded, handed to the desktop app or
    // saved by Chrome, whatever the popup asks for.
    const locked = listedItems({ ...page, showAll: false }, D.markProtected(D.withoutManifestSegments(page.items), page.contexts))
      .find(row => row.drm && (row.id === message.mediaId || (row.detectedStreams || []).some(stream => stream.id === message.mediaId)));
    if (locked) throw new Error(DRM_MESSAGE);
    const observed = D.withoutManifestSegments(page.items);
    const item = observed.find(value => value.id === message.mediaId);
    if (!item) throw new Error('This video is no longer on the page.');
    if (youtubeBlocked(item, message.payload)) throw new Error(YOUTUBE_STORE_MESSAGE);
    const apiBase = !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE;
    const existing = page.mappings[message.mediaId];
    if (existing && !String(existing).startsWith('browser:') && message.backend !== 'browser') {
      // Desktop cancel/Undo can leave this mapping cancelled or absent. Read
      // the extension bridge; /api/jobs is intentionally desktop-only. A closed
      // app only means the old job cannot be reused.
      const { queue = [] } = await appRequest('/v1/queue', undefined, apiBase, 'GET').catch(() => ({}));
      const job = queue.find(candidate => candidate.id === existing || candidate.jobId === existing);
      if (job && job.queueStatus !== 'cancelled' && job.status !== 'cancelled') return { ok: true, jobId: existing, backend: 'desktop', status: job.queueStatus || job.status };
    }
    const requestedUrl = D.httpUrl(message.payload?.mediaUrl);
    const choice = { ...item, url: requestedUrl, selection: message.payload?.selection || {} };
    const source = SnagThisBrowserDownloads.resolveSource(choice, observed);
    if (source && source.url !== requestedUrl) throw new Error('The selected file no longer matches this video. Choose it again.');
    if (message.backend === 'browser' && !source) throw new Error('This video needs the desktop app. Chrome can save standalone MP4 and WebM files.');
    const useBrowser = message.backend !== 'desktop' && source && browserDownloads.available;
    const result = useBrowser
      ? await browserDownloads.start({ source, pageUrl: page.url, title: message.payload?.title || page.titles?.[message.mediaId] })
      : { ...await appRequest('/v1/jobs', withManifestSnapshot(message.payload, observed), apiBase), backend: 'desktop' };
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
function youtubeBlocked(item, payload) {
  return SnagThisBuild.storeBuild && (item?.mediaKind === 'youtube-page' || [item?.url, payload?.mediaUrl].some(url => Boolean(D.youtubeId(url)) || D.isYoutubeMediaHost(url)));
}
async function injectContentScripts(tabId) {
  // Tabs opened before install/update have no (or an orphaned) content script.
  // Both files guard against running twice in one document.
  const target = { tabId, allFrames: true };
  await chrome.scripting.executeScript({ target, files: ['js/media-detector.js'], world: 'MAIN', injectImmediately: true });
  await chrome.scripting.executeScript({ target, files: ['js/content.js'], injectImmediately: true });
}
function trustedPage(sender) { return sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL('')); }
registerPreviewOriginSessions({ readPage, trustedPage });
async function handleContentMessage(message, sender, tabId) {
  const frameId = sender.frameId || 0;
  const scope = await observationScope(tabId, { frameId, documentLifecycle: sender.documentLifecycle });
  if (!scope) return { ok: true, ignored: true };
  const topUrl = scope.slot ? scope.url : sender.tab.url;
  if (['STORE_DETECTED_MEDIA', 'PAGE_CONTEXT'].includes(message.cmd) && scope.outermost && !scope.slot) {
    const sourcePageUrl = D.httpUrl((message.media || message.context)?.sourcePageUrl);
    // A queued observation can outlive a same-document navigation. Compare
    // top-frame observations with the current tab URL: sender.url retains the
    // original document URL after pushState. Child frames have their own URLs
    // and continue through the frame/document validation below.
    if (sourcePageUrl && sender.tab.url && sourcePageUrl !== D.httpUrl(sender.tab.url)) return { ok: true, ignored: true };
  }
  const observed = { documentId: sender.documentId, fromContent: true, outermost: scope.outermost, slot: scope.slot };
  if (message.cmd === 'STORE_DETECTED_MEDIA') return storeMedia(tabId, message.media || {}, frameId, topUrl, observed);
  if (message.cmd === 'SERVICE_WORKER_MEDIA') return markServiceWorkerMedia(tabId, message.urls, frameId, topUrl, observed);
  if (message.cmd === 'PAGE_NAVIGATED') {
    if (!scope.outermost || scope.slot) return { ok: true };
    const current = await chrome.tabs.get(tabId);
    const nextUrl = D.httpUrl(message.pageUrl);
    if (nextUrl && D.httpUrl(current.url) === nextUrl) await resetPage(tabId, nextUrl, false, sender.documentId);
    return { ok: true };
  }
  return serializeTab(tabId, async () => {
    const page = await pageFor(tabId, frameId, topUrl, observed);
    if (!page) return { ok: true, ignored: true };
    if (!page.url) page.url = topUrl;
    if (scope.outermost && sender.documentId && !page.documentId) page.documentId = sender.documentId;
    const context = cleanContext(message.context, topUrl);
    page.contexts[frameId] = context;
    page.items = page.items.map(item => item.frameId === frameId ? { ...item, ...scopedContext(context, item) } : item);
    await writePage(tabId, page, scope.slot); return { ok: true };
  });
}
function markServiceWorkerMedia(tabId, urls, frameId, topUrl, observed) {
  const served = [...new Set((Array.isArray(urls) ? urls : []).slice(0, 20).map(value => withoutFragment(D.httpUrl(value))).filter(Boolean))];
  if (!served.length) return { ok: true, ignored: true };
  return serializeTab(tabId, async () => {
    const page = await pageFor(tabId, frameId, topUrl, observed);
    if (!page) return { ok: true, ignored: true };
    if (!page.url) page.url = topUrl;
    // Remembered for media the page reports after this timing entry.
    page.serviceWorkerUrls = [...new Set([...(page.serviceWorkerUrls || []), ...served])].slice(-50);
    for (const item of page.items) if (!item.networkObserved && served.includes(withoutFragment(item.url))) item.serviceWorkerServed = true;
    await writePage(tabId, page, observed.slot); return { ok: true };
  });
}
async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (['STORE_DETECTED_MEDIA', 'PAGE_CONTEXT', 'PAGE_NAVIGATED', 'SERVICE_WORKER_MEDIA'].includes(message.cmd) && Number.isInteger(tabId)) return handleContentMessage(message, sender, tabId);
  if (!trustedPage(sender)) return { ok: false, error: 'Unavailable to this page.' };
  if (message.cmd === 'PAIR_START') return { ok: true, state: await startPairing(message) };
  if (message.cmd === 'PAIR_AUTO') return { ok: true, state: await autoPair(message) };
  if (message.cmd === 'PAIR_STATE') { const state = await pairingState(); if (state?.status === 'waiting') resumePairingPoll(); return { ok: true, state }; }
  if (message.cmd === 'PAIR_OPEN_APP') { const state = await pairingState(); if (state?.status === 'waiting') await openPairingApp(); return { ok: true }; }
  if (message.cmd === 'PAIR_CANCEL') { await cancelPairing(); return { ok: true }; }
  if (message.cmd === 'PAIR_ACK') { await acknowledgePairing(); return { ok: true }; }
  if (message.cmd === 'PAIR_UPGRADE') { await ensureCurrentToken(!chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE); return { ok: true }; }
  if (message.cmd === 'PAIR_DISCONNECT') return disconnectApp(message);
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
    const rawItems = visibleItems(page).map(popupItem);
    const browser = await browserDownloads.snapshot(rawItems, page.mappings);
    return { ok: true, items: listedItems(page, rawItems), rawItems, mappings: browser.mappings, browserQueue: browser.queue, visit: page.visit, showAll: Boolean(page.showAll), titles: page.titles || {} };
  }
  if (['HIDE_MEDIA', 'SHOW_ALL_MEDIA', 'RENAME_MEDIA'].includes(message.cmd)) return serializeTab(message.tabId, async () => {
    const page = await readPage(message.tabId);
    if (message.cmd === 'HIDE_MEDIA') page.hidden = [...new Set([...page.hidden, ...(message.mediaIds || [message.mediaId])])];
    if (message.cmd === 'SHOW_ALL_MEDIA') { page.showAll = true; page.hidden = []; }
    if (message.cmd === 'RENAME_MEDIA') { page.titles ||= {}; page.titles[message.mediaId] = String(message.title || '').trim().slice(0, 255); }
    await writePage(message.tabId, page); return { ok: true };
  });
  if (message.cmd === 'DOWNLOAD_MEDIA') return downloadMedia(message);
  if (message.cmd === 'PREPARE_PAGE') {
    if (!Number.isInteger(message.tabId)) return { ok: false };
    const tab = await chrome.tabs.get(message.tabId).catch(() => null);
    if (!/^https?:/.test(tab?.url || '')) return { ok: false };
    try { await injectContentScripts(message.tabId); return { ok: true }; } catch { return { ok: false }; }
  }
  if (message.cmd === 'BROWSER_DOWNLOAD_ACTION') return browserDownloads.action(message.jobId, message.action);
  if (message.cmd === 'REQUEST_MEDIA_PREVIEW') {
    const page = await readPage(message.tabId);
    if (!page.items.some(item => item.id === message.mediaId) || !Object.values(page.mappings).includes(message.jobId)) return { ok: false, error: 'This video is no longer linked to a download.' };
    const result = await appRequest(`/v1/jobs/${encodeURIComponent(message.jobId)}/preview`, {}, !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE);
    return { ok: true, ...result };
  }
  if (message.cmd === 'RETRY_MEDIA' || message.cmd === 'REFRESH_MEDIA_SOURCE') {
    const page = await readPage(message.tabId);
    const item = page.items.find(value => value.id === message.mediaId);
    if (!item) return { ok: false, error: 'The video is no longer on this page.' };
    if (message.cmd === 'REFRESH_MEDIA_SOURCE' && youtubeBlocked(item, message.payload)) return { ok: false, error: YOUTUBE_STORE_MESSAGE };
    const action = message.cmd === 'RETRY_MEDIA' ? 'retry' : 'refresh-source';
    const result = await appRequest(`/v1/jobs/${encodeURIComponent(message.jobId)}/${action}`, action === 'retry' ? {} : withManifestSnapshot(message.payload, page.items), !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE);
    const jobId = result.jobId || result.id || message.jobId;
    await serializeTab(message.tabId, async () => { const current = await readPage(message.tabId); if (current.visit === page.visit) { current.mappings[message.mediaId] = jobId; await writePage(message.tabId, current); } });
    return { ok: true, ...result, jobId };
  }
  if (message.cmd === 'CREATE_STREAM_SESSION') {
    const id = crypto.randomUUID(); const value = message.session || {};
    const sourceUrl = D.httpUrl(value.sourceUrl); if (!sourceUrl) return { ok: false, error: 'Invalid video URL.' };
    await chrome.storage.session.set({ [`snagthis:preview:${id}`]: { sourceUrl, title: String(value.title || '').slice(0, 255), declaredType: value.declaredType, sourcePageUrl: D.httpUrl(value.sourcePageUrl), requestHeaders: value.credentialed === true ? D.sanitizeHeaders(value.requestHeaders) : {}, credentialed: value.credentialed === true, createdAt: Date.now() } });
    return { ok: true, sessionId: id };
  }
  if (message.cmd === 'GET_STREAM_SESSION') {
    const key = `snagthis:preview:${String(message.sessionId)}`; const result = await chrome.storage.session.get(key); const session = result[key];
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
chrome.webNavigation.onCommitted.addListener(details => {
  if (!isOutermostEvent(details)) return;
  (details.documentLifecycle === 'prerender' ? startPrerender(details) : commitPage(details)).catch(logFailure);
});
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (isOutermostEvent(details) && details.documentLifecycle !== 'prerender') resetPage(details.tabId, details.url, false, details.documentId, details.timeStamp).catch(logFailure);
});
chrome.tabs.onRemoved.addListener(tabId => {
  removedTabs.add(tabId);
  if (removedTabs.size > 1000) removedTabs.delete(removedTabs.values().next().value);
  for (const key of observedRequests.keys()) if (key.startsWith(`${tabId} `)) observedRequests.delete(key);
  // Queued writes for this tab finish (and are dropped) before the removal.
  serializeTab(tabId, () => chrome.storage.session.remove([getStorageKey(tabId), ...takePrerenderSlots(tabId)])).catch(logFailure);
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') autoPairOnStartup();
  if (!['install', 'update'].includes(reason) || !chrome.scripting) return;
  chrome.tabs.query({ url: NETWORK_URLS }).then(tabs => Promise.all(tabs.map(tab => injectContentScripts(tab.id).catch(() => {})))).catch(logFailure);
});
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  if (details.tabId < 0) return;
  inFlightRequests.set(details.requestId, { url: details.url, headers: D.sanitizeHeaders(details.requestHeaders), time: details.timeStamp || Date.now(), documentId: details.documentId });
  if (inFlightRequests.size > MAX_IN_FLIGHT) inFlightRequests.delete(inFlightRequests.keys().next().value);
}, { urls: NETWORK_URLS, types: REQUEST_TYPES }, ['requestHeaders', 'extraHeaders']);
async function observeNetworkMedia(details, contentType, contentLength, captured, headers = {}) {
  const scope = await observationScope(details.tabId, details);
  if (!scope) return;
  const tab = await chrome.tabs.get(details.tabId);
  await storeMedia(details.tabId, { url: details.url, method: details.method, contentType, contentLength, contentRange: details.statusCode === 206 ? headers['content-range'] : '', requestType: details.type, requestHeaders: captured?.url === details.url ? captured.headers : {}, sourcePageTitle: scope.slot ? '' : tab.title },
    details.frameId, scope.slot ? scope.url : tab.url, { documentId: details.documentId || captured?.documentId, startedAt: captured?.time, fromNetwork: true, outermost: scope.outermost, slot: scope.slot });
}
chrome.webRequest.onHeadersReceived.addListener(details => {
  const captured = inFlightRequests.get(details.requestId);
  inFlightRequests.delete(details.requestId);
  // A redirect hop's type and size describe the redirect, not the media. A
  // 304 revalidation still confirms the cached media response.
  if (details.tabId < 0 || details.statusCode >= 400 || (details.statusCode >= 300 && details.statusCode !== 304)) return;
  const headers = Object.fromEntries((details.responseHeaders || []).map(item => [item.name.toLowerCase(), item.value]));
  const contentType = headers['content-type'] || '';
  if (!D.mediaType(details.url, contentType)) {
    // Playlists can use generic names and types; the page then reports their
    // body. Remember briefly that Chrome itself fetched this URL for the tab.
    if (details.type === 'xmlhttprequest' && (!contentType || /^(?:text\/|image\/|application\/octet-stream|binary\/octet-stream)/i.test(contentType))) {
      rememberRequest(details.tabId, details.url, captured?.url === details.url ? captured.headers : {});
    }
    return;
  }
  observeNetworkMedia(details, contentType, Number(headers['content-length']), captured, headers).catch(logFailure);
}, { urls: NETWORK_URLS, types: ['main_frame', 'sub_frame', 'object', ...REQUEST_TYPES] }, ['responseHeaders']);
for (const event of [chrome.webRequest.onCompleted, chrome.webRequest.onErrorOccurred]) event.addListener(details => { inFlightRequests.delete(details.requestId); }, { urls: NETWORK_URLS, types: REQUEST_TYPES });
