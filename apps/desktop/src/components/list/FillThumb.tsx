import { useState } from 'react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { resolveThumbnailUrl } from '@/lib/utils';

export type RequestThumbnailPreview = (id: string, kind: 'job' | 'history', thumbnailUrl: string | null) => Promise<string | null>;

function MotionPreview({ url }: { url: string }) {
  // Signed URLs can refresh during playback; take the latest one on the next hover/focus.
  const [playbackUrl] = useState(url);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <video className={`thumb-fill thumb-preview${ready ? ' ready' : ''}`} src={playbackUrl}
    muted autoPlay loop playsInline preload="auto" disablePictureInPicture tabIndex={-1}
    onLoadedData={() => setReady(true)} onError={() => setFailed(true)}
    onCanPlay={(event) => { event.currentTarget.play().catch(() => setFailed(true)); }} />;
}

export function FillThumb({ row, apiBase, previewUrl, previewActive = false }: {
  row: RowModel; apiBase: string; previewUrl?: string | null; previewActive?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = resolveThumbnailUrl(row.thumbnailUrl, apiBase);
  const resolvedPreview = resolveThumbnailUrl(previewUrl, apiBase);
  const showImage = !!url && failedUrl !== url;
  return (
    <div className="fill-thumb thumb" aria-hidden="true">
      {showImage ? <img className="thumb-fill thumb-poster" src={url!} alt="" draggable={false} onError={() => setFailedUrl(url)} /> : <div className="thumb-fill thumb-placeholder" />}
      {previewActive && resolvedPreview && <MotionPreview key={resolvedPreview.split(/[?#]/, 1)[0]} url={resolvedPreview} />}
    </div>
  );
}
