// Shared data, window mock and state switcher for the update-experience prototypes.
(function () {
  const P = window.SnagProto = {};
  P.CUR = '1.0.0';
  P.NEXT = '1.1.0';
  P.GOT = 38; P.SIZE = 92;
  P.PCT = Math.round(P.GOT / P.SIZE * 100);
  P.REMIND = '3:45 PM';
  P.ACTIVE = 2;
  P.STATES = [
    ['checking', 'Checking'], ['uptodate', 'Up to date'], ['downloading', 'Downloading'], ['ready', 'Ready'],
    ['notes', 'What’s new'], ['blocked', 'Blocked'], ['deferred', 'Later'], ['installing', 'Installing'], ['error', 'Error'],
  ];
  P.NOTES = [
    ['new', 'Accent colours', 'Pick Orange, Cobalt, Violet, Mint or Magenta. Chrome follows along.'],
    ['new', 'Saved shelf previews', 'Hover a thumbnail to see a few seconds of the video.'],
    ['better', 'Expired links', 'Reopen the page and SnagThis carries on from where it stopped.'],
    ['fixed', 'Big files', 'Downloads over 4 GB no longer stall at 99%.'],
    ['fixed', 'Windows', 'The window remembers its size on high-DPI screens.'],
  ];
  P.RAW = 'Error: net::ERR_CONNECTION_RESET\n  GET https://github.com/dylansallred/snagthis/releases/download/v1.1.0/SnagThis-1.1.0-arm64-mac.zip\n  at ClientRequest.<anonymous> (electron-updater/out/httpExecutor.js:318)\n  received 39845888 of 96468992 bytes';
  P.ACCENTS = {
    orange: ['#fa5d0e', 'hsl(18 96% 40%)', 'hsl(18 96% 36%)', 'hsl(20 96% 52%)', 'hsl(16 58% 16%)', '#fa5d0e', '#fa5d0e', '#ffb238', '#bd3f00'],
    cobalt: ['#3b7bff', 'hsl(220 80% 50%)', 'hsl(220 80% 45%)', 'hsl(218 95% 63%)', 'hsl(220 50% 18%)', '#4a88ff', '#3b7bff', '#a3c6ff', '#1d44b0'],
    violet: ['#8b5cf6', 'hsl(262 70% 54%)', 'hsl(262 70% 48%)', 'hsl(262 90% 70%)', 'hsl(262 45% 20%)', '#9b78ff', '#8b5cf6', '#d0bcff', '#5528b8'],
    mint: ['#1fbf8a', 'hsl(160 84% 28%)', 'hsl(160 84% 24%)', 'hsl(158 70% 50%)', 'hsl(160 50% 13%)', '#26d996', '#1fbf8a', '#a4f3cc', '#0d7a57'],
    magenta: ['#e8388e', 'hsl(330 75% 46%)', 'hsl(330 75% 41%)', 'hsl(330 90% 64%)', 'hsl(330 50% 18%)', '#f550a0', '#e8388e', '#ffb3d6', '#9c1558'],
  };
  P.setAccent = (id) => {
    const a = P.ACCENTS[id] || P.ACCENTS.orange, s = document.documentElement.style;
    [['--color-primary', 1], ['--color-primary-strong', 2], ['--color-primary-hover', 3], ['--color-primary-muted', 4], ['--accent-logo', 5], ['--accent-bevel-face', 6], ['--accent-bevel-light', 7], ['--accent-bevel-dark', 8]].forEach(([k, i]) => s.setProperty(k, a[i]));
  };

  const ICONS = {
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    down: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    retry: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    sparkle: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  };
  P.icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  P.spin = () => `<span class="pspin" aria-hidden="true">${'<i></i>'.repeat(9)}</span>`;
  /** Segmented update progress in the accent; `pct` null marches (indeterminate). */
  P.upbar = (pct, cells = 24, h = 8, label = 'Update download') => {
    if (pct == null) return `<div class="upbar march" style="--cells:${cells};--h:${h}px" role="progressbar" aria-label="${label}">${Array.from({ length: cells }, (_, n) => `<i style="--n:${n}"></i>`).join('')}</div>`;
    const exact = pct / 100 * cells, full = Math.floor(exact), frac = Math.round((exact - full) * 100);
    return `<div class="upbar" style="--cells:${cells};--h:${h}px" role="progressbar" aria-label="${label}" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">${Array.from({ length: cells }, (_, n) => n < full ? '<i class="on"></i>' : n === full && pct < 100 ? `<i class="cur" style="--f:${Math.max(frac, 20)}%"></i>` : '<i></i>').join('')}</div>`;
  };
  P.notesList = (limit) => `<ul class="relnotes">${P.NOTES.slice(0, limit || P.NOTES.length).map(([tag, title, text]) => `<li><b class="tag ${tag}">${tag}</b><div><b style="font-weight:600">${title}.</b> <span>${text}</span></div></li>`).join('')}</ul>`;
  P.errorDetails = () => `<details class="details"><summary>Details</summary><pre>${P.RAW.replace(/</g, '&lt;')}</pre></details>`;
  P.button = (size = 16) => window.SNAG_BUTTON.replace('class="pbtn"', `class="pbtn" style="width:${size}px;height:${size}px"`);

  const MEDIA = '../../sample-media/1-pixel/';
  const pieces = (done, cls = '') => `<div class="pieces ${cls}">${Array.from({ length: 40 }, (_, n) => n < done ? '<i class="d"></i>' : n === done ? '<i class="c"></i>' : '<i></i>').join('')}</div>`;
  P.rows = () => [
    { img: 'sky-hop.jpg', t: 'Sky Hop — director’s commentary', d: '24:18', s: 'Link expired. Reopen the page to continue from 48%.', warn: 1, p: pieces(19, 'idle'), a: '<span class="btn" style="background:none;box-shadow:inset 0 0 0 1px var(--color-border)">Open page</span>' },
    { img: 'neon-rain.jpg', t: 'Neon Rain — night drive', d: '12:37', s: '34% · 5 min left', p: pieces(13, 'live'), a: `<span class="iconbtn">${P.icon('pause')}</span>` },
    { img: '', t: 'Behind the pixels — how Neon Rain was drawn', d: '9:54', s: '18% · 1 min left', p: pieces(7, 'live'), a: `<span class="iconbtn">${P.icon('pause')}</span>` },
    { img: 'star-courier.jpg', t: 'Star Courier — arcade run', d: '8:05', s: 'Paused at 48%', p: pieces(19, 'idle'), a: `<span class="iconbtn">${P.icon('play')}</span>` },
    { img: 'ember-tide.jpg', t: 'Ember Tide — sunset crossing', d: '22:14', s: '<span style="color:#dce0e5">1080p</span> · 412 MB · Saved', p: '', a: '' },
    { img: 'sky-hop.jpg', t: 'Sky Hop — a play button’s day out', d: '5:42', s: 'Waiting · starts next', p: '', a: '' },
  ].map((r) => `<div class="vrow"><div class="thumb" style="${r.img ? `background-image:url(${MEDIA}${r.img})` : ''}">${r.img ? '' : '• • •'}</div><div class="tt"><b>${r.t}</b><small>${r.d}</small><div class="${r.warn ? 'warn' : ''}">${r.s}</div></div><div class="act">${r.a}</div>${r.p}</div>`).join('');

  /** The main window; slots let each direction place its surfaces. */
  P.win = ({ topExtra = '', banner = '', footExtra = '', overlay = '', dim = false, listOverlay = '' } = {}) => `
    <div class="win${dim ? ' dim-list' : ''}">
      <header class="top chrome-tex"><div class="lights"><i></i><i></i><i></i></div>${window.SNAG_LOGO}
        <div class="paste">${P.icon('link')}<span>Paste a video link</span><kbd>⌘V</kbd></div>
        <div class="topnav">${topExtra}<nav class="tabs"><span class="sel">All</span><span>Downloading</span><span>Saved</span></nav><span class="iconbtn">${P.icon('search')}</span></div>
      </header>
      ${banner}
      <div class="list">${P.rows()}${listOverlay}</div>
      <footer class="foot chrome-tex"><span>${P.ACTIVE} downloading · 6.96 MB/s</span><span class="sp"></span>${footExtra}<span class="cmd"><kbd>⌘K</kbd>Commands</span><span class="iconbtn">${P.icon('more')}</span><span class="iconbtn">${P.icon('folder')}</span><span class="iconbtn">${P.icon('gear')}</span></footer>
      ${overlay}
    </div>`;

  /**
   * cfg: { view(state, ctx) -> window slots, card(state, ctx) -> html, notes: {state: html}, toggles: [{key,label}],
   *        ctx: initial context, cardMin }
   * URL: #state=ready&accent=cobalt&<toggle>=0|1 so screenshots can deep-link.
   */
  P.mount = (cfg) => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const ctx = Object.assign({}, cfg.ctx || {});
    for (const [k, v] of hash) if (k in ctx) ctx[k] = v === '1';
    let state = hash.get('state') || cfg.initial || 'ready', accent = hash.get('accent') || 'orange';
    const toolbar = document.getElementById('toolbar'), stage = document.getElementById('window'), notes = document.getElementById('state-notes'), grid = document.getElementById('grid');
    if (cfg.cardMin) grid.style.setProperty('--card-min', cfg.cardMin);
    const syncHash = () => { const h = new URLSearchParams({ state, accent }); for (const k of Object.keys(ctx)) h.set(k, ctx[k] ? '1' : '0'); history.replaceState(null, '', '#' + h); };
    const renderToolbar = () => {
      toolbar.innerHTML = `<div class="seg" role="group" aria-label="Update state">${P.STATES.map(([id, label], i) => `<button data-state="${id}" aria-pressed="${id === state}"><em>${i + 1}</em>${label}</button>`).join('')}</div>
        <div class="swatches" role="group" aria-label="Accent">${Object.keys(P.ACCENTS).map((id) => `<button data-accent="${id}" title="${id}" aria-label="${id}" aria-pressed="${id === accent}" style="--s:${P.ACCENTS[id][0]}"></button>`).join('')}</div>
        ${(cfg.toggles || []).map((t) => `<label class="check"><input type="checkbox" data-ctx="${t.key}" ${ctx[t.key] ? 'checked' : ''}>${t.label}</label>`).join('')}`;
    };
    const render = () => {
      P.setAccent(accent);
      stage.innerHTML = P.win(cfg.view(state, ctx));
      notes.innerHTML = (typeof cfg.notes === 'function' ? cfg.notes(state, ctx) : cfg.notes[state]) || '';
      grid.innerHTML = P.STATES.map(([id, label], i) => `<article class="card" data-card="${id}"><header><em>${i + 1}</em>${label}<small>${cfg.cardHint ? cfg.cardHint(id) : ''}</small></header>${cfg.card(id, Object.assign({}, ctx, cfg.cardCtx || {}))}</article>`).join('');
      renderToolbar();
      syncHash();
    };
    document.addEventListener('click', (event) => {
      const t = event.target.closest('[data-state],[data-accent],[data-go],[data-flip]');
      if (!t) return;
      if (t.dataset.state) state = t.dataset.state;
      else if (t.dataset.accent) accent = t.dataset.accent;
      else if (t.dataset.go) { if (t.closest('.card')) return; state = t.dataset.go; if (t.dataset.set) t.dataset.set.split(',').forEach((kv) => { const [k, v] = kv.split('='); ctx[k] = v === '1'; }); }
      else if (t.dataset.flip) { if (t.closest('.card')) return; ctx[t.dataset.flip] = !ctx[t.dataset.flip]; }
      event.preventDefault();
      render();
    });
    document.addEventListener('change', (event) => {
      const k = event.target.dataset && event.target.dataset.ctx;
      if (!k) return;
      ctx[k] = event.target.checked;
      render();
    });
    document.addEventListener('keydown', (event) => {
      if (event.target.closest('input,textarea')) return;
      const n = Number(event.key);
      if (n >= 1 && n <= P.STATES.length) { state = P.STATES[n - 1][0]; render(); }
    });
    render();
  };
})();
