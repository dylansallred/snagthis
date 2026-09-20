import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import artwork from '@/assets/vidsnag-logo-title.png';
import './StartupLogo.css';

const ART_WIDTH = 830;
const ART_HEIGHT = 164;
const WORDS_WIDTH = 679;
const MARK_WIDTH = ART_WIDTH - WORDS_WIDTH;
const FINISH_MS = 1400; // 150ms pause, 850ms shimmer, 400ms hold.

/** The chosen opening plays once while the rest of the app initializes normally. */
export function StartupLogo({ targetRef }: { targetRef: RefObject<HTMLImageElement | null> }) {
  const [finished, setFinished] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const backdropRef = useRef<HTMLDivElement>(null);
  const artworkRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const shineRef = useRef<HTMLSpanElement>(null);
  const beamRef = useRef<HTMLSpanElement>(null);
  const dismissRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    if (finished) return;
    const target = targetRef.current;
    const backdrop = backdropRef.current;
    const logo = artworkRef.current;
    const words = wordsRef.current;
    const mark = markRef.current;
    const shine = shineRef.current;
    const beam = beamRef.current;
    const source = words?.querySelector('img');
    if (!target || !backdrop || !logo || !words || !mark || !shine || !beam || !source) {
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
    const play = (element: HTMLElement, keyframes: Keyframe[], duration: number, delay = 0, easing = 'linear') => {
      const animation = element.animate(keyframes, { duration, delay, easing, fill: 'both' });
      animations.push(animation);
      // Every cancellation is handled, including StrictMode's initial cleanup.
      return animation.finished.then(() => true, () => false);
    };
    const start = async () => {
      if (cancelled || started || document.hidden) return;
      started = true;
      try {
        await source.decode();
        if (cancelled) return;
        const width = Math.min(280, window.innerWidth - 64);
        const height = width * ART_HEIGHT / ART_WIDTH;
        if (width <= 0) { finish(); return; }
        const from = `translate(${(window.innerWidth - width) / 2}px, ${(window.innerHeight - height) / 2 + 10}px) scale(1)`;
        logo.style.width = `${width}px`;
        logo.style.transform = from;
        const arrowStart = `translateX(${-WORDS_WIDTH / MARK_WIDTH * 100}%)`;
        const sweepEasing = 'cubic-bezier(.4, 0, .2, 1)';
        const completed = await Promise.all([
          play(mark, [
            { opacity: 0, transform: `${arrowStart} rotate(0deg)`, offset: 0 },
            { opacity: 1, transform: `${arrowStart} rotate(0deg)`, offset: .14 },
            { opacity: 1, transform: `${arrowStart} rotate(0deg)`, offset: .18, easing: sweepEasing },
            { opacity: 1, transform: 'translateX(0) rotate(0deg)', offset: .72, easing: 'ease-out' },
            { opacity: 1, transform: 'translateX(0) rotate(6deg)', offset: .83, easing: 'ease-in-out' },
            { opacity: 1, transform: 'translateX(0) rotate(-2deg)', offset: .92, easing: 'ease-out' },
            { opacity: 1, transform: 'translateX(0) rotate(0deg)', offset: 1 },
          ], 1200),
          play(words, [
            { clipPath: 'inset(0 100% 0 0)', offset: 0 },
            { clipPath: 'inset(0 100% 0 0)', offset: .18, easing: sweepEasing },
            { clipPath: 'inset(0 0% 0 0)', offset: .72 },
            { clipPath: 'inset(0 0% 0 0)', offset: 1 },
          ], 1200),
          play(shine, [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: 150 / FINISH_MS },
            { opacity: .42, offset: 270 / FINISH_MS },
            { opacity: .42, offset: 850 / FINISH_MS },
            { opacity: 0, offset: 1000 / FINISH_MS },
            { opacity: 0, offset: 1 },
          ], FINISH_MS, 1200),
          play(beam, [
            { transform: 'translateX(-120%) skewX(-15deg)' },
            { transform: 'translateX(470%) skewX(-15deg)' },
          ], 850, 1350, 'cubic-bezier(.3, 0, .2, 1)'),
        ]);
        if (cancelled) return;
        if (completed.some(result => !result)) { finish(); return; }

        // Match the original image's contained artwork, including its tiny
        // letterbox margin, without moving or resizing the real header.
        const bounds = target.getBoundingClientRect();
        const scale = Math.min(bounds.width / width, bounds.height / height);
        if (scale <= 0) { finish(); return; }
        const left = bounds.left + (bounds.width - width * scale) / 2;
        const top = bounds.top + (bounds.height - height * scale) / 2;
        await Promise.all([
          play(logo, [{ transform: from }, { transform: `translate(${left}px, ${top}px) scale(${scale})` }], 500, 0, 'cubic-bezier(.65, 0, .2, 1)'),
          play(backdrop, [{ opacity: 1 }, { opacity: 0 }], 400, 100, 'ease-out'),
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
    else void start();
    return dispose;
  }, [finished, targetRef]);

  if (finished) return null;
  return <div className="startup-logo-overlay" aria-hidden="true" onPointerDown={event => {
    event.preventDefault();
    event.stopPropagation();
    dismissRef.current();
  }}>
    <div className="startup-logo-backdrop" ref={backdropRef} />
    <div className="startup-logo-artwork" ref={artworkRef}>
      <span className="startup-logo-piece startup-logo-words" ref={wordsRef}>
        <img src={artwork} alt="" width={ART_WIDTH} height={ART_HEIGHT} draggable={false} />
      </span>
      <span className="startup-logo-piece startup-logo-mark" ref={markRef}>
        <img src={artwork} alt="" width={ART_WIDTH} height={ART_HEIGHT} draggable={false} />
      </span>
      <span className="startup-logo-shine" ref={shineRef} style={{ maskImage: `url("${artwork}")`, WebkitMaskImage: `url("${artwork}")` }}>
        <span className="startup-logo-beam" ref={beamRef} />
      </span>
    </div>
  </div>;
}
