// Short in-memory speed history for the details chart. Nothing here is persisted or exported.
export const SPEED_STEP_MS = 650;
const LENGTH = 62;
// The collapsed-row trace grows across the row's free width, so it keeps a longer, unpadded tail.
const TRAIL = 400;

interface Series { samples: number[]; trail: number[]; latest: number; tickAt: number; recorded: number; }
const series = new Map<string, Series>();
const sampleListeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  const now = performance.now();
  for (const item of series.values()) {
    item.samples.push(item.latest);
    item.samples.shift();
    item.trail.push(item.latest);
    if (item.trail.length > TRAIL) item.trail.shift();
    item.tickAt = now;
    item.recorded++;
  }
  for (const listener of sampleListeners) listener();
}

export function recordSpeeds(jobs: { id: string; speedBps?: number }[]) {
  const seen = new Set<string>();
  for (const job of jobs) {
    if (!Number.isFinite(job.speedBps)) continue;
    seen.add(job.id);
    const speed = Math.max(0, job.speedBps || 0);
    const item = series.get(job.id) || { samples: Array<number>(LENGTH).fill(0), trail: [], latest: 0, tickAt: performance.now(), recorded: 0 };
    item.latest = speed;
    series.set(job.id, item);
  }
  for (const id of series.keys()) if (!seen.has(id)) series.delete(id);
  if (series.size && !timer) timer = setInterval(tick, SPEED_STEP_MS);
  if (!series.size && timer) { clearInterval(timer); timer = null; }
}

export function speedSeries(id: string) { return series.get(id) || null; }

export function subscribeSpeedSamples(listener: () => void) {
  sampleListeners.add(listener);
  return () => { sampleListeners.delete(listener); };
}
