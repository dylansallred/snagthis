import { useEffect, useRef, useState } from 'react';
import type { RowModel } from '@m3u8/contracts/src/rows.mjs';
import { resolveThumbnailUrl } from '@/lib/utils';

export type RequestThumbnailPreview = (id: string, kind: 'job' | 'history', thumbnailUrl: string | null) => Promise<string | null>;

function MotionPreview({ url }: { url: string }) {
  // Signed URLs can refresh during playback; take the latest one on the next hover/focus.
  const [playbackUrl] = useState(url);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = player.current;
    if (video && video.getAttribute('src') !== playbackUrl) video.src = playbackUrl;
    return () => { if (video) { video.pause(); video.removeAttribute('src'); video.load(); } };
  }, [playbackUrl]);
  if (failed) return null;
  return <video ref={player} className={`thumb-fill thumb-preview${ready ? ' ready' : ''}`} src={playbackUrl}
    muted autoPlay loop playsInline preload="auto" disablePictureInPicture tabIndex={-1}
    onLoadedData={() => setReady(true)} onError={() => setFailed(true)}
    onCanPlay={(event) => { event.currentTarget.play().catch(() => setFailed(true)); }} />;
}

export function FillThumb({ row, apiBase, previewUrl, previewActive = false }: {
  row: RowModel; apiBase: string; previewUrl?: string | null; previewActive?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [settledUrl, setSettledUrl] = useState<string | null>(null);
  const url = resolveThumbnailUrl(row.thumbnailUrl, apiBase);
  const resolvedPreview = resolveThumbnailUrl(previewUrl, apiBase);
  const showImage = !!url && failedUrl !== url;
  const loaded = showImage && loadedUrl === url;
  return (
    <div className="fill-thumb thumb" aria-hidden="true">
      {/* The dots stay underneath until the poster has decoded, then the two crossfade. */}
      {!(loaded && settledUrl === url) && <div className={`thumb-fill thumb-placeholder${loaded ? ' done' : ''}`}><i className="thumb-loading-dot" /><i className="thumb-loading-dot" /><i className="thumb-loading-dot" /></div>}
      {/* Lazy: a long library only fetches and decodes the posters near the viewport. */}
      {showImage && <img loading="lazy" decoding="async" className={`thumb-fill thumb-poster${loaded ? ' ready' : ''}`} src={url!} alt="" draggable={false} onLoad={() => setLoadedUrl(url)} onTransitionEnd={() => setSettledUrl(url)} onError={() => setFailedUrl(url)} />}
      {previewActive && resolvedPreview && <MotionPreview key={resolvedPreview.split(/[?#]/, 1)[0]} url={resolvedPreview} />}
    </div>
  );
}
