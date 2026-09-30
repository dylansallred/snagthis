// Shared sample library, row renderer, menus, drag and drop and state switcher for the
// library-organising prototypes. Each direction supplies its layout and folder semantics.
(function () {
  const P = window.Org = {};
  const MEDIA = '../../sample-media/1-pixel/';
  const NOW = new Date(2026, 8, 27, 18, 0); // Sunday 27 Sep 2026
  const DAY = 86400000;

  // Four Pixel-worlds posters, cropped and tinted differently so a 30-row library does not look copied.
  const LOOK = [
    '', 'background-size:190%;background-position:20% 40%', 'background-size:210%;background-position:85% 60%',
    'background-size:170%;background-position:50% 90%;filter:hue-rotate(35deg) saturate(1.1)', 'filter:hue-rotate(-40deg)',
    'background-size:170%;background-position:35% 55%;filter:hue-rotate(150deg)', 'background-size:200%;background-position:70% 20%;filter:saturate(.7) brightness(.9)',
  ];
  const secs = (d) => d.split(':').reduce((a, b) => a * 60 + Number(b), 0);
  // id, title, site, days ago, MB, duration, height, poster, look, folder (b/c) — A adds more memberships.
  const RAW = [
    ['i1', 'Neon Rain — night drive', 'pixelworlds.tv', 0, 412, '12:37', 1080, 'neon-rain', 0, 'road'],
    ['i2', 'Sky Hop — a play button’s day out', 'vimeo.com', 0, 96, '5:42', 720, 'sky-hop', 0, ''],
    ['i3', 'Ember Tide — sunset crossing', 'pixelworlds.tv', 1, 1210, '22:14', 1080, 'ember-tide', 0, 'road'],
    ['i4', 'Star Courier — arcade run', 'twitch.tv', 1, 2460, '1:48:10', 1080, 'star-courier', 0, 'later'],
    ['i5', 'Behind the pixels — how Neon Rain was drawn', 'vimeo.com', 2, 188, '9:54', 720, 'neon-rain', 1, 'tut'],
    ['i6', 'Sky Hop — director’s commentary', 'pixelworlds.tv', 3, 640, '24:18', 1080, 'sky-hop', 1, ''],
    ['i7', 'Lo-fi harbour loop (1 hour)', 'archive.org', 3, 820, '1:00:00', 480, 'ember-tide', 2, 'music'],
    ['i8', 'Tile by tile: painting water in 16 colours', 'nebula.tv', 4, 356, '18:22', 1080, 'sky-hop', 2, 'tut'],
    ['i9', 'Star Courier OST — full soundtrack', 'archive.org', 5, 210, '41:05', 480, 'star-courier', 1, 'music'],
    ['i10', 'Ember Tide speedrun in 11:52', 'twitch.tv', 6, 505, '11:52', 720, 'ember-tide', 1, ''],
    ['i11', 'Neon Rain — rooftop chase', 'pixelworlds.tv', 8, 298, '7:30', 1080, 'neon-rain', 2, ''],
    ['i12', 'Pixel dust — making a particle system', 'nebula.tv', 9, 402, '26:40', 1080, 'star-courier', 3, 'tut'],
    ['i13', 'Night market in 8 bits', 'dailymotion.com', 10, 144, '6:12', 720, 'neon-rain', 3, ''],
    ['i14', 'Sky Hop — every secret level', 'twitch.tv', 12, 3170, '2:14:48', 1080, 'sky-hop', 3, 'later'],
    ['i15', 'Harbour lights timelapse', 'vimeo.com', 13, 1840, '4:05', 2160, 'ember-tide', 3, 'road'],
    ['i16', 'Palette swap: dusk to dawn', 'pixelworlds.tv', 15, 88, '3:18', 720, 'ember-tide', 4, ''],
    ['i17', 'Courier jingles — chiptune session', 'archive.org', 17, 176, '32:10', 480, 'star-courier', 4, 'music'],
    ['i18', 'Ember Tide — boss rush', 'twitch.tv', 20, 980, '38:44', 1080, 'ember-tide', 5, ''],
    ['i19', 'How to animate a walk cycle', 'nebula.tv', 22, 260, '14:03', 1080, 'sky-hop', 4, 'tut'],
    ['i20', 'Rain on the tram window (ambience)', 'vimeo.com', 25, 1130, '1:30:00', 720, 'neon-rain', 4, 'music'],
    ['i21', 'Star Courier — launch trailer', 'pixelworlds.tv', 28, 64, '1:52', 2160, 'star-courier', 5, ''],
    ['i22', 'Sprite sheets from scratch', 'nebula.tv', 31, 330, '21:30', 1080, 'neon-rain', 5, 'tut'],
    ['i23', 'Sky Hop — co-op with friends', 'twitch.tv', 34, 2250, '1:31:20', 720, 'sky-hop', 5, 'later'],
    ['i24', 'Coast road — drive at dusk', 'vimeo.com', 38, 720, '16:45', 2160, 'ember-tide', 6, 'road'],
    ['i25', 'Ember Tide — photo mode tour', 'dailymotion.com', 41, 120, '8:20', 720, 'ember-tide', 2, ''],
    ['i26', 'Neon Rain — soundtrack live', 'archive.org', 45, 540, '47:12', 1080, 'neon-rain', 6, 'music', 1],
    ['i27', 'Lighting pixel scenes', 'nebula.tv', 52, 290, '19:48', 1080, 'star-courier', 6, 'tut'],
    ['i28', 'Night bus to the coast', 'vimeo.com', 60, 480, '11:04', 1080, 'sky-hop', 6, 'road'],
    ['i29', 'Star Courier — dev diary 1', 'pixelworlds.tv', 70, 150, '12:30', 720, 'star-courier', 2, ''],
    ['i30', 'Old arcade walkthrough', 'archive.org', 85, 45, '5:05', 360, 'sky-hop', 5, ''],
  ];
  P.items = () => RAW.map(([id, title, site, days, mb, dur, h, img, look, f, missing], n) => ({
    id, title, site, days, mb, dur: secs(dur), durLabel: dur, h, img, look, f: f ? [f] : [], missing: !!missing,
    saved: NOW.getTime() - days * DAY - n * 3100000,
  }));
  P.FOLDERS = [
    { id: 'road', name: 'Road trips', color: '#f4a261' },
    { id: 'tut', name: 'Tutorials', color: '#6fb3ff' },
    { id: 'music', name: 'Music & ambience', color: '#c792ea' },
    { id: 'later', name: 'Watch later', color: '#80bfa6' },
  ];
  P.COLORS = ['#f4a261', '#6fb3ff', '#c792ea', '#80bfa6', '#ff7aa8', '#e9d36b'];
  P.ACTIVE = [
    { id: 'j1', title: 'Coast road — part 2', dur: '18:02', img: 'ember-tide', look: 3, st: '34% · 5 min left', pieces: 13, act: 'pause' },
    { id: 'j2', title: 'Sky Hop — any% speedrun', dur: '9:40', img: 'sky-hop', look: 2, st: 'Waiting · starts next' },
  ];

  // ── Formatting (§3.2) ──
  P.size = (mb) => mb >= 1000 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
  P.when = (days) => {
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    const d = new Date(NOW.getTime() - days * DAY);
    if (days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  };
  const TIER = { 480: 'SD', 720: 'HD', 1080: 'FHD', 2160: '4K' };
  P.quality = (h) => `<span class="qm">${TIER[h] ? `<span class="tier">${TIER[h]}</span>` : ''}<span class="res">${h}p</span></span>`;
  P.sumMb = (list) => list.reduce((a, it) => a + it.mb, 0);
  P.count = (n, one = 'video', many = 'videos') => `${n} ${n === 1 ? one : many}`;
  P.esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Sorting ──
  P.SORTS = [
    ['newest', 'Newest saved', 'Newest'], ['oldest', 'Oldest saved', 'Oldest'], ['name', 'Name A–Z', 'Name'],
    ['size', 'Largest first', 'Largest'], ['length', 'Longest first', 'Longest'], ['site', 'Site A–Z', 'Site'],
  ];
  P.sortLabel = (key, long) => (P.SORTS.find((s) => s[0] === key) || P.SORTS[0])[long ? 1 : 2];
  const name = (t) => t.replace(/^(the|a|an) /i, '');
  P.sort = (list, key) => {
    const by = {
      newest: (a, b) => b.saved - a.saved, oldest: (a, b) => a.saved - b.saved,
      name: (a, b) => name(a.title).localeCompare(name(b.title), 'en', { sensitivity: 'base', numeric: true }),
      size: (a, b) => b.mb - a.mb, length: (a, b) => b.dur - a.dur,
      site: (a, b) => a.site.localeCompare(b.site) || b.saved - a.saved,
    }[key] || ((a, b) => b.saved - a.saved);
    return [...list].sort(by);
  };

  // ── Icons (Lucide) ──
  const ICONS = {
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    folderInput: '<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/>',
    folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4Z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    sort: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    reveal: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    minus: '<path d="M5 12h14"/>',
    group: '<path d="M3 5h18"/><path d="M7 10h14"/><path d="M7 14h14"/><path d="M3 19h18"/>',
  };
  P.icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  P.thumbStyle = (img, look) => `background-image:url(${MEDIA}${img}.jpg);${LOOK[look] || ''}`;
  P.mascot = () => `<div class="mascot" aria-hidden="true">${window.SNAG_BUTTON}<i class="shelf"></i><i class="slot"></i><i class="slot"></i></div>`;
  P.empty = ({ title, text, acts = '', drop = '' }) => `<div class="empty"${drop ? ` data-drop="${drop}"` : ''}>${P.mascot()}<h3>${title}</h3><p>${text}</p>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;

  // ── Rows ──
  /** A saved row. o: { sort, loc(it) -> html, extra(it) -> html after duration, status(it) -> html override } */
  P.row = (it, m, o = {}) => {
    const k = o.sort;
    const cls = ['vrow', m.sel.includes(it.id) && 'sel', m.hot === it.id && 'hot', m.menu && m.menu.id === it.id && 'menu-open',
      m.drag && m.drag.ids.includes(it.id) && 'dragging', it.missing && 'missing'].filter(Boolean).join(' ');
    const dot = '<span class="dot" aria-hidden="true">·</span>';
    let status;
    if (o.status && o.status(it)) status = o.status(it);
    else if (it.missing) status = '<div class="st warn">File was moved or deleted</div>';
    else {
      const parts = [
        k === 'site' ? `<span class="em">${it.site}</span>` : '',
        P.quality(it.h),
        `<span class="${k === 'size' ? 'em' : ''}">${P.size(it.mb)}</span>`,
        `<span class="ok${k === 'newest' || k === 'oldest' ? ' em' : ''}">${P.icon('check')}Saved ${P.when(it.days)}</span>`,
        o.loc ? o.loc(it) : '',
      ].filter(Boolean);
      status = `<div class="st">${parts.join(dot)}</div>`;
    }
    const action = (o.action && o.action(it)) || (it.missing ? `<button class="btnb" data-act="noop" aria-label="Locate: ${P.esc(it.title)}">Locate</button>`
      : `<button class="iconbtn play" data-act="noop" aria-label="Play: ${P.esc(it.title)}" title="Play">${P.icon('play')}</button>`);
    return `<div class="${cls}" role="option" aria-selected="${m.sel.includes(it.id)}" tabindex="0" data-row="${it.id}" data-nav data-fk="row:${it.id}" draggable="true" aria-label="${P.esc(it.title)}">
      <div class="thumb" style="${P.thumbStyle(it.img, it.look)}"></div>
      <div class="tt"><div class="h"><b title="${P.esc(it.title)}">${it.title}</b><small class="${k === 'length' ? 'em' : ''}">${it.durLabel}</small>${o.extra ? o.extra(it) : ''}</div>${status}</div>
      <div class="act"><span class="hx">${it.missing ? '' : `<button class="iconbtn" data-act="noop" aria-label="Show in folder: ${P.esc(it.title)}" title="Show in folder">${P.icon('folder')}</button>`}<button class="iconbtn" data-act="rowmenu" data-arg="${it.id}" data-fk="more:${it.id}" aria-haspopup="menu" aria-expanded="${!!(m.menu && m.menu.id === it.id)}" aria-label="More: ${P.esc(it.title)}" title="More">${P.icon('more')}</button></span>${action}</div>
    </div>`;
  };
  P.activeRows = () => P.ACTIVE.map((j) => `<div class="vrow" tabindex="0" data-nav role="option" aria-selected="false" aria-label="${j.title}">
      <div class="thumb" style="${P.thumbStyle(j.img, j.look)}"></div>
      <div class="tt"><div class="h"><b>${j.title}</b><small>${j.dur}</small></div><div class="st">${j.st}</div></div>
      <div class="act"><span class="hx"><button class="iconbtn" data-act="noop" aria-label="More: ${j.title}">${P.icon('more')}</button></span>${j.act ? `<button class="iconbtn" data-act="noop" aria-label="Pause download">${P.icon('pause')}</button>` : '<span style="width:30px"></span>'}</div>
      ${j.pieces ? `<div class="pieces">${Array.from({ length: 40 }, (_, n) => n < j.pieces ? '<i class="d"></i>' : n === j.pieces ? '<i class="c"></i>' : '<i></i>').join('')}</div>` : ''}
    </div>`).join('');

  // ── Menus ──
  /** items: [{label, act, arg, icon, radio:bool|null, check:'on'|'off'|'mixed', r, danger, disabled}] | 'sep' | {lbl} | {note} */
  P.menu = (items, { anchor, align = 'end', label = 'Menu', width = 0, id = '' } = {}) => `<div class="pop" role="menu" aria-label="${label}" data-anchor='${anchor}' data-align="${align}"${width ? ` style="width:${width}px"` : ''}${id ? ` id="${id}"` : ''}>${items.map((it) => {
    if (it === 'sep') return '<div class="sep" role="separator"></div>';
    if (it.lbl) return `<div class="lbl" role="presentation">${it.lbl}</div>`;
    if (it.note) return `<div class="foot-note" role="presentation">${it.note}</div>`;
    if (it.html) return it.html;
    const role = it.radio != null ? 'menuitemradio' : it.check ? 'menuitemcheckbox' : 'menuitem';
    const aria = it.radio != null ? ` aria-checked="${!!it.radio}"` : it.check ? ` aria-checked="${it.check === 'on' ? 'true' : it.check === 'mixed' ? 'mixed' : 'false'}"` : '';
    const lead = it.radio != null ? `<span class="mk">${it.radio ? P.icon('check') : ''}</span>` : it.check ? `<span class="checkbox ${it.check === 'on' ? 'on' : it.check === 'mixed' ? 'mixed' : ''}"></span>` : it.swatch ? `<span class="swatch" style="--c:${it.swatch}"></span>` : it.icon ? P.icon(it.icon) : '';
    return `<button class="mi${it.danger ? ' danger' : ''}${it.kb ? ' kb' : ''}" role="${role}"${aria} tabindex="-1" data-act="${it.act || 'noop'}" data-arg="${it.arg ?? ''}"${it.disabled ? ' aria-disabled="true"' : ''}>${lead}<span>${it.label}</span>${it.r != null ? `<span class="r">${it.r}</span>` : ''}</button>`;
  }).join('')}</div>`;
  P.sortMenu = (m, anchor, { scope = 'this tab', extra = [] } = {}) => P.menu([
    { lbl: 'Sort by' },
    ...P.SORTS.map(([k, l]) => ({ label: l, act: 'sort', arg: k, radio: P.getSort(m) === k, kb: m.kbSort === k })),
    ...extra,
    { note: `Remembered for ${scope}.` },
  ], { anchor, label: 'Sort', width: 216 });

  P.ctxKey = (m) => m.tab === 'folder' ? 'f:' + m.folder : m.tab;
  P.getSort = (m) => m.sort[P.ctxKey(m)] || 'newest';
  P.folder = (m, id) => m.folders.find((f) => f.id === id);
  P.inFolder = (m, id) => m.items.filter((it) => it.f.includes(id));

  // ── Window ──
  P.win = (m, v) => {
    const tabs = v.tabs || [['all', 'All'], ['downloading', 'Downloading'], ['saved', 'Saved']].map(([id, label]) => ({ id, label, act: 'tab', sel: m.tab === id }));
    return `<div class="win">
      <header class="top chrome-tex"><div class="lights"><i></i><i></i><i></i></div>${window.SNAG_LOGO}
        <div class="paste">${P.icon('link')}<span>Paste a video link</span><kbd>⌘V</kbd></div>
        <div class="topnav"><nav class="tabs" role="tablist" aria-label="Library">${tabs.map((t) => t.html || `<button class="tab${t.cls ? ' ' + t.cls : ''}" role="tab" aria-selected="${!!t.sel}" data-act="${t.act}" data-arg="${t.arg || t.id}" data-fk="tab:${t.id}"${t.drop ? ` data-drop="${t.drop}"` : ''}>${t.pre || ''}${t.label}</button>`).join('')}</nav>${v.topExtra || ''}<button class="iconbtn" data-act="noop" aria-label="Search">${P.icon('search')}</button></div>
      </header>
      <div class="body">${v.side || ''}<div class="main">${v.head || ''}<div class="list" role="listbox" aria-multiselectable="true" aria-label="Videos">${v.list}</div></div></div>
      <footer class="foot chrome-tex">${v.foot || (m.sel.length > 1 && v.selbar ? v.selbar : `<span class="path">Saving to ~/Downloads/<b>SnagThis</b></span>`)}<span class="sp"></span><span class="cmd"><kbd>⌘K</kbd>Commands</span><button class="iconbtn" data-act="noop" aria-label="Open save folder">${P.icon('folder')}</button><button class="iconbtn" data-act="noop" aria-label="Settings">${P.icon('gear')}</button></footer>
      ${v.over || ''}
      ${m.drag && m.drag.preset ? P.ghost(m) : ''}
      ${m.toast ? `<div class="toast${m.toast.warn ? ' warn' : ''}" role="status">${m.toast.warn ? `<span class="warn">${P.icon('alert')}</span>` : ''}<span>${m.toast.text}</span>${m.toast.btn ? `<button class="btn" data-act="${m.toast.btn[1]}">${m.toast.btn[0]}</button>` : ''}${m.undo ? '<button class="btn" data-act="undo">Undo</button>' : ''}<button class="iconbtn" style="width:26px;height:26px" data-act="toastclose" aria-label="Dismiss">${P.icon('x')}</button></div>` : ''}
    </div>`;
  };
  P.selbar = (m, buttons) => `<div class="selbar" role="toolbar" aria-label="Selected videos"><span class="count"><i></i>${m.sel.length} selected</span>${buttons}<button class="btn quiet" data-act="clearsel" aria-label="Clear selection">${P.icon('x')}Clear</button></div>`;
  P.ghost = (m) => {
    const it = m.items.find((x) => x.id === m.drag.ids[0]);
    const n = m.drag.ids.length;
    return `<div class="ghost" data-anchor='${m.drag.anchor}' data-align="ghost"><span class="gthumb" style="${P.thumbStyle(it.img, it.look)}"></span>${n > 1 ? `<span class="gn">${n}</span>${n} videos` : it.title.slice(0, 26) + (it.title.length > 26 ? '…' : '')}<span class="hint">${m.drag.hint || ''}</span></div>
      <svg class="cursor" data-anchor='${m.drag.anchor}' data-align="cursor" viewBox="0 0 14 20"><path d="M1 1v15l4-4 3 7 3-1-3-7h5z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>`;
  };

  // ── Positioning popovers against their anchors inside the window ──
  const place = (win) => {
    const wr = win.getBoundingClientRect();
    win.querySelectorAll('[data-anchor]').forEach((el) => {
      const a = win.querySelector(el.dataset.anchor);
      if (!a) return;
      const list = a.closest('.list');
      if (list && el.dataset.align !== 'ghost' && el.dataset.align !== 'cursor') {
        const lr = list.getBoundingClientRect(), ar = a.getBoundingClientRect();
        if (ar.top < lr.top || ar.bottom > lr.bottom - 40) a.scrollIntoView({ block: 'center' });
      }
      const r = a.getBoundingClientRect();
      const x = r.left - wr.left, y = r.top - wr.top, er = el.getBoundingClientRect(), w = er.width, h = er.height;
      let left, top;
      const al = el.dataset.align;
      const gx = x + (r.width > 400 ? 470 : Math.min(r.width * .42, 150));
      if (al === 'ghost') { left = gx; top = y + r.height / 2 + 6; }
      else if (al === 'cursor') { left = gx - 6; top = y + r.height / 2 - 8; }
      else if (al === 'right') { left = x + r.width + 6; top = y - 4; }
      else {
        left = al === 'start' ? x : x + r.width - w;
        top = y + r.height + 6;
        if (top + h > wr.height - 8) top = Math.max(8, y - h - 6);
      }
      left = Math.max(8, Math.min(left, wr.width - w - 8));
      el.style.left = left + 'px'; el.style.top = top + 'px';
      const caret = el.querySelector('.caret');
      if (caret) {
        const below = top > y;
        caret.style.left = Math.max(12, Math.min(x + r.width / 2 - left - 5, w - 22)) + 'px';
        caret.style.top = below ? '-5px' : 'auto'; caret.style.bottom = below ? 'auto' : '-5px';
      }
    });
  };

  // ── Mount: state switcher, rendering, events ──
  P.ACCENTS = {
    orange: ['#fa5d0e', 'hsl(18 96% 40%)', 'hsl(18 96% 36%)', 'hsl(20 96% 52%)', 'hsl(16 58% 16%)', '#fa5d0e', '#fa5d0e', '#ffb238', '#bd3f00'],
    cobalt: ['#3b7bff', 'hsl(220 80% 50%)', 'hsl(220 80% 45%)', 'hsl(218 95% 63%)', 'hsl(220 50% 18%)', '#4a88ff', '#3b7bff', '#a3c6ff', '#1d44b0'],
    violet: ['#8b5cf6', 'hsl(262 70% 54%)', 'hsl(262 70% 48%)', 'hsl(262 90% 70%)', 'hsl(262 45% 20%)', '#9b78ff', '#8b5cf6', '#d0bcff', '#5528b8'],
    mint: ['#1fbf8a', 'hsl(160 84% 28%)', 'hsl(160 84% 24%)', 'hsl(158 70% 50%)', 'hsl(160 50% 13%)', '#26d996', '#1fbf8a', '#a4f3cc', '#0d7a57'],
    magenta: ['#e8388e', 'hsl(330 75% 46%)', 'hsl(330 75% 41%)', 'hsl(330 90% 64%)', 'hsl(330 50% 18%)', '#f550a0', '#e8388e', '#ffb3d6', '#9c1558'],
  };
  const setAccent = (id) => {
    const a = P.ACCENTS[id] || P.ACCENTS.orange, s = document.documentElement.style;
    [['--color-primary', 1], ['--color-primary-strong', 2], ['--color-primary-hover', 3], ['--color-primary-muted', 4], ['--accent-logo', 5], ['--accent-bevel-face', 6], ['--accent-bevel-light', 7], ['--accent-bevel-dark', 8]].forEach(([k, i]) => s.setProperty(k, a[i]));
  };

  P.fresh = (cfg) => {
    const m = { tab: 'saved', folder: null, sort: {}, menu: null, sel: [], anchorSel: null, creating: null, renaming: null, confirm: null, drag: null, toast: null, undo: null, hot: null, collapsed: [], items: P.items(), folders: P.FOLDERS.map((f) => ({ ...f })) };
    if (cfg.init) cfg.init(m);
    return m;
  };
  P.snapshot = (m) => { m.undo = JSON.stringify({ f: m.items.map((it) => it.f), folders: m.folders, sort: m.sort }); };
  P.restore = (m) => { const s = JSON.parse(m.undo); m.items.forEach((it, n) => { it.f = s.f[n]; }); m.folders = s.folders; m.sort = s.sort; if (m.tab === 'folder' && !P.folder(m, m.folder)) { m.tab = 'saved'; m.folder = null; } m.undo = null; m.toast = null; };
  P.slug = (m, name) => { let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'folder'; while (P.folder(m, id)) id += '-2'; return id; };

  P.mount = (cfg) => {
    const hash = new URLSearchParams(location.hash.slice(1));
    let state = hash.get('state') || cfg.states[0][0], accent = hash.get('accent') || 'orange';
    let m;
    const toolbar = document.getElementById('toolbar'), stage = document.getElementById('window'), notes = document.getElementById('state-notes');
    const load = (s) => { state = s; m = P.fresh(cfg); (cfg.presets[s] || (() => {}))(m); render({ scroll: m.scroll || 0 }); };
    let focusKey = null;
    const render = ({ scroll } = {}) => {
      setAccent(accent);
      const prev = stage.querySelector('.list');
      const top = scroll != null ? scroll : prev ? prev.scrollTop : 0;
      stage.innerHTML = P.win(m, cfg.view(m));
      const list = stage.querySelector('.list');
      if (list) list.scrollTop = typeof top === 'string' ? 0 : top;
      if (typeof top === 'string') { const t = stage.querySelector(top); if (t) t.scrollIntoView({ block: 'center' }); }
      place(stage.querySelector('.win'));
      notes.innerHTML = cfg.notes(state, m);
      toolbar.innerHTML = `<div class="seg" role="group" aria-label="Prototype state">${cfg.states.map(([id, label], i) => `<button data-state="${id}" aria-pressed="${id === state}"><em>${i + 1}</em>${label}</button>`).join('')}</div>
        <div class="swatches" role="group" aria-label="Accent">${Object.keys(P.ACCENTS).map((id) => `<button data-accent="${id}" title="${id}" aria-label="${id}" aria-pressed="${id === accent}" style="--s:${P.ACCENTS[id][0]}"></button>`).join('')}</div>`;
      history.replaceState(null, '', '#' + new URLSearchParams({ state, accent }));
      if (focusKey) {
        const el = focusKey === 'menu' ? (stage.querySelector('.pop [aria-checked="true"]') || stage.querySelector('.pop .mi')) : stage.querySelector(focusKey.startsWith('[') ? focusKey : `[data-fk="${focusKey}"]`);
        if (el) el.focus({ preventScroll: focusKey === 'menu' });
        focusKey = null;
      }
    };
    P.rerender = render;
    const closeAll = () => { m.menu = null; m.confirm = null; };
    const visibleRowIds = () => [...stage.querySelectorAll('.vrow[data-row]')].map((el) => el.dataset.row);

    // Generic actions; cfg.acts may override or extend.
    const ACTS = {
      noop() {},
      tab(a) { closeAll(); m.tab = a; m.folder = null; m.sel = []; m.creating = null; m.toast = null; },
      open(a) { closeAll(); m.tab = 'folder'; m.folder = a; m.sel = []; m.creating = null; m.toast = null; },
      sortmenu() { const open = m.menu && m.menu.kind === 'sort'; closeAll(); if (!open) { m.menu = { kind: 'sort' }; focusKey = 'menu'; } else focusKey = 'sortbtn'; },
      sort(a) { m.sort[P.ctxKey(m)] = a; m.menu = null; focusKey = 'sortbtn'; m.kbSort = null; },
      rowmenu(a) { const open = m.menu && m.menu.id === a && m.menu.kind === 'row'; closeAll(); if (!m.sel.includes(a)) m.sel = []; if (!open) { m.menu = { kind: 'row', id: a }; focusKey = 'menu'; } else focusKey = 'more:' + a; },
      move(a) { const ids = a && !m.sel.includes(a) ? [a] : m.sel.length ? [...m.sel] : [a]; const anchorId = m.menu && m.menu.id; closeAll(); m.menu = { kind: 'move', ids, id: anchorId || (a && !m.sel.length ? a : null) }; focusKey = 'menu'; },
      into(a) { const ids = (m.menu && m.menu.ids) || (m.sel.length ? [...m.sel] : m.menu && m.menu.id ? [m.menu.id] : []); P.snapshot(m); cfg.moveInto(m, ids, a); if (!(m.menu && m.menu.stay)) { m.menu = null; } },
      newfolder(a) { const ids = m.menu && m.menu.ids; closeAll(); m.creating = { where: a || 'side', ids: ids || null }; focusKey = '[data-name]'; },
      rename(a) { closeAll(); m.renaming = a; focusKey = '[data-name]'; },
      delete(a) { closeAll(); m.confirm = { id: a, mode: 'keep' }; focusKey = '[data-default]'; },
      mode(a) { m.confirm.mode = a; },
      dodelete() { const id = m.confirm.id; P.snapshot(m); cfg.deleteFolder(m, id, m.confirm.mode); m.confirm = null; if (m.folder === id) { m.tab = 'saved'; m.folder = null; } },
      foldermenu(a) { const open = m.menu && m.menu.kind === 'folder' && m.menu.fid === a; closeAll(); if (!open) { m.menu = { kind: 'folder', fid: a }; focusKey = 'menu'; } },
      close() { closeAll(); },
      clearsel() { m.sel = []; },
      undo() { P.restore(m); },
      toastclose() { m.toast = null; m.undo = null; },
    };
    const act = (name, arg, el, ev) => {
      const fn = (cfg.acts && cfg.acts[name]) || ACTS[name];
      if (fn) fn.call(ACTS, arg, el, ev, m);
    };
    P.act = ACTS;
    P.run = (name, arg) => { act(name, arg); render(); };

    const commitName = (input, cancel) => {
      const value = input.value.trim();
      if (m.renaming) { if (!cancel && value) { P.snapshot(m); P.folder(m, m.renaming).name = value; cfg.onRename && cfg.onRename(m, m.renaming, value); } focusKey = cfg.folderFocus ? cfg.folderFocus(m.renaming) : null; m.renaming = null; }
      else if (m.creating) {
        const c = m.creating; m.creating = null;
        if (!cancel && value) { P.snapshot(m); const id = P.slug(m, value); m.folders.push({ id, name: value, color: P.COLORS[m.folders.length % P.COLORS.length] }); if (cfg.onCreate) cfg.onCreate(m, id, c); if (c.ids) cfg.moveInto(m, c.ids, id); else m.undo = null; focusKey = cfg.folderFocus ? cfg.folderFocus(id) : null; }
      }
      render();
    };

    document.addEventListener('click', (ev) => {
      const hubBtn = ev.target.closest('[data-state],[data-accent]');
      if (hubBtn) { if (hubBtn.dataset.accent) { accent = hubBtn.dataset.accent; render(); } else load(hubBtn.dataset.state); return; }
      if (!stage.contains(ev.target)) return;
      if (ev.target.closest('[data-name]')) return;
      const t = ev.target.closest('[data-act]');
      if (t && !(t.getAttribute('aria-disabled') === 'true')) { ev.preventDefault(); m.hot = null; act(t.dataset.act, t.dataset.arg, t, ev); render(); return; }
      const row = ev.target.closest('.vrow[data-row]');
      if (row) {
        const id = row.dataset.row; m.hot = null;
        if (ev.metaKey || ev.ctrlKey) { m.sel = m.sel.includes(id) ? m.sel.filter((x) => x !== id) : [...m.sel, id]; m.anchorSel = id; }
        else if (ev.shiftKey && m.anchorSel) { const ids = visibleRowIds(); const [a, b] = [ids.indexOf(m.anchorSel), ids.indexOf(id)].sort((x, y) => x - y); m.sel = ids.slice(a, b + 1); }
        else { m.sel = []; m.anchorSel = id; }
        closeAll(); focusKey = 'row:' + id; render(); return;
      }
      if (ev.target.closest('.pop')) return;
      if (m.menu || m.confirm) { closeAll(); render(); }
    });
    document.addEventListener('contextmenu', (ev) => {
      const row = ev.target.closest('.vrow[data-row]');
      if (!row || !stage.contains(row)) return;
      ev.preventDefault(); act('rowmenu', row.dataset.row); render();
    });

    document.addEventListener('keydown', (ev) => {
      const input = ev.target.closest && ev.target.closest('[data-name]');
      if (input) { if (ev.key === 'Enter') { ev.preventDefault(); commitName(input); } else if (ev.key === 'Escape') { ev.preventDefault(); commitName(input, true); } return; }
      if (ev.target.closest && ev.target.closest('input,textarea')) return;
      const pop = stage.querySelector('.pop');
      if (pop && (pop.contains(ev.target) || ev.key === 'Escape')) {
        const items = [...pop.querySelectorAll('.mi:not([aria-disabled="true"]), .choice, .btn')];
        const i = items.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = items.length; items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n].focus(); return; }
        if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); items[ev.key === 'Home' ? 0 : items.length - 1].focus(); return; }
        if (ev.key === 'Escape' || ev.key === 'Tab') {
          ev.preventDefault();
          const trig = m.menu ? (m.menu.kind === 'sort' ? 'sortbtn' : m.menu.kind === 'folder' ? (cfg.folderFocus ? cfg.folderFocus(m.menu.fid) : null) : m.menu.id ? 'more:' + m.menu.id : null) : m.confirm && cfg.folderFocus ? cfg.folderFocus(m.confirm.id) : null;
          closeAll(); focusKey = trig; render(); return;
        }
        return;
      }
      const n = Number(ev.key);
      if (n >= 1 && n <= cfg.states.length && !ev.metaKey && !ev.ctrlKey) { load(cfg.states[n - 1][0]); return; }
      const nav = ev.target.closest && ev.target.closest('[data-nav]');
      if (!nav || !stage.contains(nav)) return;
      const navs = [...(nav.closest('.list, [data-navgroup]') || stage).querySelectorAll('[data-nav]')];
      const idx = navs.indexOf(nav);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const next = navs[Math.max(0, Math.min(navs.length - 1, idx + (ev.key === 'ArrowDown' ? 1 : -1)))];
        if (ev.shiftKey && next.dataset.row && nav.dataset.row) { if (!m.sel.includes(nav.dataset.row)) m.sel.push(nav.dataset.row); if (!m.sel.includes(next.dataset.row)) m.sel.push(next.dataset.row); focusKey = next.dataset.fk; render(); }
        else next.focus();
        return;
      }
      const id = nav.dataset.row;
      if (id && ((ev.key === 'F10' && ev.shiftKey) || ev.key === 'ContextMenu')) { ev.preventDefault(); act('rowmenu', id); render(); return; }
      if (id && (ev.key === 'm' || ev.key === 'M')) { ev.preventDefault(); if (!m.sel.includes(id)) m.sel = []; m.menu = { kind: 'row', id }; act('move', id); render(); return; }
      if (ev.key === 'Escape' && m.sel.length) { m.sel = []; focusKey = nav.dataset.fk; render(); return; }
      if (cfg.navKey && cfg.navKey(ev, nav, m, act)) { ev.preventDefault(); render(); }
    });

    document.addEventListener('focusout', (ev) => {
      const input = ev.target.closest && ev.target.closest('[data-name]');
      if (input && stage.contains(input)) setTimeout(() => { if (document.activeElement !== input && (m.creating || m.renaming)) commitName(input, !input.value.trim()); }, 0);
    });

    // Live drag and drop: saved rows onto any [data-drop] target. The list is not re-rendered mid-drag.
    let dragIds = null;
    document.addEventListener('dragstart', (ev) => {
      const row = ev.target.closest && ev.target.closest('.vrow[data-row]');
      if (!row) return;
      const id = row.dataset.row;
      dragIds = m.sel.includes(id) ? [...m.sel] : [id];
      ev.dataTransfer.effectAllowed = cfg.dropEffect || 'move';
      ev.dataTransfer.setData('text/x-snagthis-rows', dragIds.join(','));
      const it = m.items.find((x) => x.id === id);
      const chip = document.createElement('div');
      chip.className = 'ghost'; chip.style.cssText = 'position:fixed;left:-999px;top:-999px';
      chip.innerHTML = `<span class="gthumb" style="${P.thumbStyle(it.img, it.look)}"></span>${dragIds.length > 1 ? `<span class="gn">${dragIds.length}</span>${dragIds.length} videos` : P.esc(it.title.slice(0, 28))}`;
      document.body.appendChild(chip); ev.dataTransfer.setDragImage(chip, 20, 15); setTimeout(() => chip.remove(), 0);
      stage.querySelectorAll('.vrow[data-row]').forEach((el) => { if (dragIds.includes(el.dataset.row)) el.classList.add('dragging'); });
    });
    document.addEventListener('dragover', (ev) => {
      if (!dragIds) return;
      const t = ev.target.closest && ev.target.closest('[data-drop]');
      stage.querySelectorAll('.drop-hot').forEach((el) => { if (el !== t) el.classList.remove('drop-hot'); });
      if (!t || (cfg.canDrop && !cfg.canDrop(m, dragIds, t.dataset.drop))) return;
      ev.preventDefault(); t.classList.add('drop-hot');
    });
    document.addEventListener('drop', (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-drop]');
      if (!dragIds || !t) return;
      ev.preventDefault(); P.snapshot(m); cfg.moveInto(m, dragIds, t.dataset.drop); m.sel = []; dragIds = null; render();
    });
    document.addEventListener('dragend', () => { if (dragIds) { dragIds = null; render(); } });
    document.addEventListener('mouseover', (ev) => { if (m && m.hot && stage.contains(ev.target) && ev.target.closest('.vrow')) { m.hot = null; stage.querySelectorAll('.vrow.hot').forEach((el) => el.classList.remove('hot')); } });

    load(state);
  };
})();
