/* SnagThis landing, direction B · Cinematic product. Plain JS, no dependencies. */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const $ = id => document.getElementById(id);

  /* ── Visitor OS: highlight the matching download ─────────────────────────── */
  const platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
  const mobile = /iphone|ipad|android/.test(navigator.userAgent.toLowerCase());
  root.dataset.os = mobile ? 'unknown' : /mac/.test(platform) ? 'mac' : /win/.test(platform) ? 'windows' : 'unknown';

  /* ── Nav: glass once scrolled; logo appears when the hero logo leaves ────── */
  const nav = $('nav');
  const heroLogo = document.querySelector('.hero-logo');
  if ('IntersectionObserver' in window && heroLogo) {
    new IntersectionObserver(([entry]) => nav.classList.toggle('show-brand', !entry.isIntersecting), { rootMargin: '-64px 0px 0px 0px' }).observe(heroLogo);
  } else nav.classList.add('show-brand');

  /* ── Hero logo: "type, then press" (the desktop app's launch, StartupLogo.tsx) ── */
  const mark = document.querySelector('.hero-mark');
  const PENS = [-1, 13, 27, 40, 53, 65, 78, 84]; const RIGHT_LAST = 96; const BUTTON_X = 104;
  function playLogo() {
    const letters = [...mark.querySelectorAll('.lg-l')];
    const cursor = mark.querySelector('.lg-cursor');
    const press = mark.querySelector('.lg-press');
    if (reduced.matches || !cursor || !press || !press.animate) { mark.classList.add('static'); return; }
    const START = 350; const LETTER = 55; const POP = START + letters.length * LETTER + 70; const PRESS = POP + 340;
    letters.forEach((letter, i) => letter.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: START + i * LETTER, fill: 'both' }));
    const total = POP;
    const stops = [{ transform: `translateX(${PENS[0]}px)`, opacity: 0, offset: 0 }, { transform: `translateX(${PENS[0]}px)`, opacity: 1, offset: (START - 1) / total }];
    letters.forEach((_, i) => stops.push({ transform: `translateX(${i + 1 < PENS.length ? PENS[i + 1] : RIGHT_LAST + 1}px)`, opacity: 1, offset: (START + i * LETTER) / total }));
    stops.push({ transform: `translateX(${BUTTON_X}px)`, opacity: 1, offset: (START + letters.length * LETTER) / total });
    stops.push({ transform: `translateX(${BUTTON_X}px)`, opacity: 0, offset: 1 });
    cursor.animate(stops.map(s => ({ ...s, easing: 'step-end' })), { duration: total, fill: 'forwards' });
    press.animate([
      { transform: 'scale(.25)', opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: 'scale(1.14)', opacity: 1, offset: .55, easing: 'ease-in-out' },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 260, delay: POP, fill: 'backwards' }).finished.then(() => {
      press.style.opacity = 1;
      const light = press.querySelector('.bv-light'); const darks = press.querySelectorAll('.bv-dark');
      light.animate([{ fill: 'var(--bevel-dark)' }, { fill: 'var(--bevel-dark)' }], { duration: 180, delay: 130 });
      darks[0].animate([{ fill: 'var(--bevel-light)' }, { fill: 'var(--bevel-light)' }], { duration: 180, delay: 130 });
      press.animate([
        { transform: 'translateY(0) scale(1)', easing: 'cubic-bezier(.5,0,.9,.4)' },
        { transform: 'translateY(2px) scale(.93)', offset: .3, easing: 'cubic-bezier(.2,.9,.3,1.4)' },
        { transform: 'translateY(-.5px) scale(1.01)', offset: .66, easing: 'ease-in-out' },
        { transform: 'translateY(0) scale(1)' },
      ], { duration: 520, delay: PRESS - POP - 260 });
    }, () => {});
  }
  if (mark) playLogo();

  /* ── Accent: the same five as the app (packages/contracts/src/accents.js) ── */
  const ACCENTS = {
    orange: { primary: 'hsl(18 96% 40%)', strong: 'hsl(18 96% 36%)', hover: 'hsl(20 96% 52%)', muted: 'hsl(16 58% 16%)', logo: '#fa5d0e', face: '#fa5d0e', light: '#ffb238', dark: '#bd3f00' },
    cobalt: { primary: 'hsl(220 80% 50%)', strong: 'hsl(220 80% 45%)', hover: 'hsl(218 95% 63%)', muted: 'hsl(220 50% 18%)', logo: '#4a88ff', face: '#3b7bff', light: '#a3c6ff', dark: '#1d44b0' },
    violet: { primary: 'hsl(262 70% 54%)', strong: 'hsl(262 70% 48%)', hover: 'hsl(262 90% 70%)', muted: 'hsl(262 45% 20%)', logo: '#9b78ff', face: '#8b5cf6', light: '#d0bcff', dark: '#5528b8' },
    mint: { primary: 'hsl(160 84% 28%)', strong: 'hsl(160 84% 24%)', hover: 'hsl(158 70% 50%)', muted: 'hsl(160 50% 13%)', logo: '#26d996', face: '#1fbf8a', light: '#a4f3cc', dark: '#0d7a57' },
    magenta: { primary: 'hsl(330 75% 46%)', strong: 'hsl(330 75% 41%)', hover: 'hsl(330 90% 64%)', muted: 'hsl(330 50% 18%)', logo: '#f550a0', face: '#e8388e', light: '#ffb3d6', dark: '#9c1558' },
  };
  const swatches = [...document.querySelectorAll('.swatches [data-accent]')];
  function setAccent(id, focus) {
    const t = ACCENTS[id]; if (!t) return;
    const vars = { '--primary': t.primary, '--primary-strong': t.strong, '--accent': t.hover, '--accent-muted': t.muted, '--logo': t.logo, '--bevel-face': t.face, '--bevel-light': t.light, '--bevel-dark': t.dark };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    swatches.forEach(b => { const on = b.dataset.accent === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
  }
  swatches.forEach((b, i) => {
    b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
    b.addEventListener('click', () => setAccent(b.dataset.accent));
    b.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return;
      e.preventDefault(); setAccent(swatches[(i + d + swatches.length) % swatches.length].dataset.accent, true);
    });
  });

  /* ── "Add to Chrome" is a placeholder until the store listing is live ───── */
  const toast = $('toast'); let toastTimer = 0;
  document.querySelectorAll('[data-soon]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    toast.textContent = 'The Chrome Web Store listing is coming soon.'; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }));

  /* ── Closing bevel button presses like the logo ──────────────────────────── */
  const bigBevel = $('big-bevel');
  const pressBig = () => { if (reduced.matches) return; bigBevel.classList.remove('pressing'); void bigBevel.offsetWidth; bigBevel.classList.add('pressing'); };
  bigBevel.addEventListener('click', pressBig);
  bigBevel.addEventListener('pointerenter', pressBig);
  bigBevel.addEventListener('animationend', e => { if (e.target === bigBevel.querySelector('svg')) bigBevel.classList.remove('pressing'); });

  /* ── Reveal on scroll ───────────────────────────────────────────────────── */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
  }), { rootMargin: '0px 0px -12% 0px' }) : null;
  document.querySelectorAll('.reveal, .art-drop').forEach(el => io ? io.observe(el) : el.classList.add('in'));
  const bevelIo = io && new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(pressBig, 300); bevelIo.disconnect(); } }, { threshold: .8 });
  if (bevelIo) bevelIo.observe(bigBevel);

  /* ── Hero: the screenshot tilts flat as you scroll ───────────────────────── */
  const shotDesktop = document.querySelector('.shot-desktop');
  const shotPopup = document.querySelector('.shot-popup');
  function heroFrame() {
    if (reduced.matches) { shotDesktop.style.cssText = ''; shotPopup.style.cssText = ''; return; }
    const hp = clamp(window.scrollY / (window.innerHeight * .8));
    const e = easeOut(hp);
    shotDesktop.style.setProperty('--tilt', `${(1 - e) * 16}deg`);
    shotDesktop.style.setProperty('--zoom', `${.93 + e * .07}`);
    shotPopup.style.setProperty('--lift', `${-e * 70}px`);
  }

  /* ── Scroll story ───────────────────────────────────────────────────────── */
  const story = $('story');
  const stage = $('stage'); const scene = $('scene');
  const browser = $('browser'); const pop = $('pop'); const app = $('app');
  const ext = $('ext'); const popRow = $('pop-row'); const popDl = $('pop-dl'); const popMeta = $('pop-meta');
  const ghost = $('ghost'); const pointer = $('pointer');
  const rowNew = $('row-new'); const rowStatus = $('row-status'); const footStatus = $('foot-status');
  const list = $('list'); const shelf = $('shelf'); const cards = [...shelf.children];
  const tabLine = $('tab-line'); const tabAll = document.querySelector('[data-tab="all"]'); const tabSaved = document.querySelector('[data-tab="saved"]');
  const trace = $('trace'); const trLine = $('tr-line'); const trArea = $('tr-area'); const trDot = $('tr-dot');
  const steps = [...document.querySelectorAll('#steps .step')]; const rail = $('rail-fill');
  const cellsEl = $('cells');
  const CELLS = 40;
  for (let i = 0; i < CELLS; i++) cellsEl.appendChild(document.createElement('i'));
  const cells = [...cellsEl.children];

  // A speed series that wanders like a real transfer (deterministic, so every visit matches).
  const SAMPLES = 60; const speeds = [];
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0, v = 2.2; i < SAMPLES; i++) { v = clamp(v * (.86 + rand() * .3) + Math.sin(i / 4) * .45 + (i < 8 ? .5 : 0), 1.2, 8.4); speeds.push(v); }
  const PEAK = Math.max(...speeds) * 1.15;
  const TW = 150; const TH = 30;

  const LAYOUT = {
    wide: { W: 1040, H: 620, browser: [0, 0, 720, 452], pop: [330, 88], app: [410, 196, 630, 400], appFrom: [40, 30], browserTo: { o: .5, s: .97, y: 0 } },
    narrow: { W: 440, H: 400, browser: [0, 0, 440, 300], pop: [52, 80], app: [0, 10, 440, 390], appFrom: [0, 90], browserTo: { o: 0, s: .94, y: -30 } },
  };
  let L = LAYOUT.wide; let mode = ''; let geo = null;
  const place = (el, r) => { el.style.left = `${r[0]}px`; el.style.top = `${r[1]}px`; if (r[2]) el.style.width = `${r[2]}px`; if (r[3]) el.style.height = `${r[3]}px`; };
  const local = el => { let x = 0; let y = 0; let n = el; while (n && n !== scene) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return { x, y, w: el.offsetWidth, h: el.offsetHeight }; };

  function layout() {
    const next = window.innerWidth >= 900 ? 'wide' : 'narrow';
    if (next !== mode) {
      mode = next; L = LAYOUT[mode]; scene.dataset.mode = mode;
      scene.style.setProperty('--sw', `${L.W}px`); scene.style.setProperty('--sh', `${L.H}px`);
      place(browser, L.browser); place(pop, L.pop); place(app, L.app);
    }
    const w = stage.clientWidth; const h = stage.clientHeight || L.H;
    const s = Math.min(w / L.W, h / L.H, 1.25);
    const oy = Math.max(0, (h - L.H * s) / 2);
    scene.style.transform = `translate(${(w - L.W * s) / 2}px, ${mode === 'wide' ? oy : Math.min(oy, 28)}px) scale(${s})`;
    const popThumb = local($('pop-thumb')); const rowThumb = local($('row-thumb')); const dl = local(popDl);
    geo = { popThumb, rowThumb, dl, all: [tabAll.offsetLeft, tabAll.offsetWidth], saved: [tabSaved.offsetLeft, tabSaved.offsetWidth] };
    ghost.style.width = `${popThumb.w}px`; ghost.style.height = `${popThumb.h}px`;
    last = -1; render(current);
  }

  let lastCells = -1; let last = -1; let lastStep = -1;
  function render(p) {
    if (!geo || Math.abs(p - last) < 1e-5) return; last = p;
    const R = reduced.matches;
    // 1 · Find: the extension icon lights and the popup opens under it.
    ext.classList.toggle('on', p > .02 && p < .47);
    const popIn = easeOut(seg(p, .03, .12)); const popOut = ease(seg(p, .40, .47));
    pop.style.opacity = popIn * (1 - popOut);
    pop.style.transform = `translateY(${(1 - popIn) * -10 + popOut * -12}px) scale(${.96 + .04 * popIn - popOut * .03})`;
    pop.style.visibility = popIn * (1 - popOut) > 0.001 ? 'visible' : 'hidden';

    // The pointer travels to the download button and presses it.
    const pt = ease(seg(p, .12, .24)); const ptVis = seg(p, .11, .14) * (1 - seg(p, .31, .34));
    const d = geo.dl; const tx = d.x + d.w * .55 + L.pop[0]; const ty = d.y + d.h * .5 + L.pop[1];
    const press = seg(p, .25, .29); const down = press > 0 && press < 1 ? Math.sin(press * Math.PI) : 0;
    pointer.style.opacity = R ? 0 : ptVis;
    pointer.style.transform = `translate(${tx + (1 - pt) * 150}px, ${ty + (1 - pt) * 120}px) scale(${1 - down * .15})`;
    popRow.classList.toggle('hover', p > .2 && p < .4);
    popDl.style.transform = `scale(${1 - down * .14})`;
    popDl.classList.toggle('pressed', p >= .26);
    const sent = p >= .28;
    if (popMeta.classList.contains('sent') !== sent) { popMeta.classList.toggle('sent', sent); popMeta.innerHTML = sent ? 'Snagged · sending to SnagThis' : '<em>FHD</em>1080p · 2.1 GB · 14:48'; }

    // 2 · Snag: the desktop app comes forward and the thumbnail flies into its list.
    const appIn = ease(seg(p, .27, .37));
    const ax = (1 - appIn) * L.appFrom[0]; const ay = (1 - appIn) * L.appFrom[1];
    app.style.opacity = appIn; app.style.transform = `translate(${ax}px, ${ay}px) scale(${.97 + .03 * appIn})`;
    const bt = L.browserTo;
    browser.style.opacity = 1 - (1 - bt.o) * appIn; browser.style.transform = `translateY(${bt.y * appIn}px) scale(${1 - (1 - bt.s) * appIn})`;
    const fly = ease(seg(p, .31, .43));
    const a = { x: geo.popThumb.x + L.pop[0], y: geo.popThumb.y + L.pop[1] };
    const b = { x: geo.rowThumb.x + L.app[0] + ax, y: geo.rowThumb.y + L.app[1] + ay };
    const cx = (a.x + b.x) / 2 + (mode === 'wide' ? 60 : 90); const cy = Math.min(a.y, b.y) - 70; // arc control point
    const q = fly; const fx = (1 - q) * (1 - q) * a.x + 2 * (1 - q) * q * cx + q * q * b.x; const fy = (1 - q) * (1 - q) * a.y + 2 * (1 - q) * q * cy + q * q * b.y;
    const sx = 1 + (geo.rowThumb.w / geo.popThumb.w - 1) * q; const sy = 1 + (geo.rowThumb.h / geo.popThumb.h - 1) * q;
    ghost.style.opacity = R ? 0 : (fly > 0 && fly < 1 ? 1 : 0);
    ghost.style.transform = `translate(${fx}px, ${fy}px) scale(${sx * (1 + Math.sin(q * Math.PI) * .12)}, ${sy * (1 + Math.sin(q * Math.PI) * .12)})`;
    const landed = fly >= 1 || (R && p >= .43);
    rowNew.style.opacity = landed ? 1 : 0;
    rowNew.style.setProperty('--edge', easeOut(seg(p, .42, .46)) * (1 - seg(p, .70, .74)));

    // Progress: segmented cells fill and the speed trace draws.
    const dl = seg(p, .43, .66);
    const fin = seg(p, .66, .70);
    const filled = Math.floor(dl * CELLS + 1e-6);
    if (filled !== lastCells) {
      cells.forEach((c, i) => {
        const done = i < filled; const cur = i === filled && dl > 0 && dl < 1;
        if (!R && done && !c.classList.contains('done') && lastCells >= 0 && i >= lastCells && filled - lastCells < 4) { c.classList.remove('spark'); void c.offsetWidth; c.classList.add('spark'); }
        c.classList.toggle('done', done); c.classList.toggle('current', cur);
      });
      lastCells = filled;
    }
    const curCell = cells[filled]; if (curCell) curCell.style.setProperty('--f', (dl * CELLS - filled).toFixed(3));
    const head = dl * (SAMPLES - 1);
    const n = Math.floor(head); const frac = head - n;
    const X = i => (i / (SAMPLES - 1)) * (TW - 4); const Y = v => TH - 3 - (v / PEAK) * (TH - 8);
    if (dl > 0) {
      let dPath = `M0,${Y(speeds[0]).toFixed(2)}`;
      for (let i = 1; i <= n; i++) dPath += ` L${X(i).toFixed(2)},${Y(speeds[i]).toFixed(2)}`;
      const hv = n + 1 < SAMPLES ? speeds[n] + (speeds[n + 1] - speeds[n]) * frac : speeds[n];
      const hx = X(head); const hy = Y(hv);
      dPath += ` L${hx.toFixed(2)},${hy.toFixed(2)}`;
      trLine.setAttribute('d', dPath); trArea.setAttribute('d', `${dPath} L${hx.toFixed(2)},${TH} L0,${TH} Z`);
      trDot.setAttribute('cx', hx.toFixed(2)); trDot.setAttribute('cy', hy.toFixed(2));
      footStatus.textContent = dl < 1 ? `1 downloading · ${hv.toFixed(1)} MB/s` : 'Nothing downloading';
    } else { trLine.setAttribute('d', ''); trArea.setAttribute('d', ''); footStatus.textContent = 'Nothing downloading'; }
    const saved = fin >= 1;
    trace.classList.toggle('finishing', dl >= 1 && !saved); trace.classList.toggle('saved', saved);
    trDot.style.opacity = dl >= 1 ? 0 : 1;
    trace.style.opacity = dl > 0 ? 1 - seg(p, .70, .74) : 0;
    const status = dl <= 0 ? 'Starting…' : dl < 1 ? `${Math.round(dl * 100)}% · ${Math.max(1, Math.ceil((1 - dl) * 9))} min left` : saved ? '<em class="q">FHD</em>1080p · 2.1 GB · <span class="ok">✓ Saved today</span>' : 'Finishing up…';
    if (rowStatus.dataset.s !== status) { rowStatus.dataset.s = status; rowStatus.innerHTML = status; }
    cellsEl.style.opacity = 1 - seg(p, .70, .73);
    cellsEl.style.display = seg(p, .70, .73) >= 1 ? 'none' : '';

    // 3 · Keep: the tab moves to Saved and the list becomes the shelf.
    const tab = ease(seg(p, .74, .80));
    const tl = geo.all[0] + (geo.saved[0] - geo.all[0]) * tab; const tw = geo.all[1] + (geo.saved[1] - geo.all[1]) * tab;
    tabLine.style.transform = `translateX(${tl + 6}px) scaleX(${(tw - 12) / 30})`;
    tabAll.classList.toggle('on', tab < .5); tabSaved.classList.toggle('on', tab >= .5);
    const sh = seg(p, .76, .9);
    list.style.opacity = 1 - ease(seg(sh, 0, .35)); list.style.transform = `translateY(${-ease(seg(sh, 0, .35)) * 12}px)`;
    shelf.style.opacity = sh > 0 ? 1 : 0;
    cards.forEach((c, i) => { const t = easeOut(seg(sh, .2 + i * .14, .6 + i * .14)); c.style.opacity = t; c.style.transform = `translateY(${(1 - t) * 18}px) scale(${.96 + .04 * t})`; });

    // Captions and rail.
    const step = p < .26 ? 0 : p < .70 ? 1 : 2;
    if (step !== lastStep) { steps.forEach((s, i) => s.classList.toggle('is-active', i === step)); lastStep = step; }
    if (rail) rail.style.setProperty('--rail', p.toFixed(4));
  }

  let target = 0; let current = 0; let raf = 0; let lastT = 0;
  let pinValue = null;
  const storyTarget = () => {
    if (pinValue !== null) return pinValue;
    const r = story.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    const p = clamp(-r.top / (span || 1));
    if (!reduced.matches) return p;
    return p < .26 ? .2 : p < .70 ? .6 : 1; // Reduced motion: three still frames, no travel between them.
  };
  function tick(t) {
    raf = 0;
    const dt = lastT ? Math.min(64, t - lastT) : 16.7; lastT = t;
    if (reduced.matches) current = target;
    else current += (target - current) * (1 - Math.pow(1 - .16, dt / 16.7));
    if (Math.abs(target - current) < 1e-4) current = target;
    render(current);
    if (current !== target) raf = requestAnimationFrame(tick); else lastT = 0;
  }
  function onScroll() {
    nav.classList.toggle('scrolled', window.scrollY > 8);
    heroFrame();
    target = storyTarget();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { layout(); onScroll(); });
  reduced.addEventListener && reduced.addEventListener('change', () => { last = -1; layout(); onScroll(); });
  layout(); target = current = storyTarget(); render(current); onScroll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  // Deep link for previews: ?story=0.55 pins the scene at that point.
  const pin = new URLSearchParams(location.search).get('story');
  if (pin !== null) { root.classList.add('story-pinned'); document.querySelectorAll('.reveal, .art-drop').forEach(el => el.classList.add('in')); layout(); pinValue = clamp(parseFloat(pin) || 0); current = target = pinValue; last = -1; render(pinValue); }
})();
