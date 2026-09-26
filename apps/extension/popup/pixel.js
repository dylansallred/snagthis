/* The logo's pixel play button as the popup's mascot and snag moment, scaled from the desktop
 * (components/brand/PixelButton.tsx, PixelMascot.tsx, components/list/SnagMoment.tsx).
 * Geometry comes from shared/accents.js; colours follow the accent variables. Decorative only. */
window.SnagThisPixel = (() => {
  'use strict';
  const A = SnagThisAccents;
  const SVG = 'http://www.w3.org/2000/svg';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A 3 × 5 pixel face for "z" and "+N", so no pixel font ships.
  const FONT = {
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'], 3: ['###', '..#', '.##', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'], 6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '.#.', '.#.'],
    8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '###'], '+': ['...', '.#.', '###', '.#.', '...'], z: ['###', '..#', '.#.', '#..', '###'],
  };
  const COLORS = ['var(--accent-bevel-face, #fa5d0e)', 'var(--accent-bevel-light, #ffb238)', '#80bfa6', '#fff4e6', 'var(--accent-bevel-dark, #bd3f00)'];

  function svg(width, height, viewBox, className) {
    const node = document.createElementNS(SVG, 'svg');
    for (const [name, value] of [['width', width], ['height', height], ['viewBox', viewBox], ['shape-rendering', 'crispEdges'], ['aria-hidden', 'true'], ['focusable', 'false']]) node.setAttribute(name, String(value));
    if (className) node.setAttribute('class', className);
    return node;
  }
  function path(parent, className, d, fill) {
    if (!d) return;
    const node = document.createElementNS(SVG, 'path');
    if (className) node.setAttribute('class', className);
    if (fill) node.setAttribute('fill', fill);
    node.setAttribute('d', d); parent.append(node);
  }
  // Whole-pixel runs, the encoding scripts/render-brand-assets.cjs uses.
  function runs(roles, wanted) {
    let d = '';
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16;) {
        if (roles[y * 16 + x] !== wanted) { x++; continue; }
        let end = x; while (end + 1 < 16 && roles[y * 16 + end + 1] === wanted) end++;
        d += `M${x} ${y}h${end - x + 1}v1h-${end - x + 1}z`; x = end + 1;
      }
    }
    return d;
  }

  /** The pixel bevel button; `pause` is the dozing mascot's glyph. */
  function button(size, variant = 'play') {
    const roles = A.buttonRoles(variant);
    const node = svg(size, size, '0 0 16 16', 'pixel-button');
    for (const role of ['face', 'light', 'dark', 'shade', 'glyph']) path(node, `pixel-button-${role}`, runs(roles, role));
    return node;
  }

  /** Replays the launch press. Decorative, so reduced motion skips it. */
  function press(node) {
    if (!node || reduced()) return;
    node.classList.remove('pressing'); void node.getBoundingClientRect(); node.classList.add('pressing');
    node.addEventListener('animationend', event => { if (event.target === node) node.classList.remove('pressing'); }, { once: true });
  }

  function text(value, scale) {
    const chars = [...String(value)].filter(char => FONT[char]);
    let d = '';
    chars.forEach((char, index) => FONT[char].forEach((row, y) => [...row].forEach((cell, x) => { if (cell === '#') d += `M${index * 4 + x} ${y}h1v1h-1z`; })));
    const width = Math.max(1, chars.length * 4 - 1);
    const node = svg(width * scale, 5 * scale, `0 0 ${width} 5`);
    path(node, '', d, 'currentColor');
    return node;
  }

  /** Empty states: the button waits (bobbing in hard steps) or dozes with pause bars and drifting z's. */
  function mascot(variant = 'waiting') {
    const node = document.createElement('div'); node.className = 'pixel-mascot'; node.dataset.variant = variant; node.setAttribute('aria-hidden', 'true');
    const floor = document.createElement('i'); floor.className = 'pixel-mascot-floor';
    if (variant === 'dozing') {
      const first = text('z', 2); first.classList.add('pixel-mascot-z'); const second = text('z', 2); second.classList.add('pixel-mascot-z');
      node.append(button(48, 'pause'), first, second, floor);
    } else {
      const bob = document.createElement('div'); bob.className = 'pixel-mascot-bob'; bob.append(button(48));
      node.append(bob, floor);
    }
    const poke = () => press(node.querySelector('.pixel-button'));
    node.addEventListener('pointerenter', poke); node.addEventListener('click', poke);
    return node;
  }

  // ── Snag moment ────────────────────────────────────────────────────────────
  let layer = null; let batch = null;
  const center = rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  function ensureLayer() {
    if (layer?.isConnected) return layer;
    layer = document.createElement('div'); layer.className = 'snag-layer'; layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer); return layer;
  }
  function burst(fx, from) {
    for (let index = 0; index < 14; index++) {
      const pixel = document.createElement('i'); pixel.className = 'snag-pixel';
      pixel.style.background = COLORS[index % COLORS.length]; pixel.style.left = `${from.x - 2}px`; pixel.style.top = `${from.y - 2}px`;
      fx.append(pixel);
      const angle = index / 14 * Math.PI * 2 + Math.random() * .4; const distance = 20 + Math.random() * 22;
      const dx = Math.cos(angle) * distance; const dy = Math.sin(angle) * distance * .8;
      // Out, then falling under gravity, in eight hard steps.
      pixel.animate([
        { transform: 'translate(0, 0)', opacity: 1 },
        { transform: `translate(${dx * .7}px, ${dy * .7 - 8}px)`, opacity: 1, offset: .45 },
        { transform: `translate(${dx}px, ${dy + 14}px)`, opacity: 0 },
      ], { duration: 600, easing: 'steps(8, end)', fill: 'forwards' }).finished.catch(() => {}).then(() => pixel.remove());
    }
  }
  function drawPlus(label, count) { label.replaceChildren(text(`+${count}`, 3)); }
  async function rise(fx, target, moment) {
    const to = target.getBoundingClientRect();
    target.classList.remove('snag-bump'); void target.offsetWidth; target.classList.add('snag-bump');
    target.addEventListener('animationend', () => target.classList.remove('snag-bump'), { once: true });
    const plus = document.createElement('div'); plus.className = 'snag-plus';
    plus.style.left = `${Math.min(window.innerWidth - 28, to.right - 18)}px`; plus.style.top = `${to.top - 14}px`;
    fx.append(plus); moment.plus = plus; drawPlus(plus, moment.count);
    await plus.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-12px)', opacity: 0 }], { duration: 700, easing: 'steps(6, end)', fill: 'forwards' }).finished.catch(() => {});
    moment.plus = null; plus.remove();
  }

  /**
   * A watched download finished: 14 pixels burst from its action and, for SnagThis library saves,
   * "+N" rises from the footer's Open SnagThis indicator. Completions within 2s share one "+N".
   * Hidden popups and reduced motion only get a small square dot on the indicator.
   */
  function snag(origin, target) {
    if (document.hidden || reduced()) { if (target) target.classList.add('snag-pip'); return; }
    const fx = ensureLayer();
    const rect = origin?.getBoundingClientRect();
    if (rect?.width) burst(fx, center(rect));
    if (!target) return;
    const now = performance.now();
    if (batch && now - batch.started < 2000) { batch.count++; if (batch.plus) drawPlus(batch.plus, batch.count); return; }
    const moment = { started: now, count: 1, plus: null }; batch = moment;
    setTimeout(() => { rise(fx, target, moment); }, 240);
  }

  return { button, press, text, mascot, snag };
})();
