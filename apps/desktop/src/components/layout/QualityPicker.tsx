import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { formatSize } from '@m3u8/contracts/src/rows.mjs';
import type { MediaInspection, MediaSelection } from '@/lib/api';
import { ui } from '@/lib/strings';

export function QualityPicker({ inspection, initial, onDownload, onCancel, busy }: {
  inspection: MediaInspection; initial: MediaSelection; onDownload: (selection: MediaSelection) => void; onCancel: () => void; busy: boolean;
}) {
  const variants = [...(inspection.variants || [])].sort((a, b) => (b.height || 0) - (a.height || 0));
  const [selection, setSelection] = useState<MediaSelection>(initial);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); }, []);
  return <section ref={panel} className="quality-picker" aria-label="Choose video quality" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key === 'Enter' && (event.target as HTMLElement).matches('input[type="radio"]')) { event.preventDefault(); onDownload(selection); }
  }}>
    <div className="quality-heading"><span>{ui.quality}</span><button className="row-action" aria-label={ui.cancel} onClick={onCancel}><X /></button></div>
    <fieldset><legend className="sr-only">{ui.quality}</legend>{variants.map((variant) => <label className="quality-option" key={variant.url}><input type="radio" name="quality" checked={!selection.audioOnly && selection.variantUrl === variant.url} onChange={() => setSelection({ ...selection, audioOnly: false, variantUrl: variant.url, height: variant.height })} /><Check aria-hidden="true" /><span>{variant.height ? `${variant.height}p` : ui.best}</span><small>{formatSize(variant.estimatedSizeBytes ?? variant.sizeBytes)}</small></label>)}
      {(inspection.audio || []).some((audio) => audio.url) && <label className="quality-option"><input type="radio" name="quality" checked={!!selection.audioOnly} onChange={() => setSelection({ ...selection, audioOnly: true })} /><Check aria-hidden="true" /><span>Audio only</span></label>}
    </fieldset>
    {(inspection.audio?.length || 0) > 1 && <div className="quality-setting"><label htmlFor="paste-audio">Audio</label><select id="paste-audio" value={selection.audioLang || ''} onChange={(event) => setSelection({ ...selection, audioLang: event.target.value })}>{inspection.audio?.map((audio, index) => <option key={index} value={audio.language || audio.name}>{audio.name || audio.language}</option>)}</select></div>}
    {!!inspection.subtitles?.length && <div className="quality-setting"><label htmlFor="paste-subtitles">{ui.subtitles}</label><select id="paste-subtitles" value={selection.subtitleLang || 'none'} onChange={(event) => setSelection({ ...selection, subtitleLang: event.target.value })}><option value="none">{ui.none}</option>{inspection.subtitles.map((subtitle, index) => <option key={index} value={subtitle.language || subtitle.name}>{subtitle.name || subtitle.language}</option>)}</select></div>}
    <div className="quality-footer"><button className="row-action primary-action" disabled={busy} onClick={() => onDownload(selection)}>{ui.download}</button></div>
  </section>;
}
