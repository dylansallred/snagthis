import { useEffect, useRef } from 'react';
import { SPEED_STEP_MS, speedSeries, subscribeSpeedSamples } from '@/lib/speedHistory';

// Decorative live speed backdrop. The speed and peak are stated as text beside it.
export function SpeedChart({ jobId }: { jobId: string }) {
  const line = useRef<SVGPathElement>(null);
  const area = useRef<SVGPathElement>(null);
  const dot = useRef<HTMLElement>(null);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let scale = 0;
    const draw = (now: number) => {
      const data = speedSeries(jobId);
      if (!data || !line.current || !area.current) return;
      const { samples, tickAt } = data;
      const count = samples.length;
      const step = 600 / (count - 3);
      const fraction = preference.matches ? 0 : Math.min(1, (now - tickAt) / SPEED_STEP_MS);
      const target = Math.max(...samples, 1) * 1.12;
      scale = scale ? scale + (target - scale) * (preference.matches ? 1 : .08) : target;
      const points = samples.map((speed, index) => [600 + (index - (count - 2) + .5 - fraction) * step, 100 - speed / scale * 92]);
      const path = `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`;
      line.current.setAttribute('d', path);
      area.current.setAttribute('d', `${path} L${points[count - 1][0].toFixed(1)},100 L${points[0][0].toFixed(1)},100 Z`);
      const along = fraction + .5;
      const edge = along <= 1
        ? points[count - 3][1] + (points[count - 2][1] - points[count - 3][1]) * along
        : points[count - 2][1] + (points[count - 1][1] - points[count - 2][1]) * (along - 1);
      if (dot.current) dot.current.style.top = `${edge}%`;
    };
    const animate = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(animate);
    };
    const updateMotion = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (document.visibilityState === 'hidden') return;
      draw(performance.now());
      if (!preference.matches) frame = requestAnimationFrame(animate);
    };
    // Reduced motion changes only when a real sample arrives, not every frame.
    const stopSamples = subscribeSpeedSamples(() => {
      if (preference.matches && document.visibilityState !== 'hidden') draw(performance.now());
    });
    preference.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateMotion);
    updateMotion();
    return () => {
      cancelAnimationFrame(frame);
      stopSamples();
      preference.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateMotion);
    };
  }, [jobId]);
  return <div className="speed-chart" aria-hidden="true">
    <svg viewBox="0 0 600 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="speed-chart-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id="speed-chart-mask"><rect width="600" height="100" fill="url(#speed-chart-fade)" /></mask>
      </defs>
      <path ref={area} fill="#fa5d0e" mask="url(#speed-chart-mask)" />
      <path ref={line} fill="none" stroke="var(--speed-chart-line)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
    <i ref={dot} className="speed-chart-dot" />
  </div>;
}
