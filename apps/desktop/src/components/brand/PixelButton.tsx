import type { SVGProps } from 'react';
import { SNAGTHIS_LOGO } from '@/components/layout/snagthisLogo';
import './PixelButton.css';

const { button: BUTTON } = SNAGTHIS_LOGO;

/** Whole-pixel runs as SVG path data, the same encoding scripts/render-brand-assets.cjs uses. */
function runs(cells: ReadonlyArray<readonly [number, number]>) {
  const rows = new Map<number, number[]>();
  for (const [x, y] of cells) rows.set(y, [...(rows.get(y) || []), x]);
  let d = '';
  for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      d += `M${xs[i]} ${y}h${j - i + 1}v1h-${j - i + 1}z`;
      i = j + 1;
    }
  }
  return d;
}

// The logo only ships the play glyph; the dozing mascot shows pause bars on the same tile,
// with the same one-pixel cast shadow the generator gives the play glyph.
const PAUSE_CELLS = Array.from({ length: 8 }, (_, row) => [5, 6, 9, 10].map((x) => [x, row + 4] as const)).flat();
const pauseSet = new Set(PAUSE_CELLS.map(([x, y]) => `${x},${y}`));
const PAUSE = {
  glyph: runs(PAUSE_CELLS),
  shadow: runs(PAUSE_CELLS.map(([x, y]) => [x + 1, y + 1] as const).filter(([x, y]) => !pauseSet.has(`${x},${y}`))),
};

/**
 * The logo's pixel bevel button, drawn from the generated brand geometry.
 * Colours come from --accent-bevel-face / -light / -dark so an accent theme recolours it.
 */
export function PixelButton({ size, glyph = 'play', className = '', ...props }: { size: number; glyph?: 'play' | 'pause' } & SVGProps<SVGSVGElement>) {
  const art = glyph === 'pause' ? PAUSE : { glyph: BUTTON.glyph, shadow: BUTTON.shadow };
  return <svg className={`pixel-button ${className}`} width={size} height={size} viewBox={`0 0 ${BUTTON.size} ${BUTTON.size}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false" {...props}>
    <path className="pixel-button-face" d={BUTTON.tile} />
    <path className="pixel-button-light" d={BUTTON.hi} />
    <path className="pixel-button-dark" d={BUTTON.lo} />
    <path className="pixel-button-shade" d={art.shadow} />
    <path className="pixel-button-glyph" d={art.glyph} />
  </svg>;
}

/** Replays the launch press on a pixel button. Decorative, so reduced motion skips it. */
export function pressPixelButton(svg: Element | null | undefined) {
  if (!svg || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  svg.classList.remove('pressing');
  void svg.getBoundingClientRect();
  svg.classList.add('pressing');
  const done = (event: Event) => {
    if (event.target !== svg) return;
    svg.classList.remove('pressing');
    svg.removeEventListener('animationend', done);
  };
  svg.addEventListener('animationend', done);
}
