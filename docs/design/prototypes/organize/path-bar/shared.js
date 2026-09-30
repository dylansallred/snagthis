// Path-bar options: a nested sample Saved folder, the real window (header, path bar, folder rows in the
// owner-chosen "C · Sections" style, videos), forced states, middle-segment collapse, live navigation and drag.
// Reuses ../shared.js (Org: sample videos, VideoRow, icons, window, accents) and ../folder-rows/shared.js
// (FR.glyph pixel folder; it also points posters one level further up, as these pages need).
(function () {
  const P = window.Org, R = window.FR;
  const B = window.PB = {};
  B.ROOT = 'SnagThis';
  B.ROOT_DISP = '~/Downloads/SnagThis';
  B.THREE = ['Road trips', 'Coast', '2026 Summer'];
  B.LONG = ['Road trips', 'Pacific Coast Highway — the whole trip', 'Day 14 · Big Sur to Monterey via Bixby Creek', 'Drone footage (unedited 4K originals)', 'Bixby Bridge — sunrise passes'];

  // Folder contents by path: [sub-folders as [name, video ids]], loose video ids.
  const TREE = {
    '': [[['Game runs', ['i4', 'i10', 'i14', 'i18', 'i23', 'i30']], ['Music & ambience', ['i7', 'i9', 'i17']], ['Road trips', ['i1', 'i3', 'i15', 'i24', 'i28', 'i13']], ['Tutorials', ['i5', 'i8', 'i12']], ['Watch later', []]],
      ['i2', 'i6', 'i11', 'i16', 'i19', 'i20', 'i21', 'i22', 'i25', 'i27', 'i29']],
    'Road trips': [[['Coast', ['i15', 'i24', 'i28']], ['Mountains', ['i13']], ['Pacific Coast Highway — the whole trip', ['i24']]], ['i1', 'i3']],
    'Road trips/Coast': [[['2026 Summer', ['i15', 'i24']], ['Harbours', ['i28']]], ['i13']],
    'Road trips/Coast/2026 Summer': [[['Drone', []]], ['i15', 'i24', 'i3', 'i1']],
  };
  const FALLBACK = [[['Raw clips', ['i15']], ['Selects', []]], ['i24', 'i15', 'i28', 'i1']];
  const byId = () => Object.fromEntries(P.items().map((it) => [it.id, it]));
  /** "3 folders · 2 videos · 1.6 GB" for the place being shown. */
  B.summary = (m, o = {}) => {
    const ids = byId(), [folders, vids] = TREE[m.path.join('/')] || FALLBACK;
    const loose = vids.filter((id) => !m.moved.includes(id)).map((id) => ids[id]);
    return [folders.length ? P.count(folders.length, 'folder', 'folders') : '', P.count(loose.length), o.size ? P.size(P.sumMb(loose)) : ''].filter(Boolean).join(' · ');
  };

  B.disp = (parts) => [B.ROOT_DISP, ...parts].join('/');
  /** The disk path with break chances after each slash. */
  B.wrapPath = (parts) => P.esc(B.disp(parts)).replace(/\//g, '/<wbr>');
  /** Segments of the current place: root first. */
  B.segs = (m) => [{ i: 0, name: B.ROOT, parts: [], root: true }, ...m.path.map((name, n) => ({ i: n + 1, name, parts: m.path.slice(0, n + 1) }))]
    .map((s) => ({ ...s, cur: s.i === m.path.length, disp: B.disp(s.parts), key: s.parts.join('/') }));
  /** Visible segments: hidden middle ones fold into one { more, items } entry. */
  B.visible = (m, list = B.segs(m)) => {
    const out = [];
    list.forEach((s) => {
      if (!m.hidden.includes(s.i)) return out.push(s);
      const last = out[out.length - 1];
      if (last && last.more) last.items.push(s); else out.push({ more: true, items: [s] });
    });
    return out;
  };
  /** Forced-state classes for segment i. */
  B.st = (m, i) => `${m.hover === i ? ' is-hover' : ''}${m.focus === i ? ' is-focus' : ''}${m.drop === i ? ' drop-hot' : ''}`;
  /** Attributes a clickable, droppable segment carries. */
  B.at = (s) => s.cur ? `aria-current="page" data-seg="${s.i}" title="${P.esc(s.disp)}"` : `data-seg="${s.i}" data-go="${P.esc(s.key)}" data-dropseg="${s.i}" title="${P.esc(s.disp)}"`;
  B.parentName = (m) => m.path.length > 1 ? m.path[m.path.length - 2] : B.ROOT;
  B.glyph = (w, kind) => R.glyph(w, kind);

  // Crisp pixel marks for separators, keys and the collapse dots.
  const px = (w, h, rects, cls = '') => `<svg class="pxm ${cls}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${rects.map(([x, y, ww, hh]) => `<rect x="${x}" y="${y}" width="${ww}" height="${hh}"/>`).join('')}</svg>`;
  B.px = {
    slash: (s = 1) => px(5 * s, 12 * s, [[4, 0, 1, 2], [3, 2, 1, 3], [2, 5, 1, 2], [1, 7, 1, 3], [0, 10, 1, 2]].map((r) => r.map((v) => v * s)), 'slash'),
    tri: () => px(4, 7, [[0, 0, 1, 7], [1, 1, 1, 5], [2, 2, 1, 3], [3, 3, 1, 1]], 'tri'),
    left: () => px(6, 10, [[4, 0, 2, 3], [2, 2, 2, 3], [0, 4, 2, 2], [2, 5, 2, 3], [4, 7, 2, 3]], 'left'),
    up: () => px(10, 10, [[4, 0, 2, 10], [2, 2, 2, 3], [6, 2, 2, 3], [0, 4, 2, 2], [8, 4, 2, 2]], 'up'),
    dots: () => px(14, 2, [[0, 0, 2, 2], [6, 0, 2, 2], [12, 0, 2, 2]], 'dots'),
    copy: () => px(12, 12, [[3, 0, 9, 1], [3, 0, 1, 9], [11, 0, 1, 9], [3, 8, 9, 1], [0, 3, 1, 9], [0, 11, 9, 1], [8, 9, 1, 3], [0, 3, 3, 1]], 'copy'),
  };

  /** The right side every option keeps: Sort & group, New folder, Show in Finder, and ⋯ inside a folder. */
  B.tools = (m, o = {}) => `<span class="pb-tools">
    <button class="sortbtn" data-act="noop" aria-label="Sort and group: Newest saved">${P.icon('sort')}<b>Newest saved</b>${P.icon('chevron', 'chev')}</button>
    <button class="iconbtn" data-act="noop" aria-label="New folder" title="New folder">${P.icon('folderPlus')}</button>
    <button class="iconbtn" data-act="noop" aria-label="Show in Finder" title="Show in Finder">${P.icon('reveal')}</button>
    ${m.path.length && !o.noMore ? `<button class="iconbtn" data-more-folder aria-haspopup="menu" aria-expanded="${m.menu === 'folder'}" aria-label="Folder options: ${P.esc(m.path[m.path.length - 1])}" title="Folder options">${P.icon('more')}</button>` : ''}</span>`;

  /** Menu of the collapsed middle segments, each one a way in and a drop target. */
  B.moreMenu = (m, items) => `<div class="pop pb-more" role="menu" aria-label="Hidden folders" data-anchor="[data-more]" data-align="start">
    ${items.map((s, n) => `<button class="mi${m.drop === s.i ? ' drop-hot' : ''}" role="menuitem" tabindex="-1" data-go="${P.esc(s.key)}" data-dropseg="${s.i}" style="padding-left:${9 + n * 12}px">${B.glyph(16, 'closed')}<span class="nm">${P.esc(s.name)}</span></button>`).join('')}
    <div class="foot-note">Drop a video on a folder here to move it in.</div></div>`;

  /** Path exposure shared by several options: the path, Copy path, Show in Finder. */
  B.pathCard = (m) => `<div class="pb-pathcard"><span class="mono">${P.esc(B.disp(m.path))}</span>
    <button class="btn" data-copy>${B.px.copy()}Copy path</button></div>`;

  const setAccent = (id) => {
    const a = P.ACCENTS[id] || P.ACCENTS.orange, s = document.documentElement.style;
    [['--color-primary', 1], ['--color-primary-strong', 2], ['--color-primary-hover', 3], ['--color-primary-muted', 4], ['--accent-logo', 5], ['--accent-bevel-face', 6], ['--accent-bevel-light', 7], ['--accent-bevel-dark', 8]].forEach(([k, i]) => s.setProperty(k, a[i]));
  };

  /** The Saved list in the "Sections" style (folder-rows option C). */
  const list = (m) => {
    const ids = byId(), [folders, vids] = TREE[m.path.join('/')] || FALLBACK;
    const loose = vids.map((id) => ids[id]).filter((it) => it && !m.moved.includes(it.id));
    const label = (name, n, right = '') => `<div class="sec" role="presentation">${name}<b>${n}</b>${right ? `<span class="r">${right}</span>` : ''}</div>`;
    const rows = folders.map(([name, fv]) => {
      const n = fv.length, meta = n ? `${P.count(n)} · ${P.size(P.sumMb(fv.map((id) => ids[id])))}` : 'Empty';
      const key = [...m.path, name].join('/');
      const icon = n ? `<span class="ico">${B.glyph(32, 'closed')}${B.glyph(32, 'open')}</span>` : `<span class="ico">${B.glyph(32, 'empty')}</span>`;
      return `<div class="frow${n ? '' : ' is-empty'}" tabindex="0" role="option" aria-selected="false" data-go="${P.esc(key)}" data-droprow aria-label="Folder ${P.esc(name)}, ${meta}">${icon}<span class="nm">${P.esc(name)}</span><span class="fm">${meta}</span><span class="sp"></span><span class="chevr">${P.icon('chevronRight')}</span></div>`;
    }).join('');
    const rowM = { sel: [], hot: null, menu: null, drag: m.drag ? { ids: [m.drag] } : null };
    return `${folders.length ? `${label('Folders', folders.length)}<div class="fblock">${rows}</div>` : ''}${label('Videos', loose.length, P.size(P.sumMb(loose)))}${loose.map((it) => P.row(it, rowM, {})).join('')}`;
  };

  /**
   * cfg: { states?, bar(m) -> html, over?(m) -> html (popovers), notes(state) -> html, fit?: false }
   * m: { path, hover, focus, drop, drag, menu, reveal, width, hidden }
   */
  B.mount = (cfg) => {
    const states = cfg.states || B.STATES;
    const hash = new URLSearchParams(location.hash.slice(1));
    let state = hash.get('state') || states[0][0], accent = hash.get('accent') || 'orange', m;
    const toolbar = document.getElementById('toolbar'), stage = document.getElementById('window'), notes = document.getElementById('state-notes');
    const fresh = () => ({ path: [], hover: null, focus: null, drop: null, drag: null, menu: null, reveal: false, width: 1200, hidden: [], moved: [], toast: null });
    const load = (s) => { state = s; m = fresh(); const st = states.find((x) => x[0] === s); if (st && st[2]) st[2](m); render(); };
    const go = (key) => { const w = m.width; m = fresh(); m.width = w; m.path = key ? key.split('/') : []; render(); };

    const draw = () => {
      setAccent(accent);
      const pm = { tab: 'saved', sel: [], drag: null, toast: m.toast };
      const topExtra = `<span class="viewtoggle" role="group" aria-label="Saved view"><button class="iconbtn" aria-pressed="true" aria-label="List" title="List">${P.icon('list')}</button><button class="iconbtn" aria-pressed="false" aria-label="Shelf" title="Shelf">${P.icon('grid')}</button></span>`;
      stage.innerHTML = P.win(pm, { head: cfg.bar(m), list: list(m), topExtra, over: (cfg.over ? cfg.over(m) : '') + (m.menu === 'more' ? B.moreMenu(m, (B.visible(m).find((s) => s.more) || { items: [] }).items) : '') });
      const win = stage.querySelector('.win');
      win.style.width = m.width + 'px';
      win.classList.toggle('narrow', m.width < 1200);
    };
    const overflow = () => {
      const el = stage.querySelector('[data-fit]');
      if (!el) return false;
      const win = stage.querySelector('.win');
      win.classList.add('measure');
      const over = el.scrollWidth > el.clientWidth + 1;
      win.classList.remove('measure');
      return over;
    };
    const place = () => {
      const win = stage.querySelector('.win'), wr = win.getBoundingClientRect();
      win.querySelectorAll('[data-anchor]').forEach((el) => {
        const a = win.querySelector(el.dataset.anchor);
        if (!a) { el.remove(); return; }
        const r = a.getBoundingClientRect(), w = el.getBoundingClientRect().width;
        let left = el.dataset.align === 'end' ? r.right - wr.left - w : el.dataset.align === 'center' ? r.left - wr.left + r.width / 2 - w / 2 : r.left - wr.left;
        left = Math.max(8, Math.min(left, wr.width - w - 8));
        el.style.left = left + 'px'; el.style.top = (r.bottom - wr.top + 6) + 'px';
        const caret = el.querySelector('.caret');
        if (caret) caret.style.left = Math.max(10, Math.min(r.left - wr.left + r.width / 2 - left - 5, w - 20)) + 'px';
      });
      // A dragged video: dim its row and float the chip over the drop target.
      if (m.drop != null && m.drag) {
        const t = win.querySelector(`.drop-hot[data-dropseg="${m.drop}"]`), it = P.items().find((x) => x.id === m.drag);
        win.querySelectorAll(`[data-row="${m.drag}"]`).forEach((el) => el.classList.add('dragging'));
        if (t && it) {
          const r = t.getBoundingClientRect(), s = B.segs(m)[m.drop];
          const x = Math.min(r.left - wr.left + Math.min(r.width * .6, 90), wr.width - 330), y = r.bottom - wr.top + 10;
          win.insertAdjacentHTML('beforeend', `<div class="ghost pb-ghost" style="left:${x}px;top:${y}px"><span class="gthumb" style="${P.thumbStyle(it.img, it.look)}"></span>${P.esc(it.title.slice(0, 24))}${it.title.length > 24 ? '…' : ''}<span class="hint">Move to ${P.esc(s.name)}</span></div>
            <svg class="cursor" style="left:${x - 4}px;top:${y - 14}px" viewBox="0 0 14 20"><path d="M1 1v15l4-4 3 7 3-1-3-7h5z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>`);
        }
      }
      if (m.focus != null) { const el = win.querySelector(`[data-seg="${m.focus}"]`); if (el) el.focus({ preventScroll: true }); }
      const inp = win.querySelector('.pb-edit input'); if (inp) { inp.focus(); inp.select(); }
    };
    const render = () => {
      draw();
      if (cfg.fit !== false) {
        const order = m.path.map((_, n) => n + 1).slice(0, -1); // middle folders, nearest the root first
        for (const i of order) { if (!overflow()) break; if (!m.hidden.includes(i)) { m.hidden.push(i); draw(); } }
      }
      place();
      notes.innerHTML = cfg.notes(state);
      toolbar.innerHTML = `<div class="seg" role="group" aria-label="Prototype state">${states.map(([id, label], i) => `<button data-state="${id}" aria-pressed="${id === state}"><em>${i + 1}</em>${label}</button>`).join('')}</div>
        <div class="swatches" role="group" aria-label="Accent">${Object.keys(P.ACCENTS).map((id) => `<button data-accent="${id}" title="${id}" aria-label="${id}" aria-pressed="${id === accent}" style="--s:${P.ACCENTS[id][0]}"></button>`).join('')}</div>
        <button class="btn quiet" data-width>${m.width === 1200 ? 'Window 1200px → 960px' : 'Window 960px → 1200px'}</button>
        <span>Live: click segments and folders, Tab through the bar, drag a video onto a segment.</span>`;
      history.replaceState(null, '', '#' + new URLSearchParams({ state, accent }));
    };
    B.render = render;
    B.m = () => m;

    document.addEventListener('click', (ev) => {
      const hub = ev.target.closest('[data-state],[data-accent],[data-width]');
      if (hub) {
        if (hub.dataset.accent) { accent = hub.dataset.accent; render(); }
        else if (hub.hasAttribute('data-width')) { m.width = m.width === 1200 ? 960 : 1200; m.hidden = []; m.menu = null; render(); }
        else load(hub.dataset.state);
        return;
      }
      if (!stage.contains(ev.target)) return;
      const t = ev.target.closest('[data-go],[data-more],[data-copy],[data-more-folder],[data-edit],[data-title-menu],[data-act="toastclose"]');
      if (!t) { if (m.menu || m.reveal) { m.menu = null; m.reveal = false; render(); } return; }
      if (t.hasAttribute('data-go')) return go(t.dataset.go);
      if (t.hasAttribute('data-more')) { m.menu = m.menu === 'more' ? null : 'more'; render(); return; }
      if (t.hasAttribute('data-more-folder')) { m.menu = m.menu === 'folder' ? null : 'folder'; render(); return; }
      if (t.hasAttribute('data-title-menu')) { m.menu = m.menu === 'title' ? null : 'title'; render(); return; }
      if (t.hasAttribute('data-edit')) { m.reveal = true; m.menu = null; render(); return; }
      if (t.hasAttribute('data-copy')) { navigator.clipboard && navigator.clipboard.writeText(B.disp(m.path)).catch(() => {}); m.menu = null; m.reveal = false; m.toast = { text: `Copied ${B.disp(m.path)}` }; render(); return; }
      if (t.dataset.act === 'toastclose') { m.toast = null; render(); }
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && (m.menu || m.reveal)) { m.menu = null; m.reveal = false; render(); return; }
      if (ev.target.closest && ev.target.closest('input')) { if (ev.key === 'Enter') { m.reveal = false; render(); } return; }
      if (ev.metaKey && ev.key.toLowerCase() === 'l') { ev.preventDefault(); m.reveal = true; render(); return; }
      const n = Number(ev.key);
      if (n >= 1 && n <= states.length && !ev.metaKey && !ev.ctrlKey) load(states[n - 1][0]);
      if (ev.key === 'Enter' && ev.target.closest && ev.target.closest('.frow[data-go]')) go(ev.target.closest('.frow').dataset.go);
      if ((ev.metaKey && ev.key === 'ArrowUp') || (ev.key === 'Backspace' && !ev.target.closest('input'))) { if (m.path.length) go(m.path.slice(0, -1).join('/')); }
    });
    // Forced hover / focus give way to the real pointer and keyboard.
    document.addEventListener('pointerover', (ev) => {
      if (m && (m.hover != null || m.focus != null) && stage.contains(ev.target) && ev.target.closest('.pbar')) {
        m.hover = m.focus = null; stage.querySelectorAll('.is-hover,.is-focus').forEach((el) => el.classList.remove('is-hover', 'is-focus'));
      }
    });

    // Live drag: a video onto a segment, a hidden-folder menu item or a folder row moves it there.
    let dragId = null;
    document.addEventListener('dragstart', (ev) => {
      const row = ev.target.closest && ev.target.closest('[data-row]');
      if (!row) return;
      dragId = row.dataset.row;
      ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', dragId);
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    document.addEventListener('dragover', (ev) => {
      if (!dragId) return;
      const t = ev.target.closest && ev.target.closest('[data-dropseg],[data-droprow],[data-more]');
      stage.querySelectorAll('.drop-hot').forEach((el) => { if (el !== t) el.classList.remove('drop-hot'); });
      if (!t) return;
      ev.preventDefault();
      t.classList.add('drop-hot');
      if (t.hasAttribute('data-more') && m.menu !== 'more') { m.menu = 'more'; const keep = dragId; draw(); place(); dragId = keep; }
    });
    document.addEventListener('drop', (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-dropseg],[data-droprow]');
      if (!dragId || !t) return;
      ev.preventDefault();
      const it = P.items().find((x) => x.id === dragId);
      const name = t.dataset.dropseg != null ? B.segs(m)[Number(t.dataset.dropseg)].name : t.dataset.go.split('/').pop();
      m.moved.push(dragId); m.menu = null; m.toast = { text: `Moved “${it.title.slice(0, 30)}${it.title.length > 30 ? '…' : ''}” to ${name}` };
      dragId = null; render();
    });
    document.addEventListener('dragend', () => { if (dragId) { dragId = null; render(); } });
    load(state);
  };

  /** Every option shows these states. */
  B.STATES = [
    ['root', 'At the root', (m) => {}],
    ['one', 'One level', (m) => { m.path = ['Road trips']; }],
    ['three', 'Three levels', (m) => { m.path = [...B.THREE]; }],
    ['long', 'Long names · 960px', (m) => { m.path = [...B.LONG]; m.width = 960; }],
    ['long-menu', '“…” opened · 960px', (m) => { m.path = [...B.LONG]; m.width = 960; m.menu = 'more'; }],
    ['hover', 'Hover a segment', (m) => { m.path = [...B.THREE]; m.hover = 2; }],
    ['focus', 'Keyboard focus', (m) => { m.path = [...B.THREE]; m.focus = 1; }],
    ['drop', 'Drag onto a segment', (m) => { m.path = [...B.THREE]; m.drop = 1; m.drag = 'i15'; }],
    ['path', 'Full disk path', (m) => { m.path = [...B.THREE]; m.reveal = true; }],
  ];
})();
