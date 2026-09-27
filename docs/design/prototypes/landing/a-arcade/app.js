/* SnagThis landing · Direction A "Arcade". Vanilla, no dependencies. Every animation is decorative
   and checks prefers-reduced-motion; content is fully visible without JavaScript. */
(function () {
  'use strict';
  var root = document.documentElement;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = function () { return motion.matches; };

  /* ── Accent colours (packages/contracts/src/accents.js) ── */
  var ACCENTS = {
    orange: { primary: 'hsl(18 96% 40%)', strong: 'hsl(18 96% 36%)', hover: 'hsl(20 96% 52%)', muted: 'hsl(16 58% 16%)', ring: 'hsl(18 96% 44%)', logo: '#fa5d0e', face: '#fa5d0e', light: '#ffb238', dark: '#bd3f00' },
    cobalt: { primary: 'hsl(220 80% 50%)', strong: 'hsl(220 80% 45%)', hover: 'hsl(218 95% 63%)', muted: 'hsl(220 50% 18%)', ring: 'hsl(219 88% 56%)', logo: '#4a88ff', face: '#3b7bff', light: '#a3c6ff', dark: '#1d44b0' },
    violet: { primary: 'hsl(262 70% 54%)', strong: 'hsl(262 70% 48%)', hover: 'hsl(262 90% 70%)', muted: 'hsl(262 45% 20%)', ring: 'hsl(262 80% 62%)', logo: '#9b78ff', face: '#8b5cf6', light: '#d0bcff', dark: '#5528b8' },
    mint: { primary: 'hsl(160 84% 28%)', strong: 'hsl(160 84% 24%)', hover: 'hsl(158 70% 50%)', muted: 'hsl(160 50% 13%)', ring: 'hsl(159 77% 40%)', logo: '#26d996', face: '#1fbf8a', light: '#a4f3cc', dark: '#0d7a57' },
    magenta: { primary: 'hsl(330 75% 46%)', strong: 'hsl(330 75% 41%)', hover: 'hsl(330 90% 64%)', muted: 'hsl(330 50% 18%)', ring: 'hsl(330 82% 55%)', logo: '#f550a0', face: '#e8388e', light: '#ffb3d6', dark: '#9c1558' }
  };
  var ACCENT_KEY = 'snagthis.siteAccent';
  function applyAccent(id) {
    var t = ACCENTS[id] || ACCENTS.orange;
    [['--primary', t.primary], ['--primary-strong', t.strong], ['--primary-hover', t.hover], ['--primary-muted', t.muted], ['--ring', t.ring],
      ['--accent-logo', t.logo], ['--accent-bevel-face', t.face], ['--accent-bevel-light', t.light], ['--accent-bevel-dark', t.dark]]
      .forEach(function (pair) { root.style.setProperty(pair[0], pair[1]); });
    document.querySelectorAll('[data-accent]').forEach(function (b) {
      var on = b.getAttribute('data-accent') === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  var saved = null;
  try { saved = localStorage.getItem(ACCENT_KEY); } catch (e) { /* private mode */ }
  if (saved && ACCENTS[saved]) applyAccent(saved);

  var swatches = document.querySelector('[data-swatches]');
  if (swatches) {
    var pick = function (button, focus) {
      var id = button.getAttribute('data-accent');
      if (!reduced()) { root.classList.add('accent-fade'); setTimeout(function () { root.classList.remove('accent-fade'); }, 300); }
      applyAccent(id);
      try { localStorage.setItem(ACCENT_KEY, id); } catch (e) { /* ignore */ }
      if (focus) button.focus();
      press(document.querySelector('.accent-demo .pb'));
    };
    swatches.addEventListener('click', function (event) {
      var button = event.target.closest('[data-accent]');
      if (button) pick(button, false);
    });
    swatches.addEventListener('keydown', function (event) {
      var list = Array.prototype.slice.call(swatches.querySelectorAll('[data-accent]'));
      var index = list.indexOf(document.activeElement);
      if (index < 0) return;
      var next = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (event.key === 'Home') next = -index; else if (event.key === 'End') next = list.length - 1 - index;
      if (next === undefined) return;
      event.preventDefault();
      pick(list[(index + next + list.length) % list.length], true);
    });
  }

  /* ── Operating system: highlight the matching download ── */
  function detectOS() {
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var ua = navigator.userAgent || '';
    var touchMac = /Mac/i.test(platform) && navigator.maxTouchPoints > 1;
    if (/Android|iPhone|iPad|iPod/i.test(ua) || touchMac || (navigator.userAgentData && navigator.userAgentData.mobile)) return 'mobile';
    if (/Mac/i.test(platform) || /Mac OS X/.test(ua)) return 'mac';
    if (/Win/i.test(platform) || /Windows/.test(ua)) return 'windows';
    if (/Linux|CrOS|X11/i.test(platform + ua)) return 'other';
    return 'unknown';
  }
  var os = detectOS();
  root.setAttribute('data-os', os);
  document.querySelectorAll('[data-cta-row]').forEach(function (row) {
    var match = row.querySelector('[data-os-btn="' + os + '"]');
    if (match) {
      match.classList.add('is-you');
      // The visitor's download comes right after Add to Chrome.
      var chrome = row.querySelector('[data-chrome]');
      if (chrome && chrome.nextElementSibling !== match) row.insertBefore(match, chrome.nextElementSibling);
    }
  });
  var note = document.querySelector('[data-os-note]');
  if (note) {
    if (os === 'mac') note.textContent = 'Looks like you’re on a Mac. The extension works on its own; the app adds streams and a library.';
    else if (os === 'windows') note.textContent = 'Looks like you’re on Windows. The extension works on its own; the app adds streams and a library.';
    else if (os === 'mobile') note.textContent = 'SnagThis runs on computers. Visit on your Mac or PC to get it.';
    else if (os === 'other') note.textContent = 'The desktop app is for Mac and Windows. The Chrome extension works on its own.';
  }

  /* ── "Add to Chrome" placeholder until the store listing is live ── */
  var toast = document.querySelector('[data-toast]');
  var toastTimer = 0;
  function showToast(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 3200);
  }
  document.querySelectorAll('[data-chrome]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      if ((link.getAttribute('href') || '').indexOf('#chrome-web-store') !== 0) return;
      event.preventDefault();
      showToast('Coming soon to the Chrome Web Store. The desktop app is ready on GitHub now.');
    });
  });

  /* ── Pixel button press + burst ── */
  function press(svg) {
    if (!svg || reduced()) return;
    svg.classList.remove('pressing');
    void svg.getBoundingClientRect();
    svg.classList.add('pressing');
    svg.addEventListener('animationend', function done(event) {
      if (event.target !== svg) return;
      svg.classList.remove('pressing');
      svg.removeEventListener('animationend', done);
    });
  }
  function burst(host, target, px) {
    if (reduced() || !host || !target) return;
    var h = host.getBoundingClientRect();
    var t = target.getBoundingClientRect();
    var cx = t.left - h.left + t.width / 2;
    var cy = t.top - h.top + t.height / 2;
    var style = getComputedStyle(root);
    var colours = [style.getPropertyValue('--accent-bevel-face'), style.getPropertyValue('--accent-bevel-light'), '#80bfa6', '#f4c38a', '#ffffff'];
    for (var i = 0; i < 14; i++) {
      var bit = document.createElement('i');
      bit.className = 'burst';
      bit.style.setProperty('--c', colours[i % colours.length]);
      bit.style.setProperty('--px', px + 'px');
      bit.style.left = Math.round(cx - px / 2) + 'px';
      bit.style.top = Math.round(cy - px / 2) + 'px';
      host.appendChild(bit);
      var angle = (i / 14) * Math.PI * 2 + Math.random() * .4;
      var dist = t.width * (.8 + Math.random() * .7);
      var dx = Math.round(Math.cos(angle) * dist / px) * px;
      var dy = Math.round(Math.sin(angle) * dist / px) * px;
      bit.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: 0 }],
        { duration: 620, easing: 'steps(6)', fill: 'forwards' }).finished.then(function (b) { return function () { b.remove(); }; }(bit), function () {});
    }
    var plus = document.createElement('span');
    plus.className = 'plus-one';
    plus.textContent = '+1';
    plus.style.left = Math.round(cx + t.width * .35) + 'px';
    plus.style.top = Math.round(cy - t.height) + 'px';
    host.appendChild(plus);
    plus.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-32px)', opacity: 0 }], { duration: 800, easing: 'steps(8)', fill: 'forwards' })
      .finished.then(function () { plus.remove(); }, function () {});
  }

  /* ── Hero: the launch "type, then press", at whole-pixel scale ── */
  var stage = document.querySelector('.stage');
  var lockup = document.querySelector('.lockup-hero');
  var PENS = [-1, 13, 27, 40, 53, 65, 78, 84];
  var LAST_RIGHT = 96, BUTTON_X = 104;
  var TYPE_START = 260, LETTER_MS = 70;
  var CURSOR_AT_BUTTON = TYPE_START + PENS.length * LETTER_MS;
  var POP_AT = CURSOR_AT_BUTTON + 90, POP_MS = 280;
  var PRESS_AT = POP_AT + POP_MS + 120, PRESS_MS = 560;
  var SHINE_AT = PRESS_AT + PRESS_MS + 150;
  var running = [];
  var shineTimer = 0;

  function fitScale() {
    if (!stage || !lockup) return;
    var width = stage.clientWidth - 40;
    var scale = Math.max(2, Math.min(5, Math.floor(width / 120)));
    lockup.style.setProperty('--s', scale);
  }
  fitScale();
  window.addEventListener('resize', fitScale);

  function stopIntro() {
    running.forEach(function (a) { a.cancel(); });
    running = [];
    clearTimeout(shineTimer);
    if (lockup) lockup.classList.remove('shining');
  }
  function play(el, frames, options) {
    var a = el.animate(frames, options);
    running.push(a);
    return a;
  }
  function intro() {
    if (!lockup) return;
    stopIntro();
    root.classList.add('intro-ready');
    if (reduced()) return;
    var letters = lockup.querySelectorAll('.logo-letter');
    var cursor = lockup.querySelector('.logo-cursor');
    var button = lockup.querySelector('.lockup-btn');
    var svg = button.querySelector('.pb');
    letters.forEach(function (letter, i) {
      play(letter, [{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: TYPE_START + i * LETTER_MS, fill: 'both' });
    });
    var at = function (ms) { return ms / POP_AT; };
    var stops = [{ transform: 'translateX(' + PENS[0] + 'px)', opacity: 1, offset: 0 }];
    PENS.forEach(function (pen, i) {
      stops.push({ transform: 'translateX(' + (PENS[i + 1] !== undefined ? PENS[i + 1] : LAST_RIGHT + 1) + 'px)', opacity: 1, offset: at(TYPE_START + i * LETTER_MS) });
    });
    stops.push({ transform: 'translateX(' + BUTTON_X + 'px)', opacity: 1, offset: at(CURSOR_AT_BUTTON) });
    stops.push({ transform: 'translateX(' + BUTTON_X + 'px)', opacity: 0, offset: 1 });
    // A blinking cursor waits at the start, then types.
    play(cursor, stops.map(function (s) { s.easing = 'step-end'; return s; }), { duration: POP_AT, fill: 'both' });
    play(button, [
      { transform: 'scale(.25)', opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: 'scale(1.14)', opacity: 1, offset: .55, easing: 'ease-in-out' },
      { transform: 'scale(1)', opacity: 1 }
    ], { duration: POP_MS, delay: POP_AT, fill: 'both' });
    var depth = Math.max(2, button.getBoundingClientRect().height * .13);
    var hi = svg.querySelector('[data-bevel="hi"]');
    var lo = svg.querySelector('[data-bevel="lo"]');
    var lit = getComputedStyle(hi).fill, shade = getComputedStyle(lo).fill;
    play(hi, [{ fill: shade }, { fill: shade }], { duration: PRESS_MS * .34, delay: PRESS_AT + PRESS_MS * .1 });
    play(lo, [{ fill: lit }, { fill: lit }], { duration: PRESS_MS * .34, delay: PRESS_AT + PRESS_MS * .1 });
    play(svg, [
      { transform: 'translateY(0) scale(1)', filter: 'drop-shadow(0 ' + depth + 'px 0 rgb(0 0 0 / 0))', easing: 'cubic-bezier(.5,0,.9,.4)' },
      { transform: 'translateY(0) scale(1)', filter: 'drop-shadow(0 ' + depth + 'px 0 rgb(0 0 0 / .55))', offset: .08, easing: 'cubic-bezier(.5,0,.9,.4)' },
      { transform: 'translateY(' + depth + 'px) scale(.93)', filter: 'drop-shadow(0 ' + depth * .15 + 'px 0 rgb(0 0 0 / .55))', offset: .3, easing: 'cubic-bezier(.2,.9,.3,1.4)' },
      { transform: 'translateY(' + (-depth * .25) + 'px) scale(1.01)', filter: 'drop-shadow(0 ' + depth * 1.1 + 'px 0 rgb(0 0 0 / .4))', offset: .66, easing: 'ease-in-out' },
      { transform: 'translateY(0) scale(1)', filter: 'drop-shadow(0 ' + depth + 'px 0 rgb(0 0 0 / 0))' }
    ], { duration: PRESS_MS, delay: PRESS_AT });
    setTimeout(function () { if (running.length) burst(stage, button, Math.max(4, Math.round(depth / 2))); }, PRESS_AT + PRESS_MS * .3);
    shineTimer = setTimeout(function () {
      lockup.classList.remove('shining');
      void lockup.offsetWidth;
      lockup.classList.add('shining');
    }, SHINE_AT);
  }

  if (lockup) {
    // Start once the page is visible, so nobody misses the opening in a background tab.
    var begin = function () {
      if (document.hidden) { document.addEventListener('visibilitychange', function v() { if (!document.hidden) { document.removeEventListener('visibilitychange', v); intro(); } }); return; }
      intro();
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(begin, begin); else begin();
    var replay = document.querySelector('[data-replay]');
    if (replay) replay.addEventListener('click', intro);
    lockup.querySelector('.lockup-btn').addEventListener('click', function () {
      if (running.length && running.some(function (a) { return a.playState === 'running'; })) return;
      var svg = this.querySelector('.pb');
      press(svg);
      burst(stage, this, Math.max(4, Math.round(this.getBoundingClientRect().height / 12)));
    });
    motion.addEventListener && motion.addEventListener('change', function () { if (reduced()) stopIntro(); });
  }

  /* Final mascot: hover or click presses it, like the app's empty-state mascot. */
  var mascot = document.querySelector('[data-mascot]');
  if (mascot) {
    var host = mascot.closest('.final-inner');
    host.style.position = 'relative';
    var hit = function () { press(mascot.querySelector('.pb')); };
    mascot.addEventListener('pointerenter', hit);
    mascot.addEventListener('click', function () { hit(); burst(host, mascot.querySelector('.pb'), 6); });
  }

  /* ── Scroll progress: the page "downloads" in pixel segments ── */
  var cells = document.querySelector('.scrollbar-cells');
  var cellEls = [];
  function buildCells() {
    var count = window.innerWidth < 640 ? 24 : 60;
    if (cellEls.length === count) return;
    cells.innerHTML = '';
    cellEls = [];
    for (var i = 0; i < count; i++) { var c = document.createElement('i'); cells.appendChild(c); cellEls.push(c); }
  }
  var ticking = false;
  function paintProgress() {
    ticking = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var frac = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    var done = Math.floor(frac * cellEls.length);
    cellEls.forEach(function (c, i) {
      c.className = i < done ? 'done' : (i === done && frac > 0 && frac < 1 ? 'head' : '');
    });
  }
  if (cells) {
    buildCells();
    paintProgress();
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(paintProgress); } }, { passive: true });
    window.addEventListener('resize', function () { buildCells(); paintProgress(); });
  }

  /* ── Step bars fill as each step scrolls into view ── */
  document.querySelectorAll('.segbar').forEach(function (bar) {
    for (var i = 0; i < 14; i++) { var c = document.createElement('i'); c.style.setProperty('--i', i); bar.appendChild(c); }
  });
  var steps = document.querySelectorAll('[data-fill]');
  if ('IntersectionObserver' in window) {
    var stepObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var index = Array.prototype.indexOf.call(steps, entry.target);
        setTimeout(function () { entry.target.classList.add('filled'); }, reduced() ? 0 : index * 350);
        stepObserver.unobserve(entry.target);
      });
    }, { threshold: .6 });
    steps.forEach(function (s) { stepObserver.observe(s); });
  } else steps.forEach(function (s) { s.classList.add('filled'); });

  /* ── Speed trace demo (matches the app: 6px per 650ms sample, eased scale, glowing head) ── */
  var canvas = document.querySelector('[data-trace]');
  var speedLabel = document.querySelector('[data-speed]');
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext('2d');
    var STEP = 6, SAMPLE_MS = 650;
    var samples = [];
    var value = 3.9;
    var nextValue = function () {
      value += (Math.random() - .5) * .9 + (3.9 - value) * .12;
      value = Math.max(1.6, Math.min(6.2, value));
      if (Math.random() < .05) value = Math.max(1.6, value - 1.6);
      return value;
    };
    for (var s = 0; s < 140; s++) samples.push(nextValue());
    var lastAt = performance.now();
    var scaleMax = 7;
    var visible = false, rafId = 0, timerId = 0;
    var size = function () {
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: w, h: h };
    };
    var draw = function (t) {
      var box = size(), w = box.w, h = box.h;
      if (!w) return;
      var style = getComputedStyle(root);
      var face = style.getPropertyValue('--accent-bevel-face').trim() || '#fa5d0e';
      var light = style.getPropertyValue('--accent-bevel-light').trim() || '#ffb238';
      var n = samples.length;
      var peak = 0;
      for (var i = Math.max(0, n - Math.ceil(w / STEP) - 2); i < n; i++) peak = Math.max(peak, samples[i]);
      scaleMax += (peak * 1.25 - scaleMax) * (reduced() ? 1 : .06);
      var headX = w - 8;
      var y = function (v) { return h - 4 - (v / scaleMax) * (h - 14); };
      var headV = samples[n - 2] + (samples[n - 1] - samples[n - 2]) * t;
      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(headX, y(headV));
      for (var k = n - 2; k >= 0; k--) {
        var x = headX - (n - 2 - k) * STEP - t * STEP;
        ctx.lineTo(x, y(samples[k]));
        if (x < -STEP) break;
      }
      ctx.save();
      ctx.lineTo(-STEP, h); ctx.lineTo(headX, h); ctx.closePath();
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, hexA(face, .55)); grad.addColorStop(1, hexA(face, 0));
      ctx.fillStyle = grad; ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(headX, y(headV));
      for (var m = n - 2; m >= 0; m--) {
        var xx = headX - (n - 2 - m) * STEP - t * STEP;
        ctx.lineTo(xx, y(samples[m]));
        if (xx < -STEP) break;
      }
      ctx.strokeStyle = light; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      if (!reduced()) { ctx.shadowColor = light; ctx.shadowBlur = 12; }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(headX, y(headV), 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    };
    var hexA = function (hex, a) {
      var m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return 'rgba(250,93,14,' + a + ')';
      var v = parseInt(m[1], 16);
      return 'rgba(' + (v >> 16 & 255) + ',' + (v >> 8 & 255) + ',' + (v & 255) + ',' + a + ')';
    };
    var sample = function () {
      samples.push(nextValue());
      if (samples.length > 400) samples.splice(0, samples.length - 400);
      lastAt = performance.now();
      if (speedLabel) speedLabel.textContent = samples[samples.length - 1].toFixed(2);
      if (reduced()) draw(1);
    };
    var frame = function (now) {
      if (!visible || reduced()) { rafId = 0; return; }
      draw(Math.min(1, (now - lastAt) / SAMPLE_MS));
      rafId = requestAnimationFrame(frame);
    };
    var start = function () {
      if (timerId) return;
      timerId = setInterval(sample, SAMPLE_MS);
      if (reduced()) draw(1); else if (!rafId) rafId = requestAnimationFrame(frame);
    };
    var stop = function () { clearInterval(timerId); timerId = 0; cancelAnimationFrame(rafId); rafId = 0; };
    draw(1);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible && !document.hidden) start(); else stop();
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (visible) start(); });
    window.addEventListener('resize', function () { draw(1); });
  }
})();
