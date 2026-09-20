import { useRef, useEffect, useCallback, useState, memo } from 'react';
import type { SegmentState } from '@/types/queue';

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--color-segment-pending)',
  downloading: 'var(--color-segment-downloading)',
  completed: 'var(--color-segment-completed)',
  retrying: 'var(--color-segment-retrying)',
  failed: 'var(--color-segment-failed)',
};

function resolveCssColor(cssValue: string): string {
  if (!resolveCssColor.cache) resolveCssColor.cache = new Map<string, string>();
  const cached = resolveCssColor.cache.get(cssValue);
  if (cached) return cached;

  const el = document.createElement('div');
  el.style.color = cssValue;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  document.body.removeChild(el);
  resolveCssColor.cache.set(cssValue, resolved);
  return resolved;
}
resolveCssColor.cache = null as Map<string, string> | null;

interface SegmentHeatmapProps {
  totalSegments: number;
  segmentStates: Record<string, SegmentState> | undefined;
}

export const SegmentHeatmap = memo(function SegmentHeatmap({ totalSegments, segmentStates }: SegmentHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const layoutRef = useRef<{ cellW: number; cellH: number; cols: number; gap: number; piecesPerCell: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || totalSegments <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) return;

    // Use the available width and at most 20 short rows. Very large playlists
    // combine adjacent pieces proportionally, so no piece is clipped or omitted.
    const gap = 2;
    const cellSize = 4;
    const step = cellSize + gap;
    const cols = Math.max(1, Math.floor((containerWidth + gap) / step));
    const piecesPerCell = Math.max(1, Math.ceil(totalSegments / (cols * 20)));
    const cells = Math.ceil(totalSegments / piecesPerCell);
    const rows = Math.ceil(cells / cols);
    const canvasHeight = rows * step - gap;

    layoutRef.current = { cellW: cellSize, cellH: cellSize, cols, gap, piecesPerCell };

    canvas.width = containerWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    canvas.dataset.piecesPerCell = String(piecesPerCell);
    canvas.setAttribute('aria-label', `${totalSegments} download segments${piecesPerCell > 1 ? `, grouped in sets of up to ${piecesPerCell}` : ''}; status is summarized above`);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, canvasHeight);

    // Resolve CSS variable colors once
    const resolvedColors: Record<string, string> = {};
    for (const [status, cssVar] of Object.entries(STATUS_COLORS)) {
      resolvedColors[status] = resolveCssColor(cssVar);
    }
    const retryInterior = resolveCssColor('var(--color-surface-row)');

    for (let cell = 0; cell < cells; cell++) {
      const first = cell * piecesPerCell;
      const last = Math.min(totalSegments, first + piecesPerCell);
      const counts = new Map<string, number>();
      for (let index = first; index < last; index++) {
        const status = segmentStates?.[String(index)]?.status || 'pending';
        counts.set(status, (counts.get(status) || 0) + 1);
      }
      const x = (cell % cols) * step;
      const y = Math.floor(cell / cols) * step;
      let offset = 0;
      for (const [status, count] of counts) {
        const width = cellSize * count / (last - first);
        ctx.globalAlpha = status === 'pending' ? 0.25 : status === 'retrying' ? 0.75 : 1;
        ctx.fillStyle = resolvedColors[status] || resolvedColors.pending;
        if (status === 'retrying' && width > 2) {
          // Paint the 1px border and centre without overlap, so the entire
          // retry cell has the same opacity rather than a twice-painted centre.
          ctx.fillRect(x + offset, y, width, 1);
          ctx.fillRect(x + offset, y + cellSize - 1, width, 1);
          ctx.fillRect(x + offset, y + 1, 1, cellSize - 2);
          ctx.fillRect(x + offset + width - 1, y + 1, 1, cellSize - 2);
          ctx.fillStyle = retryInterior;
          ctx.fillRect(x + offset + 1, y + 1, width - 2, cellSize - 2);
        } else {
          // Narrow grouped slices retain their colour so retries stay visible.
          ctx.fillRect(x + offset, y, width, cellSize);
        }
        offset += width;
      }
    }
    ctx.globalAlpha = 1;
  }, [totalSegments, segmentStates]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const step = layout.cellW + layout.gap;
    const col = Math.floor(x / step);
    const row = Math.floor(y / step);
    const idx = (row * layout.cols + col) * layout.piecesPerCell;

    if (col >= layout.cols || idx < 0 || idx >= totalSegments || x % step > layout.cellW || y % step > layout.cellH) {
      setTooltip(null);
      return;
    }

    const state = segmentStates?.[String(idx)];
    const status = state?.status || 'pending';
    const attempt = state?.attempt || 0;
    let text = `Segment ${idx + 1}: ${status}${attempt > 1 ? ` (attempt ${attempt})` : ''}`;
    if (layout.piecesPerCell > 1) {
      const last = Math.min(totalSegments, idx + layout.piecesPerCell);
      const counts = new Map<string, number>();
      for (let index = idx; index < last; index++) {
        const itemStatus = segmentStates?.[String(index)]?.status || 'pending';
        counts.set(itemStatus, (counts.get(itemStatus) || 0) + 1);
      }
      text = `Segments ${idx + 1}–${last}: ${[...counts].map(([itemStatus, count]) => `${count} ${itemStatus}`).join(', ')}`;
    }

    const containerRect = containerRef.current?.getBoundingClientRect();
    const tooltipX = containerRect ? e.clientX - containerRect.left : x;
    setTooltip({ x: tooltipX, y: -24, text });
  }, [totalSegments, segmentStates]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (totalSegments <= 0) return null;

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${totalSegments} download segments; status is summarized above`}
        className="w-full cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow-md whitespace-nowrap z-10"
          style={{ left: Math.max(0, Math.min(tooltip.x, (containerRef.current?.clientWidth || 200) - 260)), top: tooltip.y, maxWidth: '100%' }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
});
