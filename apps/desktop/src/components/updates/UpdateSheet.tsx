import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, Check, Clock, ExternalLink, RotateCcw, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PixelButton } from '@/components/brand/PixelButton';
import { ui } from '@/lib/strings';
import type { QueueJob } from '@/types/queue';
import type { UpdaterState } from '@/types/updater';
import { byteProgress, checkedWhen, errorKind, nextVersion, releaseNoteItems, shortTime, timeLeft, type ReleaseNote, type UpdateChipKind, type UpdateView } from './updateModel';
import './updates.css';

export interface UpdateActions {
  check(): void;
  install(): void;
  later(): void;
  setInstallWhenIdle(enabled: boolean): void;
  openInstaller(): void;
  openReleaseNotes(version: string): void;
}

// "Install when downloads finish" starts on (the approved prototype's default) unless the person
// turned it off or chose Later for that version during this session.
const declinedWait = new Set<string>();
export const declineInstallWhenIdle = (version: string) => { if (version) declinedWait.add(version); };

/** Segmented update progress in the accent, bevel-lit like the logo button. `percent` null marches. */
export function UpdateMeter({ percent, cells = 32, height = 10, label = ui.updateProgressLabel, className = '' }: { percent: number | null; cells?: number; height?: number; label?: string; className?: string }) {
  const style = { '--cells': cells, '--h': `${height}px` } as CSSProperties;
  if (percent == null) {
    return <div className={`update-meter march ${className}`} style={style} role="progressbar" aria-label={label}>
      {Array.from({ length: cells }, (_, n) => <i key={n} style={{ '--n': n } as CSSProperties} />)}
    </div>;
  }
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const exact = value / 100 * cells, full = Math.floor(exact), fraction = Math.round((exact - full) * 100);
  return <div className={`update-meter ${className}`} style={style} role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    {Array.from({ length: cells }, (_, n) => n < full ? <i key={n} className="on" />
      : n === full && value < 100 ? <i key={n} className="cur" style={{ '--f': `${Math.max(fraction, 20)}%` } as CSSProperties} /> : <i key={n} />)}
  </div>;
}

const TAGS = { new: ui.updateTagNew, better: ui.updateTagBetter, fixed: ui.updateTagFixed } as const;
function NotesList({ notes }: { notes: ReleaseNote[] }) {
  const tagged = notes.some((note) => note.tag);
  return <ul className={`update-notes${tagged ? '' : ' plain'}`}>
    {notes.map((note, index) => <li key={index}>
      {note.tag ? <b className={`update-tag tag-${note.tag}`}>{TAGS[note.tag]}</b> : <i className="update-bullet" aria-hidden="true" />}
      <div>{note.title && <><strong>{note.title}</strong>{' '}</>}<span>{note.text}</span></div>
    </li>)}
  </ul>;
}

