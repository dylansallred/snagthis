// Folder-row options: sample Saved folder (folders of 0, 1, 2, 3 and 6 videos above loose videos),
// the window, list ⇄ shelf, forced hover / focus / drop states, and live drag from a video onto a folder.
// Reuses ../shared.js (Org: sample videos, VideoRow, icons, accents) and ../brand.js (logo).
(function () {
  const P = window.Org;
  const R = window.FR = {};
  // Posters live one level further up than ../shared.js expects.
  const thumb = P.thumbStyle;
  P.thumbStyle = (img, look) => thumb(img, look).replace('../../sample-media/', '../../../sample-media/');
  const ROOT = '~/Downloads/SnagThis';

  // Folder id, name, video ids (newest first). Alphabetical, as the app lists folders.
  const FOLDERS = [
    ['game', 'Game runs', ['i4', 'i10', 'i14', 'i18', 'i23', 'i30']],
    ['music', 'Music & ambience', ['i7', 'i9', 'i17']],
    ['road', 'Road trips', ['i1', 'i3']],
    ['tut', 'Tutorials', ['i5']],
    ['later', 'Watch later', []],
  ];
  R.fresh = () => {
    const items = P.items().filter((it) => !it.missing);
    const byId = Object.fromEntries(items.map((it) => [it.id, it]));
    const folders = FOLDERS.map(([id, name, ids]) => ({ id, name, vids: ids.map((x) => byId[x]) }));
    const inFolder = new Set(FOLDERS.flatMap((f) => f[2]));
    return { folders, loose: items.filter((it) => !inFolder.has(it.id)), view: 'list', hover: null, focus: null, drop: null, drag: null };
  };
  /** Display facts for a folder: count, "6 videos · 3.2 GB" or "Empty", newest posters, drop hint. */
  R.info = (f) => {
    const n = f.vids.length;
    return {
      n, name: f.name, id: f.id,
      meta: n ? `${P.count(n)} · ${P.size(P.sumMb(f.vids))}` : 'Empty',
      short: n ? P.count(n) : 'Empty',
      size: n ? P.size(P.sumMb(f.vids)) : '',
      newest: n ? P.when(Math.min(...f.vids.map((v) => v.days))) : '',
      thumbs: f.vids.map((v) => P.thumbStyle(v.img, v.look)),
      path: `${ROOT}/${f.name}`,
      hint: `Move here · ${ROOT}/${f.name}`,
    };
  };
  /** Classes and attributes for a folder row or tile in the given forced state. */
  R.attrs = (m, f, base) => {
    const cls = [base, m.hover === f.id && 'is-hover', m.focus === f.id && 'is-focus', m.drop === f.id && 'drop-hot', !f.vids.length && 'is-empty', `n${Math.min(f.vids.length, 4)}`].filter(Boolean).join(' ');
    return `class="${cls}" tabindex="0" role="option" aria-selected="false" data-drop="${f.id}" data-folder="${f.id}" aria-label="Folder ${P.esc(f.name)}, ${R.info(f).meta}"`;
  };
  R.actions = (f) => `<div class="fact"><span class="hx"><button class="iconbtn" tabindex="-1" aria-label="Show ${P.esc(f.name)} in Finder" title="Show in Finder">${P.icon('reveal')}</button><button class="iconbtn" tabindex="-1" aria-label="Folder options: ${P.esc(f.name)}">${P.icon('more')}</button></span><span class="chevr">${P.icon('chevronRight')}</span></div>`;

  /** 16×13 pixel folder. kind: 'closed' | 'open' | 'empty'. */
  R.glyph = (w = 16, kind = 'closed') => {
    const h = Math.round(w * 13 / 16);
    const r = (c, x, y, ww, hh) => `<rect class="${c}" x="${x}" y="${y}" width="${ww}" height="${hh}"/>`;
    let body;
    if (kind === 'empty') {
      body = r('o', 0, 0, 6, 1) + r('o', 5, 1, 1, 1) + r('o', 6, 2, 10, 1) + r('o', 0, 0, 1, 13) + r('o', 15, 2, 1, 11) + r('o', 0, 12, 16, 1)
        + [1, 3, 5, 7, 9, 11, 13].map((x) => r('o', x, 5, 1, 1)).join('');
    } else if (kind === 'open') {
      body = r('b', 0, 0, 6, 2) + r('b', 0, 2, 16, 11) + r('p', 2, 2, 12, 5) + r('f', 1, 6, 15, 7) + r('l', 1, 6, 15, 1) + r('b', 1, 12, 15, 1);
    } else {
      body = r('b', 0, 0, 6, 2) + r('b', 0, 2, 16, 11) + r('f', 0, 4, 16, 9) + r('l', 0, 4, 16, 1) + r('b', 0, 12, 16, 1) + r('b', 15, 5, 1, 7);
    }
    return `<svg class="pxf k-${kind}" width="${w}" height="${h}" viewBox="0 0 16 13" aria-hidden="true">${body}</svg>`;
  };

  // A saved video as a shelf tile (SavedShelf.tsx).
  const TIER = { 480: 'SD', 720: 'HD', 1080: 'FHD', 2160: '4K' };
  R.videoTile = (it, m) => `<div class="stile${m.drag === it.id ? ' dragging' : ''}" tabindex="0" role="option" aria-selected="false" draggable="true" data-row="${it.id}" aria-label="${P.esc(it.title)}">
    <div class="poster" style="${P.thumbStyle(it.img, it.look)}"></div><div class="ledge"></div>
    <div class="sh"><b title="${P.esc(it.title)}">${it.title}</b><small>${it.durLabel}</small></div>
    <div class="ss">${TIER[it.h] ? `<span class="qm"><span class="tier">${TIER[it.h]}</span></span><span class="dot">·</span>` : ''}<span>${P.size(it.mb)}</span><span class="dot">·</span><span class="ok">${P.icon('check')}${P.when(it.days).replace(/^./, (c) => c.toUpperCase())}</span></div>
  </div>`;

  const pathBar = () => `<nav class="crumbs" aria-label="Folder"><span class="seg-c">${P.icon('folder')}SnagThis</span><span class="path mono">${ROOT}</span><span class="sp"></span>
    <button class="sortbtn" aria-label="Sort: Newest saved">${P.icon('sort')}<b>Newest saved</b>${P.icon('chevron', 'chev')}</button>
    <button class="iconbtn" aria-label="New folder" title="New folder">${P.icon('folderPlus')}</button><button class="iconbtn" aria-label="Show in Finder" title="Show in Finder">${P.icon('reveal')}</button></nav>`;

  const setAccent = (id) => {
    const a = P.ACCENTS[id] || P.ACCENTS.orange, s = document.documentElement.style;
    [['--color-primary', 1], ['--color-primary-strong', 2], ['--color-primary-hover', 3], ['--color-primary-muted', 4], ['--accent-logo', 5], ['--accent-bevel-face', 6], ['--accent-bevel-light', 7], ['--accent-bevel-dark', 8]].forEach(([k, i]) => s.setProperty(k, a[i]));
  };

  /**
   * cfg: { states: [[id, label, preset(m)]], row(m, f), tile(m, f), list?(m, rows, videos), shelf?(m, tiles, videos), notes(state) }
   * Presets set m.view and one of m.hover / m.focus / m.drop (+ m.drag, the dragged video).
   */
  R.mount = (cfg) => {
    const hash = new URLSearchParams(location.hash.slice(1));
    let state = hash.get('state') || cfg.states[0][0], accent = hash.get('accent') || 'orange', m;
    const toolbar = document.getElementById('toolbar'), stage = document.getElementById('window'), notes = document.getElementById('state-notes');
    const load = (s) => { state = s; m = R.fresh(); const st = cfg.states.find((x) => x[0] === s); if (st && st[2]) st[2](m); render(); };
    const render = () => {
      setAccent(accent);
      const rowM = { sel: [], hot: null, menu: null, drag: m.drag ? { ids: [m.drag] } : null };
      const videos = P.sort(m.loose, 'newest');
      let list;
      if (m.view === 'shelf') {
        const tiles = m.folders.map((f) => cfg.tile(m, f)).join('');
        const vids = videos.map((it) => R.videoTile(it, m)).join('');
        list = cfg.shelf ? cfg.shelf(m, tiles, vids) : `<div class="shelf"><div class="sgrid">${tiles}${vids}</div></div>`;
      } else {
        const rows = m.folders.map((f) => cfg.row(m, f)).join('');
        const vids = videos.map((it) => P.row(it, rowM, {})).join('');
        list = cfg.list ? cfg.list(m, rows, vids) : rows + vids;
      }
      const topExtra = `<span class="viewtoggle" role="group" aria-label="Saved view"><button class="iconbtn" data-view="list" aria-pressed="${m.view === 'list'}" aria-label="List" title="List">${P.icon('list')}</button><button class="iconbtn" data-view="shelf" aria-pressed="${m.view === 'shelf'}" aria-label="Shelf" title="Shelf">${P.icon('grid')}</button></span>`;
      const pm = { tab: 'saved', sel: [], drag: null, toast: null };
      stage.innerHTML = P.win(pm, { head: pathBar(), list, topExtra, foot: `<span class="path">Saving to ~/Downloads/<b>SnagThis</b></span>` });
      // Dragged video: dim it and float the chip over the drop target.
      if (m.drop && m.drag) {
        const win = stage.querySelector('.win'), target = win.querySelector(`[data-drop="${m.drop}"]`), it = m.loose.find((x) => x.id === m.drag);
        win.querySelectorAll(`[data-row="${m.drag}"]`).forEach((el) => el.classList.add('dragging'));
        if (target && it) {
          const wr = win.getBoundingClientRect(), r = target.getBoundingClientRect();
          const x = Math.min(r.left - wr.left + Math.min(r.width * .55, 540), wr.width - 290), y = r.top - wr.top + r.height * .55;
          win.insertAdjacentHTML('beforeend', `<div class="ghost" style="left:${x}px;top:${y}px"><span class="gthumb" style="${P.thumbStyle(it.img, it.look)}"></span>${P.esc(it.title.slice(0, 26))}${it.title.length > 26 ? '…' : ''}</div>
            <svg class="cursor" style="left:${x - 6}px;top:${y - 12}px" viewBox="0 0 14 20"><path d="M1 1v15l4-4 3 7 3-1-3-7h5z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>`);
        }
      }
      if (m.focus) { const el = stage.querySelector(`[data-folder="${m.focus}"]`); if (el) el.focus({ preventScroll: true }); }
      notes.innerHTML = cfg.notes(state);
      toolbar.innerHTML = `<div class="seg" role="group" aria-label="Prototype state">${cfg.states.map(([id, label], i) => `<button data-state="${id}" aria-pressed="${id === state}"><em>${i + 1}</em>${label}</button>`).join('')}</div>
        <div class="swatches" role="group" aria-label="Accent">${Object.keys(P.ACCENTS).map((id) => `<button data-accent="${id}" title="${id}" aria-label="${id}" aria-pressed="${id === accent}" style="--s:${P.ACCENTS[id][0]}"></button>`).join('')}</div>
        <span>Live: drag a video onto a folder (watch 0 → 1 → 2 …), hover, Tab through rows, switch list ⇄ shelf in the window.</span>`;
      history.replaceState(null, '', '#' + new URLSearchParams({ state, accent }));
    };
    R.render = render;

    document.addEventListener('click', (ev) => {
      const hub = ev.target.closest('[data-state],[data-accent]');
      if (hub) { if (hub.dataset.accent) { accent = hub.dataset.accent; render(); } else load(hub.dataset.state); return; }
      const v = ev.target.closest('[data-view]');
      if (v && stage.contains(v)) { m.view = v.dataset.view; m.hover = m.focus = m.drop = m.drag = null; render(); }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.target.closest && ev.target.closest('input')) return;
      const n = Number(ev.key);
      if (n >= 1 && n <= cfg.states.length && !ev.metaKey && !ev.ctrlKey) load(cfg.states[n - 1][0]);
      const nav = ev.target.closest && ev.target.closest('.list [tabindex="0"]');
      if (nav && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
        ev.preventDefault();
        const all = [...stage.querySelectorAll('.list [tabindex="0"]')], i = all.indexOf(nav);
        const next = all[Math.max(0, Math.min(all.length - 1, i + (ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : -1)))];
        next.focus(); next.scrollIntoView({ block: 'nearest' });
      }
    });
    // Forced states clear as soon as the pointer or keyboard takes over.
    document.addEventListener('pointerover', (ev) => { if (m && (m.hover || m.focus) && stage.contains(ev.target) && ev.target.closest('.list')) { m.hover = m.focus = null; stage.querySelectorAll('.is-hover,.is-focus').forEach((el) => el.classList.remove('is-hover', 'is-focus')); } });

    // Live drag: a video row or tile onto a folder moves it in (newest first) and re-renders.
    let dragId = null;
    document.addEventListener('dragstart', (ev) => {
      const row = ev.target.closest && ev.target.closest('[data-row]');
      if (!row) return;
      dragId = row.dataset.row;
      m.hover = m.focus = null; stage.querySelectorAll('.is-hover,.is-focus').forEach((el) => el.classList.remove('is-hover', 'is-focus'));
      ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', dragId);
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    document.addEventListener('dragover', (ev) => {
      if (!dragId) return;
      const t = ev.target.closest && ev.target.closest('[data-drop]');
      stage.querySelectorAll('.drop-hot').forEach((el) => { if (el !== t) { el.classList.remove('drop-hot'); cfg.onHot && cfg.onHot(el, false, m); } });
      if (!t) return;
      ev.preventDefault();
      if (!t.classList.contains('drop-hot')) { t.classList.add('drop-hot'); cfg.onHot && cfg.onHot(t, true, m); }
    });
    document.addEventListener('drop', (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-drop]');
      if (!dragId || !t) return;
      ev.preventDefault();
      const it = m.loose.find((x) => x.id === dragId), f = m.folders.find((x) => x.id === t.dataset.drop);
      if (it && f) { it.days = 0; m.loose = m.loose.filter((x) => x !== it); f.vids.unshift(it); }
      dragId = null; m.drop = m.drag = null; render();
    });
    document.addEventListener('dragend', () => { if (dragId) { dragId = null; render(); } });
    load(state);
  };

  /** The eight states every option shows. */
  R.STATES = [
    ['list', 'List: 0·1·2·3·6', (m) => {}],
    ['hover', 'List hover', (m) => { m.hover = 'game'; }],
    ['drop', 'List drag-over', (m) => { m.drop = 'road'; m.drag = 'i2'; }],
    ['focus', 'List keyboard focus', (m) => { m.focus = 'tut'; }],
    ['shelf', 'Shelf', (m) => { m.view = 'shelf'; }],
    ['shelf-hover', 'Shelf hover', (m) => { m.view = 'shelf'; m.hover = 'game'; }],
    ['shelf-drop', 'Shelf drag-over', (m) => { m.view = 'shelf'; m.drop = 'later'; m.drag = 'i2'; }],
    ['shelf-focus', 'Shelf keyboard focus', (m) => { m.view = 'shelf'; m.focus = 'music'; }],
  ];
})();
