import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, X } from 'lucide-react';
import { formatDuration, formatSize } from '@m3u8/contracts/src/rows.mjs';
import { describeAudioTracks, defaultAudioTrack, type AudioTrack } from '@m3u8/contracts/src/audioTracks.mjs';
import type { AudioRendition, MediaInspection, MediaSelection } from '@/lib/api';
import { resolveThumbnailUrl } from '@/lib/utils';
import { ui } from '@/lib/strings';

export interface AudioSampleSource { url: string; start?: number; startFraction?: number; release?: () => void }
export type AudioSampleLoader = (track: AudioTrack<AudioRendition>, signal: AbortSignal) => Promise<AudioSampleSource>;

const SAMPLE_SECONDS = 10;
const SAMPLE_VOLUME = 0.5;
const DWELL_MS = 500;

// The audio tracks a download can honour. HLS chooses a rendition by identity;
// DASH (yt-dlp) can only choose by language, so it needs distinct languages.
function selectableTracks(inspection: MediaInspection) {
  const audio = inspection.audio || [];
  if (inspection.mediaType === 'hls') return describeAudioTracks(audio.filter((rendition) => rendition.url));
  const tracks = describeAudioTracks(audio);
  const languages = tracks.map((track) => track.languageCode);
  return languages.every(Boolean) && new Set(languages).size === languages.length ? tracks : [];
}

function Speaker() {
  return <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" shapeRendering="crispEdges"><path fill="currentColor" d="M2 6h3v4h-3zM5 5h1v6h-1zM6 4h1v8h-1zM7 3h1v10h-1z" /><path className="waves" fill="currentColor" d="M10 6h1v4h-1zM12 4h1v8h-1zM14 3h1v10h-1z" /></svg>;
}

type SampleState = { key: string; phase: 'loading' | 'playing'; progress: number } | null;