function WhatsNew({ notes, version, expanded, onExpand, onOpenNotes, title = ui.updateWhatsNew }: { notes: ReleaseNote[]; version: string; expanded: boolean; onExpand: () => void; onOpenNotes: () => void; title?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const wasExpanded = useRef(expanded);
  // The "See all" button goes away; keep focus in the sheet on the list it revealed.
  useEffect(() => { if (expanded && !wasExpanded.current) scroller.current?.focus({ preventScroll: true }); wasExpanded.current = expanded; }, [expanded]);
  if (!notes.length) return null;
  const all = expanded || notes.length <= 3;
  const count = notes.length === 1 ? ui.updateOneChange : ui.updateChanges.replace('{n}', String(notes.length));
  return <section className="update-whatsnew" aria-label={title}>
    <h3>{title}{expanded && <small>{count}</small>}</h3>
    <div ref={scroller} className={expanded ? 'update-notes-scroll' : undefined} tabIndex={expanded ? 0 : undefined} aria-label={expanded ? title : undefined}>
      <NotesList notes={all ? notes : notes.slice(0, 3)} />
    </div>
    {!all && <button type="button" className="update-quiet" onClick={onExpand}>{ui.updateSeeAll.replace('{n}', String(notes.length))}</button>}
    {all && version && <button type="button" className="update-link" onClick={onOpenNotes}>{ui.updateFullNotes}<ExternalLink aria-hidden="true" /></button>}
  </section>;
}

// The hero: a 125 × 38 pixel scene (sky bands, stars, stepped hills) drawn from the accent's shades.
const steps = (heights: number[], width: number, base: number) => `M0 ${base}${heights.map((h, i) => `V${base - h}H${(i + 1) * width}`).join('')}V${base}Z`;
const STARS: Array<[number, number]> = [[8, 4], [19, 11], [27, 3], [41, 8], [52, 2], [71, 5], [84, 12], [93, 3], [104, 9], [117, 4], [12, 17], [110, 16], [63, 14], [35, 15]];
const FAR = steps([4, 5, 7, 8, 8, 7, 5, 4, 5, 6, 8, 9, 9, 8, 6, 5, 4, 4, 5, 7, 8, 7, 6, 5, 5, 4], 5, 33);
const NEAR = steps([2, 3, 3, 4, 5, 5, 4, 3, 2, 2, 3, 4, 4, 3, 3, 2, 3, 4, 5, 5, 4, 3, 3, 2, 2, 3], 5, 35);

function UpdateHero({ view, version, current }: { view: UpdateView; version: string; current: string }) {
  const tone = view === 'error' ? 'warn' : view === 'uptodate' ? 'good' : 'accent';
  const kicker = { checking: ui.updateKickerChecking, uptodate: ui.updateKickerUpToDate, unavailable: ui.updateKickerUpToDate, downloading: ui.updateKickerDownloading, installing: ui.updateKickerInstalling, error: ui.updateKickerError }[view as string] || ui.updateKickerNew;
  const number = ['uptodate', 'checking', 'unavailable'].includes(view) || !version ? current : version;
  return <div className={`update-hero tone-${tone}`} data-view={view}>
    <svg className="update-scene" viewBox="0 0 125 38" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <rect className="sky" width="125" height="38" />
      <rect className="band1" y="12" width="125" height="6" />
      <rect className="band2" y="18" width="125" height="5" />
      <rect className="band3" y="23" width="125" height="4" />
      {STARS.map(([x, y], index) => <rect key={index} className={`star${index % 3 === 0 ? ' blink' : index % 3 === 1 ? ' blink2' : ''}`} x={x} y={y} width="1" height="1" opacity={index % 2 ? 0.55 : 0.8} />)}
      <path className="far" d={FAR} />
      <path className="near" d={NEAR} />
      <rect className="ground" y="34" width="125" height="4" />
      <rect className="horizon" y="34" width="125" height="1" />
    </svg>
    <div className="update-hero-mid" aria-hidden="true">
      <span className={`update-hero-button${view === 'installing' ? ' pressing' : ''}`}><PixelButton size={60} /></span>
      <span className="update-hero-version"><small>{kicker}</small><b>{number}</b></span>
    </div>
    {view !== 'installing' && <DialogClose asChild><button type="button" className="update-close" aria-label={ui.updateClose}><X /></button></DialogClose>}
  </div>;
}

const Version = ({ version }: { version: string }) => <>SnagThis <span className="update-pixel">{version}</span></>;

function WaitingDownloads({ jobs }: { jobs: QueueJob[] }) {
  return <ul className="update-waiting" aria-label={ui.updateActiveDownloads}>
    {jobs.map((job) => {
      const percent = Math.max(0, Math.min(99, Math.floor(job.progress || 0)));
      const done = Math.floor(percent / 100 * 12);
      return <li key={job.id}>
        <span className="update-waiting-title" title={job.title}>{job.title}</span>
        <span className="update-waiting-cells" aria-hidden="true">{Array.from({ length: 12 }, (_, n) => <i key={n} className={n < done ? 'd' : n === done ? 'c' : undefined} />)}</span>
        <span className="update-waiting-percent">{percent}%</span>
      </li>;
    })}
  </ul>;
}

/**
 * The update sheet (updates direction C · Dedicated sheet): a pixel-art hero with the version,
 * then one state's words, What's new and the install controls. Opened from the header chip,
 * Settings ▸ Updates or an update notification.
 */
export function UpdateSheet({ open, onOpenChange, updater, view, blocking, autoCheck, currentVersion, actions, initialExpanded = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; updater: UpdaterState; view: UpdateView; blocking: QueueJob[];
  autoCheck: boolean; currentVersion: string; actions: UpdateActions; initialExpanded?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(initialExpanded);
  const version = nextVersion(updater);
  const current = updater.currentVersion || currentVersion;
  const notes = releaseNoteItems(updater.releaseNotes);
  const autoArmed = useRef('');
  useEffect(() => { if (!open) setExpanded(false); }, [open]);
  useEffect(() => {
    if (!open) { autoArmed.current = ''; return; }
    if (view !== 'blocked' || updater.installWhenIdle || !version || declinedWait.has(version) || autoArmed.current === version) return;
    autoArmed.current = version;
    actions.setInstallWhenIdle(true);
  }, [open, view, updater.installWhenIdle, version, actions]);
  const whatsNew = (title?: string) => <WhatsNew notes={notes} version={version} expanded={expanded} onExpand={() => setExpanded(true)} onOpenNotes={() => actions.openReleaseNotes(version)} title={title} />;
  const later = <button type="button" className="row-action labelled update-secondary" onClick={actions.later}>{ui.later}</button>;
  const install = (disabled = false) => <button type="button" className="row-action primary-action" disabled={disabled} title={disabled ? ui.updateAvailableWhenDone : undefined} onClick={actions.install}>{ui.install}</button>;
  const close = (label: string) => <DialogClose asChild><button type="button" className="row-action labelled update-secondary">{label}</button></DialogClose>;
  const onVersion = <span className="update-foot-note">{ui.updateOnVersion.replace('{version}', current)}</span>;
  const checksNote = <span className="update-foot-note">{autoCheck ? ui.updateChecksOnStart : ui.updateChecksOff}</span>;

  let title: React.ReactNode, description: React.ReactNode = null, body: React.ReactNode = null, foot: React.ReactNode = null;
  switch (view) {
    case 'checking':
      title = ui.updateChecking; description = ui.updateYouAreOn.replace('{version}', current);
      body = <UpdateMeter percent={null} />;
      foot = <>{checksNote}{close(ui.updateClose)}</>;
      break;
    case 'uptodate':
      title = ui.updateUpToDate; description = ui.updateUpToDateBody.replace('{version}', current).replace('{when}', checkedWhen(updater.lastCheckedAt));
      foot = <><span className="update-foot-note"><Check className="tone-good" aria-hidden="true" />{autoCheck ? ui.updateChecksOnStart : ui.updateChecksOff}</span>{close(ui.updateDone)}</>;
      break;
    case 'unavailable':
      title = ui.updateUnavailable; description = updater.message || ui.updatesNotChecked;
      foot = <>{checksNote}{close(ui.updateDone)}</>;
      break;
    case 'downloading': {
      const bytes = byteProgress(updater), left = timeLeft(updater);
      title = <>{ui.updateDownloading} <span className="update-pixel">{version}</span></>;
      body = <><div className="update-progress"><UpdateMeter percent={updater.progress || 0} />{(bytes || left) && <div className="update-progress-meta"><span>{bytes}</span><span>{left}</span></div>}</div>{whatsNew()}</>;
      foot = <><span className="update-foot-note">{ui.updateInstallsOnRestart}</span>{close(ui.updateKeepSnagging)}</>;
      break;
    }
    case 'ready':
      title = <><Version version={version} /> {ui.updateReadySuffix}</>;
      description = expanded ? null : ui.updateReadyBody;
      body = whatsNew();
      foot = <>{onVersion}{later}{install()}</>;
      break;
    case 'blocked': {
      const etas = blocking.map((job) => job.etaSeconds);
      const minutes = etas.length && etas.every((eta) => typeof eta === 'number' && eta >= 0) ? Math.max(1, Math.round(Math.max(...(etas as number[])) / 60)) : 0;
      const waiting = !!updater.installWhenIdle;
      title = <><Version version={version} /> {ui.updateReadySuffix}</>;
      description = blocking.length === 1 ? ui.updateBlockedBodyOne : ui.updateBlockedBody.replace('{n}', String(blocking.length));
      body = <>
        <div className="update-waitbox">
          <WaitingDownloads jobs={blocking} />
          <label className="update-check"><input type="checkbox" checked={waiting} onChange={(event) => { if (!event.target.checked) declineInstallWhenIdle(version); actions.setInstallWhenIdle(event.target.checked); }} />{ui.updateInstallWhenIdle}</label>
        </div>
        {expanded ? whatsNew(ui.updateWhatsNewIn.replace('{version}', version)) : notes.length > 0 && <button type="button" className="update-quiet" onClick={() => setExpanded(true)}>{ui.updateWhatsNewIn.replace('{version}', version)}</button>}
      </>;
      foot = <><span className="update-foot-note" role="status">{waiting ? minutes ? ui.updateInstallsInAbout.replace('{n}', String(minutes)) : ui.updateInstallsWhenDone : ui.updateAvailableWhenDone}</span>{later}{install(true)}</>;
      break;
    }
    case 'deferred':
      title = <><Version version={version} /> {ui.updateReadySuffix}</>;
      description = ui.updateDeferredBody.replace('{time}', shortTime(updater.deferredUntil || Date.now()));
      body = whatsNew();
      foot = <><span className="update-foot-note"><Clock aria-hidden="true" />{ui.updateReminderAt.replace('{time}', shortTime(updater.deferredUntil || Date.now()))}</span>{install()}</>;
      break;
    case 'installing':
      title = <>{ui.updateInstallingPrefix} <span className="update-pixel">{version}</span>…</>;
      description = ui.updateInstallingBody;
      body = <UpdateMeter percent={null} />;
      break;
    case 'error': {
      const kind = errorKind(updater);
      const bytes = byteProgress(updater);
      title = { check: ui.updateErrorCheck, download: ui.updateErrorDownload, install: ui.updateErrorInstall, location: ui.updateErrorLocation }[kind];
      const what = { check: ui.updateCheckFailed, download: bytes && updater.totalBytes ? ui.updateDroppedAt.replace('{bytes}', bytes) : ui.updateDownloadStopped, install: ui.updateInstallFailed, location: ui.updateMoveApp }[kind];
      description = `${what} ${ui.updateNothingChanged.replace('{version}', current)}`;
      body = updater.error ? <details className="update-details"><summary>{ui.updateDetails}</summary><pre>{updater.error}</pre></details> : null;
      foot = <><button type="button" className="row-action labelled update-secondary update-installer" onClick={actions.openInstaller}>{ui.updateDownloadInstaller}<ExternalLink aria-hidden="true" /></button>
        <button type="button" className="row-action primary-action" onClick={actions.check}><RotateCcw aria-hidden="true" />{ui.updateTryAgain}</button></>;
      break;
    }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent ref={content} className="update-sheet" showCloseButton={false} data-view={view}
      // Like Settings: start on the sheet itself so Escape and Tab work without lighting up a button.
      onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }}>
      <UpdateHero view={view} version={version} current={current} />
      <div className="update-body">
        <DialogTitle className="update-title">{title}</DialogTitle>
        {description ? <DialogDescription className="update-description">{description}</DialogDescription> : <DialogDescription className="sr-only">{ui.updateSheetDescription}</DialogDescription>}
        {body}
      </div>
      {foot && <div className="update-foot">{foot}</div>}
    </DialogContent>
  </Dialog>;
}

/** The header chip: NEW 1.1.0 when ready, a mini meter while downloading, the reminder time after Later. */
export function UpdateChip({ updater, kind, onOpen }: { updater: UpdaterState; kind: UpdateChipKind; onOpen: () => void }) {
  const version = nextVersion(updater);
  if (kind === 'downloading') {
    const percent = Math.round(updater.progress || 0);
    return <button type="button" className="update-chip cart" data-kind={kind} onClick={onOpen} aria-label={ui.updateChipDownloadingLabel.replace('{version}', version).replace('{percent}', String(percent))}>
      <span aria-hidden="true"><UpdateMeter percent={percent} cells={6} height={6} className="mini" /></span><span className="update-chip-num" aria-hidden="true">{percent}%</span>
    </button>;
  }
  if (kind === 'ready') {
    return <button type="button" className="update-chip cart hot" data-kind={kind} onClick={onOpen} aria-label={ui.updateChipReadyLabel.replace('{version}', version)}>
      <PixelButton size={13} /><span className="update-pixel" aria-hidden="true">{ui.updateChipNew.replace('{version}', version)}</span>
    </button>;
  }
  if (kind === 'deferred') {
    const time = shortTime(updater.deferredUntil || Date.now());
    return <button type="button" className="update-chip cart" data-kind={kind} onClick={onOpen} aria-label={ui.updateChipDeferredLabel.replace('{version}', version).replace('{time}', time)}>
      <Clock aria-hidden="true" /><span aria-hidden="true"><span className="update-pixel">{version}</span> · {time}</span>
    </button>;
  }
  return <button type="button" className="update-chip cart warn" data-kind={kind} onClick={onOpen} aria-label={ui.updateChipFailedLabel}>
    <AlertTriangle aria-hidden="true" /><span aria-hidden="true">{ui.updateChipFailed}</span>
  </button>;
}
