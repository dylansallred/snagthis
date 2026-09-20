import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, Folder, FolderOpen, Link2, Trash2, X } from 'lucide-react';
import { formatSize, type RowModel } from '@m3u8/contracts/src/rows.mjs';
import { SegmentHeatmap } from '@/components/queue/SegmentHeatmap';
import { formatBytesPerSecond } from '@/lib/utils';
import { ui } from '@/lib/strings';
import { SpeedChart } from './SpeedChart';
import { QualityLabel } from './QualityLabel';

export type RowCommand = 'copy-link-inline' | 'pause' | 'resume' | 'retry' | 'play' | 'open-page' | 'choose-folder' | 'locate' | 'details' | 'rename' | 'copy-link' | 'show-folder' | 'cancel' | 'remove' | 'start' | 'move-up' | 'move-down' | 'use-chrome-session';
export function RowDetails({ row, folder, onCommand, onRefreshLink }: {
  row: RowModel; folder: string; onCommand: (command: RowCommand) => void;
  onRefreshLink: (url: string) => Promise<void>;
}) {
  const [showLink, setShowLink] = useState(false);
  const [newLink, setNewLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(0);
  const copied = copyFeedback > 0;
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  function copyLink() {
    onCommand('copy-link-inline');
    window.clearTimeout(copyTimer.current);
    setCopyFeedback((sequence) => sequence + 1);
    copyTimer.current = window.setTimeout(() => setCopyFeedback(0), 1500);
  }
  const source = row.source;
  const saved = row.state === 'saved' || row.state === 'missing';
  let host = '';
  try { host = new URL(source.sourcePageUrl || source.url || source.mediaUrl).hostname; } catch { /* no source available */ }
  const outputFile = source.absolutePath || source.outputPath || source.filePath;
  const path = String(outputFile || source.outputDirectory || source.storageDir || folder || 'Downloads');
  const directory = outputFile ? path.replace(/([\\/])[^\\/]+$/, '$1').replace(/([^:\\/])[\\/]$/, '$1') : path;
  // Shorten the home folder and emphasise the final folder; the path stays complete.
  const shownDirectory = directory.replace(/^(?:\/Users|\/home)\/[^/]+(?=\/|$)/, '~');
  const folderSplit = shownDirectory.replace(/[\\/]+$/, '').match(/^(.*[\\/])([^\\/]+)$/);
  const qualityDetails = [source.selection?.audioLang && `${source.selection.audioLang} audio`, source.selection?.subtitleLang && source.selection.subtitleLang !== 'none' && `${source.selection.subtitleLang} subtitles`].filter(Boolean).join(' · ');
  const quality = [row.qualityLabel, qualityDetails].filter(Boolean).join(' · ');
  const downloaded = formatSize(source.bytesDownloaded) || '—';
  const total = Number.isFinite(source.totalBytes) && source.totalBytes > 0
    ? `${source.totalBytesKnown ? '' : '~'}${formatSize(source.totalBytes)}` : 'Total unknown';
  const size = saved ? row.sizeLabel : [`${downloaded} / ${total}`, Number.isFinite(source.speedBps) && formatBytesPerSecond(source.speedBps)].filter(Boolean).join(' · ');
  const removeLabel = saved ? ui.remove : row.state === 'problem' ? ui.removeList : ui.cancelDownload;
  const maxConnections = Number.isFinite(source.maxConnections) && source.maxConnections > 0 ? Math.floor(source.maxConnections) : null;
  const connectionsKnown = source.connectionCountAvailable === true && Number.isFinite(source.activeConnections) && source.activeConnections >= 0;
  const connections = connectionsKnown
    ? (maxConnections ? ui.connectionsUsage.replace('{limit}', String(maxConnections)) : ui.connectionsUsageWithoutLimit).replace('{active}', String(Math.floor(source.activeConnections)))
    : [ui.connectionsUnavailable, maxConnections && ui.connectionsLimit.replace('{limit}', String(maxConnections))].filter(Boolean).join(' · ');
  const pieces = !saved && source.totalSegments > 0 && source.downloadMode !== 'native-file';
  const pieceStates = Object.values(source.segmentStates || {}) as { status: string }[];
  const pieceProgressAvailable = source.segmentProgressAvailable !== false
    && (source.segmentProgressAvailable === true || pieceStates.length > 0);
  const completed = pieceStates.filter((item) => item.status === 'completed').length;
  const retrying = pieceStates.filter((item) => item.status === 'retrying').length;
  const speed = row.state === 'downloading' && Number.isFinite(source.speedBps) ? formatBytesPerSecond(source.speedBps) : '';
  const chartId = String(row.jobId || row.id);
  const [speedValue, speedUnit] = speed.split(' ');
  const sizeFact = speed ? `${downloaded} / ${total}` : size;
  return (
    <div className="row-details" id={`details-${row.id}`}>
      <div className="detail-card">
        <button type="button" className="detail-location" title={`${ui.openFolder}: ${directory}`} onClick={() => onCommand('show-folder')}><span className="detail-folder-mark" aria-hidden="true"><Folder className="detail-folder-closed" /><FolderOpen className="detail-folder-open" /></span><span className="detail-location-copy"><span className="detail-location-label">{saved ? ui.savedIn : ui.savingTo}</span>{' '}<span className="detail-folder-name">{folderSplit ? <>{folderSplit[1]}<strong>{folderSplit[2]}</strong></> : shownDirectory}</span></span><ChevronRight className="detail-location-arrow" aria-hidden="true" /></button>
        <div className={`detail-body${speed ? ' has-chart' : ''}`}>
          {speed && <SpeedChart jobId={chartId} />}
          <div className="detail-over">
            <div className="detail-top">
              {speed && <div className="speed-stat"><strong data-speed>{speedValue} <small>{speedUnit}</small></strong>{connectionsKnown && maxConnections && maxConnections <= 32 && <span className="connection-dots" aria-hidden="true">{Array.from({ length: maxConnections }, (_, index) => <i key={index} className={index < Math.floor(source.activeConnections) ? 'on' : undefined} />)}</span>}<span data-connections title={connections}>{connections}</span></div>}
              <dl className={`row-facts${speed ? ' with-stat' : ''}`}>
                {quality && <div className="row-fact"><dt>{ui.quality}</dt><dd title={quality}><QualityLabel label={row.qualityLabel} />{row.qualityLabel && qualityDetails ? ' · ' : ''}{qualityDetails}</dd></div>}
                {sizeFact && <div className="row-fact size-fact"><dt>{ui.size}</dt><dd data-transfer-size title={sizeFact}>{sizeFact}</dd></div>}
                {!saved && !speed && <div className="row-fact"><dt>{ui.connectionsLabel}</dt><dd data-connections title={connections}>{connections}</dd></div>}
                {host && <div className="row-fact"><dt>{ui.from}</dt><dd title={host}>{host}</dd></div>}
              </dl>
            </div>
            {row.problem?.code === 'expired' && <>
              <button className="detail-refresh" onClick={() => setShowLink(!showLink)}>{ui.refreshLink}</button>
              {showLink && <form className="refresh-link-form" onSubmit={async (event) => {
                event.preventDefault(); setSaving(true);
                try { await onRefreshLink(newLink); setShowLink(false); } finally { setSaving(false); }
              }}><input type="url" required value={newLink} onChange={(event) => setNewLink(event.target.value)} placeholder={ui.refreshPlaceholder} aria-label={ui.refreshPlaceholder} /><button className="row-action labelled" disabled={saving}>{ui.replaceLink}</button></form>}
            </>}
            {pieces && <div className="pieces-panel"><div className="pieces-caption"><span>{ui.pieces}</span>{pieceProgressAvailable && <span>{completed} of {source.totalSegments}{retrying ? ` · ${retrying} retrying` : ''}</span>}</div>{pieceProgressAvailable ? <><SegmentHeatmap totalSegments={source.totalSegments} segmentStates={source.segmentStates} /><div className="pieces-legend" aria-label="Segment status colours"><span><i className="piece-completed" aria-hidden="true" />Completed</span><span><i className="piece-downloading" aria-hidden="true" />Downloading</span><span><i className="piece-retrying" aria-hidden="true" />Retrying</span><span><i className="piece-pending" aria-hidden="true" />Pending</span></div></> : <p className="pieces-unavailable">Segment progress is unavailable for this download</p>}</div>}
            {row.problem?.raw && <p className="detail-problem">{row.problem.raw}</p>}
          </div>
        </div>
        <div className="detail-links">
          {row.state === 'missing' && <button className="detail-text-action" title={ui.locate} onClick={() => onCommand('locate')}><FolderOpen aria-hidden="true" />{ui.locate}</button>}
          {['waiting', 'paused'].includes(row.state) && <button className="detail-text-action" onClick={() => onCommand('rename')}>{ui.rename}</button>}
          {(source.url || source.sourcePageUrl) && <><button className={`detail-text-action copy-action${copied ? ' copied' : ''}`} title={ui.copyLink} onClick={copyLink}>{copied ? <svg key={copyFeedback} className="copy-sheets" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect className="copy-sheet-back" x="3" y="3" width="12" height="14" rx="1.5" /><rect className="copy-sheet-front" x="8" y="7" width="12" height="14" rx="1.5" /></svg> : <Link2 aria-hidden="true" />}<span className="copy-feedback-label" aria-live="polite"><span className="copy-feedback-width" aria-hidden="true">{ui.copyLink}</span><span>{copied ? ui.copied : ui.copyLink}</span></span></button><button className="detail-text-action open-action" title={ui.openPage} onClick={() => onCommand('open-page')}><ExternalLink aria-hidden="true" />{ui.openPage}</button></>}
          <button className="detail-text-action destructive-text" title={removeLabel} onClick={() => onCommand(saved ? 'remove' : 'cancel')}>{saved || row.state === 'problem' ? <Trash2 aria-hidden="true" /> : <X aria-hidden="true" />}{removeLabel}</button>
        </div>
      </div>
    </div>
  );
}
