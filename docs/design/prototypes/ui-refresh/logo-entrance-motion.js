const ARTWORK = new URL('../../../../apps/desktop/src/assets/vidsnag-logo-title.png', import.meta.url).href;
const WIDTH = 830;
const states = new WeakMap();
const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';
// At natural pace: 150ms pause, 850ms glint, then a short 400ms hold.
export const LEAD_FINISH_MS = 1400;

function image(alt = '') {
  const element = document.createElement('img');
  element.src = ARTWORK;
  element.alt = alt;
  element.width = 830;
  element.height = 164;
  element.draggable = false;
  return element;
}

function fragment(name, left, right) {
  const element = document.createElement('span');
  element.className = `entrance-logo__piece entrance-logo__piece--${name}`;
  element.hidden = true;
  element.style.left = `${left / WIDTH * 100}%`;
  element.style.width = `${(right - left) / WIDTH * 100}%`;
  const artwork = image();
  artwork.style.width = `${WIDTH / (right - left) * 100}%`;
  artwork.style.left = `${-left / (right - left) * 100}%`;
  element.append(artwork);
  return element;
}

/** Mount once. The accessible image is the unchanged original artwork. */
export function mountLogo(host) {
  if (states.has(host)) return host;
  host.classList.add('entrance-logo');
  const base = image('VidSnag');
  base.className = 'entrance-logo__base';
  const stage = document.createElement('span');
  stage.className = 'entrance-logo__stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.hidden = true;
  // These boundaries fall in transparent gaps in the original bitmap.
  const pieces = {
    full: fragment('full', 0, WIDTH),
    words: fragment('words', 0, 679),
    vid: fragment('vid', 0, 263),
    snag: fragment('snag', 263, 679),
    mark: fragment('mark', 679, WIDTH),
  };
  const strips = Array.from({ length: 8 }, (_, index) => (
    fragment(`strip-${index}`, WIDTH * index / 8, WIDTH * (index + 1) / 8)
  ));
  const shine = document.createElement('span');
  shine.className = 'entrance-logo__shine';
  shine.hidden = true;
  shine.style.maskImage = `url("${ARTWORK}")`;
  shine.style.webkitMaskImage = `url("${ARTWORK}")`;
  const beam = document.createElement('span');
  beam.className = 'entrance-logo__beam';
  shine.append(beam);
  stage.append(...Object.values(pieces), ...strips, shine);
  host.replaceChildren(base, stage);
  states.set(host, { stage, pieces, strips, shine, beam, animations: [], run: 0 });
  return host;
}

/** Stop a reveal immediately and restore the complete, unchanged artwork. */
export function stopLogo(host) {
  const state = states.get(host);
  if (!state) return;
  state.run += 1;
  state.animations.forEach(animation => animation.cancel());
  state.animations = [];
  state.stage.hidden = true;
  [...Object.values(state.pieces), ...state.strips, state.shine].forEach(element => {
    element.hidden = true;
  });
  host.classList.remove('is-playing');
}

