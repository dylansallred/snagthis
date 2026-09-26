import type { SVGProps } from 'react';

// A 3 × 5 pixel face for the few one-word moments ("z", "+1"), so no pixel font has to ship.
const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'], '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'], '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'], '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'], '9': ['###', '#.#', '###', '..#', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'], z: ['###', '..#', '.#.', '#..', '###'],
};

/** Path data and width (in glyph pixels) for short text on the 3 × 5 grid. */
export function pixelTextPath(text: string) {
  const chars = [...text].filter((char) => FONT[char]);
  let d = '';
  chars.forEach((char, index) => FONT[char].forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell === '#') d += `M${index * 4 + x} ${y}h1v1h-1z`;
  })));
  return { d, width: Math.max(1, chars.length * 4 - 1) };
}

/** Draws short text on a whole-pixel grid; `scale` is screen pixels per glyph pixel. */
export function PixelText({ text, scale, ...props }: { text: string; scale: number } & SVGProps<SVGSVGElement>) {
  const { d, width } = pixelTextPath(text);
  return <svg width={width * scale} height={5 * scale} viewBox={`0 0 ${width} 5`} shapeRendering="crispEdges" aria-hidden="true" focusable="false" {...props}>
    <path fill="currentColor" d={d} />
  </svg>;
}
