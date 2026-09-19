import { useState, type CSSProperties } from 'react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { resolveThumbnailUrl } from '@/lib/utils';

export function FillThumb({ row, apiBase }: { row: RowModel; apiBase: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = resolveThumbnailUrl(row.thumbnailUrl, apiBase);
  const showImage = !!url && failedUrl !== url;
  return (
    <div className={`fill-thumb thumb${row.fill.dimmed ? ' is-dimmed' : ''}`} data-progress={row.fill.percent} style={{ '--p': `${row.fill.percent}%` } as CSSProperties} aria-hidden="true">
      {showImage ? <>
        <img className="thumb-fill thumb-ghost" src={url!} alt="" draggable={false} onError={() => setFailedUrl(url)} />
        <img className="thumb-fill thumb-live" src={url!} alt="" draggable={false} onError={() => setFailedUrl(url)} />
      </> : <><div className="thumb-fill thumb-placeholder thumb-ghost" /><div className="thumb-fill thumb-placeholder thumb-live" /></>}
      {row.fill.scanLine && <div className="thumb-edge" />}
      {row.durationLabel && <span className="thumb-duration">{row.durationLabel}</span>}
    </div>
  );
}
