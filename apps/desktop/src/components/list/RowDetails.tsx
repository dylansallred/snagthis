import { useState } from 'react';
import { formatSize, type RowModel } from '@m3u8/contracts/src/rows.mjs';
import { SegmentHeatmap } from '@/components/queue/SegmentHeatmap';
import { formatBytesPerSecond } from '@/lib/utils';
import { ui } from '@/lib/strings';

export type RowCommand = 'pause' | 'resume' | 'retry' | 'play' | 'open-page' | 'choose-folder' | 'locate' | 'details' | 'rename' | 'copy-link' | 'show-folder' | 'cancel' | 'remove' | 'start' | 'move-up' | 'move-down';
export function RowDetails({ row, folder, onCommand, onRefreshLink }: {
  row: RowModel; folder: string; onCommand: (command: RowCommand) => void;
  onRefreshLink: (url: string) => Promise<void>;
}) {
  const [showLink, setShowLink] = useState(false);
  const [newLink, setNewLink] = useState('');
  const [saving, setSaving] = useState(false);
  const source = row.source;
  const saved = row.state === 'saved' || row.state === 'missing';
  let host = '';
  try { host = new URL(source.sourcePageUrl || source.url || source.mediaUrl).hostname; } catch { /* no source available */ }
  const path = source.absolutePath || source.outputDirectory || folder;
  const quality = [row.qualityLabel, source.selection?.audioLang && `${source.selection.audioLang} audio`, source.selection?.subtitleLang && source.selection.subtitleLang !== 'none' && `${source.selection.subtitleLang} subtitles`].filter(Boolean).join(' · ');
  const downloaded = formatSize(source.bytesDownloaded);
  const total = formatSize(source.totalBytes, { estimated: !source.totalBytesKnown });
  const size = saved ? row.sizeLabel : [downloaded && total ? `${downloaded} of ${total}` : downloaded || total, source.speedBps > 0 && formatBytesPerSecond(source.speedBps)].filter(Boolean).join(' · ');
  const pieces = !saved && source.totalSegments > 0;
  const retrying = Object.values(source.segmentStates || {}).filter((item) => (item as { status: string }).status === 'retrying').length;
  return (
    <div className="row-details" id={`details-${row.id}`}>
      <div>
        <dl className="row-facts">
          {quality && <><dt>{ui.quality}</dt><dd>{quality}</dd></>}
          {size && <><dt>{ui.size}</dt><dd>{size}</dd></>}
          {host && <><dt>{ui.from}</dt><dd>{host}</dd></>}
          <dt>{saved ? ui.savedIn : ui.savingTo}</dt><dd>{path || 'Downloads'}</dd>
          {row.problem?.raw && <><dt>{ui.problem}</dt><dd>{row.problem.raw}</dd></>}
        </dl>
        <div className="detail-links">
          {['waiting', 'paused'].includes(row.state) && <button onClick={() => onCommand('rename')}>{ui.rename}</button>}
          {(source.url || source.sourcePageUrl) && <><button onClick={() => onCommand('copy-link')}>{ui.copyLink}</button><button onClick={() => onCommand('open-page')}>{ui.openPage}</button></>}
          <button className="destructive-text" onClick={() => onCommand(saved ? 'remove' : 'cancel')}>{saved ? ui.remove : ui.cancelDownload}</button>
        </div>
        {row.problem?.code === 'expired' && <>
          <button className="detail-refresh" onClick={() => setShowLink(!showLink)}>{ui.refreshLink}</button>
          {showLink && <form className="refresh-link-form" onSubmit={async (event) => {
            event.preventDefault(); setSaving(true);
            try { await onRefreshLink(newLink); setShowLink(false); } finally { setSaving(false); }
          }}><input type="url" required value={newLink} onChange={(event) => setNewLink(event.target.value)} placeholder={ui.refreshPlaceholder} aria-label={ui.refreshPlaceholder} /><button className="row-action labelled" disabled={saving}>{ui.replaceLink}</button></form>}
        </>}
      </div>
      {pieces && <div className="pieces-panel"><div className="pieces-caption"><span>{ui.pieces}</span><span>{source.completedSegments || 0} of {source.totalSegments}{retrying ? ` · ${retrying} retrying` : ''}</span></div><SegmentHeatmap totalSegments={source.totalSegments} segmentStates={source.segmentStates} /></div>}
    </div>
  );
}