/** One reveal; resolves with { cancelled } even when interrupted or replayed. */
export function animateLogo(host, { variant = 'current', duration = 1200, reducedMotion = false } = {}) {
  mountLogo(host);
  stopLogo(host);
  const state = states.get(host);
  const run = state.run;
  const allowed = ['lift', 'light', 'lead', 'assemble', 'shutters'];
  const systemReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || systemReducedMotion || !allowed.includes(variant) || duration <= 0) {
    return Promise.resolve({ cancelled: false });
  }
  const milliseconds = Math.max(240, Math.min(3600, Number(duration) || 1200));
  state.stage.hidden = false;
  host.classList.add('is-playing');

  const show = element => { element.hidden = false; return element; };
  const play = (element, keyframes, fraction = 1, delay = 0, easing = EASE_OUT) => {
    const animation = element.animate(keyframes, {
      duration: milliseconds * fraction,
      delay: milliseconds * delay,
      easing,
      fill: 'both',
    });
    state.animations.push(animation);
    // Attach the rejection handler before any replay can cancel this animation.
    return animation.finished.then(() => true, () => false);
  };
  const finished = [];

  if (variant === 'lift') {
    finished.push(play(show(state.pieces.full), [
      { opacity: 0, transform: 'translateY(20%) scale(.97)', filter: 'blur(4px)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
    ]));
  }

  if (variant === 'light') {
    finished.push(play(show(state.pieces.full), [
      { clipPath: 'inset(0 100% 0 0)', opacity: .35 },
      { clipPath: 'inset(0 0% 0 0)', opacity: 1 },
    ], .78, 0, 'cubic-bezier(.33, 0, .2, 1)'));
    finished.push(play(show(state.shine), [
      { opacity: 0, offset: 0 },
      { opacity: .5, offset: .22 },
      { opacity: .5, offset: .68 },
      { opacity: 0, offset: 1 },
    ], .7, .3, 'linear'));
    finished.push(play(state.beam, [
      { transform: 'translateX(-120%) skewX(-15deg)' },
      { transform: 'translateX(470%) skewX(-15deg)' },
    ], .7, .3, 'cubic-bezier(.3, 0, .2, 1)'));
  }

  if (variant === 'lead') {
    // Lock the text reveal to the arrow's trailing edge. Only after the
    // entire name is visible does the arrow tip and settle into place.
    const start = `translateX(${-679 / (WIDTH - 679) * 100}%)`;
    const sweepEasing = 'cubic-bezier(.4, 0, .2, 1)';
    finished.push(play(show(state.pieces.mark), [
      { opacity: 0, transform: `${start} rotate(0deg)`, offset: 0 },
      { opacity: 1, transform: `${start} rotate(0deg)`, offset: .14 },
      { opacity: 1, transform: `${start} rotate(0deg)`, offset: .18, easing: sweepEasing },
      { opacity: 1, transform: 'translateX(0) rotate(0deg)', offset: .72, easing: 'ease-out' },
      { opacity: 1, transform: 'translateX(0) rotate(6deg)', offset: .83, easing: 'ease-in-out' },
      { opacity: 1, transform: 'translateX(0) rotate(-2deg)', offset: .92, easing: 'ease-out' },
      { opacity: 1, transform: 'translateX(0) rotate(0deg)', offset: 1 },
    ], 1, 0, 'linear'));
    finished.push(play(show(state.pieces.words), [
      { clipPath: 'inset(0 100% 0 0)', offset: 0 },
      { clipPath: 'inset(0 100% 0 0)', offset: .18, easing: sweepEasing },
      { clipPath: 'inset(0 0% 0 0)', offset: .72 },
      { clipPath: 'inset(0 0% 0 0)', offset: 1 },
    ], 1, 0, 'linear'));
    // Keep the completed artwork still while a single alpha-clipped shimmer
    // crosses it, then hold before handing control back to the docking motion.
    finished.push(play(show(state.shine), [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 150 / LEAD_FINISH_MS },
      { opacity: .42, offset: 270 / LEAD_FINISH_MS },
      { opacity: .42, offset: 850 / LEAD_FINISH_MS },
      { opacity: 0, offset: 1000 / LEAD_FINISH_MS },
      { opacity: 0, offset: 1 },
    ], LEAD_FINISH_MS / 1200, 1, 'linear'));
    finished.push(play(state.beam, [
      { transform: 'translateX(-120%) skewX(-15deg)' },
      { transform: 'translateX(470%) skewX(-15deg)' },
    ], 850 / 1200, 1350 / 1200, 'cubic-bezier(.3, 0, .2, 1)'));
  }

  if (variant === 'assemble') {
    finished.push(play(show(state.pieces.vid), [
      { opacity: 0, transform: 'translateX(-12%)' },
      { opacity: 1, transform: 'translateX(0)' },
    ], .62));
    finished.push(play(show(state.pieces.snag), [
      { opacity: 0, transform: 'translateY(24%)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], .62, .14));
    finished.push(play(show(state.pieces.mark), [
      { opacity: 0, transform: 'translateX(20%) rotate(-10deg) scale(.9)', offset: 0 },
      { opacity: 1, transform: 'translateX(-2%) rotate(1deg) scale(1.02)', offset: .68 },
      { opacity: 1, transform: 'translateX(0) rotate(0deg) scale(1)', offset: 1 },
    ], .66, .34));
  }

  if (variant === 'shutters') {
    state.strips.forEach((strip, index) => {
      finished.push(play(show(strip), [
        {
          opacity: 0,
          clipPath: 'inset(0 49% 0 49%)',
          transform: `translateY(${index % 2 ? '9%' : '-9%'})`,
        },
        { opacity: 1, clipPath: 'inset(0 0% 0 0%)', transform: 'translateY(0)' },
      ], .65, index * .05));
    });
  }

  return Promise.all(finished).then(results => {
    if (state.run !== run) return { cancelled: true };
    const cancelled = results.some(result => !result);
    stopLogo(host);
    return { cancelled };
  });
}
