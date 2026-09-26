/* Collapsed-row speed trace, ported from the desktop (components/list/SpeedTrace.tsx, lib/speedHistory.ts).
 * It fills the free width after a downloading row's title, grows one step per sample, and once its head
 * reaches the actions the head stays put and older samples scroll off. Paused rows hold a grey copy,
 * finishing rows turn amber and a just-saved row turns mint and fades. Only desktop jobs report speed.
 * Reduced motion draws once per sample instead of every frame. */
window.SnagThisSpeedTrace = (() => {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const STEP_MS = 650; const TRAIL = 400;
  const STEP = 6; const GAP = 14; const END = 3; const MIN_WIDTH = 48; const SLACK = 8; const REGROW = 32; const READY_SAMPLES = 2;
  const FLOOR_BPS = 50_000; const STALLED_BPS = 30_000;
  const series = new Map(); const listeners = new Set();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = 0; let traceIds = 0;

  function tick() {
    const now = performance.now();
    for (const item of series.values()) { item.trail.push(item.latest); if (item.trail.length > TRAIL) item.trail.shift(); item.tickAt = now; }
    for (const listener of listeners) listener();
  }

  /** The latest speeds of downloading desktop jobs; any other job's history is dropped. */
  function record(jobs) {
    const seen = new Set();
    for (const job of jobs) {
      if (!Number.isFinite(job.speedBps)) continue;
      const id = String(job.id); seen.add(id);
      const item = series.get(id) || { trail: [], latest: 0, tickAt: performance.now() };
      item.latest = Math.max(0, job.speedBps); series.set(id, item);
    }
    for (const id of series.keys()) if (!seen.has(id)) series.delete(id);
    if (series.size && !timer) timer = setInterval(tick, STEP_MS);
    if (!series.size && timer) { clearInterval(timer); timer = 0; }
  }

  function create() {
    const element = document.createElement('div'); element.className = 'speed-trace'; element.setAttribute('aria-hidden', 'true');
    const plot = document.createElementNS(SVG, 'svg'); plot.setAttribute('class', 'speed-trace-plot'); plot.setAttribute('aria-hidden', 'true'); plot.setAttribute('focusable', 'false');
    const fadeId = `speed-trace-fade-${++traceIds}`;
    plot.innerHTML = `<defs><linearGradient id="${fadeId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="speed-trace-stop-top"/><stop offset="1" class="speed-trace-stop-bottom"/></linearGradient></defs><path class="speed-trace-area" fill="url(#${fadeId})"/><path class="speed-trace-line"/>`;
    const [area, line] = plot.querySelectorAll('path');
    const dot = document.createElement('i'); dot.className = 'speed-trace-dot';
    element.append(plot, dot);
    let jobId = ''; let live = false; let frozen = null; let scale = 0; let span = 0; let height = 0; let frame = 0; let pending = 0;

    const draw = now => {
      if (!height) return;
      const data = series.get(jobId);
      const fresh = live && Boolean(data) && data.trail.length >= READY_SAMPLES;
      if (fresh || (!frozen && data && data.trail.length >= READY_SAMPLES)) frozen = data.trail;
      const samples = frozen; const width = span;
      element.classList.toggle('ready', Boolean(samples) && width >= MIN_WIDTH);
      if (!samples || width < MIN_WIDTH) return;
      // The head moves smoothly toward the newest sample; frozen and reduced-motion traces rest on it.
      const fraction = fresh && !reduced.matches ? Math.min(1, (now - data.tickAt) / STEP_MS) : 1;
      const count = samples.length; const head = count - 2 + fraction;
      const offset = Math.max(0, head - width / STEP); const first = Math.max(0, Math.floor(offset) - 1);
      let peak = FLOOR_BPS; for (let index = first; index < count; index++) peak = Math.max(peak, samples[index]);
      const target = peak * 1.18;
      scale = scale && fresh && !reduced.matches ? scale + (target - scale) * .06 : target;
      const y = speed => height - 3 - speed / scale * (height - 8);
      let d = '';
      for (let index = first; index <= count - 2; index++) d += `${d ? ' L' : 'M'}${((index - offset) * STEP).toFixed(2)},${y(samples[index]).toFixed(2)}`;
      const headX = (head - offset) * STEP; const headY = y(samples[count - 2] + (samples[count - 1] - samples[count - 2]) * fraction);
      d += ` L${headX.toFixed(2)},${headY.toFixed(2)}`;
      line.setAttribute('d', d);
      area.setAttribute('d', `${d} L${headX.toFixed(2)},${height} L${((first - offset) * STEP).toFixed(2)},${height} Z`);
      dot.style.transform = `translate(${(headX - width - END + 2).toFixed(2)}px, ${(headY - 2).toFixed(2)}px)`;
      element.classList.toggle('stalled', fresh && data.latest < STALLED_BPS);
    };
    const active = () => element.isConnected && !document.hidden;
    const animate = now => { draw(now); frame = requestAnimationFrame(animate); };
    const update = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (!active()) return;
      draw(performance.now());
      if (live && !reduced.matches) frame = requestAnimationFrame(animate);
    };
    // A row is sized once it is in the list; a live trace starts its frame loop then.
    const redraw = () => {
      if (frame || pending || !active()) return;
      if (live && !reduced.matches) { update(); return; }
      pending = requestAnimationFrame(now => { pending = 0; draw(now); });
    };
    const sizes = new ResizeObserver(entries => {
      const { width: cellWidth, height: cellHeight } = entries[entries.length - 1].contentRect;
      const room = Math.floor(cellWidth - GAP - END);
      // Shrink at once (never overlap text) with a little slack; grow back only after a real change.
      if (!span || room < span) span = Math.max(0, span ? room - SLACK : room);
      else if (room > span + REGROW) span = room;
      height = cellHeight;
      const plotWidth = Math.max(0, span + END);
      plot.setAttribute('width', String(plotWidth)); plot.setAttribute('height', String(height)); plot.setAttribute('viewBox', `0 0 ${plotWidth} ${height}`);
      redraw();
    });
    sizes.observe(element);
    const onSample = () => { if (live && reduced.matches && active()) draw(performance.now()); };
    listeners.add(onSample);
    reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);

    return {
      element,
      /** `state`: downloading · paused · finishing · saved. */
      set(nextJobId, state) {
        if (nextJobId !== jobId) { jobId = nextJobId; frozen = null; scale = 0; }
        const nextLive = state === 'downloading';
        // A trace that stopped being live keeps a private copy of its history.
        if (!nextLive && frozen) frozen = frozen.slice();
        live = nextLive; element.dataset.traceState = state;
        update();
      },
      destroy() {
        cancelAnimationFrame(frame); cancelAnimationFrame(pending); sizes.disconnect(); listeners.delete(onSample);
        reduced.removeEventListener('change', update); document.removeEventListener('visibilitychange', update);
        element.remove();
      },
    };
  }

  return { record, create };
})();
