import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Folder, FolderInput, FolderOpen, Link2, ListX, Pencil, Play, Trash2 } from 'lucide-react';
import { formatDuration, formatWhen, type RowModel } from '@m3u8/contracts/src/rows.mjs';
import { channelsLabel, languageName, selectionAudioLabel } from '@m3u8/contracts/src/audioTracks.mjs';
import { codecLabel, containerLabel, durationOf, formatBitrate, formatFrameRate, libraryStrings as copy, libraryText, siteOf } from '@m3u8/contracts/src/library.mjs';
import { PixelFolder } from '@/components/library/FolderRow';
import { revealLabel } from '@/lib/libraryBackend';
import type { MediaInfo, SourceInfo } from '@/types/history';
import { FillThumb } from './FillThumb';
import './SavedDetails.css';
import { QualityLabel } from './QualityLabel';
import type { RowCommand } from './RowDetails';

/** Loads what is inside a saved file; null when it can't be read (the rows that need it stay hidden). */
export type LoadMediaInfo = (row: RowModel) => Promise<MediaInfo | null>;

/** What the saved-video details need from Saved: its root's name, how to open a folder there, and the file probe. */
export interface SavedDetailsContext {
  rootName: string;
  openFolder: (path: string) => void;
  loadMediaInfo: LoadMediaInfo;
}

