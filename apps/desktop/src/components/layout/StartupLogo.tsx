import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { SNAGTHIS_LOGO as LOGO } from './snagthisLogo';
import './StartupLogo.css';

const { button: BUTTON, colors: COLORS } = LOGO;
// Orange parts follow the accent theme (lib/accentTheme.ts).
const ACCENT_LOGO = `var(--accent-logo, ${COLORS.orange})`;
const ACCENT_LIGHT = `var(--accent-bevel-light, ${COLORS.amber})`;
const ACCENT_DARK = `var(--accent-bevel-dark, ${COLORS.deep})`;
const SCALE = 3; // Whole screen pixels per logo pixel while the opening plays.
// A10 "Type, then press": a block cursor types each capital, the button pops in
// where the cursor lands, then presses like hitting play.
const TYPE_START_MS = 150;
const LETTER_MS = 50;
const CURSOR_TO_BUTTON_MS = TYPE_START_MS + LOGO.letters.length * LETTER_MS; // 550
const POP_AT_MS = CURSOR_TO_BUTTON_MS + 70;
const POP_MS = 260;
const PRESS_AT_MS = POP_AT_MS + POP_MS + 80; // 960
const PRESS_MS = 520;
const HOLD_UNTIL_MS = 1750; // The pressed logo rests briefly before moving.
const MOVE_MS = 620;
const SHORT_MS = 600;
const SEEN_KEY = 'snagthis.startupSeen';

function startupSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
function markStartupSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* A private or full store just replays the opening. */ }
}

/**
 * The chosen opening plays in full on the first launch while the rest of the app initializes normally.
 * Later launches settle the logo into the header in a short fade and scale.
 */
