// Clickable storyboards for the simpler update studies. Builds on ../updates/shared.js (SnagProto):
// icons, accent tokens, update meter and notes. URL: #s=<scenario>&f=<frame>&accent=<id>.
(function () {
  const P = window.SnagProto;
  const S = window.Story = {};
  const V = P.NEXT, CUR = P.CUR;
  S.V = V; S.CUR = CUR;
  const MEDIA = '../../sample-media/1-pixel/';

  const pieces = (done, cls = '') => `<div class="pieces ${cls}">${Array.from({ length: 40 }, (_, n) => n < done ? '<i class="d"></i>' : n === done ? '<i class="c"></i>' : '<i></i>').join('')}</div>`;
  const ROWS = {
    busy: [
      { img: 'neon-rain.jpg', t: 'Neon Rain — night drive', d: '12:37', s: '34% · 5 min left', p: pieces(13, 'live'), a: `<span class="iconbtn">${P.icon('pause')}</span>` },
      { img: '', t: 'Behind the pixels — how Neon Rain was drawn', d: '9:54', s: '18% · 1 min left', p: pieces(7, 'live'), a: `<span class="iconbtn">${P.icon('pause')}</span>` },
      { img: 'star-courier.jpg', t: 'Star Courier — arcade run', d: '8:05', s: 'Waiting · starts next', p: '', a: '' },
    ],
    done: [
      { img: 'neon-rain.jpg', t: 'Neon Rain — night drive', d: '12:37', s: '<span style="color:#dce0e5">1080p</span> · 1.2 GB · Saved just now', p: '', a: '' },
      { img: '', t: 'Behind the pixels — how Neon Rain was drawn', d: '9:54', s: '<span style="color:#dce0e5">720p</span> · 380 MB · Saved just now', p: '', a: '' },
      { img: 'star-courier.jpg', t: 'Star Courier — arcade run', d: '8:05', s: '<span style="color:#dce0e5">1080p</span> · 640 MB · Saved just now', p: '', a: '' },
    ],
    resumed: [
      { img: 'neon-rain.jpg', t: 'Neon Rain — night drive', d: '12:37', s: '35% · picking up where it left off', p: pieces(14, 'live'), a: `<span class="iconbtn">${P.icon('pause')}</span>` },
      { img: '', t: 'Behind the pixels — how Neon Rain was drawn', d: '9:54', s: '19% · picking up where it left off', p: pieces(8, 'live'), a: `<span class="iconbtn">${P.icon('pause')}</span>` },
      { img: 'star-courier.jpg', t: 'Star Courier — arcade run', d: '8:05', s: 'Waiting · starts next', p: '', a: '' },
    ],
    saved: [
      { img: 'ember-tide.jpg', t: 'Ember Tide — sunset crossing', d: '22:14', s: '<span style="color:#dce0e5">1080p</span> · 412 MB · Saved today', p: '', a: '' },
      { img: 'sky-hop.jpg', t: 'Sky Hop — a play button’s day out', d: '5:42', s: '<span style="color:#dce0e5">720p</span> · 96 MB · Saved today', p: '', a: '' },
      { img: 'star-courier.jpg', t: 'Star Courier — boss stage', d: '5:12', s: '<span style="color:#dce0e5">1080p</span> · 210 MB · Saved yesterday', p: '', a: '' },
    ],
  };
  const TAIL = [
    { img: 'sky-hop.jpg', t: 'Sky Hop — director’s commentary', d: '24:18', s: '<span style="color:#dce0e5">1080p</span> · 1.4 GB · Saved yesterday', p: '', a: '' },
    { img: 'ember-tide.jpg', t: 'Ember Tide — director’s cut', d: '22:14', s: '<span style="color:#dce0e5">1080p</span> · 182 MB · Saved Monday', p: '', a: '' },
    { img: 'neon-rain.jpg', t: 'Neon Rain — rooftop chase', d: '6:48', s: '<span style="color:#dce0e5">720p</span> · 88 MB · Saved Monday', p: '', a: '' },
  ];
  const rows = (mode) => [...(ROWS[mode] || ROWS.saved), ...TAIL].map((r) => `<div class="vrow"><div class="thumb" style="${r.img ? `background-image:url(${MEDIA}${r.img})` : ''}">${r.img ? '' : '• • •'}</div><div class="tt"><b>${r.t}</b><small>${r.d}</small><div>${r.s}</div></div><div class="act">${r.a}</div>${r.p}</div>`).join('');
  const FOOT = { busy: '2 downloading · 6.96 MB/s', resumed: '2 downloading · 6.40 MB/s', done: '3 saved just now', saved: 'Nothing downloading' };

  /** The main window. mode: busy | done | resumed | saved. */
  S.win = ({ mode = 'saved', chip = '', overlay = '', dim = false, cls = '' } = {}) => `
    <div class="win${dim ? ' dim-list' : ''} ${cls}">
      <header class="top chrome-tex"><div class="lights"><i></i><i></i><i></i></div>${window.SNAG_LOGO}
        <div class="paste">${P.icon('link')}<span>Paste a video link</span><kbd>⌘V</kbd></div>
        <div class="topnav">${chip}<nav class="tabs"><span class="sel">All</span><span>Downloading</span><span>Saved</span></nav><span class="iconbtn">${P.icon('search')}</span></div>
      </header>
      <div class="list">${rows(mode)}</div>
      <footer class="foot chrome-tex"><span>${FOOT[mode]}</span><span class="sp"></span><span class="cmd"><kbd>⌘K</kbd>Commands</span><span class="iconbtn">${P.icon('more')}</span><span class="iconbtn">${P.icon('folder')}</span><span class="iconbtn">${P.icon('gear')}</span></footer>
      ${overlay}
    </div>`;

  const hot = (next) => next === false ? '' : ` hotspot" data-next="${next === undefined ? 1 : next}`;
  /** Chip kinds: new (accent), quiet (neutral), waiting (after downloads), restarting, countdown, failed. */
  S.chip = (kind, { next, text } = {}) => {
    const h = hot(next);
    switch (kind) {
      case 'new': return `<button class="tchip hot cart${h}">${P.button(13)}<span class="pixel">${text || `NEW ${V}`}</span></button>`;
      case 'restart': return `<button class="tchip hot cart${h}">${P.button(13)}<span class="pixel">${V}</span><span class="sep">·</span>${text || 'Restart'}</button>`;
      case 'quiet': return `<button class="tchip cart${h}">${P.button(13)}<span class="pixel">${V}</span><span class="sep">·</span>${text || 'ready'}</button>`;
      case 'waiting': return `<button class="tchip cart${h}">${P.icon('clock')}<span class="pixel">${V}</span><span class="sep">·</span>${text || 'after 2 downloads'}</button>`;
      case 'restarting': return `<button class="tchip cart${h}">${P.upbar(null, 6, 6)}${text || 'Restarting…'}</button>`;
      case 'failed': return `<button class="tchip warn cart${h}">${P.icon('alert')}${text || 'Update failed'}</button>`;
      default: return '';
    }
  };
  S.cursorAt = (x, y) => `<svg class="cursor" style="left:${x}px;top:${y}px" viewBox="0 0 18 22"><path d="M1 1v17l4.5-4 3 7 3-1.3-3-6.7H15z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>`;
  S.pop = (html, { right = 250, arrow = 60, cls = '' } = {}) => `<div class="pop ${cls}" style="right:${right}px;--arrow:${arrow}px">${html}</div>`;
  S.errorPop = ({ right = 250, arrow = 40, title = `Couldn’t download ${V}`, line = 'The connection dropped at 38 of 92 MB.' } = {}) => S.pop(`
      <h4>${title}</h4><p>${line} You’re still on ${CUR}; nothing changed.</p>
      ${P.errorDetails()}
      <div class="row"><span class="sp"></span><a class="btn" href="#" onclick="return false">Download installer ${P.icon('ext')}</a><button class="btn primary${hot()}">${P.icon('retry')}Try again</button></div>`, { right, arrow, cls: 'warn' });
  S.toast = (html, { life = 0.6, next, cls = '' } = {}) => `<div class="stoast ${cls}">${html}${life == null ? '' : `<i class="life" style="--life:${life}"></i>`}</div>`;
  S.updatedToast = ({ next, life = 0.7 } = {}) => S.toast(`${P.button(18)}<span>Updated to <b class="pixel" style="font-size:16px;font-weight:400">${V}</b></span><span class="sp"></span><button class="btn quiet${hot(next)}">What’s new</button><button class="iconbtn" style="width:24px;height:24px">${P.icon('x')}</button>`, { life });
  S.countdownToast = ({ secs = 7, next } = {}) => S.toast(`${P.button(18)}<span>Restarting to update to <b class="pixel" style="font-size:16px;font-weight:400">${V}</b> in <b class="num">${secs} s</b></span><span class="sp"></span><button class="btn${hot(next)}">Cancel</button>
      <div class="pips" aria-hidden="true">${Array.from({ length: 10 }, (_, n) => n < 10 - secs ? '<i></i>' : n === 10 - secs ? '<i class="on blink"></i>' : '<i class="on"></i>').join('')}</div>`, { life: null, cls: 'count' });
  S.whatsNew = () => `<div class="newpop"><h4>What’s new in <span class="pixel">${V}</span></h4>${P.notesList(3)}<div class="foot2"><span class="subtle">You were on ${CUR}</span><a class="link" href="#" onclick="return false">Full release notes ↗</a></div></div>`;

  /** The macOS desktop with SnagThis's window closed (the app keeps running for downloads). */
  S.desk = ({ notif = '', other = true, overlay = '', running = true } = {}) => `
    <div class="desk"><div class="menubar"><span></span><b>Safari</b><span>File</span><span>Edit</span><span>View</span><span class="sp"></span><span>Tue 2:14 PM</span></div>
      ${other ? '<div class="other"><div class="bar"><i></i><i></i><i></i></div><div class="page"><div style="width:60%"></div><div class="vid"></div><div></div><div style="width:80%"></div></div></div>' : ''}
      ${notif}${overlay}
      <div class="dock"><span></span><span></span><span class="snag ${running ? 'run' : ''}">${P.button(30)}</span><span></span></div>
    </div>`;
  S.notif = ({ title, body, acts = '', next, cls = '' }) => `<div class="notif ${cls}${hot(next)}"><span class="ico">${P.button(26)}</span><div><b>${title}</b><span>${body}</span></div><time>now</time>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
  S.native = (html) => `<div class="native">${P.button(48)}${html}</div>`;
  S.settings = (row, { hint = '' } = {}) => `<div class="ssheet"><h3>Updates &amp; support</h3><div class="d">Keep SnagThis up to date, and get help when a site doesn’t work.</div><div class="cap">Updates</div><div class="scard">${row}<div><span class="lbl"><b>Check automatically</b><small>${hint || 'Looks for a new version each time SnagThis starts.'}</small></span><span class="switch"></span></div></div></div>`;
  S.srow = (label, small, tone, button) => `<div><span class="lbl"><b>${label}</b><small class="${tone || ''}">${small}</small></span>${button || ''}</div>`;

  const KIND = { click: 'You click', notif: 'Notification', auto: 'Automatic', show: 'Shown', none: 'Nothing shown' };

  /**
   * cfg: { scenarios: [{ id, label, frames: [{ t, cap, k, n:{s,n,c}, r() }] }] }
   * n counts what this frame adds: s = in-app surface, n = OS notification, c = click.
   */
  S.mount = (cfg) => {
    const hash = new URLSearchParams(location.hash.slice(1));
    // ?preview renders the 1200×800 summary card that capture.cjs saves as preview.png.
    if (new URLSearchParams(location.search).has('preview') && cfg.preview) {
      P.setAccent(hash.get('accent') || 'orange');
      const pv = cfg.preview, frame = (sid, i) => cfg.scenarios.find((s) => s.id === sid).frames[i];
      document.body.className = 'preview';
      document.body.innerHTML = `<div class="pv"><header><span class="n">${pv.n}</span><h1>${pv.title}</h1><p>${pv.pitch}</p></header>
        <div class="frames">${pv.frames.map(([sid, i, cap], k) => `<div class="fr f${k}"><div class="scale">${frame(sid, i).r()}</div><p><em>${k + 1}</em>${cap}</p></div>`).join('')}
        <div class="counts">${pv.counts.map(([label, value, today]) => `<div><b>${value}</b>${label}<span class="today">${today}</span></div>`).join('')}</div></div>
        <div class="flow">${pv.flow.map((x) => `<span class="${x[0]}">${x.slice(1)}</span>`).join('<i>→</i>')}</div><div class="legend">Common path. Filled = a click · outlined = something appears · blue = OS notification · plain = happens by itself</div>${pv.note ? `<div class="pvnote">${pv.note}</div>` : ''}</div>`;
      return;
    }
    let sid = hash.get('s') || cfg.scenarios[0].id, f = Number(hash.get('f') || 0), accent = hash.get('accent') || 'orange';
    const el = (id) => document.getElementById(id);
    const scen = () => cfg.scenarios.find((s) => s.id === sid) || cfg.scenarios[0];
    const render = () => {
      P.setAccent(accent);
      const sc = scen(), frames = sc.frames; f = Math.max(0, Math.min(frames.length - 1, f));
      const fr = frames[f];
      el('stage').innerHTML = fr.r();
      const sum = frames.slice(0, f + 1).reduce((a, x) => ({ s: a.s + ((x.n || {}).s || 0), n: a.n + ((x.n || {}).n || 0), c: a.c + ((x.n || {}).c || 0) }), { s: 0, n: 0, c: 0 });
      const tot = frames.reduce((a, x) => ({ s: a.s + ((x.n || {}).s || 0), n: a.n + ((x.n || {}).n || 0), c: a.c + ((x.n || {}).c || 0) }), { s: 0, n: 0, c: 0 });
      el('caption').innerHTML = `<div class="fnum">${f + 1}/${frames.length}</div><h2>${fr.t}</h2><p><span class="kind ${fr.k || 'show'}">${KIND[fr.k || 'show']}</span></p><p>${fr.cap}</p>
        <div class="tally"><div><b>${sum.s}<span class="subtle" style="font-size:16px">/${tot.s}</span></b><small>In-app surfaces</small></div><div><b>${sum.n}<span class="subtle" style="font-size:16px">/${tot.n}</span></b><small>Notifications</small></div><div><b>${sum.c}<span class="subtle" style="font-size:16px">/${tot.c}</span></b><small>Clicks</small></div></div>
        <div class="nav"><button class="btn" data-step="-1" ${f === 0 ? 'disabled' : ''}>← Back</button><button class="btn primary" data-step="1" ${f === frames.length - 1 ? 'disabled' : ''}>Next →</button><span class="subtle" style="font-size:12px;align-self:center">or click the dashed hotspot · ← →</span></div>
        ${sc.note ? `<p style="margin-top:14px;font-size:12.5px">${sc.note}</p>` : ''}`;
      el('strip').innerHTML = frames.map((x, i) => `<button data-frame="${i}" aria-current="${i === f}"><em>${i + 1}</em>${x.t}${x.k === 'click' ? '<span class="k">click</span>' : ''}</button>`).join('');
      el('scen').innerHTML = cfg.scenarios.map((s, i) => `<button data-scen="${s.id}" aria-pressed="${s.id === sid}"><em>${String.fromCharCode(97 + i)}</em>${s.label}</button>`).join('');
      el('acc').innerHTML = Object.keys(P.ACCENTS).map((id) => `<button data-accent="${id}" title="${id}" aria-label="${id}" aria-pressed="${id === accent}" style="--s:${P.ACCENTS[id][0]}"></button>`).join('');
      history.replaceState(null, '', `#s=${sid}&f=${f}&accent=${accent}`);
    };
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-next],[data-step],[data-frame],[data-scen],[data-accent]');
      if (!t) return;
      e.preventDefault();
      if (t.dataset.next) f += Number(t.dataset.next);
      else if (t.dataset.step) f += Number(t.dataset.step);
      else if (t.dataset.frame) f = Number(t.dataset.frame);
      else if (t.dataset.scen) { sid = t.dataset.scen; f = 0; }
      else if (t.dataset.accent) accent = t.dataset.accent;
      render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { f++; render(); } else if (e.key === 'ArrowLeft') { f--; render(); }
    });
    S.frames = (id) => cfg.scenarios.find((s) => s.id === id).frames;
    render();
  };
})();