type Fact = { key: string; label: string; value: ReactNode; wide?: boolean; title?: string; pending?: boolean };
const upperFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function timeOf(value: number) {
  try { return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

/** One audio or subtitle track: name, then muted details, then a pixel tag. */
function Track({ name, details, tag }: { name: string; details: string; tag?: string }) {
  return <span className="spec-track"><b>{name}</b>{details && <span className="sub">{details}</span>}{tag && <span className="spec-tag">{tag}</span>}</span>;
}

/** The folder a saved video is in, as the path bar's minimal segments: plain names, pixel "/", the current one in the accent. */
function FolderTrail({ folder, rootName, onOpen }: { folder: string; rootName: string; onOpen: (path: string) => void }) {
  const parts = folder ? folder.split('/') : [];
  const places = [{ path: '', name: rootName }, ...parts.map((name, index) => ({ path: parts.slice(0, index + 1).join('/'), name }))];
  return <span className="spec-crumbs">
    {places.map((place, index) => <Fragment key={place.path || '/'}>
      {index > 0 && <svg className="crumb-sep" viewBox="0 0 5 12" aria-hidden="true">{[[4, 0, 1, 2], [3, 2, 1, 3], [2, 5, 1, 2], [1, 7, 1, 3], [0, 10, 1, 2]].map(([x, y, width, height]) => <rect key={y} x={x} y={y} width={width} height={height} />)}</svg>}
      <button type="button" className={`spec-crumb${index === places.length - 1 ? ' current' : ''}`} aria-label={libraryText('detailFolderOpen', { name: place.name })} title={libraryText('detailFolderOpen', { name: place.name })} onClick={() => onOpen(place.path)}>
        {index === 0 && <PixelFolder empty={false} small />}<span>{place.name}</span>
      </button>
    </Fragment>)}
  </span>;
}

/**
 * The details of a saved video (owner choice A · Spec sheet): a poster that loops on hover with
 * Play under it, the full title, a two-column grid of pixel-labelled facts (unknown facts are left
 * out) and one quiet action bar. Facts from inside the file come from a one-time probe.
 */
export function SavedDetails({ row, apiBase, context, previewUrl, onPosterActive, onCommand }: {
  row: RowModel; apiBase: string; context: SavedDetailsContext; previewUrl: string | null;
  /** The poster wants its loop (pointer over it, or keyboard focus on Play). */
  onPosterActive: (active: boolean) => void;
  onCommand: (command: RowCommand) => void;
}) {
  const source = row.source;
  const missing = row.state === 'missing';
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [loading, setLoading] = useState(!missing);
  // No shimmer for quick answers: the placeholder waits 150ms.
  const [showLoading, setShowLoading] = useState(false);
  const [copied, setCopied] = useState(0);
  const [posterHot, setPosterHot] = useState(false);
  const [playFocused, setPlayFocused] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  const load = context.loadMediaInfo;
  useEffect(() => {
    if (missing) { setLoading(false); return; }
    let stopped = false;
    setLoading(true);
    const timer = window.setTimeout(() => { if (!stopped) setShowLoading(true); }, 150);
    load(row).then((result) => { if (!stopped) setInfo(result); }, () => { /* Unreadable files just show fewer facts. */ })
      .finally(() => { if (!stopped) { window.clearTimeout(timer); setLoading(false); setShowLoading(false); } });
    return () => { stopped = true; window.clearTimeout(timer); };
    // The file is what matters: a new path, size or time means a new probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, load, source.id, source.absolutePath, source.sizeBytes, source.modifiedAt]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  useEffect(() => { onPosterActive(posterHot || playFocused); }, [posterHot, playFocused, onPosterActive]);
  useEffect(() => () => onPosterActive(false), [onPosterActive]);

  const pageUrl = typeof source.sourcePageUrl === 'string' && /^https?:\/\//i.test(source.sourcePageUrl) ? source.sourcePageUrl : '';
  const sourceInfo = (source.sourceInfo || {}) as SourceInfo;
  const video = info?.video || null;
  const height = Number(video?.height) || Number(source.height || source.selection?.height) || 0;
  const duration = Number(info?.durationSeconds) || durationOf(source) || 0;
  const fileName = String(source.fileName || '');
  const ext = String(source.ext || (fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : ''));
  const audio = info?.audio || [];
  const subtitles = info?.subtitles || [];
  const sides = info?.sideSubtitles || [];
  const trackName = (language: string | null | undefined, title: string | null | undefined, index: number) => languageName(language) || title || libraryText('detailTrack', { n: index + 1 });
  const savedAt = Number(source.completedAt || source.modifiedAt) || 0;
  const site = sourceInfo.siteName || siteOf(source);
  const uploader = sourceInfo.uploader || source.youtubeMetadata?.channelName || '';
  const chosenAudio = selectionAudioLabel(source.selection);
  const facts: (Fact | null)[] = [
    height ? { key: 'quality', label: copy.detailQuality, value: <><QualityLabel label={`${height}p`} />{video?.hdr && <span className="sub"> · {video.hdr}</span>}</> } : null,
    duration ? { key: 'length', label: copy.detailLength, value: formatDuration(duration) } : null,
    row.sizeLabel ? { key: 'size', label: copy.detailSize, value: missing ? <>{row.sizeLabel} <span className="sub">{copy.detailLastSeen}</span></> : row.sizeLabel } : null,
    ext ? { key: 'format', label: copy.detailFormat, value: <>{containerLabel(ext)}{video?.codec && <span className="sub"> · {[codecLabel(video.codec), video.profile].filter(Boolean).join(' ')}</span>}</> } : null,
    video?.width && video.height ? { key: 'video', label: copy.detailVideo, value: <>{libraryText('detailDimensions', { width: video.width, height: video.height })}{formatBitrate(video.bitRate || info?.bitRate) && <span className="sub"> · {formatBitrate(video.bitRate || info?.bitRate)}</span>}</> } : null,
    formatFrameRate(video?.fps) ? { key: 'fps', label: copy.detailFrameRate, value: formatFrameRate(video?.fps) } : null,
    audio.length ? {
      key: 'audio', label: audio.length > 1 ? libraryText('detailAudioCount', { n: audio.length }) : copy.detailAudio,
      value: <span className="spec-tracks">{audio.map((track, index) => <Track key={index} name={trackName(track.language, track.title, index)}
        details={[channelsLabel(track.channels ?? track.layout), [codecLabel(track.codec), formatBitrate(track.bitRate)].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
        tag={track.default ? copy.detailDefault : undefined} />)}</span>,
    } : chosenAudio && !loading ? { key: 'audio', label: copy.detailAudio, value: <span className="spec-tracks"><Track name={chosenAudio} details="" /></span> } : null,
    subtitles.length || sides.length ? {
      key: 'subtitles', label: copy.detailSubtitles,
      value: <span className="spec-tracks">
        {subtitles.map((track, index) => <Track key={`in-${index}`} name={trackName(track.language, track.title, index)} details={copy.detailInFile} tag={track.default ? copy.detailDefault : undefined} />)}
        {sides.map((side, index) => <Track key={side.fileName} name={languageName(side.language) || libraryText('detailTrack', { n: subtitles.length + index + 1 })} details={libraryText('detailSideFile', { ext: side.format })} />)}
      </span>,
    } : null,
    site ? { key: 'source', label: copy.detailSource, title: sourceInfo.pageTitle || pageUrl, value: <span className="spec-source"><span className="spec-sitemark" aria-hidden="true">{site.charAt(0)}</span>{site}{uploader && <span className="sub"> · {uploader}</span>}</span> } : null,
    savedAt ? { key: 'saved', label: copy.detailSaved, value: <>{upperFirst(formatWhen(savedAt))}<span className="sub"> · {timeOf(savedAt)}</span></> } : null,
    { key: 'folder', label: missing ? copy.detailLastFolder : copy.detailFolder, value: <FolderTrail folder={String(source.folder || '')} rootName={context.rootName} onOpen={context.openFolder} /> },
    fileName ? { key: 'file', label: copy.detailFile, value: <span className="spec-mono">{fileName}</span>, wide: true } : null,
  ];
  const shown = facts.filter((fact): fact is Fact => !!fact);
  // While the file is read, its facts hold their places quietly, after the ones already known about the file.
  if (loading && showLoading) {
    const after = Math.max(shown.findIndex((fact) => fact.key === 'format'), shown.findIndex((fact) => fact.key === 'size')) + 1;
    const pending = [['video', copy.detailVideo], ['audio', copy.detailAudio]].filter(([key]) => !shown.some((fact) => fact.key === key))
      .map(([key, label]) => ({ key, label, value: <i />, pending: true }));
    shown.splice(after, 0, ...pending);
  }
  const directory = String(source.absolutePath || '').replace(/[\\/][^\\/]*$/, '').replace(/^(?:\/Users|\/home)\/[^/]+(?=\/|$)/, '~');
  const copyPage = () => {
    onCommand('copy-page');
    window.clearTimeout(copyTimer.current);
    setCopied((count) => count + 1);
    copyTimer.current = window.setTimeout(() => setCopied(0), 1500);
  };
  let facet = 0;
  let action = 0;
  const bar = (node: ReactNode) => <span className="spec-bar-item" style={{ '--i': action++ } as React.CSSProperties}>{node}</span>;
  return (
    <div className={`row-details saved-spec${missing ? ' missing' : ''}`} id={`details-${row.id}`} role="region" aria-label={libraryText('detailRegion', { title: row.title })}>
      <div className="spec-card">
        <div className="spec-top">
          <div className="spec-media">
            <div className="spec-poster px-shine" onMouseEnter={() => setPosterHot(true)} onMouseLeave={() => setPosterHot(false)} role="img" aria-label={libraryText('detailPoster', { title: row.title })}>
              <FillThumb row={row} apiBase={apiBase} previewUrl={previewUrl} previewActive={!missing && (posterHot || playFocused)} />
            </div>
            {!missing && <button type="button" className="spec-play px-shine" onClick={() => onCommand('play')} onFocus={(event) => setPlayFocused(event.currentTarget.matches(':focus-visible'))} onBlur={() => setPlayFocused(false)}>
              <Play aria-hidden="true" />{copy.detailPlay}
            </button>}
          </div>
          <div className="spec-main">
            {missing && <div className="spec-missing" role="status">
              <AlertTriangle aria-hidden="true" />
              <span>{row.statusLine}{directory && <><br /><span className="was">{libraryText('detailMissingWhere', { path: directory })}</span></>}</span>
              <button type="button" className="spec-locate px-shine" onClick={() => onCommand('locate')}><FolderOpen aria-hidden="true" />{copy.detailLocate}</button>
            </div>}
            <h3 className="spec-title">{row.title}</h3>
            <dl className="spec-grid" aria-busy={loading || undefined}>
              {shown.map((fact) => fact.pending
                ? <div key={`pending-${fact.key}`} className="spec-row pending" data-fact-pending={fact.key} aria-hidden="true" style={{ '--i': facet++ } as React.CSSProperties}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                : <div key={fact.key} className={`spec-row${fact.wide ? ' wide' : ''}`} data-fact={fact.key} style={{ '--i': facet++ } as React.CSSProperties} title={fact.title}>
                  <dt>{fact.label}</dt><dd>{fact.value}</dd>
                </div>)}
            </dl>
            {loading && showLoading && <span className="sr-only" role="status">{copy.detailReading}</span>}
          </div>
        </div>
        <div className="spec-bar detail-links" role="toolbar" aria-label={libraryText('detailActions', { title: row.title })}>
          {!missing && bar(<button type="button" className="spec-action px-shine" onClick={() => onCommand('show-folder')}><Folder aria-hidden="true" />{revealLabel()}</button>)}
          {pageUrl && bar(<button type="button" className="spec-action px-shine open-page" onClick={() => onCommand('open-page')}><ExternalLink aria-hidden="true" />{copy.detailOpenPage}</button>)}
          {pageUrl && bar(<button type="button" className={`spec-action px-shine copy-action${copied ? ' copied' : ''}`} onClick={copyPage}>
            {copied ? <svg key={copied} className="copy-sheets" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect className="copy-sheet-back" x="3" y="3" width="12" height="14" rx="1.5" /><rect className="copy-sheet-front" x="8" y="7" width="12" height="14" rx="1.5" /></svg> : <Link2 aria-hidden="true" />}
            <span className="copy-feedback-label" aria-live="polite"><span className="copy-feedback-width" aria-hidden="true">{copy.detailCopyPage}</span><span>{copied ? copy.detailCopied : copy.detailCopyPage}</span></span>
          </button>)}
          {!missing && <>
            <span className="spec-sep" aria-hidden="true" />
            {bar(<button type="button" className="spec-action px-shine" onClick={() => onCommand('move-to')}><FolderInput aria-hidden="true" />{copy.moveTo}<kbd aria-hidden="true">M</kbd></button>)}
            {bar(<button type="button" className="spec-action px-shine" onClick={() => onCommand('rename')}><Pencil aria-hidden="true" />{copy.detailRename}</button>)}
          </>}
          <span className="spec-space" />
          {bar(<button type="button" className="spec-action px-shine danger" onClick={() => onCommand('remove')}>{missing ? <ListX aria-hidden="true" /> : <Trash2 aria-hidden="true" />}{missing ? copy.detailRemoveFromList : copy.detailRemove}</button>)}
        </div>
      </div>
    </div>
  );
}
