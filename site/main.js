/* SnagThis landing · Direction C · Playable demo. Plain script, no dependencies. */
(() => {
  'use strict';

  // Paste the Chrome Web Store listing here once it is live; until then the buttons say "Coming soon".
  const CHROME_STORE_URL = '';

  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  /* ── Accent colours (packages/contracts/src/accents.js) ─────────────── */
  const ACCENTS = [
    { id: 'orange', name: 'Orange', swatch: '#fa5d0e' },
    { id: 'cobalt', name: 'Cobalt', swatch: '#3b7bff' },
    { id: 'violet', name: 'Violet', swatch: '#8b5cf6' },
    { id: 'mint', name: 'Mint', swatch: '#1fbf8a' },
    { id: 'magenta', name: 'Magenta', swatch: '#e8388e' },
  ];
  const ACCENT_TOKENS = {
    orange: { primary: 'hsl(18 96% 40%)', strong: 'hsl(18 96% 36%)', hover: 'hsl(20 96% 52%)', muted: 'hsl(16 58% 16%)', ring: 'hsl(18 96% 44%)', logo: '#fa5d0e', bevelFace: '#fa5d0e', bevelLight: '#ffb238', bevelDark: '#bd3f00' },
    cobalt: { primary: 'hsl(220 80% 50%)', strong: 'hsl(220 80% 45%)', hover: 'hsl(218 95% 63%)', muted: 'hsl(220 50% 18%)', ring: 'hsl(219 88% 56%)', logo: '#4a88ff', bevelFace: '#3b7bff', bevelLight: '#a3c6ff', bevelDark: '#1d44b0' },
    violet: { primary: 'hsl(262 70% 54%)', strong: 'hsl(262 70% 48%)', hover: 'hsl(262 90% 70%)', muted: 'hsl(262 45% 20%)', ring: 'hsl(262 80% 62%)', logo: '#9b78ff', bevelFace: '#8b5cf6', bevelLight: '#d0bcff', bevelDark: '#5528b8' },
    mint: { primary: 'hsl(160 84% 28%)', strong: 'hsl(160 84% 24%)', hover: 'hsl(158 70% 50%)', muted: 'hsl(160 50% 13%)', ring: 'hsl(159 77% 40%)', logo: '#26d996', bevelFace: '#1fbf8a', bevelLight: '#a4f3cc', bevelDark: '#0d7a57' },
    magenta: { primary: 'hsl(330 75% 46%)', strong: 'hsl(330 75% 41%)', hover: 'hsl(330 90% 64%)', muted: 'hsl(330 50% 18%)', ring: 'hsl(330 82% 55%)', logo: '#f550a0', bevelFace: '#e8388e', bevelLight: '#ffb3d6', bevelDark: '#9c1558' },
  };
  let accent = 'orange';

  function applyAccent(id, fromUser) {
    const t = ACCENT_TOKENS[id] || ACCENT_TOKENS.orange;
    accent = ACCENT_TOKENS[id] ? id : 'orange';
    const vars = { '--color-primary': t.primary, '--color-primary-strong': t.strong, '--color-primary-hover': t.hover, '--color-primary-muted': t.muted, '--color-ring': t.ring,
      '--accent-logo': t.logo, '--accent-bevel-face': t.bevelFace, '--accent-bevel-light': t.bevelLight, '--accent-bevel-dark': t.bevelDark };
    if (fromUser && !reduced.matches) {
      root.classList.add('accent-shift');
      clearTimeout(applyAccent.timer);
      applyAccent.timer = setTimeout(() => root.classList.remove('accent-shift'), 420);
    }
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    root.dataset.accent = accent;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = '#07090b';
    $$('.swatch').forEach(swatch => {
      const on = swatch.dataset.accent === accent;
      swatch.setAttribute('aria-checked', String(on));
      swatch.tabIndex = on ? 0 : -1;
    });
    if (fromUser) {
      shine($('.site-header .logo-finish'));
      $$('.mascot .px-btn, .closing-mascot .px-btn').forEach(press);
    }
  }

  function buildPickers() {
    $$('.accent-picker').forEach(picker => {
      ACCENTS.forEach(({ id, name, swatch }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'swatch';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-label', name);
        button.title = name;
        button.dataset.accent = id;
        button.style.setProperty('--sw', swatch);
        button.addEventListener('click', () => applyAccent(id, true));
        picker.append(button);
      });
      picker.addEventListener('keydown', event => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const index = ACCENTS.findIndex(a => a.id === accent);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ACCENTS.length - 1 : (index + keys[event.key] + ACCENTS.length) % ACCENTS.length;
        applyAccent(ACCENTS[next].id, true);
        picker.querySelector(`[data-accent="${ACCENTS[next].id}"]`).focus();
      });
    });
  }

  /* ── Pixel button press and logo shine ──────────────────────────────── */
  function press(svg) {
    if (!svg || reduced.matches) return;
    svg.classList.remove('pressing');
    void svg.getBoundingClientRect();
    svg.classList.add('pressing');
    svg.addEventListener('animationend', function done(event) {
      if (event.target !== svg) return;
      svg.classList.remove('pressing');
      svg.removeEventListener('animationend', done);
    });
  }
  function shine(finish) {
    if (!finish || reduced.matches) return;
    finish.classList.remove('shining');
    void finish.offsetWidth;
    finish.classList.add('shining');
  }
  $$('.logo-finish').forEach(finish => {
    finish.addEventListener('pointerenter', () => shine(finish));
    finish.addEventListener('animationend', () => finish.classList.remove('shining'));
  });

  /* ── The launch animation, "type, then press" (StartupLogo.tsx) ──────── */
  function typeLogo() {
    const svg = $('.site-header .logo-svg');
    if (!svg || reduced.matches || !svg.animate) return;
    const letters = $$('.lg-letter', svg);
    const cursor = $('.lg-cursor', svg);
    const button = $('.lg-press', svg);
    const light = $('.px-light', button); const dark = $$('.px-dark', button)[0];
    const pens = [-1, 13, 27, 40, 53, 65, 78, 84];
    const TYPE = 150, LETTER = 50, POP = TYPE + letters.length * LETTER + 70, PRESS = POP + 260 + 80;
    letters.forEach((letter, i) => letter.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: TYPE + i * LETTER, fill: 'backwards' }));
    const stops = [{ transform: `translateX(${pens[0]}px)`, opacity: 1, offset: 0 }];
    pens.forEach((_, i) => stops.push({ transform: `translateX(${pens[i + 1] ?? 97}px)`, opacity: 1, offset: (TYPE + i * LETTER) / POP }));
    stops.push({ transform: 'translateX(104px)', opacity: 1, offset: (TYPE + letters.length * LETTER) / POP }, { transform: 'translateX(104px)', opacity: 0, offset: 1 });
    cursor.animate(stops.map(stop => ({ ...stop, easing: 'step-end' })), { duration: POP });
    button.animate([
      { transform: 'scale(.25)', opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: 'scale(1.14)', opacity: 1, offset: .55, easing: 'ease-in-out' },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 260, delay: POP, fill: 'backwards' });
    button.style.transformOrigin = '50% 50%';
    button.animate([
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(2px) scale(.93)', offset: .3, easing: 'cubic-bezier(.2,.9,.3,1.4)' },
      { transform: 'translateY(-.5px) scale(1.01)', offset: .66 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: 520, delay: PRESS });
    const lit = getComputedStyle(light).fill; const shade = getComputedStyle(dark).fill;
    light.animate([{ fill: shade }, { fill: shade }], { duration: 180, delay: PRESS + 50 });
    $$('.px-dark', button).forEach(path => path.animate([{ fill: lit }, { fill: lit }], { duration: 180, delay: PRESS + 50 }));
    setTimeout(() => shine($('.site-header .logo-finish')), PRESS + 600);
  }

  /* ── Visitor's OS and the store link ────────────────────────────────── */
  function detectOs() {
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    const ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod|android/i.test(ua) || (navigator.userAgentData && navigator.userAgentData.mobile)) return 'mobile';
    if (/mac/i.test(platform) || /Macintosh/.test(ua)) return 'mac';
    if (/win/i.test(platform) || /Windows/.test(ua)) return 'windows';
    return 'other';
  }
  function markOs() {
    const os = detectOs();
    root.dataset.os = os;
    const names = { mac: 'Mac', windows: 'Windows' };
    $$('.os-btn').forEach(button => {
      if (!names[os]) return;
      button.classList.toggle('is-os', button.dataset.os === os);
      button.classList.toggle('is-other-os', button.dataset.os !== os);
    });
    const mine = $(`.os-btn[data-os="${os}"]`);
    if (mine) mine.parentElement.insertBefore(mine, mine.parentElement.children[1]);
    if (names[os]) {
      $$('.os-download').forEach(link => {
        const label = $('.os-download-label', link) || link;
        label.textContent = `Download for ${names[os]}`;
      });
    }
  }
  function markStore() {
    $$('#cta-chrome, [data-chrome-link]').forEach(link => {
      if (CHROME_STORE_URL) { link.href = CHROME_STORE_URL; return; }
      const soon = $('.soon', link);
      if (soon) soon.hidden = false;
      link.setAttribute('aria-label', 'Add to Chrome, coming soon');
    });
  }

  /* ── The playable demo ──────────────────────────────────────────────── */
  // Only the home page has the demo; the privacy, help and 404 pages share the rest.
  function initDemo() {
    const demo = $('#demo');
    const popup = $('#popup');
    const extButton = $('#ext-button');
    const qualityButton = $('#quality-button');
    const menu = $('#quality-menu');
    const snagButton = $('#snag-button');
    const statusLive = $('#status-live');
    const hint = $('#demo-hint');
    const piecesEl = $('#pieces');
    const trace = $('#trace');
    const thumbLive = $('.thumb .live', popup);
    const thumbEdge = $('.thumb .edge', popup);
    const slot = $('#shelf-slot');
    const mascot = $('#mascot');
    const replay = $('#replay');
    const countBadge = $('#count-badge');
    const video = $('#page-video');
    const PIECES = 30;
    const TICK = 420; // Speed sample interval; the real trace uses 650ms, the demo runs faster.
    const MINUTES = { 1080: 6, 720: 4, 480: 2, audio: 1 };
    const ICON_PAUSE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
    const ICON_PLAY = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>';
    const ICON_CHECK = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

    const choice = { q: '1080', tier: 'FHD', size: '2.1 GB', sub: 'English' };
    let state = 'ready';
    let progress = 0; let paused = false; let doneCount = 0;
    let samples = []; let latest = 0; let tickAt = 0; let tickTimer = 0; let frame = 0; let lastFrame = 0; let scale = 0;

    for (let i = 0; i < PIECES; i++) { const piece = document.createElement('i'); piece.className = 'piece'; piecesEl.append(piece); }
    const pieces = [...piecesEl.children];

    function setStep(current) {
      $$('#steps li').forEach(li => {
        const step = Number(li.dataset.step);
        li.classList.toggle('done', step < current || current === 4);
        li.classList.toggle('current', step === current);
        if (step === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
    }
    function setHint(text) { hint.textContent = text; }
    function setPopupHints() {
      popup.classList.toggle('hint-quality', state === 'ready' && !demo.dataset.picked);
      popup.classList.toggle('hint-snag', state === 'ready' && Boolean(demo.dataset.picked));
    }

    // Extension toolbar button toggles the popup.
    function setPopupOpen(open) {
      if (open) popup.removeAttribute('data-closed'); else { popup.setAttribute('data-closed', ''); closeMenu(false); }
      extButton.setAttribute('aria-expanded', String(open));
      extButton.classList.toggle('nudge', !open && state !== 'downloading');
      if (!open) setHint('Click the SnagThis icon in the toolbar.');
      else if (state === 'ready') setHint(demo.dataset.picked ? 'Now press Snag.' : 'Pick a quality, then press Snag.');
    }
    extButton.addEventListener('click', () => { press($('.px-btn', extButton)); setPopupOpen(popup.hasAttribute('data-closed')); });

    // Quality menu (role="menu", menuitemradio; ↑/↓, Home/End, Enter, Esc).
    const items = () => $$('.menu-item', menu);
    function openMenu() {
      if (state !== 'ready') return;
      menu.hidden = false;
      qualityButton.setAttribute('aria-expanded', 'true');
      const checked = items().find(item => item.dataset.q === choice.q) || items()[0];
      checked.focus({ preventScroll: true });
      setStep(1);
    }
    function closeMenu(restoreFocus) {
      if (menu.hidden) return;
      menu.hidden = true;
      qualityButton.setAttribute('aria-expanded', 'false');
      if (restoreFocus) qualityButton.focus({ preventScroll: true });
    }
    qualityButton.addEventListener('click', event => { event.stopPropagation(); if (menu.hidden) openMenu(); else closeMenu(true); });
    qualityButton.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(); } });
    menu.addEventListener('keydown', event => {
      const list = items(); const index = list.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        list[(index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus({ preventScroll: true });
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); list[event.key === 'Home' ? 0 : list.length - 1].focus({ preventScroll: true });
      } else if (event.key === 'Escape') {
        event.preventDefault(); closeMenu(true);
      } else if (event.key === 'Tab') {
        closeMenu(false);
      }
    });
    menu.addEventListener('click', event => {
      const item = event.target.closest('.menu-item');
      if (!item) return;
      event.stopPropagation();
      const group = item.dataset.q ? '[data-q]' : '[data-sub]';
      $$(`.menu-item${group}`, menu).forEach(other => other.setAttribute('aria-checked', String(other === item)));
      if (item.dataset.q) {
        Object.assign(choice, { q: item.dataset.q, tier: item.dataset.tier, size: item.dataset.size });
        $('#quality-label').textContent = item.dataset.q === 'audio' ? 'Audio only' : `${item.dataset.q}p`;
        $('#tier').textContent = item.dataset.tier;
        $('#size-label').textContent = `${item.dataset.size} · 12:37`;
      } else {
        choice.sub = item.dataset.sub;
      }
      demo.dataset.picked = '1';
      closeMenu(true);
      setStep(2);
      setHint('Now press Snag.');
      setPopupHints();
    });
    document.addEventListener('click', event => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(false); });

    // Snag → downloading → saved.
    snagButton.addEventListener('click', () => {
      if (state === 'ready') startDownload();
      else if (state === 'downloading') togglePause();
      else if (state === 'saved') { video.currentTime = 0; video.play().catch(() => {}); press($('.px-btn', mascot)); }
    });
    replay.addEventListener('click', reset);
    mascot.addEventListener('click', () => press($('.px-btn', mascot)));
    const closingMascot = $('.closing-mascot');
    if (closingMascot) {
      closingMascot.addEventListener('click', () => press($('.px-btn', closingMascot)));
      closingMascot.addEventListener('pointerenter', () => press($('.px-btn', closingMascot)));
    }

    function qualityText() { return choice.q === 'audio' ? 'Audio only' : `${choice.q}p`; }
    function etaText() {
      const minutes = (1 - progress) * (MINUTES[choice.q] || 4);
      return minutes < 1 ? 'under a minute left' : `${Math.ceil(minutes)} min left`;
    }
    function renderStatus() {
      if (state === 'downloading') {
        statusLive.textContent = paused ? `Paused at ${Math.floor(progress * 100)}%` : `${Math.floor(progress * 100)}% · ${etaText()}`;
      }
    }

    function startDownload() {
      closeMenu(false);
      state = 'downloading'; popup.dataset.state = state; progress = 0; paused = false; doneCount = 0;
      demo.dataset.picked = demo.dataset.picked || '1';
      setPopupHints();
      snagButton.innerHTML = `${ICON_PAUSE}<span>Pause</span>`;
      snagButton.setAttribute('aria-label', 'Pause download');
      statusLive.textContent = 'Starting…';
      countBadge.hidden = false;
      mascot.dataset.mood = 'busy';
      setStep(3);
      setHint('Snagging. Watch the pieces fill in.');
      pieces.forEach(piece => { piece.className = 'piece'; piece.style.removeProperty('--fill'); });
      samples = [0]; latest = 0; scale = 0; trace.classList.remove('ready');
      tickAt = performance.now();
      clearInterval(tickTimer);
      tickTimer = setInterval(sample, TICK);
      sample();
      lastFrame = performance.now();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(step);
    }

    // A plausible, bumpy download speed (MB/s); sampled like the real speed trace.
    function sample() {
      if (state !== 'downloading') return;
      const t = samples.length;
      const target = paused ? 0 : 6 + 3.2 * Math.sin(t * .9) + 2.4 * Math.sin(t * 2.3 + 1) + Math.random() * 2.2 - (t === 3 ? 4 : 0);
      latest = Math.max(paused ? 0 : .6, target);
      samples.push(latest);
      if (samples.length > 200) samples.shift();
      tickAt = performance.now();
      if (samples.length >= 3) trace.classList.add('ready');
      if (reduced.matches) render(performance.now());
    }

    function togglePause() {
      paused = !paused;
      snagButton.innerHTML = paused ? `${ICON_PLAY}<span>Resume</span>` : `${ICON_PAUSE}<span>Pause</span>`;
      snagButton.setAttribute('aria-label', paused ? 'Resume download' : 'Pause download');
      mascot.dataset.mood = paused ? '' : 'busy';
      setHint(paused ? 'Paused. Pieces already saved stay saved.' : 'Snagging. Watch the pieces fill in.');
      renderStatus();
    }

    function step(now) {
      const dt = Math.min(80, now - lastFrame); lastFrame = now;
      if (state !== 'downloading') return;
      if (!paused) {
        const speed = samples[samples.length - 1] || 1;
        progress = Math.min(1, progress + dt * speed / 36000);
      }
      if (!reduced.matches) render(now);
      else if (progress >= 1) render(now);
      if (progress >= 1) { finish(); return; }
      frame = requestAnimationFrame(step);
    }

    function render(now) {
      const pct = progress * 100;
      thumbLive.style.setProperty('--p', `${pct}%`);
      thumbEdge.style.setProperty('--p', `${pct}%`);
      const done = Math.floor(progress * PIECES);
      for (let i = doneCount; i < Math.min(done, PIECES); i++) {
        const piece = pieces[i];
        piece.className = 'piece done';
        if (!reduced.matches) { piece.classList.add('spark'); setTimeout(() => piece.classList.remove('spark'), 540); }
      }
      doneCount = Math.max(doneCount, done);
      if (done < PIECES) {
        const current = pieces[done];
        current.className = 'piece current';
        current.style.setProperty('--fill', Math.max(.15, progress * PIECES - done).toFixed(2));
      }
      renderStatus();
      drawTrace(now);
    }

    // Speed trace, after apps/extension/popup/speed-trace.js: steps of 6px, a smoothly moving head.
    function drawTrace(now) {
      const box = trace.getBoundingClientRect();
      const width = Math.round(box.width); const height = Math.round(box.height);
      if (width < 40 || samples.length < 2) return;
      trace.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const STEP = 6;
      const fraction = paused || reduced.matches ? 1 : Math.min(1, (now - tickAt) / TICK);
      const count = samples.length; const head = count - 2 + fraction;
      const offset = Math.max(0, head - (width - 4) / STEP); const first = Math.max(0, Math.floor(offset) - 1);
      let peak = 4; for (let i = first; i < count; i++) peak = Math.max(peak, samples[i]);
      const target = peak * 1.18;
      scale = scale && !reduced.matches ? scale + (target - scale) * .06 : target;
      const y = speed => height - 3 - speed / scale * (height - 8);
      let d = '';
      for (let i = first; i <= count - 2; i++) d += `${d ? ' L' : 'M'}${((i - offset) * STEP).toFixed(1)},${y(samples[i]).toFixed(1)}`;
      const headX = (head - offset) * STEP;
      const headY = y(samples[count - 2] + (samples[count - 1] - samples[count - 2]) * fraction);
      d += ` L${headX.toFixed(1)},${headY.toFixed(1)}`;
      $('.trace-line', trace).setAttribute('d', d);
      $('.trace-area', trace).setAttribute('d', `${d} L${headX.toFixed(1)},${height} L${((first - offset) * STEP).toFixed(1)},${height} Z`);
      const dot = $('.trace-dot', trace); dot.setAttribute('cx', headX.toFixed(1)); dot.setAttribute('cy', headY.toFixed(1));
    }

    function finish() {
      clearInterval(tickTimer); cancelAnimationFrame(frame);
      progress = 1; render(performance.now());
      state = 'saved'; popup.dataset.state = state;
      statusLive.innerHTML = `${ICON_CHECK}<span>Saved · ${qualityText()} · ${choice.size}</span>`;
      snagButton.innerHTML = `${ICON_PLAY}<span>Play</span>`;
      snagButton.setAttribute('aria-label', 'Play the saved video');
      countBadge.hidden = true;
      mascot.dataset.mood = '';
      setStep(4);
      setHint('Saved. It’s on your shelf below.');
      replay.hidden = false;
      flyToShelf();
    }

    function fillSlot() {
      slot.classList.add('filled');
      slot.innerHTML = `<img src="media/neon-rain-thumb.webp" alt="" width="320" height="180"><span>Neon Rain <b class="new-tag">NEW</b></span><small>${qualityText()} · ${choice.size}</small>`;
      const btn = $('.px-btn', mascot);
      press(btn);
      if (!reduced.matches) { mascot.classList.remove('cheer'); void mascot.offsetWidth; mascot.classList.add('cheer'); }
    }

    function flyToShelf() {
      const from = $('.thumb', popup).getBoundingClientRect();
      const to = $('.slot-empty', slot).getBoundingClientRect();
      const visible = to.top < innerHeight && to.bottom > 0;
      if (reduced.matches || !visible || !document.body.animate) { fillSlot(); return; }
      const flyer = document.createElement('img');
      flyer.src = 'media/neon-rain-thumb.webp'; flyer.alt = ''; flyer.className = 'flyer';
      Object.assign(flyer.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
      document.body.append(flyer);
      const dx = to.left - from.left; const dy = to.top - from.top; const sx = to.width / from.width; const sy = to.height / from.height;
      flyer.style.transformOrigin = '0 0';
      flyer.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * .45}px, ${dy * .45 - 60}px) scale(${(1 + sx) / 2 * 1.08}, ${(1 + sy) / 2 * 1.08}) rotate(-4deg)`, opacity: 1, offset: .5 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1 },
      ], { duration: 760, easing: 'cubic-bezier(.5,0,.3,1)' }).finished.then(() => { flyer.remove(); fillSlot(); });
    }

    function reset() {
      clearInterval(tickTimer); cancelAnimationFrame(frame);
      state = 'ready'; popup.dataset.state = state; progress = 0; paused = false; doneCount = 0;
      delete demo.dataset.picked;
      statusLive.textContent = '';
      snagButton.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>Snag</span>';
      snagButton.removeAttribute('aria-label');
      thumbLive.style.setProperty('--p', '100%');
      pieces.forEach(piece => { piece.className = 'piece'; });
      trace.classList.remove('ready');
      slot.classList.remove('filled');
      slot.innerHTML = '<span class="slot-empty" aria-hidden="true"></span>';
      mascot.classList.remove('cheer');
      replay.hidden = true;
      setStep(1);
      setPopupOpen(true);
      setHint('Pick a quality, then press Snag.');
      setPopupHints();
      qualityButton.focus({ preventScroll: true });
    }

    // The page's video plays while it's on screen (never with reduced motion).
    function watchVideo() {
      if (!('IntersectionObserver' in window)) return;
      new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && !reduced.matches) video.play().catch(() => {});
          else video.pause();
        }
      }, { threshold: .35 }).observe(video);
      reduced.addEventListener('change', () => { if (reduced.matches) video.pause(); });
    }
    setStep(1);
    setPopupHints();
    watchVideo();
  }

  /* ── Product recordings: load near the viewport, play only on screen ── */
  // Sources start as data-src so nothing downloads until a clip is close. JavaScript then owns playback:
  // play while at least a quarter is visible, pause off screen or in a hidden tab, never autoplay with
  // reduced motion (the poster shows instead), and the round button pauses or plays each one.
  function initClips() {
    const clips = $$('video.clip');
    if (!clips.length) return;
    const states = new Map();
    const load = video => {
      if (video.dataset.loaded) return;
      video.dataset.loaded = '1';
      $$('source[data-src]', video).forEach(source => { source.src = source.dataset.src; source.removeAttribute('data-src'); });
      video.load();
    };
    const sync = video => {
      const state = states.get(video);
      const play = state.visible && state.want && !document.hidden;
      if (play) { load(video); const started = video.play(); if (started) started.catch(() => {}); }
      else if (!video.paused) video.pause();
      if (state.toggle) {
        state.toggle.toggleAttribute('data-paused', !state.want);
        state.toggle.setAttribute('aria-label', state.want ? 'Pause the recording' : 'Play the recording');
      }
    };
    clips.forEach(video => {
      video.autoplay = false; // Playback follows visibility below, not page load.
      const toggle = $('.clip-toggle', video.closest('.shot') || video.parentElement);
      const state = { visible: false, want: !reduced.matches, toggle };
      states.set(video, state);
      if (toggle) {
        toggle.hidden = false;
        toggle.addEventListener('click', () => { state.want = !state.want; if (state.want) state.visible = true; sync(video); });
      }
    });
    if (!('IntersectionObserver' in window)) { clips.forEach(video => { states.get(video).visible = true; sync(video); }); return; }
    const near = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting && states.get(entry.target).want) { load(entry.target); near.unobserve(entry.target); }
    }), { rootMargin: '600px 0px' });
    const seen = new IntersectionObserver(entries => entries.forEach(entry => {
      states.get(entry.target).visible = entry.isIntersecting;
      sync(entry.target);
    }), { threshold: .25 });
    clips.forEach(video => { near.observe(video); seen.observe(video); });
    document.addEventListener('visibilitychange', () => clips.forEach(sync));
    reduced.addEventListener('change', () => clips.forEach(video => { states.get(video).want = !reduced.matches; sync(video); }));
  }

  /* ── Layout motion: scroll-in reveals, a drifting glow and tilt on the product frames ── */
  function initMotion() {
    const reveals = $$('.reveal');
    const shots = $$('.shot[data-tilt]');
    const canMove = () => !reduced.matches && 'IntersectionObserver' in window;
    if (!canMove()) { reveals.forEach(node => node.classList.add('in')); }
    else {
      root.classList.add('motion');
      const io = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      }), { rootMargin: '0px 0px -8% 0px', threshold: .1 });
      reveals.forEach(node => io.observe(node));
    }
    reduced.addEventListener('change', () => {
      root.classList.toggle('motion', canMove());
      if (reduced.matches) { reveals.forEach(node => node.classList.add('in')); shots.forEach(reset); }
    });
    if (!shots.length) return;

    // Tilt and a pointer-following glow, for mouse and trackpad only.
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    function reset(shot) { shot.classList.remove('tilting'); shot.style.setProperty('--rx', '0deg'); shot.style.setProperty('--ry', '0deg'); }
    shots.forEach(shot => {
      let frame = 0; let last = null;
      shot.addEventListener('pointermove', event => {
        if (reduced.matches || !finePointer.matches || event.pointerType === 'touch') return;
        last = event;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const box = shot.getBoundingClientRect();
          const x = Math.min(1, Math.max(0, (last.clientX - box.left) / box.width));
          const y = Math.min(1, Math.max(0, (last.clientY - box.top) / box.height));
          shot.classList.add('tilting');
          shot.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
          shot.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
          shot.style.setProperty('--rx', `${((.5 - y) * 4).toFixed(2)}deg`);
          shot.style.setProperty('--ry', `${((x - .5) * 6).toFixed(2)}deg`);
        });
      });
      shot.addEventListener('pointerleave', () => reset(shot));
    });

    // Gentle parallax: frames drift a few pixels against the scroll while they are on screen.
    const onScreen = new Set();
    let ticking = false;
    const drift = () => {
      ticking = false;
      if (reduced.matches) return;
      const middle = innerHeight / 2;
      onScreen.forEach(shot => {
        const box = shot.getBoundingClientRect();
        const offset = Math.max(-1, Math.min(1, (box.top + box.height / 2 - middle) / innerHeight));
        shot.style.setProperty('--lift', `${(offset * 14).toFixed(1)}px`);
      });
    };
    const request = () => { if (!ticking && onScreen.size) { ticking = true; requestAnimationFrame(drift); } };
    if ('IntersectionObserver' in window) {
      const watch = new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) onScreen.add(entry.target); else onScreen.delete(entry.target); });
        request();
      });
      shots.forEach(shot => watch.observe(shot));
      addEventListener('scroll', request, { passive: true });
      addEventListener('resize', request, { passive: true });
    }
  }

  buildPickers();
  applyAccent('orange', false);
  markOs();
  markStore();
  if ($('#demo')) initDemo();
  initClips();
  initMotion();
  typeLogo();
})();