export function QualityPicker({ inspection, initial, onDownload, onCancel, busy, apiBase, loadSample }: {
  inspection: MediaInspection; initial: MediaSelection; onDownload: (selection: MediaSelection) => void; onCancel: () => void; busy: boolean; apiBase: string;
  loadSample?: AudioSampleLoader;
}) {
  const variants = [...(inspection.variants || [])].sort((a, b) => (b.height || 0) - (a.height || 0));
  const tracks = useMemo(() => selectableTracks(inspection), [inspection]);
  const defaultTrack = defaultAudioTrack(tracks);
  const [selection, setSelection] = useState<MediaSelection>(initial);
  const panel = useRef<HTMLElement>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnail = thumbnailFailed ? null : resolveThumbnailUrl(inspection.thumbnailUrl, apiBase);
  const duration = formatDuration(inspection.durationSeconds);
  const chosenTrack = tracks.find((track) => (inspection.mediaType === 'hls' ? track.key === selection.audioTrack : track.languageCode === selection.audioLang)) || defaultTrack;
  const [sample, setSample] = useState<SampleState>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const [dwelling, setDwelling] = useState<string | null>(null);
  const playback = useRef<{ key: string; abort: AbortController; audio?: HTMLAudioElement; source?: AudioSampleSource; fade?: number } | null>(null);
  const dwell = useRef<{ timer: number; key: string | null }>({ timer: 0, key: null });

  const stopSample = (reason: 'user' | 'escape' | 'leave' | 'choose' | 'close' | 'switch' | 'hidden' = 'close') => {
    window.clearTimeout(dwell.current.timer); dwell.current.key = null; setDwelling(null);
    const current = playback.current;
    if (!current) return false;
    playback.current = null;
    current.abort.abort();
    window.clearInterval(current.fade);
    if (current.audio) { current.audio.pause(); current.audio.removeAttribute('src'); current.audio.load(); }
    current.source?.release?.();
    setSample(null);
    if (reason === 'user' || reason === 'escape') setAnnouncement('Sample stopped.');
    return true;
  };
  const startSample = (track: AudioTrack<AudioRendition>) => {
    if (!loadSample || playback.current?.key === track.key) return;
    stopSample('switch');
    const current: NonNullable<typeof playback.current> = { key: track.key, abort: new AbortController() };
    playback.current = current;
    setFailed((previous) => { const next = new Set(previous); next.delete(track.key); return next; });
    setSample({ key: track.key, phase: 'loading', progress: 0 });
    setAnnouncement(`Loading a sample of ${track.title}…`);
    const fail = () => {
      if (playback.current !== current) return;
      stopSample('switch');
      setFailed((previous) => new Set(previous).add(track.key));
      setAnnouncement(`Sample unavailable for ${track.title}. You can still choose it.`);
    };
    loadSample(track, current.abort.signal).then((source) => {
      if (playback.current !== current) { source.release?.(); return; }
      current.source = source;
      const audio = new Audio(source.url);
      let start = source.start || 0;
      current.audio = audio;
      audio.volume = 0;
      audio.addEventListener('loadedmetadata', () => {
        if (source.startFraction && Number.isFinite(audio.duration)) start = audio.duration * source.startFraction;
        if (start > 0) audio.currentTime = start;
      }, { once: true });
      audio.addEventListener('error', fail);
      audio.addEventListener('ended', () => { if (playback.current === current) { stopSample('switch'); setAnnouncement('Sample finished.'); } });
      audio.addEventListener('timeupdate', () => {
        if (playback.current !== current) return;
        const progress = Math.max(0, Math.min(1, (audio.currentTime - start) / SAMPLE_SECONDS));
        setSample({ key: track.key, phase: 'playing', progress });
        if (progress >= 1) { stopSample('switch'); setAnnouncement('Sample finished.'); }
      });
      audio.play().then(() => {
        if (playback.current !== current) return;
        setSample({ key: track.key, phase: 'playing', progress: 0 });
        setAnnouncement(`Playing a sample of ${track.title} from 25% in. Press Escape to stop.`);
        const began = performance.now();
        current.fade = window.setInterval(() => {
          const step = Math.min(1, (performance.now() - began) / 400);
          audio.volume = SAMPLE_VOLUME * step;
          if (step >= 1) window.clearInterval(current.fade);
        }, 30);
      }).catch(fail);
    }, fail);
  };
  const arm = (track: AudioTrack<AudioRendition>) => {
    if (!loadSample || playback.current?.key === track.key || dwell.current.key === track.key) return;
    window.clearTimeout(dwell.current.timer);
    setDwelling(track.key);
    dwell.current = { key: track.key, timer: window.setTimeout(() => { dwell.current.key = null; setDwelling(null); startSample(track); }, DWELL_MS) };
  };
  const disarm = (track: AudioTrack<AudioRendition>, row: HTMLElement) => {
    if (row.matches(':hover') || row.contains(document.activeElement)) return;
    if (dwell.current.key === track.key) { window.clearTimeout(dwell.current.timer); dwell.current.key = null; setDwelling(null); }
    if (playback.current?.key === track.key) stopSample('leave');
  };
  const stopRef = useRef(stopSample);
  stopRef.current = stopSample;
  useEffect(() => { panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stopRef.current('hidden'); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); stopRef.current('close'); };
  }, []);
  const chooseTrack = (track: AudioTrack<AudioRendition>) => {
    stopSample('choose');
    const { audioTrack: _track, audioLang: _lang, ...rest } = selection;
    if (track === defaultTrack) setSelection(rest);
    else if (inspection.mediaType === 'hls') setSelection({ ...rest, audioTrack: track.key });
    else setSelection({ ...rest, audioLang: track.languageCode || undefined });
  };
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return <section ref={panel} className={`quality-picker${tracks.length > 1 ? ' wide' : ''}`} aria-label="Choose video quality" onKeyDown={(event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') { event.preventDefault(); if (!stopSample('escape')) onCancel(); return; }
    const row = target.closest<HTMLElement>('.atrack');
    if (event.key === ' ' && row && loadSample) {
      event.preventDefault();
      const track = tracks.find((item) => item.key === row.dataset.track);
      if (track) { if (playback.current?.key === track.key) stopSample('user'); else startSample(track); }
      return;
    }
    if (event.key === 'Enter' && target.matches('input[type="radio"]')) { event.preventDefault(); if (busy) return; stopSample('close'); onDownload(selection); }
  }}>
    {/* Name the video being chosen for, so a paste never downloads the wrong thing unseen. */}
    <div className="quality-heading">{thumbnail && <img src={thumbnail} alt="" onError={() => setThumbnailFailed(true)} />}<div><strong title={inspection.title}>{inspection.title || ui.quality}</strong><small>{[inspection.title && ui.quality, duration].filter(Boolean).join(' · ')}</small></div><button className="row-action" aria-label={ui.cancel} onClick={onCancel}><X /></button></div>
    <fieldset><legend className="sr-only">{ui.quality}</legend>{variants.map((variant) => <label className="quality-option" key={variant.url}><input type="radio" name="quality" checked={!selection.audioOnly && selection.variantUrl === variant.url} onChange={() => setSelection({ ...selection, audioOnly: false, variantUrl: variant.url, height: variant.height })} /><Check aria-hidden="true" /><span>{variant.height ? `${variant.height}p` : ui.best}</span><small>{formatSize(variant.estimatedSizeBytes ?? variant.sizeBytes)}</small></label>)}
      {(inspection.audio || []).some((audio) => audio.url) && <label className="quality-option"><input type="radio" name="quality" checked={!!selection.audioOnly} onChange={() => setSelection({ ...selection, audioOnly: true })} /><Check aria-hidden="true" /><span>Audio only</span></label>}
    </fieldset>
    {tracks.length > 1 && <fieldset className="audio-set">
      <legend>Audio <small>{tracks.length} tracks{loadSample ? ' · samples start 25% in' : ''}</small></legend>
      {tracks.map((track) => {
        const state = sample?.key === track.key ? sample : null;
        const trackFailed = failed.has(track.key);
        const progress = state?.phase === 'playing' ? (reduced ? Math.floor(state.progress * SAMPLE_SECONDS) / SAMPLE_SECONDS : state.progress) : 0;
        return <div key={track.key} data-track={track.key} className={['atrack', state && `is-${state.phase}`, trackFailed && 'is-failed', dwelling === track.key && 'dwelling'].filter(Boolean).join(' ')} style={{ '--p': progress } as CSSProperties}
          onPointerEnter={() => arm(track)} onPointerLeave={(event) => disarm(track, event.currentTarget)}
          onFocus={() => arm(track)} onBlur={(event) => { const row = event.currentTarget; queueMicrotask(() => disarm(track, row)); }}>
          <label className="quality-option">
            <input type="radio" name="audio" value={track.key} checked={track === chosenTrack} aria-label={track.ariaLabel} aria-describedby={loadSample ? 'audio-sample-hint' : undefined} onChange={() => chooseTrack(track)} />
            <Check aria-hidden="true" />
            <span className="alabel"><b>{track.title}{track.tags.map((tag) => <span key={tag} className={tag === 'AD' ? 'chip ad' : 'chip'} title={tag === 'AD' ? 'Audio description' : undefined}>{tag}</span>)}</b>
              {trackFailed ? <small>Sample unavailable · you can still choose it</small> : track.detail && <small>{track.detail}</small>}</span>
          </label>
          {loadSample && <span className="hear" aria-hidden="true"><Speaker /></span>}
          <span className="aprog"><i /></span><span className="hear-dwell" />
        </div>;
      })}
      {tracks.some((track) => track.unknown) && <p className="menu-note">This site doesn’t name its tracks.{loadSample ? ' Rest on one to check.' : ''}</p>}
    </fieldset>}
    {loadSample && tracks.length > 1 && <><span id="audio-sample-hint" className="sr-only">Rest on a track or press Space to hear a 10-second sample. Enter downloads.</span><div className="sr-only" aria-live="polite">{announcement}</div></>}
    {!!inspection.subtitles?.length && <div className="quality-setting"><label htmlFor="paste-subtitles">{ui.subtitles}</label><select id="paste-subtitles" value={selection.subtitleLang || 'none'} onChange={(event) => setSelection({ ...selection, subtitleLang: event.target.value })}><option value="none">{ui.none}</option>{inspection.subtitles.map((subtitle, index) => <option key={index} value={subtitle.language || subtitle.name}>{subtitle.name || subtitle.language}</option>)}</select></div>}
    <div className="quality-footer"><button className="row-action primary-action" disabled={busy} onClick={() => { stopSample('close'); onDownload(selection); }}>{ui.download}</button></div>
  </section>;
}
