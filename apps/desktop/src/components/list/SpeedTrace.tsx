import { useEffect, useId, useRef } from 'react';
import { SPEED_STEP_MS, speedSeries, subscribeSpeedSamples } from '@/lib/speedHistory';
import { formatBytesPerSecond } from '@/lib/utils';
import { ui } from '@/lib/strings';

// Collapsed-row miniature of the Details "Ceiling + halo" speed chart. It fills the free width of the
// row's text column: it starts just after the title or status (whichever is longer), grows one fixed
// step per sample, and once its head reaches the actions the head stays put and older samples scroll off.
// It reads the same in-memory samples as SpeedChart (lib/speedHistory) and keeps a frozen reference so
// paused and finishing rows hold their last shape.
const STEP = 6; // px per sample
const GAP = 16; // from the end of the longer text line
const END = 3; // room for the head dot; the row's 12px column gap separates it from the actions
const MIN_WIDTH = 48; // narrower than this reads as noise, so the trace hides
const SLACK = 8; // extra room taken when the text pushes the trace, so a ticking status line does not shift it
const REGROW = 32; // the trace only reclaims width after the text shrinks by more than this
const READY_SAMPLES = 2; // the line starts where the download's history starts, so no padding is needed
const FLOOR_BPS = 50_000;
const STALLED_BPS = 30_000;

export type SpeedTraceState = 'downloading' | 'paused' | 'finishing' | 'saved';

// One shared observer for every visible trace; resize callbacks arrive batched after layout.
const sizeListeners = new WeakMap<Element, (width: number, height: number) => void>();
let sizes: ResizeObserver | null = null;
function observeSize(element: Element, listener: (width: number, height: number) => void) {
  if (typeof ResizeObserver !== 'function') return () => {};
  sizes ||= new ResizeObserver((entries) => {
    for (const entry of entries) sizeListeners.get(entry.target)?.(entry.contentRect.width, entry.contentRect.height);
  });
  sizeListeners.set(element, listener);
  sizes.observe(element);
  return () => { sizes?.unobserve(element); sizeListeners.delete(element); };
}

export function SpeedTrace({ jobId, state, speedBps, hidden }: {
  jobId: string; state: SpeedTraceState; speedBps?: number; hidden: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const plot = useRef<SVGSVGElement>(null);
  const line = useRef<SVGPathElement>(null);
  const area = useRef<SVGPathElement>(null);
  const dot = useRef<HTMLElement>(null);
  const frozen = useRef<number[] | null>(null);
  const scale = useRef(0);
  const span = useRef(0); // drawable width, measured from the actions edge leftward
  const fadeId = `speed-trace-fade-${useId().replace(/:/g, '')}`;
  const live = state === 'downloading';

  useEffect(() => {
    if (hidden) return;
    const element = root.current;
    if (!element) return;
    // A trace that stopped being live keeps a private copy of its history.
    if (!live && frozen.current) frozen.current = frozen.current.slice();
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let pending = 0;
    let onScreen = true;
    let height = 0;
    const draw = (now: number) => {
      if (!line.current || !area.current || !plot.current || !height) return;
      const data = speedSeries(jobId);
      const fresh = live && !!data && data.trail.length >= READY_SAMPLES;
      if (fresh || (!frozen.current && data && data.trail.length >= READY_SAMPLES)) frozen.current = data!.trail;
      const samples = frozen.current;
      const width = span.current;
      const fits = width >= MIN_WIDTH;
      element.classList.toggle('ready', !!samples && fits);
      if (!samples || !fits) return;
      const reduced = preference.matches;
      // The head moves smoothly toward the newest sample; frozen and reduced-motion traces rest on it.
      const fraction = fresh && !reduced ? Math.min(1, (now - data!.tickAt) / SPEED_STEP_MS) : 1;
      const count = samples.length;
      const head = count - 2 + fraction;
      const offset = Math.max(0, head - width / STEP); // non-zero only once the trace is full
      const first = Math.max(0, Math.floor(offset) - 1);
      let peak = FLOOR_BPS;
      for (let index = first; index < count; index++) peak = Math.max(peak, samples[index]);
      const target = peak * 1.18;
      scale.current = scale.current && fresh && !reduced ? scale.current + (target - scale.current) * .06 : target;
      const y = (speed: number) => height - 3 - speed / scale.current * (height - 8);
      let path = '';
      for (let index = first; index <= count - 2; index++) path += `${path ? ' L' : 'M'}${((index - offset) * STEP).toFixed(2)},${y(samples[index]).toFixed(2)}`;
      const headX = (head - offset) * STEP;
      const headY = y(samples[count - 2] + (samples[count - 1] - samples[count - 2]) * fraction);
      path += ` L${headX.toFixed(2)},${headY.toFixed(2)}`;
      line.current.setAttribute('d', path);
      area.current.setAttribute('d', `${path} L${headX.toFixed(2)},${height} L${((first - offset) * STEP).toFixed(2)},${height} Z`);
      // The dot is anchored to the right edge, like the plot, so text-side width changes never move it.
      if (dot.current) dot.current.style.transform = `translate(${(headX - width - END + 2).toFixed(2)}px, ${(headY - 2).toFixed(2)}px)`;
      element.classList.toggle('stalled', fresh && data!.latest < STALLED_BPS);
    };
    const active = () => onScreen && document.visibilityState !== 'hidden';
    const animate = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(animate);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!active()) return;
      draw(performance.now());
      if (live && !preference.matches) frame = requestAnimationFrame(animate);
    };
    // Resizes (window, title or status changes) are coalesced into one draw on the next frame.
    const redraw = () => {
      if (frame || pending || !active()) return;
      pending = requestAnimationFrame((now) => { pending = 0; draw(now); });
    };
    const stopSize = observeSize(element, (cellWidth, cellHeight) => {
      const room = Math.floor(cellWidth - GAP - END);
      // Shrink at once (never overlap text) with a little slack; grow back only after a real change.
      if (!span.current || room < span.current) span.current = Math.max(0, span.current ? room - SLACK : room);
      else if (room > span.current + REGROW) span.current = room;
      height = cellHeight;
      const plotWidth = Math.max(0, span.current + END);
      plot.current?.setAttribute('width', String(plotWidth));
      plot.current?.setAttribute('height', String(height));
      plot.current?.setAttribute('viewBox', `0 0 ${plotWidth} ${height}`);
      redraw();
    });
    // Reduced motion and off-screen rows do no per-frame work; a still trace moves only per sample.
    const stopSamples = live ? subscribeSpeedSamples(() => {
      if (preference.matches && active()) draw(performance.now());
    }) : () => {};
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      const next = entries[entries.length - 1].isIntersecting;
      if (next !== onScreen) { onScreen = next; update(); }
    }) : null;
    observer?.observe(element);
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pending);
      stopSize();
      stopSamples();
      observer?.disconnect();
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [jobId, live, hidden]);

  const label = state === 'downloading' && Number.isFinite(speedBps) ? ui.speedTrace.replace('{speed}', formatBytesPerSecond(speedBps)) : undefined;
  return <div ref={root} className="speed-trace" data-trace-state={state} hidden={hidden || undefined}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <svg ref={plot} className="speed-trace-plot" width="0" height="0" aria-hidden="true" focusable="false">
      <defs><linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="speed-trace-stop-top" /><stop offset="1" className="speed-trace-stop-bottom" /></linearGradient></defs>
      <path ref={area} className="speed-trace-area" fill={`url(#${fadeId})`} />
      <path ref={line} className="speed-trace-line" />
    </svg>
    <i ref={dot} className="speed-trace-dot" aria-hidden="true" />
  </div>;
}