export function StartupLogo({ targetRef }: { targetRef: RefObject<SVGSVGElement | null> }) {
  const [finished, setFinished] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [mode] = useState<'full' | 'short'>(() => startupSeen() ? 'short' : 'full');
  const backdropRef = useRef<HTMLDivElement>(null);
  const artworkRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<SVGSVGElement>(null);
  const buttonRef = useRef<HTMLSpanElement>(null);
  const pressRef = useRef<SVGSVGElement>(null);
  const dismissRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    if (finished) return;
    const target = targetRef.current;
    const backdrop = backdropRef.current;
    const logo = artworkRef.current;
    const words = wordsRef.current;
    const button = buttonRef.current;
    const press = pressRef.current;
    const letters = words ? [...words.querySelectorAll<SVGPathElement>('.startup-logo-letter')] : [];
    const cursor = words?.querySelector<SVGRectElement>('.startup-logo-cursor');
    const bevel = press ? [...press.querySelectorAll<SVGPathElement>('[data-bevel]')] : [];
    if (!target || !backdrop || !logo || !words || !button || !press || !cursor || letters.length !== LOGO.letters.length) {
      setFinished(true);
      return;
    }

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations: Animation[] = [];
    const previousVisibility = target.style.visibility;
    let cancelled = false;
    let started = false;

    const dispose = () => {
      if (cancelled) return;
      cancelled = true;
      animations.forEach(animation => animation.cancel());
      target.style.visibility = previousVisibility;
      preference.removeEventListener('change', onPreferenceChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', finish, true);
      dismissRef.current = () => {};
    };
    const finish = () => {
      if (cancelled) return;
      dispose();
      setFinished(true);
    };
    const onPreferenceChange = () => { if (preference.matches) finish(); };
    const onResize = () => { if (started) finish(); };
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (started) finish();
      } else if (!started) {
        void start();
      }
    };
    const play = (element: Element, keyframes: Keyframe[], duration: number, delay = 0, easing = 'linear', fill: FillMode = 'both') => {
      const animation = element.animate(keyframes, { duration, delay, easing, fill });
      animations.push(animation);
      // Every cancellation is handled, including StrictMode's initial cleanup.
      return animation.finished.then(() => true, () => false);
    };
    // The header image shows the same artwork, so the whole box maps onto it.
    const headerPlace = (width: number) => {
      const bounds = target.getBoundingClientRect();
      const scale = Math.min(bounds.width / width, bounds.height / (width * LOGO.height / LOGO.width));
      return {
        scale,
        left: bounds.left + (bounds.width - width * scale) / 2,
        top: bounds.top + (bounds.height - width * LOGO.height / LOGO.width * scale) / 2,
      };
    };
    const settle = async () => {
      // Short opening: the finished logo fades in slightly large over its header place and scales down into it.
      const width = target.getBoundingClientRect().width;
      if (width <= 0) { finish(); return; }
      const { left, top } = headerPlace(width);
      const height = width * LOGO.height / LOGO.width;
      const grow = 1.25;
      logo.style.width = `${width}px`;
      logo.style.height = `${height}px`;
      const easing = 'cubic-bezier(.2, .8, .2, 1)';
      await Promise.all([
        play(logo, [
          { transform: `translate(${left - width * (grow - 1) / 2}px, ${top - height * (grow - 1) / 2}px) scale(${grow})`, opacity: 0 },
          { transform: `translate(${left}px, ${top}px) scale(1)`, opacity: 1 },
        ], SHORT_MS, 0, easing),
        play(backdrop, [{ opacity: 1 }, { opacity: 0 }], SHORT_MS - 150, 150, 'ease-out'),
      ]);
      finish();
    };
    const type = () => {
      // Each capital appears as the cursor passes it; the cursor then waits where the button will pop in.
      letters.forEach((letter, index) => {
        void play(letter, [{ opacity: 0 }, { opacity: 1 }], 1, TYPE_START_MS + index * LETTER_MS);
      });
      const at = (ms: number) => ms / POP_AT_MS;
      const stops: Keyframe[] = [
        { transform: `translateX(${LOGO.letters[0].pen}px)`, opacity: 1, offset: 0 },
        ...LOGO.letters.map((letter, index) => ({
          transform: `translateX(${LOGO.letters[index + 1]?.pen ?? letter.right + 1}px)`, opacity: 1, offset: at(TYPE_START_MS + index * LETTER_MS),
        })),
        { transform: `translateX(${BUTTON.x}px)`, opacity: 1, offset: at(CURSOR_TO_BUTTON_MS) },
        { transform: `translateX(${BUTTON.x}px)`, opacity: 0, offset: 1 },
      ];
      return play(cursor, stops.map(stop => ({ ...stop, easing: 'step-end' })), POP_AT_MS);
    };
    const pop = () => play(button, [
      { transform: 'scale(.25)', opacity: 0, easing: 'cubic-bezier(.2, .8, .3, 1)' },
      { transform: 'scale(1.14)', opacity: 1, offset: .55, easing: 'ease-in-out' },
      { transform: 'scale(1)', opacity: 1 },
    ], POP_MS, POP_AT_MS);
    const pressButton = (height: number) => {
      const depth = Math.max(1, height * .13);
      // The lit and shaded bevel edges swap while the button is down.
      const edge = (name: string) => bevel.find(path => path.dataset.bevel === name);
      const lit = getComputedStyle(edge('hi')!).fill;
      const shade = getComputedStyle(edge('lo')!).fill;
      bevel.forEach(path => {
        // Swap to the other edge's colour, whichever accent is showing.
        const pressed = path.dataset.bevel === 'hi' ? shade : lit;
        void play(path, [{ fill: pressed }, { fill: pressed }], PRESS_MS * .34, PRESS_AT_MS + PRESS_MS * .1, 'linear', 'none');
      });
      return play(press, [
        { transform: 'translateY(0) scale(1)', filter: `drop-shadow(0 ${depth}px 0 rgb(0 0 0 / 0))`, easing: 'cubic-bezier(.5, 0, .9, .4)' },
        { transform: 'translateY(0) scale(1)', filter: `drop-shadow(0 ${depth}px 0 rgb(0 0 0 / .55))`, offset: .08, easing: 'cubic-bezier(.5, 0, .9, .4)' },
        { transform: `translateY(${depth}px) scale(.93)`, filter: `drop-shadow(0 ${depth * .15}px 0 rgb(0 0 0 / .55))`, offset: .3, easing: 'cubic-bezier(.2, .9, .3, 1.4)' },
        { transform: `translateY(${-depth * .25}px) scale(1.01)`, filter: `drop-shadow(0 ${depth * 1.1}px 0 rgb(0 0 0 / .4))`, offset: .66, easing: 'ease-in-out' },
        { transform: 'translateY(0) scale(1)', filter: `drop-shadow(0 ${depth}px 0 rgb(0 0 0 / 0))` },
      ], PRESS_MS, PRESS_AT_MS);
    };
    const start = async () => {
      if (cancelled || started || document.hidden) return;
      started = true;
      try {
        if (mode === 'short') { await settle(); return; }
        const scale = window.innerWidth - 64 >= LOGO.width * SCALE ? SCALE : 2;
        const width = LOGO.width * scale;
        const height = LOGO.height * scale;
        const from = `translate(${Math.round((window.innerWidth - width) / 2)}px, ${Math.round((window.innerHeight - height) / 2)}px) scale(1)`;
        logo.style.width = `${width}px`;
        logo.style.height = `${height}px`;
        logo.style.transform = from;
        logo.dataset.phase = 'typing';
        const completed = await Promise.all([
          type(),
          pop(),
          pressButton(BUTTON.size * scale),
          play(backdrop, [{ opacity: 1 }, { opacity: 1 }], HOLD_UNTIL_MS),
        ]);
        if (cancelled) return;
        if (completed.some(result => !result)) { finish(); return; }

        // Match the header image exactly without moving or resizing the real header.
        const place = headerPlace(width);
        if (place.scale <= 0) { finish(); return; }
        logo.dataset.phase = 'moving';
        await Promise.all([
          play(logo, [{ transform: from }, { transform: `translate(${place.left}px, ${place.top}px) scale(${place.scale})` }], MOVE_MS, 0, 'cubic-bezier(.65, 0, .2, 1)'),
          play(backdrop, [{ opacity: 1 }, { opacity: 0 }], 420, 140, 'ease-out'),
        ]);
        finish();
      } catch {
        // A decorative opening must never prevent access to the app.
        finish();
      }
    };

    target.style.visibility = 'hidden';
    dismissRef.current = finish;
    preference.addEventListener('change', onPreferenceChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', finish, true);
    if (preference.matches) finish();
    else {
      // Shown once is seen, even if a key press cuts the opening short.
      if (mode === 'full') markStartupSeen();
      void start();
    }
    return dispose;
  }, [finished, mode, targetRef]);

  if (finished) return null;
  const { width, height } = LOGO;
  return <div className="startup-logo-overlay" data-mode={mode} aria-hidden="true" onPointerDown={event => {
    event.preventDefault();
    event.stopPropagation();
    dismissRef.current();
  }}>
    <div className="startup-logo-backdrop" ref={backdropRef} />
    <div className="startup-logo-artwork" ref={artworkRef}>
      <svg className="startup-logo-words" ref={wordsRef} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges">
        {LOGO.letters.map((letter, index) => <path key={index} className="startup-logo-letter" data-letter={letter.char} style={{ fill: index < 4 ? COLORS.snag : ACCENT_LOGO }} d={letter.d} />)}
        <rect className="startup-logo-cursor" x={0} y={LOGO.capTop} width={LOGO.cursorWidth} height={LOGO.capHeight} style={{ fill: ACCENT_LOGO }} />
      </svg>
      <span className="startup-logo-button" ref={buttonRef} style={{
        left: `${BUTTON.x / width * 100}%`, top: `${BUTTON.y / height * 100}%`,
        width: `${BUTTON.size / width * 100}%`, height: `${BUTTON.size / height * 100}%`,
      }}>
        <svg className="startup-logo-press" ref={pressRef} viewBox={`0 0 ${BUTTON.size} ${BUTTON.size}`} shapeRendering="crispEdges">
          <path style={{ fill: `var(--accent-bevel-face, ${COLORS.orange})` }} d={BUTTON.tile} />
          <path style={{ fill: ACCENT_LIGHT }} d={BUTTON.hi} data-bevel="hi" />
          <path style={{ fill: ACCENT_DARK }} d={BUTTON.lo} data-bevel="lo" />
          <path style={{ fill: ACCENT_DARK }} d={BUTTON.shadow} />
          <path style={{ fill: COLORS.night }} d={BUTTON.glyph} />
        </svg>
      </span>
    </div>
  </div>;
}
