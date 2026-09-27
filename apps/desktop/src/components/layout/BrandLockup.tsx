import { forwardRef } from 'react';
import { SNAGTHIS_LOGO as LOGO } from './snagthisLogo';

const snag = LOGO.letters.slice(0, 4).map((letter) => letter.d).join('');
const tail = LOGO.letters.slice(4).map((letter) => letter.d).join('');
const { button: BUTTON, colors: COLORS } = LOGO;

/**
 * The header lockup as inline pixel paths, so "THIS" and the button bevel follow the accent
 * variables (lib/accentTheme.ts). Same artwork as assets/snagthis-logo-title.svg.
 */
export const SnagThisLogo = forwardRef<SVGSVGElement, { className?: string }>(function SnagThisLogo({ className }, ref) {
  return <svg ref={ref} className={className} role="img" aria-label="SnagThis" width={LOGO.width} height={LOGO.height}
    viewBox={`0 0 ${LOGO.width} ${LOGO.height}`} shapeRendering="crispEdges" focusable="false">
    <path style={{ fill: COLORS.snag }} d={snag} />
    <path style={{ fill: `var(--accent-logo, ${COLORS.orange})` }} d={tail} />
    <g transform={`translate(${BUTTON.x} ${BUTTON.y})`}>
      <path style={{ fill: `var(--accent-bevel-face, ${COLORS.orange})` }} d={BUTTON.tile} />
      <path style={{ fill: `var(--accent-bevel-light, ${COLORS.amber})` }} d={BUTTON.hi} />
      <path style={{ fill: `var(--accent-bevel-dark, ${COLORS.deep})` }} d={BUTTON.lo} />
      <path style={{ fill: `var(--accent-bevel-dark, ${COLORS.deep})` }} d={BUTTON.shadow} />
      <path style={{ fill: COLORS.night }} d={BUTTON.glyph} />
    </g>
  </svg>;
});
