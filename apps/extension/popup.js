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
  let appToken = ''; let activeTab = null; let mediaItems = []; let mappings = {}; let queue = []; let visit = '';
  let reachable = false; let compatible = true; let getAppFallback = false; let refreshBusy = false; let healthBusy = false;
  let menuTrigger = null; let selected = new Map(); let customTitles = {}; let pending = new Map(); let failures = new Map();
  let noticeTimer; let openTimer; let queueTimer; let healthTimer;
  const rowElements = new Map();
  const icons = {
    gear: '<path d="m10 2 1 2 2 .8 2-.6 1.8 3-1.4 1.6v2.4l1.4 1.6-1.8 3-2-.6-2 .8-1 2H6l-1-2-2-.8-2 .6-1.8-3L.6 11V8.6L-.8 7 1 4l2 .6L5 3.8 1 2Z" transform="translate(2 1) scale(.9)"/><circle cx="10" cy="10" r="3"/>',
    play: '<path d="m7 4 9 6-9 6Z"/>', pause: '<path d="M7 4v12M13 4v12"/>',
    close: '<path d="m5 5 10 10M15 5 5 15"/>', down: '<path d="m5 8 5 5 5-5"/>', check: '<path d="m4 10 4 4 8-8"/>',
  };
  function icon(name) { const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.setAttribute('viewBox', '0 0 20 20'); node.setAttribute('aria-hidden', 'true'); node.classList.add('icon'); node.innerHTML = icons[name] || icons.play; return node; }
  function el(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
  function action(label, handler, style = '', iconName = '') {
    const button = el('button', `action ${style}`); button.type = 'button'; button.setAttribute('aria-label', label);
    if (iconName) button.append(icon(iconName)); if (style !== 'icon-only' || !iconName) button.append(document.createTextNode(label));
    button.addEventListener('click', handler); return button;
  }
  function notice(message) { $('notice').textContent = String(message); $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000); }
  function external(url) { if (isDemo) { notice('Preview only — no app or page was opened.'); return; } chrome.tabs.create({ url }).catch(() => notice('Open VidSnag from your Applications folder.')); }
  async function request(path, options = {}) {
    if (isDemo) throw new Error('Demo cannot access the desktop app.');
    const headers = { 'X-Client': 'vidsnag-extension', 'X-Protocol-Version': '1', 'X-Extension-Version': runtimeVersion, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.public ? {} : { Authorization: `Bearer ${appToken}` }) };
    const response = await fetch(`${apiBase}${path}`, { method: options.body ? 'POST' : 'GET', headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(5000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error?.message || data.error || 'VidSnag could not finish that action.'); error.status = response.status; throw error; }
    return data;
  }
  async function message(value) { return isDemo ? { ok: true } : chrome.runtime.sendMessage(value); }
  function openDesktop(view) {
    if (!reachable) {
      if (getAppFallback) { external(RELEASES); return; }
      external('vidsnag://open'); clearTimeout(openTimer);
      openTimer = setTimeout(() => { if (!reachable) { getAppFallback = true; renderConnection(); } }, 3000);
      return;
    }
    if (!appToken) { external('vidsnag://open'); return; }
    request('/v1/app/focus', { body: view ? { view } : {} }).catch(error => notice(error.message));
  }
  function renderConnection() {
    const banner = $('connection-banner'); banner.replaceChildren();
    const unavailable = !reachable || !compatible || !appToken;
    $('video-list').classList.toggle('unavailable', unavailable);
    $('video-list').inert = unavailable;
    banner.hidden = !unavailable;
    if (!reachable) {
      banner.append(el('span', '', "VidSnag isn't open, so downloads can't start."), action(getAppFallback ? 'Get the app' : 'Open VidSnag', () => openDesktop(), 'primary'));
    } else if (!compatible) {
      banner.append(el('span', '', 'Update VidSnag to keep downloading.'), action('Update', () => external(RELEASES), 'primary'));
    } else if (!appToken) {
      banner.append(el('span', '', 'Connect VidSnag to start downloading.'), action('Connect', showPairing, 'primary'));
    }
    $('help-button').hidden = !reachable;
    const activeCount = queue.filter(job => ['downloading', 'queued'].includes(job.queueStatus)).length;
    const openButton = $('open-app');
    openButton.replaceChildren(document.createTextNode(!reachable ? "Don't have the app? Get it" : 'Open VidSnag'));
    if (reachable && activeCount) openButton.append(el('span', 'count-badge', String(activeCount)));
  }
  function updateThumb(thumb, row) {
    thumb.style.setProperty('--p', `${row.fill.percent}%`);
    thumb.classList.toggle('dimmed', row.fill.dimmed);
    const source = row.thumbnailUrl && row.thumbnailUrl !== thumb.dataset.failedSource ? row.thumbnailUrl : '';
    if (thumb.dataset.source !== source) {
      thumb.dataset.source = source; thumb.replaceChildren();
      for (const layer of ['ghost', 'live']) {
        const fill = source ? el('img', `fill ${layer}`) : el('div', `fill placeholder ${layer}`);
        if (source) { fill.alt = ''; fill.src = source; fill.referrerPolicy = 'no-referrer'; fill.addEventListener('error', () => { if (thumb.dataset.source === source) { thumb.dataset.failedSource = source; delete thumb.dataset.source; updateThumb(thumb, { ...(thumb.closest('.video-row')?.current?.row || row), thumbnailUrl: null }); } }, { once: true }); }
        thumb.append(fill);
      }
      thumb.append(el('div', 'edge'), el('span', 'duration'));
    }
    thumb.querySelector('.edge').hidden = !row.fill.scanLine;
    const duration = thumb.querySelector('.duration'); duration.textContent = row.durationLabel; duration.hidden = !row.durationLabel;
  }
  function rowModel(item) {
    const choice = model.selectMedia(item, preferences, selected.get(item.id));
    const jobId = model.mappingFor(item, mappings);
    const job = queue.find(candidate => candidate.id === jobId || candidate.jobId === jobId);
    const optimistic = pending.get(item.id)?.optimistic ? { queueStatus: 'downloading', progress: 0 } : null;
    const failure = failures.get(item.id);
    const title = customTitles[item.id] || titles.getDisplayTitle(item);
    const source = { ...choice, ...(job || optimistic || (failure ? { queueStatus: 'failed', error: failure, progress: 0 } : {})), title: customTitles[item.id] || job?.title || title };
    const firstWaiting = queue.find(candidate => candidate.queueStatus === 'queued')?.id;
    const result = rows.toRowModel(source, { surface: 'popup', firstQueuedId: firstWaiting, folder: preferences.outputDirectory });
    if (result && !job && !optimistic && !failure && choice.qualityLabel === 'Audio only') { result.qualityLabel = 'Audio only'; result.statusLine = 'Audio only'; }
    return { row: result, choice, jobId };
  }
  function renderRows() {
    $('page-count').textContent = mediaItems.length ? `${mediaItems.length} video${mediaItems.length === 1 ? '' : 's'} on this page` : 'No videos yet';
    const list = $('video-list');
    if (!mediaItems.length) {
      rowElements.clear(); list.replaceChildren(emptyState()); renderConnection(); return;
    }
    list.querySelector('.empty-state')?.remove();
    const valid = new Set();
    for (const item of mediaItems) {
      const { row, choice, jobId } = rowModel(item); if (!row) continue;
      valid.add(item.id);
      let node = rowElements.get(item.id);
      if (!node) {
        node = el('div', 'video-row'); node.dataset.rowKey = item.id;
        const thumb = el('div', 'thumb'); const body = el('div', 'row-body'); body.append(el('div', 'row-title'), el('div', 'row-status'));
        node.append(thumb, body); node.addEventListener('contextmenu', event => { event.preventDefault(); showContext(node.current.item, event); });
        rowElements.set(item.id, node);
      }
      node.current = { item, row, choice, jobId };
      node.dataset.state = row.state;
      updateThumb(node.querySelector('.thumb'), row);
      const title = node.querySelector('.row-title'); title.textContent = row.title; title.title = row.title;
      const status = node.querySelector('.row-status'); status.className = `row-status tone-${row.tone}`; status.title = row.statusLine;
      if (row.state === 'detected') {
        status.removeAttribute('role'); status.removeAttribute('aria-valuenow'); status.removeAttribute('aria-valuetext');
        const variants = item.variants || [];
        const signature = `${choice.qualityLabel}|${row.sizeLabel}|${variants.length}`;
        if (status.dataset.signature !== signature) {
          status.dataset.signature = signature; status.replaceChildren(); status.classList.add('status-meta');
          if (variants.length > 1) {
            const quality = el('button', 'quality-button', choice.qualityLabel || 'Quality'); quality.type = 'button'; quality.append(icon('down')); quality.setAttribute('aria-haspopup', 'menu'); quality.setAttribute('aria-label', 'Choose quality');
            quality.addEventListener('click', () => showQuality(node.current.item, quality)); status.append(quality);
          } else if (choice.qualityLabel) status.append(el('span', '', choice.qualityLabel));
          if (row.sizeLabel) status.append(el('span', '', row.sizeLabel));
        } else status.classList.add('status-meta');
      } else {
        delete status.dataset.signature; status.textContent = row.statusLine;
        if (['downloading', 'finishing', 'paused', 'problem'].includes(row.state)) {
          status.setAttribute('role', 'progressbar'); status.setAttribute('aria-valuemin', '0'); status.setAttribute('aria-valuemax', '100'); status.setAttribute('aria-valuenow', String(row.percent)); status.setAttribute('aria-valuetext', row.statusLine);
        } else { for (const attribute of ['role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) status.removeAttribute(attribute); }
      }
      const busy = pending.has(item.id) && !pending.get(item.id).optimistic;
      const actionKey = busy ? 'sending' : row.action ? `${row.action.id}:${row.action.style}` : '';
      if (node.dataset.actionKey !== actionKey) {
        node.querySelector(':scope > .action')?.remove(); node.dataset.actionKey = actionKey;
        if (busy) { const button = action('Starting download', () => {}, 'primary'); button.replaceChildren(el('span', 'spinner')); button.disabled = true; node.append(button); }
        else if (row.action) {
          const iconName = ['pause', 'resume', 'play'].includes(row.action.id) ? row.action.id === 'pause' ? 'pause' : 'play' : '';
          const style = row.action.style === 'icon' ? 'icon-only' : row.action.style;
          node.append(action(row.action.label, () => handleAction(node.current), style, iconName));
        }
      }
      if (node.parentElement !== list) list.append(node);
    }
    for (const [key, node] of rowElements) if (!valid.has(key)) { node.remove(); rowElements.delete(key); }
    renderConnection();
  }
  function emptyState() {
    const node = el('section', 'empty-state'); const tile = el('div', 'empty-icon'); tile.append(icon('play'));
    node.append(tile, el('h2', '', 'Press play on the video'), el('p', '', 'VidSnag spots a video once it starts playing. Start it, then open this again.'), action('Check again', checkAgain, 'bordered')); return node;
  }
  async function checkAgain() { if (!isDemo && activeTab?.id) await chrome.tabs.sendMessage(activeTab.id, { cmd: 'SCAN_PAGE' }).catch(() => {}); await refresh(); }
  async function handleAction(current) {
    const { item, row, jobId } = current;
    if (isDemo) { if (row.action.id === 'play') { showDemoVideo(item); return; } VidSnagDemo.act(item.id, row.action.id); queue = VidSnagDemo.state.queue; renderRows(); return; }
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
  async function startDownload(item) {
    if (pending.has(item.id)) return;
    failures.delete(item.id); pending.set(item.id, { optimistic: false }); renderRows();
    const timer = setTimeout(() => { if (pending.has(item.id)) { pending.set(item.id, { optimistic: true }); renderRows(); } }, 300);
    try {
      const choice = model.selectMedia(item, preferences, selected.get(item.id));
      const payload = model.buildDownloadPayload(choice, customTitles[item.id] || '');
      const result = await message({ cmd: 'DOWNLOAD_MEDIA', tabId: activeTab.id, mediaId: item.id, payload, apiBase });
      if (!result.ok || !result.jobId) throw new Error(result.error || 'Could not start the download.');
      mappings[item.id] = result.jobId;
      queue.push({ id: result.jobId, title: payload.title, queueStatus: result.status === 'queued' ? 'queued' : 'downloading', progress: 0 });
      await refresh();
    } catch (error) { failures.set(item.id, error.message); } finally { clearTimeout(timer); pending.delete(item.id); renderRows(); }
  }
  function closeMenu() { if (!$('sheet').open) $('popup').style.minHeight = ''; $('menu').hidden = true; $('menu').replaceChildren(); if (menuTrigger?.isConnected) menuTrigger.focus(); menuTrigger = null; }
  function openMenu(trigger, point) {
    const menu = $('menu'); menu.replaceChildren(); menu.hidden = false; menuTrigger = trigger?.focus ? trigger : null;
    const bounds = trigger?.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(144, point?.clientX ?? bounds?.left ?? 130))}px`;
    menu.style.top = `${Math.max(4, Math.min(window.innerHeight - 42, point?.clientY ?? bounds?.bottom ?? 60))}px`;
    return menu;
  }
  function fitMenu(menu) {
    const top = Number.parseFloat(menu.style.top);
    const height = Math.min(560, Math.max($('popup').offsetHeight, top + menu.scrollHeight + 12));
    $('popup').style.minHeight = `${height}px`;
    menu.style.maxHeight = `${height - 12}px`;
    menu.style.top = `${Math.max(4, Math.min(top, height - menu.offsetHeight - 6))}px`;
    menu.querySelector('button')?.focus();
  }
  function menuItem(menu, label, handler, options = {}) {
    const button = el('button', 'menu-item'); button.type = 'button'; button.setAttribute('role', options.radio ? 'menuitemradio' : 'menuitem');
    if (options.radio) { button.setAttribute('aria-checked', String(Boolean(options.checked))); const check = el('span', 'menu-check'); if (options.checked) check.append(icon('check')); button.append(check); }
    button.append(document.createTextNode(label)); if (options.value) button.append(el('span', 'menu-value', options.value));
    button.addEventListener('click', () => { closeMenu(); handler(); }); menu.append(button); return button;
  }
  function showQuality(item, trigger) {
    const menu = openMenu(trigger); const choice = model.selectMedia(item, preferences, selected.get(item.id));
    const choose = update => { selected.set(item.id, { ...(selected.get(item.id) || {}), ...update }); renderRows(); };
    for (const [index, variant] of (item.variants || []).entries()) {
      menuItem(menu, variant.height ? `${variant.height}p` : `Quality ${index + 1}`, () => choose({ variantUrl: variant.url, audioOnly: false }), { radio: true, checked: !choice.selection.audioOnly && choice.selection.variantUrl === variant.url, value: rows.formatSize(variant.sizeBytes || VidSnagHls.estimateSizeBytes(variant.averageBandwidth || variant.bandwidth, item.durationSeconds)) });
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
    const menu = openMenu(null, event); const jobId = model.mappingFor(item, mappings);
    menuItem(menu, 'Rename', () => showRename(item));
    menuItem(menu, 'Hide', async () => { const ids = (item.detectedStreams || [item]).map(value => value.id); if (isDemo) mediaItems = mediaItems.filter(value => value.id !== item.id); else await message({ cmd: 'HIDE_MEDIA', tabId: activeTab.id, mediaIds: ids }); renderRows(); await refresh(); });
    menuItem(menu, 'Preview', () => preview(item));
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
    if (jobId) menuItem(menu, 'Open in VidSnag', () => openDesktop());
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
  function openSheet(title) { closeMenu(); $('sheet-title').textContent = title; $('sheet-content').replaceChildren(); $('popup').style.minHeight = '430px'; if (!$('sheet').open) $('sheet').showModal(); return $('sheet-content'); }
  function showProblem(row) { const content = openSheet('Video details'); const pad = el('div', 'sheet-pad'); pad.append(el('p', '', row.statusLine), el('p', '', row.problem?.raw || 'Open the source page and try again.')); pad.append(action('Open page', () => external(row.source.sourcePageUrl), 'bordered')); content.append(pad); }
  function showRename(item) {
    const content = openSheet('Rename video'); const form = el('form', 'sheet-pad'); const input = el('input', 'text-input'); input.id = 'video-title'; input.value = customTitles[item.id] || titles.getDisplayTitle(item); input.maxLength = 255; input.required = true;
    const label = el('label', '', 'Video title'); label.htmlFor = input.id;
    const save = action('Save', () => form.requestSubmit(), 'primary'); form.append(label, input, el('div', 'sheet-actions')); form.lastChild.append(save); content.append(form);
    form.addEventListener('submit', async event => { event.preventDefault(); const title = input.value.trim(); if (!title) return; customTitles[item.id] = title; titles.setCustomTitleOverride(item, title); await message({ cmd: 'RENAME_MEDIA', tabId: activeTab?.id, mediaId: item.id, title }); $('sheet').close(); renderRows(); }); input.focus(); input.select();
  }
  function showHelp() { const content = openSheet('No video?'); content.append(emptyState()); const pad = el('div', 'sheet-pad'); pad.append(el('p', '', 'Start playback, then check again. Some protected videos cannot be saved. During this prerelease, installation instructions are in the project README.'), action('Troubleshooting', () => external(HELP), 'bordered')); content.append(pad); }
  function showPairing() {
    const content = openSheet('Connect VidSnag'); const form = el('form', 'sheet-pad');
    form.append(el('p', '', 'Open VidSnag, then Settings → Advanced → Connect Chrome. Enter the six-digit code shown there. You only need to do this once.'));
    const label = el('label', '', 'Connection code'); label.htmlFor = 'pairing-code'; const input = el('input', 'text-input'); input.id = 'pairing-code'; input.inputMode = 'numeric'; input.autocomplete = 'one-time-code'; input.pattern = '[0-9]{6}'; input.maxLength = 6; input.required = true; input.placeholder = '000000';
    const errorText = el('p', 'sheet-error'); errorText.setAttribute('role', 'alert'); const actions = el('div', 'sheet-actions');
    actions.append(action('Connect', () => form.requestSubmit(), 'primary'), action('Open VidSnag', () => openDesktop(), 'bordered'));
    form.append(label, input, actions, errorText); content.append(form);
    form.addEventListener('submit', async event => { event.preventDefault(); if (!form.reportValidity() || isDemo) return; const submit = actions.firstElementChild; submit.disabled = true; errorText.textContent = '';
      try { const result = await request('/v1/pair/complete', { body: { code: input.value.trim() }, public: true }); if (!result.token) throw new Error('Enter the code currently shown in VidSnag.'); appToken = result.token; await chrome.storage.local.set({ appToken }); $('sheet').close(); await loadPreferences(); await refresh(); renderConnection(); }
      catch (error) { errorText.textContent = error.status === 401 || error.status === 400 ? 'That code did not work. Check the code in VidSnag and try again.' : error.message; }
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
    setting('Save videos to', preferences.outputDirectory || 'Choose in VidSnag', action('Change', () => openDesktop('settings'), 'bordered'));
    setting('Preferred quality', 'Used when a video offers it', select('preferredQuality', [['best', 'Best'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']]));
    setting('Subtitles', 'Included when available', select('subtitleLanguage', [['none', 'None'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']]));
    setting('Tell me when a download finishes', '', toggle('notifyOnComplete'));
    setting('Start VidSnag when I log in', '', toggle('launchAtLogin'));
    const advanced = el('details', 'advanced'); const summary = el('summary', '', 'Advanced'); const body = el('div', 'advanced-body');
    body.append(el('p', '', 'Speed, file naming, metadata and subtitle accounts, updates, and diagnostics are managed in VidSnag.'), action('Open Advanced settings', () => openDesktop('settings'), 'bordered'));
    if (!appToken) body.append(action('Connect Chrome', showPairing, 'bordered'));
    advanced.append(summary, body); content.append(advanced);
  }
  async function loadPreferences() {
    if (!appToken || !reachable || isDemo) return;
    try { const data = await request('/v1/settings'); preferences = { ...preferences, ...(data.settings || data) }; await chrome.storage.local.set({ preferences }); } catch { /* Existing local preferences remain usable while the app starts. */ }
  }
  async function checkHealth() {
    if (healthBusy || isDemo) return; healthBusy = true;
    const wasReachable = reachable;
    try { const health = await request('/v1/health', { public: true }); reachable = health.status === 'ok'; compatible = model.compatible(health, runtimeVersion); if (reachable) getAppFallback = false; }
    catch { reachable = false; }
    finally { healthBusy = false; renderConnection(); }
    if (reachable && !wasReachable) { await loadPreferences(); await refresh(); }
  }
  async function refresh() {
    if (refreshBusy || isDemo) return; refreshBusy = true;
    try {
      const tasks = [activeTab?.id ? message({ cmd: 'GET_TAB_MEDIA', tabId: activeTab.id }) : Promise.resolve(null), reachable && compatible && appToken ? request('/v1/queue') : Promise.resolve(null)];
      const results = await Promise.allSettled(tasks);
      const media = results[0].status === 'fulfilled' ? results[0].value : null;
      if (media?.ok) {
        if (visit && media.visit !== visit) { selected.clear(); pending.clear(); failures.clear(); customTitles = {}; }
        visit = media.visit; mediaItems = media.items || []; mappings = media.mappings || {}; customTitles = media.titles || customTitles;
      }
      if (results[1].status === 'fulfilled' && results[1].value) queue = results[1].value.queue || [];
      if (results[1].status === 'rejected' && results[1].reason?.status === 401) { appToken = ''; await chrome.storage.local.remove('appToken'); }
      if (results[1].status === 'rejected' && results[1].reason?.status === 426) compatible = false;
      renderRows();
    } finally { refreshBusy = false; }
  }
  async function initialize() {
    $('sheet').addEventListener('close', () => { $('popup').style.minHeight = ''; });
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
      const data = VidSnagDemo.init(params.get('demo')); activeTab = data.tab; mediaItems = data.items; mappings = data.mappings; queue = data.queue; preferences = { ...preferences, ...data.preferences }; reachable = data.reachable; appToken = params.get('demo') === 'pairing' ? '' : 'demo-only'; compatible = data.compatible; titles.setActiveTab(activeTab); renderRows();
      if (params.get('demo') === 'pairing') showPairing(); if (params.get('demo') === 'settings') showSettings(); if (params.get('demo') === 'quality') showQuality(mediaItems[0], rowElements.get(mediaItems[0].id).querySelector('.quality-button'));
      return;
    }
    const stored = await chrome.storage.local.get(['appToken', 'preferences']); appToken = stored.appToken || ''; preferences = { ...preferences, ...(stored.preferences || {}) };
    const tabId = Number(params.get('tab'));
    activeTab = tabId > 0 ? await chrome.tabs.get(tabId).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
    titles.setActiveTab(activeTab); await refresh(); await checkHealth(); await checkAgain();
    queueTimer = setInterval(refresh, 1000); healthTimer = setInterval(checkHealth, 2000);
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && activeTab?.id && changes[`vidsnag:tab:${activeTab.id}`]) refresh(); });
  }
  window.addEventListener('pagehide', () => { clearInterval(queueTimer); clearInterval(healthTimer); clearTimeout(openTimer); });
  initialize().catch(error => notice(error.message));
})();
