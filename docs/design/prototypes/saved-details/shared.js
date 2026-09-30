// Saved-video details studies: the real window (header, All tab, saved rows), one expandable saved row per sample
// item, forced states for screenshots, hover-style and motion switchers, and the Remove… popover.
// Reuses ../organize/shared.js (Org: icons, quality badge, window chrome, accents) and ../organize/brand.js (logo).
// Each option page calls SD.mount({ id, name, panel(item, m), notes(m), states }).
(function () {
  const P = window.Org;
  const SD = window.SD = {};
  const MEDIA = '../../sample-media/1-pixel/';
  SD.MEDIA = MEDIA;
  SD.esc = P.esc;
  SD.icon = P.icon;

  // Extra Lucide icons these panels need.
  const EXTRA = {
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    playTri: '<path d="M6 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L7.5 3.64A1 1 0 0 0 6 4.5Z"/>',
    audio: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.7"/>',
    captions: '<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4"/>',
    search2: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  };
  SD.i = (n, cls = '') => EXTRA[n] ? `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${EXTRA[n]}</svg>` : P.icon(n, cls);

  // Pixel folder in the accent's bevel colours (same geometry as organize/folder-rows R.glyph).
  SD.folderGlyph = (w = 16, kind = 'closed') => {
    const h = Math.round(w * 13 / 16);
    const r = (c, x, y, ww, hh) => `<rect class="${c}" x="${x}" y="${y}" width="${ww}" height="${hh}"/>`;
    const body = kind === 'open'
      ? r('b', 0, 0, 6, 2) + r('b', 0, 2, 16, 11) + r('p', 2, 2, 12, 5) + r('f', 1, 6, 15, 7) + r('l', 1, 6, 15, 1) + r('b', 1, 12, 15, 1)
      : r('b', 0, 0, 6, 2) + r('b', 0, 2, 16, 11) + r('f', 0, 4, 16, 9) + r('l', 0, 4, 16, 1) + r('b', 0, 12, 16, 1) + r('b', 15, 5, 1, 7);
    return `<svg class="pxf k-${kind}" width="${w}" height="${h}" viewBox="0 0 16 13" aria-hidden="true">${body}</svg>`;
  };
  SD.slash = () => '<svg class="pxm slash" width="5" height="12" viewBox="0 0 5 12" aria-hidden="true"><rect x="4" y="0" width="1" height="2"/><rect x="3" y="2" width="1" height="3"/><rect x="2" y="5" width="1" height="2"/><rect x="1" y="7" width="1" height="3"/><rect x="0" y="10" width="1" height="2"/></svg>';
  /** Path-bar "D · Minimal" crumbs: pixel folder + save folder, pixel "/", current folder in the accent. */
  SD.crumbs = (it, cls = '') => {
    const segs = ['SnagThis', ...it.folder];
    return `<nav class="crumbs ${cls}" aria-label="Folder">${segs.map((s, n) => `${n ? SD.slash() : ''}<button class="crumb${n === segs.length - 1 ? ' cur' : ''}" data-act="noop" title="Open ${SD.esc(s)}">${n === 0 ? SD.folderGlyph(16) + SD.folderGlyph(16, 'open') : ''}<span>${SD.esc(s)}</span></button>`).join('')}</nav>`;
  };
  SD.quality = (it) => it.h ? P.quality(it.h) : '';

  // Sample items. `probe` marks facts that only a file probe (ffprobe on expand) could supply today.
  SD.items = () => ({
    rich: {
      id: 'rich', img: 'ember-tide', frames: 'ember-tide',
      title: 'Harbour lights — the whole Pacific Coast Highway, Big Sur to Monterey at dusk (4K director’s cut, uncut drone passes)',
      dur: '1:12:48', h: 2160, res: '3840 × 2160', size: '8.4 GB', saved: 'yesterday', savedFull: 'Sun 27 Sep 2026, 21:14',
      folder: ['Road trips', 'Coast'], dir: '~/Movies/SnagThis/Road trips/Coast/',
      file: 'Harbour lights — the whole Pacific Coast Highway, Big Sur to Monterey at dusk.mp4',
      site: 'vimeo.com', siteMark: 'V', siteColor: '#1ab7ea', channel: 'Pixel Worlds Studio',
      pageTitle: 'Harbour lights — Pacific Coast Highway in 4K', page: 'https://vimeo.com/872114653/harbour-lights',
      container: 'MP4', vcodec: 'HEVC', vprofile: 'Main 10 · HDR10', fps: '60 fps', bitrate: '15.8 Mb/s',
      audio: [{ code: 'EN', lang: 'English', ch: 'Stereo', codec: 'AAC 256 kb/s', def: true, picked: true }, { code: 'JA', lang: 'Japanese', ch: '5.1', codec: 'AAC 384 kb/s' }],
      subs: [{ code: 'EN', lang: 'English', kind: 'In the file', picked: true }, { code: 'ES', lang: 'Spanish', kind: 'Side file · .srt' }],
    },
    minimal: {
      id: 'minimal', img: 'neon-rain', frames: '',
      title: 'neon-rain_final_v3', dur: '', h: 0, size: '412 MB', saved: '12 Sep', savedFull: 'Sat 12 Sep 2026, 09:02',
      folder: [], dir: '~/Movies/SnagThis/', file: 'neon-rain_final_v3.mp4', container: 'MP4',
      site: '', mediaHost: 'files.pixelworlds.tv', page: '', audio: [], subs: [],
    },
    missing: {
      id: 'missing', img: 'star-courier', frames: 'star-courier', missing: true,
      title: 'Star Courier — arcade run', dur: '1:48:10', h: 1080, res: '1920 × 1080', size: '2.4 GB', saved: 'Thursday', savedFull: 'Thu 24 Sep 2026, 18:40',
      folder: ['Watch later'], dir: '~/Movies/SnagThis/Watch later/', file: 'Star Courier — arcade run.mp4',
      site: 'twitch.tv', siteMark: 'T', siteColor: '#9146ff', channel: 'courier_speedruns', pageTitle: 'Star Courier any% — arcade run', page: 'https://www.twitch.tv/videos/2238810044',
      container: 'MP4', audio: [{ code: 'EN', lang: 'English', ch: 'Stereo', codec: 'AAC', picked: true }], subs: [],
    },
  });
  const FILLER = [
    { id: 'f1', img: 'sky-hop', title: 'Sky Hop — a play button’s day out', dur: '5:42', h: 720, size: '96 MB', saved: 'today', folder: [] },
    { id: 'f2', img: 'neon-rain', title: 'Neon Rain — night drive', dur: '12:37', h: 1080, size: '412 MB', saved: 'Tuesday', folder: ['Road trips'] },
  ];

  SD.finder = (m) => m.os === 'win' ? 'Show in Explorer' : 'Show in Finder';
  /** Is this fact visible under the Data switch? kind: 'today' | 'probe' | 'new' (new plumbing other than probe). */
  SD.has = (m, kind) => m.data !== 'today' || kind === 'today';
  /** Marker class for facts that need new plumbing (visible with Data ▸ Mark new). */
  SD.nw = (m, kind) => m.data === 'mark' && kind !== 'today' ? ` data-new="${kind === 'probe' ? 'probe' : 'new'}"` : '';

  // ── Rows ──
  const dot = '<span class="dot" aria-hidden="true">·</span>';
  const clip = (it) => it.img ? `<video class="loop" muted loop playsinline preload="none" poster="${MEDIA}${it.img}.jpg" src="${MEDIA}${it.img}.mp4"></video>` : '';
  SD.clip = clip;
  function row(it, m) {
    const st = it.missing ? '<div class="st warn">File was moved or deleted</div>'
      : `<div class="st">${[SD.quality(it), `<span>${it.size}</span>`, `<span class="ok">${P.icon('check')}Saved ${it.saved}</span>`, it.folder && it.folder.length ? `<span class="loc">${P.icon('folder')}${SD.esc(it.folder[it.folder.length - 1])}</span>` : ''].filter(Boolean).join(dot)}</div>`;
    const act = it.missing ? `<button class="btnb" data-act="noop" aria-label="Locate: ${SD.esc(it.title)}">Locate</button>`
      : `<button class="iconbtn play" data-act="noop" aria-label="Play: ${SD.esc(it.title)}" title="Play">${P.icon('play')}</button>`;
    return `<div class="vrow${it.missing ? ' missing' : ''}${m.hot === it.id ? ' hot' : ''}" tabindex="0" role="button" aria-expanded="${m.open === it.id}" aria-controls="details-${it.id}" data-toggle="${it.id}" aria-label="${SD.esc(it.title)}">
      <div class="thumb pv" style="background-image:url(${MEDIA}${it.img}.jpg)">${it.missing ? '' : clip(it)}</div>
      <div class="tt"><div class="h"><b title="${SD.esc(it.title)}">${SD.esc(it.title)}</b>${it.dur ? `<small>${it.dur}</small>` : ''}</div>${st}</div>
      <div class="act"><span class="hx">${it.missing ? '' : `<button class="iconbtn" data-act="noop" aria-label="${SD.finder(m)}" title="${SD.finder(m)}">${P.icon('folder')}</button>`}<button class="iconbtn" data-act="noop" aria-label="More">${P.icon('more')}</button></span>${act}</div>
    </div>`;
  }

  /** The Remove… popover (§9): two choices, list removal is the default; Trash is explicit. */
  SD.removePop = (it, m) => `<div class="pop confirm rmpop" role="dialog" aria-label="Remove" data-remove-pop>
      <span class="caret"></span>
      <h4 title="${SD.esc(it.title)}">${SD.esc(it.title)}</h4>
      <button class="choice" role="radio" aria-checked="${m.rmChoice !== 'trash'}" data-act="rmchoice" data-arg="list"><span class="radio"></span><span><b>Remove from list</b><small>The file stays in ${SD.esc(it.folder.length ? it.folder[it.folder.length - 1] : 'SnagThis')}.</small></span></button>
      ${it.missing ? '' : `<button class="choice danger" role="radio" aria-checked="${m.rmChoice === 'trash'}" data-act="rmchoice" data-arg="trash"><span class="radio"></span><span><b>Move file to Trash</b><small>${it.size} goes to the Trash with its subtitles and poster. You can put it back from there.</small></span></button>`}
      <div class="acts"><button class="btn quiet" data-act="rmclose">Cancel</button><button class="btn ${m.rmChoice === 'trash' ? 'danger' : 'primary'}" data-act="rmclose">${m.rmChoice === 'trash' ? 'Move to Trash' : 'Remove from list'}</button></div>
    </div>`;

  /** A "Copy page link" button with Sheets-snap feedback (§7). */
  SD.copyBtn = (cls, label = 'Copy page link', attrs = '') => `<button class="sa ${cls} copy" data-act="copy" data-label="${label}"${attrs}>${SD.i('link')}<span class="lbl">${label}</span></button>`;

  const STATES = [
    ['rich', 'Rich item'], ['minimal', 'Minimal item'], ['missing', 'Missing file'],
    ['hover', 'Hover'], ['focus', 'Keyboard focus'], ['remove', 'Remove…'], ['narrow', 'Narrow 820px'],
  ];

  SD.mount = (cfg) => {
    const states = [...STATES, ...(cfg.states || [])];
    const m = { state: 'rich', open: 'rich', hover: 'h1', data: 'probe', os: 'mac', accent: 'orange', rm: false, slow: false, tab: 'overview', removeOpen: false, rmChoice: 'list', hot: null, force: '' };
    const items = SD.items();
    const root = document.getElementById('window');
    const tb = document.getElementById('toolbar');
    const notes = document.getElementById('state-notes');

    function applyState(s) {
      m.state = s; m.removeOpen = false; m.force = ''; m.hot = null; m.tab = 'overview'; m.width = 1200; m.scrub = null;
      m.open = s === 'minimal' ? 'minimal' : s === 'missing' ? 'missing' : 'rich';
      if (s === 'hover') { m.force = 'hover'; m.hot = 'rich'; }
      if (s === 'focus') m.force = 'focus';
      if (s === 'remove') m.removeOpen = true;
      if (s === 'narrow') m.width = 820;
      const extra = (cfg.states || []).find((x) => x[0] === s);
      if (extra && extra[2]) extra[2](m);
    }

    const seg = (label, key, opts) => `<span>${label}</span><div class="seg">${opts.map(([v, t, em]) => `<button data-set="${key}" data-val="${v}" aria-pressed="${String(m[key]) === String(v)}">${em ? `<em>${em}</em>` : ''}${t}</button>`).join('')}</div>`;
    function toolbar() {
      tb.innerHTML = `<span>State</span><div class="seg">${states.map(([id, t], n) => `<button data-state="${id}" aria-pressed="${m.state === id}"><em>${n + 1}</em>${t}</button>`).join('')}</div>
        ${seg('Hover', 'hover', [['h1', 'Bevel lift', 'H1'], ['h2', 'Sweep', 'H2'], ['h3', 'Pixel shine', 'H3']])}
        <span>Motion</span><div class="seg"><button data-motion="open">▶ Replay open</button><button data-motion="close">Replay close</button><button data-set="slow" data-val="${!m.slow}" aria-pressed="${m.slow}">Slow ×4</button><button data-set="rm" data-val="${!m.rm}" aria-pressed="${m.rm}">Reduced motion</button></div>
        ${seg('Data', 'data', [['today', 'Today'], ['probe', '+ File probe'], ['mark', 'Mark new']])}
        ${seg('OS', 'os', [['mac', 'macOS'], ['win', 'Windows']])}
        <span class="swatches">${Object.entries(P.ACCENTS).map(([k, a]) => `<button data-accent="${k}" aria-pressed="${m.accent === k}" style="--s:${a[0]}" aria-label="${k}"></button>`).join('')}</span>`;
    }
    function setAccent(id) {
      const a = P.ACCENTS[id] || P.ACCENTS.orange, s = document.documentElement.style;
      [['--color-primary', 1], ['--color-primary-strong', 2], ['--color-primary-hover', 3], ['--color-primary-muted', 4], ['--accent-logo', 5], ['--accent-bevel-face', 6], ['--accent-bevel-light', 7], ['--accent-bevel-dark', 8]].forEach(([k, i]) => s.setProperty(k, a[i]));
    }

    function render() {
      toolbar();
      const order = [FILLER[0], items.rich, items.minimal, items.missing, FILLER[1]];
      const list = order.map((it) => {
        const open = m.open === it.id;
        const panel = items[it.id] ? `<div class="drawer"><div class="clip"><div class="pw" id="details-${it.id}" role="region" aria-label="Details: ${SD.esc(it.title)}">${cfg.panel(it, m)}</div></div></div>` : '';
        return `<div class="item${open ? ' open' : ''}" data-item="${it.id}">${row(it, m)}${panel}</div>`;
      }).join('');
      const html = P.win({ tab: 'all', sel: [], drag: null, toast: null }, { list, over: '' });
      root.innerHTML = html;
      const win = root.querySelector('.win');
      win.classList.add('sdwin', 'opt-' + cfg.id);
      win.dataset.hover = m.hover;
      win.dataset.force = m.force;
      win.style.setProperty('--ww', m.width + 'px');
      win.style.setProperty('--k', m.slow ? 4 : 1);
      win.classList.toggle('rm', m.rm);
      const op = root.querySelector('.item.open'), lst = root.querySelector('.list');
      if (op && lst) { const over = op.offsetTop + op.offsetHeight - lst.clientHeight; if (over > 0) lst.scrollTop = Math.min(op.offsetTop - 4, over + 2); }
      if (m.removeOpen) placeRemove();
      notes.innerHTML = cfg.notes(m);
      wire();
      if (m.force === 'hover') forceHover();
    }

    function placeRemove() {
      const it = items[m.open];
      const btn = root.querySelector(`.item.open [data-act="remove"]`);
      const win = root.querySelector('.win');
      if (!btn) return;
      win.insertAdjacentHTML('beforeend', SD.removePop(it, m));
      const pop = win.querySelector('[data-remove-pop]');
      const b = btn.getBoundingClientRect(), w = win.getBoundingClientRect();
      const left = Math.max(12, Math.min(b.right - w.left - 330 + 10, w.width - 342));
      const below = b.bottom - w.top + 8;
      const fitsBelow = below + pop.offsetHeight < w.height - 50;
      pop.style.left = left + 'px';
      pop.style.top = (fitsBelow ? below : b.top - w.top - pop.offsetHeight - 8) + 'px';
      const caret = pop.querySelector('.caret');
      caret.style.left = (b.left + b.width / 2 - w.left - left - 5) + 'px';
      if (!fitsBelow) { caret.style.top = 'auto'; caret.style.bottom = '-5px'; }
    }
    function forceHover() {
      root.querySelectorAll('.item.open [data-hover-demo]').forEach((el) => el.classList.add('is-hover'));
      const pv = root.querySelector('.item.open .pw .pv');
      if (pv) pv.classList.add('is-hover');
    }

    // ── Open / close with the option's motion ──
    const dur = (name) => {
      const win = root.querySelector('.win');
      const v = parseFloat(getComputedStyle(win).getPropertyValue(name)) || 300;
      return v * (m.slow ? 4 : 1) + 40;
    };
    let timer = 0;
    SD.open = (id) => {
      clearTimeout(timer);
      root.querySelectorAll('.item.open').forEach((el) => { if (el.dataset.item !== id) SD.close(el.dataset.item); });
      const el = root.querySelector(`.item[data-item="${id}"]`);
      if (!el || !el.querySelector('.drawer')) return;
      el.classList.remove('closing', 'anim-in');
      void el.offsetWidth;
      el.classList.add('open', 'anim-in');
      el.querySelector('.vrow').setAttribute('aria-expanded', 'true');
      m.open = id;
      if (!SD.hold) timer = setTimeout(() => el.classList.remove('anim-in'), dur('--open-total'));
    };
    SD.close = (id, done) => {
      const el = root.querySelector(`.item[data-item="${id}"]`);
      if (!el) return;
      el.classList.remove('anim-in');
      el.classList.add('closing');
      el.querySelector('.vrow').setAttribute('aria-expanded', 'false');
      if (m.open === id) m.open = null;
      root.querySelectorAll('[data-remove-pop]').forEach((p) => p.remove());
      m.removeOpen = false;
      if (!SD.hold) setTimeout(() => { el.classList.remove('open', 'closing'); if (done) done(); }, dur('--close-total'));
    };
    /** Capture hook: finish the current transition immediately. */
    SD.settle = () => { root.querySelectorAll('.item').forEach((el) => { el.classList.remove('anim-in'); if (el.classList.contains('closing')) el.classList.remove('open', 'closing'); }); };

    function wire() {
      root.querySelectorAll('[data-toggle]').forEach((r) => {
        const id = r.dataset.toggle;
        const toggle = () => { if (!items[id]) return; if (r.closest('.item').classList.contains('open')) SD.close(id); else SD.open(id); };
        r.addEventListener('click', (e) => { if (e.target.closest('button')) return; toggle(); });
        r.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); toggle(); } });
      });
      // Hover/focus loops: the row thumbnail and any panel preview play a silent clip.
      root.querySelectorAll('.pv').forEach((pv) => {
        const v = pv.querySelector('video.loop');
        if (!v) return;
        const host = pv.classList.contains('thumb') ? pv.closest('.vrow') : pv;
        const on = () => { if (root.querySelector('.win').classList.contains('rm')) return; v.play().then(() => pv.classList.add('playing')).catch(() => {}); };
        const off = () => { v.pause(); v.currentTime = 0; pv.classList.remove('playing'); };
        host.addEventListener('mouseenter', on); host.addEventListener('mouseleave', off);
        host.addEventListener('focusin', on); host.addEventListener('focusout', off);
      });
      root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = b.dataset.act;
        if (a === 'tab') { m.tab = b.dataset.arg; const pw = b.closest('.pw'); pw.innerHTML = cfg.panel(items[pw.id.replace('details-', '')], m); wire(); }
        if (a === 'remove') { root.querySelectorAll('[data-remove-pop]').forEach((p) => p.remove()); m.removeOpen = !m.removeOpen; if (m.removeOpen) { placeRemove(); wirePop(); } }
        if (a === 'copy') {
          b.classList.remove('copied'); void b.offsetWidth; b.classList.add('copied');
          b.querySelector('.lbl').textContent = 'Copied';
          clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('copied'); b.querySelector('.lbl').textContent = b.dataset.label; }, 1500);
        }
        if (a === 'scrub') {
          const pw = b.closest('.pw');
          pw.querySelectorAll('[data-act="scrub"]').forEach((x) => x.classList.toggle('on', x === b));
          const big = pw.querySelector('.pv');
          if (big) big.style.backgroundImage = `url(${b.dataset.src})`;
          const tc = pw.querySelector('[data-tc]'); if (tc) tc.textContent = b.dataset.tc;
          const head = pw.querySelector('.scrub-head'); if (head) head.style.left = b.dataset.pct + '%';
        }
      }));
      root.querySelectorAll('[data-act="scrub"]').forEach((b) => b.addEventListener('mouseenter', () => b.click()));
      wirePop();
    }
    function wirePop() {
      root.querySelectorAll('[data-remove-pop] [data-act]').forEach((b) => b.onclick = (e) => {
        e.stopPropagation();
        if (b.dataset.act === 'rmchoice') { m.rmChoice = b.dataset.arg; root.querySelectorAll('[data-remove-pop]').forEach((p) => p.remove()); placeRemove(); wirePop(); }
        if (b.dataset.act === 'rmclose') { m.removeOpen = false; root.querySelectorAll('[data-remove-pop]').forEach((p) => p.remove()); }
      });
    }

    tb.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.state) { applyState(b.dataset.state); render(); }
      else if (b.dataset.set) { const k = b.dataset.set, v = b.dataset.val; m[k] = v === 'true' ? true : v === 'false' ? false : v; render(); }
      else if (b.dataset.accent) { m.accent = b.dataset.accent; setAccent(m.accent); toolbar(); }
      else if (b.dataset.motion === 'open') {
        const id = m.open || 'rich';
        const el = root.querySelector(`.item[data-item="${id}"]`);
        el.classList.remove('open', 'anim-in', 'closing'); void el.offsetWidth;
        setTimeout(() => SD.open(id), 120);
      } else if (b.dataset.motion === 'close') {
        const id = m.open || 'rich';
        const el = root.querySelector(`.item[data-item="${id}"]`);
        if (!el.classList.contains('open')) { el.classList.add('open'); void el.offsetWidth; }
        SD.close(id, () => setTimeout(() => SD.open(id), 700));
      }
    });
    const q = new URLSearchParams(location.search);
    if (q.get('state')) applyState(q.get('state'));
    if (q.get('hover')) m.hover = q.get('hover');
    SD.model = m; SD.render = render; SD.applyState = applyState;
    render();
  };
})();
