(() => {
  const MEDIA = '../../../../apps/extension/popup/media/';
  const LOGO = '../../../../apps/extension/img/vidsnag-logo-title.png';
  const PATHS = {
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>', search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>', play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>', right: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    list: '<path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h18"/>', download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  };
  const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const VIDEOS = [
    { id: 'a', title: 'Sintel', media: 'sintel', dur: '14:48', live: true },
    { id: 'b', title: 'Big Buck Bunny', media: 'big-buck-bunny', dur: '9:56', size: '655 MB', when: 'today', q: '1080p' },
    { id: 'c', title: 'Tears of Steel', media: 'tears-of-steel', dur: '12:14', size: '2.3 GB', when: 'yesterday', q: '2160p' },
    { id: 'd', title: 'Sintel: Behind the Scenes', media: 'sintel', dur: '26:02', size: '412 MB', when: 'Tuesday', q: '720p' },
  ];
  const STUDIES = {
    expand: [['instant', 'Today', 'Opens instantly'], ['slide', 'Slide', 'Height eases open, content fades in'], ['stagger', 'Cascade', 'Opens, then header, facts, segments and actions arrive in turn'], ['spring', 'Spring', 'Opens with a small bounce; card scales up'],
      ['unfold', 'Unfold', 'Card hinges down from the row like a flap'], ['focus', 'Focus pull', 'Quick open; content sharpens from a blur'], ['drop', 'Drawer', 'Card slides out from under the row'], ['grow', 'Reveal', 'Card widens out from the centre']],
    tabs: [['today', 'Today', 'Grey pill on the selected tab; text brightens on hover'], ['pill', 'Sliding pill', 'The pill glides to the tab you pick; faint pill follows hover'], ['underline', 'Underline', 'Orange line slides; grey line grows under hover'], ['segmented', 'Segmented', 'Enclosed control with a sliding thumb'],
      ['orange', 'Orange outline', 'Sliding orange-outlined pill, like the Download button'], ['counts', 'With counts', 'Sliding pill plus a count on each tab'], ['follow', 'Follow hover', 'Highlight chases the pointer; orange line marks the selection'], ['icons', 'Icons', 'Icons that open into labels on hover or when selected'], ['glow', 'Glow', 'Selected text glows orange with a dot beneath']],
  };
  let hovered = null;
  for (const [id, variants] of Object.entries(STUDIES)) {
    const section = document.getElementById(id); const picker = $('.study-picker', section);
    picker.innerHTML = variants.map(([key, name, note], i) => `<button type="button" data-key="${key}" aria-pressed="${i === 0}"><span>${i + 1} · ${name}</span><small>${note}</small></button>`).join('');
    section.pick = key => { section.dataset.variant = key; $$('button', picker).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === key))); section.dispatchEvent(new Event('variant')); };
    picker.addEventListener('click', event => { const button = event.target.closest('button'); if (button) section.pick(button.dataset.key); });
    section.addEventListener('pointerenter', () => { hovered = section; });
  }
  addEventListener('keydown', event => { if (!hovered || event.metaKey || event.ctrlKey || event.altKey) return; const variant = STUDIES[hovered.id][Number(event.key) - 1]; if (variant) hovered.pick(variant[0]); });

  const thumb = media => `<div class="thumb"><img src="${MEDIA}${media}.jpg" alt=""></div>`;
  const status = v => v.live ? '<div class="status"><b>34%</b><span>·</span><span>6 min left</span></div>' : `<div class="status">${icon('check', 'ok')}Saved ${v.when} · ${v.size} · ${v.q}</div>`;
  const lane = `<div class="lane-slot"><div class="cells">${Array.from({ length: 40 }, (_, i) => `<i class="${i < 13 ? 'done' : i === 13 ? 'now' : ''}"></i>`).join('')}</div></div>`;
  function card(v) {
    const F = v.live ? [['Quality', '1080p · English audio'], ['Size', '714 MB / ~2.1 GB'], ['From', 'durian.blender.org']] : [['Quality', `${v.q} · English audio`], ['Size', v.size], ['Length', v.dur], ['From', 'blender.org']];
    const stat = v.live ? `<div class="gstat"><strong>4.8 <small>MB/s</small></strong><span class="cdots">${Array.from({ length: 16 }, (_, i) => `<i class="${i < 6 ? 'on' : ''}"></i>`).join('')}</span><span>6 of 16 active</span></div>` : '';
    const map = v.live ? `<div class="pieces"><div class="pieces-caption" style="justify-content:flex-start;gap:12px"><span>Segments</span><span>95 of 280 · 2 retrying</span></div><div class="map">${Array.from({ length: 280 }, (_, i) => `<i class="${i < 95 ? 'done' : i < 103 ? (i === 97 || i === 100 ? 'retry' : 'now') : ''}"></i>`).join('')}</div></div>` : '';
    return `<div class="details v-card"><div class="icard"><button type="button" class="icard-head">${icon('folder')}<span>${v.live ? 'Saving to' : 'Saved in'} ~/Movies/VidSnag/<strong>${v.title}</strong></span>${icon('right', 'arrow')}</button>
      <div class="icard-body"><div class="gtop${v.live ? '' : ' solo'}">${stat}<dl class="facts ${v.live ? 'three' : ''}">${F.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl></div>${map}</div>
      <div class="icard-foot"><button type="button" class="tbtn">${icon('link')}Copy link</button><button type="button" class="tbtn">${icon('external')}Open page</button><span class="grow"></span><button type="button" class="tbtn danger">${icon(v.live ? 'x' : 'trash')}${v.live ? 'Cancel download' : 'Remove…'}</button></div></div></div>`;
  }
  const rowHTML = (v, withDetails) => `<div class="item" data-id="${v.id}" data-live="${!!v.live}"><div class="row" tabindex="0">${thumb(v.media)}<div class="text"><div class="heading"><span class="title">${v.title}</span><span class="dur">${v.dur}</span></div>${status(v)}</div><div class="actions"><button type="button" class="act">${icon(v.live ? 'pause' : 'play')}</button></div>${v.live ? lane : ''}</div>${withDetails ? `<div class="dwrap"><div class="dclip">${card(v)}</div></div>` : ''}</div>`;

  // 1 · Expand
  const list = $('#e-list'); list.innerHTML = VIDEOS.map(v => rowHTML(v, true)).join('');
  const toggle = item => { const open = item.classList.contains('open'); $$('.item.open', list).forEach(other => other.classList.remove('open')); if (!open) item.classList.add('open'); };
  list.addEventListener('click', event => { if (event.target.closest('button')) return; const item = event.target.closest('.item'); if (item && event.target.closest('.row')) toggle(item); });
  $('#e-replay').addEventListener('click', () => { const item = $('.item.open', list) || list.children[0]; item.classList.remove('open'); setTimeout(() => item.classList.add('open'), 650); });
  document.getElementById('expand').addEventListener('variant', () => { $('#e-replay').click(); });
  list.children[0].classList.add('open');

  // 2 · Tabs
  const TABS = [['all', 'All', 'list', 4], ['downloading', 'Downloading', 'download', 1], ['saved', 'Saved', 'check', 3]];
  $('#t-bar').innerHTML = `<div class="top-bar"><img class="wordmark" src="${LOGO}" alt="VidSnag"><div class="paste-field">${icon('link')}<span>Paste a video link</span><kbd>⌘V</kbd></div>
    <div class="tabs"><i class="hov"></i><i class="ind"></i>${TABS.map(([key, label, glyph, count], i) => `<button type="button" data-tab="${key}" aria-pressed="${i === 0}">${icon(glyph, 'ticon')}<span class="tlabel">${label}</span><span class="count">${count}</span></button>`).join('')}</div>
    <button type="button" class="icon-button" aria-label="Search">${icon('search')}</button></div>`;
  $('#t-list').innerHTML = VIDEOS.map(v => rowHTML(v, false)).join('');
  const tabs = $('.tabs'); let selected = 'all';
  function place() { const button = $(`[data-tab="${selected}"]`, tabs); tabs.style.setProperty('--x', `${button.offsetLeft}px`); tabs.style.setProperty('--w', `${button.offsetWidth}px`); }
  tabs.addEventListener('click', event => { const button = event.target.closest('[data-tab]'); if (!button) return; selected = button.dataset.tab;
    $$('[data-tab]', tabs).forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    $$('#t-list .item').forEach(item => { item.hidden = selected !== 'all' && (selected === 'downloading') !== (item.dataset.live === 'true'); }); place(); setTimeout(place, 300); });
  tabs.addEventListener('pointerover', event => { const button = event.target.closest('[data-tab]'); if (!button) return; tabs.classList.add('hovering'); tabs.style.setProperty('--hx', `${button.offsetLeft}px`); tabs.style.setProperty('--hw', `${button.offsetWidth}px`); setTimeout(place, 300); });
  tabs.addEventListener('pointerleave', () => { tabs.classList.remove('hovering'); setTimeout(place, 300); });
  document.getElementById('tabs').addEventListener('variant', () => { requestAnimationFrame(place); setTimeout(place, 320); });
  new ResizeObserver(place).observe(tabs); place();
})();
