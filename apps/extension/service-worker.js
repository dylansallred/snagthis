/* Download ownership and ephemeral page detections survive popup closure. */
importScripts('shared/hls.js', 'js/detection.js');
const D = VidSnagDetection;
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
async function resetPage(tabId, url, force = false) {
  return serializeTab(tabId, async () => {
    const page = await readPage(tabId);
    if (!force && page.url === url) return;
    await writePage(tabId, { url, visit: crypto.randomUUID(), items: [], hidden: [], mappings: {}, contexts: {} });
  });
}
function cleanContext(input = {}, pageUrl = '') {
  const text = value => String(value || '').trim().slice(0, 255);
  const result = { sourcePageUrl: D.httpUrl(pageUrl || input.sourcePageUrl) };
  if (text(input.sourcePageTitle)) result.sourcePageTitle = text(input.sourcePageTitle);
  for (const name of ['thumbnailUrl', 'poster']) { const value = D.thumbnailUrl(input[name], input.sourcePageUrl || pageUrl); if (value) result[name] = value; }
  for (const name of ['durationSeconds', 'height']) { const value = Number(input[name]); if (Number.isFinite(value) && value > 0) result[name] = value; }
  if (Array.isArray(input.pageTitleCandidates)) result.pageTitleCandidates = input.pageTitleCandidates.slice(0, 24).map(item => ({ source: text(item.source), value: text(item.value) })).filter(item => item.value);
  if (input.pageEpisodeHint && Number.isInteger(input.pageEpisodeHint.seasonNumber) && Number.isInteger(input.pageEpisodeHint.episodeNumber)) result.pageEpisodeHint = { ...input.pageEpisodeHint, seasonNumber: Math.min(60, input.pageEpisodeHint.seasonNumber), episodeNumber: Math.min(999, input.pageEpisodeHint.episodeNumber) };
  result.pageIsTvContext = Boolean(result.pageEpisodeHint);
  const yt = input.youtubeMetadata;
  if (yt && /^[\w-]{6,20}$/.test(yt.videoId || '')) result.youtubeMetadata = { videoId: yt.videoId, title: text(yt.title), channelName: text(yt.channelName), thumbnailUrl: D.thumbnailUrl(yt.thumbnailUrl), durationSeconds: Number(yt.durationSeconds) > 0 ? Number(yt.durationSeconds) : null };
  return result;
}
async function storeMedia(tabId, incoming, frameId = 0, topUrl = '') {
  return serializeTab(tabId, async () => {
    const page = await readPage(tabId);
    const url = D.httpUrl(incoming.url, incoming.sourcePageUrl || topUrl); if (!url) return { ok: true, ignored: true };
    const context = { ...(page.contexts[frameId] || {}), ...cleanContext(incoming, topUrl || page.url) };
    const youtube = incoming.mediaKind === 'youtube-page' && D.youtubeId(url);
    const type = youtube ? 'youtube' : D.mediaType(url, incoming.contentType, incoming.manifestText);
    if (!type || (!youtube && D.youtubeId(topUrl || page.url) && new URL(url).hostname.endsWith('.googlevideo.com'))) return { ok: true, ignored: true };
    if (!page.url) page.url = topUrl || context.sourcePageUrl;
    let manifest;
    try { if (type === 'hls' && incoming.manifestText) manifest = VidSnagHls.parseHlsManifest(incoming.manifestText, url, { durationSeconds: context.durationSeconds }); } catch { /* Detection still works if a manifest is incomplete. */ }
    const existing = page.items.find(item => item.url === url);
    const item = {
      ...existing, ...context, id: existing?.id || crypto.randomUUID(), url, type: type === 'hls' ? 'hls' : 'file',
      mediaKind: youtube ? 'youtube-page' : type === 'hls' ? 'hls-manifest' : type === 'dash' ? 'dash-manifest' : 'video',
      streamType: type === 'hls' || type === 'dash' ? type : null,
      filename: (() => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; } })(),
      contentType: String(incoming.contentType || existing?.contentType || '').slice(0, 200),
      contentLength: Number(incoming.contentLength) > 0 ? Number(incoming.contentLength) : existing?.contentLength || 0,
      requestHeaders: { ...(existing?.requestHeaders || {}), ...D.sanitizeHeaders(incoming.requestHeaders) },
      requestHeadersOrigin: new URL(url).origin,
      detectedAt: existing?.detectedAt || Date.now(), frameId,
      ...(manifest ? { manifest, durationSeconds: manifest.durationSeconds || context.durationSeconds || null } : {}),
    };
    if (existing) page.items[page.items.indexOf(existing)] = item; else if (page.items.length < MAX_ITEMS_PER_TAB) page.items.push(item);
    await writePage(tabId, page); return { ok: true, item };
  });
}
function localApiBase(candidate) {
  try { const url = new URL(candidate); return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : API_BASE; } catch { return API_BASE; }
}
async function appRequest(path, body, apiBase = API_BASE) {
  const { appToken } = await chrome.storage.local.get('appToken');
  if (!appToken) throw new Error('Connect VidSnag before downloading.');
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${appToken}`, 'X-Client': 'vidsnag-extension', 'X-Protocol-Version': '1', 'X-Extension-Version': chrome.runtime.getManifest().version }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || 'Could not start the download.');
  return data;
}
async function downloadMedia(message) {
  const key = `${message.tabId}:${message.mediaId}`;
  if (pendingDownloads.has(key)) return pendingDownloads.get(key);
  const task = (async () => {
    const page = await readPage(message.tabId);
    const existing = page.mappings[message.mediaId]; if (existing) return { ok: true, jobId: existing };
    if (!page.items.some(item => item.id === message.mediaId)) throw new Error('This video is no longer on the page.');
    const result = await appRequest('/v1/jobs', message.payload, !chrome.runtime.getManifest().update_url ? localApiBase(message.apiBase) : API_BASE);
    await serializeTab(message.tabId, async () => {
      const current = await readPage(message.tabId);
      if (current.visit === page.visit) { current.mappings[message.mediaId] = result.jobId; await writePage(message.tabId, current); }
    });
    return { ok: true, ...result };
  })();
  pendingDownloads.set(key, task);
  try { return await task; } finally { pendingDownloads.delete(key); }
}
function trustedPage(sender) { return sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL('')); }
async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (message.cmd === 'STORE_DETECTED_MEDIA' && Number.isInteger(tabId)) return storeMedia(tabId, message.media || {}, sender.frameId || 0, sender.tab.url);
  if (message.cmd === 'PAGE_NAVIGATED' && Number.isInteger(tabId) && sender.frameId === 0) { await resetPage(tabId, D.httpUrl(message.pageUrl)); return { ok: true }; }
  if (message.cmd === 'PAGE_CONTEXT' && Number.isInteger(tabId)) return serializeTab(tabId, async () => {
    const page = await readPage(tabId); const context = cleanContext(message.context, sender.tab.url);
    page.contexts[sender.frameId || 0] = context;
    page.items = page.items.map(item => item.frameId === (sender.frameId || 0) ? { ...item, ...context } : item);
    await writePage(tabId, page); return { ok: true };
  });
  if (!trustedPage(sender)) return { ok: false, error: 'Unavailable to this page.' };
  if (message.cmd === 'GET_TAB_MEDIA') {
    const page = await readPage(message.tabId);
    const rawItems = D.withoutManifestSegments(page.items).filter(item => !page.hidden.includes(item.id));
    return { ok: true, items: page.showAll ? rawItems : VidSnagHls.collapseDetections(rawItems), rawItems, mappings: page.mappings, visit: page.visit, showAll: Boolean(page.showAll), titles: page.titles || {} };
  }
  if (['HIDE_MEDIA', 'SHOW_ALL_MEDIA', 'RENAME_MEDIA'].includes(message.cmd)) return serializeTab(message.tabId, async () => {
    const page = await readPage(message.tabId);
    if (message.cmd === 'HIDE_MEDIA') page.hidden = [...new Set([...page.hidden, ...(message.mediaIds || [message.mediaId])])];
    if (message.cmd === 'SHOW_ALL_MEDIA') { page.showAll = true; page.hidden = []; }
    if (message.cmd === 'RENAME_MEDIA') { page.titles ||= {}; page.titles[message.mediaId] = String(message.title || '').trim().slice(0, 255); }
    await writePage(message.tabId, page); return { ok: true };
  });
  if (message.cmd === 'DOWNLOAD_MEDIA') return downloadMedia(message);
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
chrome.webNavigation.onCommitted.addListener(details => { if (details.frameId === 0) resetPage(details.tabId, details.url, true).catch(() => {}); });
chrome.webNavigation.onHistoryStateUpdated.addListener(details => { if (details.frameId === 0) resetPage(details.tabId, details.url).catch(() => {}); });
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(getStorageKey(tabId)); });
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  if (details.tabId < 0) return;
  inFlightRequests.set(details.requestId, { url: details.url, headers: D.sanitizeHeaders(details.requestHeaders), time: Date.now() });
  if (inFlightRequests.size > 1000) inFlightRequests.delete(inFlightRequests.keys().next().value);
}, { urls: ['http://*/*', 'https://*/*'] }, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.tabId < 0 || details.statusCode >= 400) return;
  const headers = Object.fromEntries((details.responseHeaders || []).map(item => [item.name.toLowerCase(), item.value]));
  if (!D.mediaType(details.url, headers['content-type'])) return;
  const captured = inFlightRequests.get(details.requestId);
  chrome.tabs.get(details.tabId).then(tab => storeMedia(details.tabId, { url: details.url, contentType: headers['content-type'], contentLength: Number(headers['content-length']), requestHeaders: captured?.url === details.url ? captured.headers : {}, sourcePageTitle: tab.title }, details.frameId, tab.url)).catch(() => {});
}, { urls: ['http://*/*', 'https://*/*'] }, ['responseHeaders']);
for (const event of [chrome.webRequest.onCompleted, chrome.webRequest.onErrorOccurred]) event.addListener(details => { inFlightRequests.delete(details.requestId); }, { urls: ['http://*/*', 'https://*/*'] });
