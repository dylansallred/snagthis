import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Popover } from 'radix-ui';
import { AlertTriangle, ExternalLink, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { PixelButton } from '@/components/brand/PixelButton';
import { ui } from '@/lib/strings';
import type { UpdaterState } from '@/types/updater';
import { afterDownloads, errorKind, nextVersion, releaseNoteItems, updateErrorText, type ReleaseNote, type UpdateChipKind } from './updateModel';
import './updates.css';

export interface UpdateActions {
  check(): void;
  restart(): void;
  openInstaller(): void;
  openReleaseNotes(version: string): void;
  moveToApplications(): void;
  markUpdatedSeen(): void;
}

/** Marching accent cells while SnagThis restarts into the update. */
function MarchingCells({ cells = 6 }: { cells?: number }) {
  return <span className="update-meter march mini" style={{ '--cells': cells, '--h': '6px' } as CSSProperties} aria-hidden="true">
    {Array.from({ length: cells }, (_, n) => <i key={n} style={{ '--n': n } as CSSProperties} />)}
  </span>;
}

const TAGS = { new: ui.updateTagNew, better: ui.updateTagBetter, fixed: ui.updateTagFixed } as const;
export function NotesList({ notes }: { notes: ReleaseNote[] }) {
  const tagged = notes.some((note) => note.tag);
  return <ul className={`update-notes${tagged ? '' : ' plain'}`}>
    {notes.map((note, index) => <li key={index}>
      {note.tag ? <b className={`update-tag tag-${note.tag}`}>{TAGS[note.tag]}</b> : <i className="update-bullet" aria-hidden="true" />}
      <div>{note.title && <><strong>{note.title}</strong>{' '}</>}<span>{note.text}</span></div>
    </li>)}
  </ul>;
}

/** The friendly failure: what happened, that nothing changed, Details, Download installer ↗ and Try again. */
export function UpdateErrorBody({ updater, currentVersion, actions, titleId, rawLabel = ui.updateDetails }: { updater: UpdaterState; currentVersion: string; actions: UpdateActions; titleId?: string; rawLabel?: string }) {
  const { title, body } = updateErrorText(updater, currentVersion);
  return <>
    <h2 id={titleId} className="update-pop-title warn">{title}</h2>
    <p className="update-pop-line">{body}</p>
    {updater.error && <details className="update-details"><summary>{rawLabel}</summary><pre>{updater.error}</pre></details>}
    <div className="update-pop-actions">
      <button type="button" className="update-pop-button" onClick={actions.openInstaller}>{ui.updateDownloadInstaller}<ExternalLink aria-hidden="true" /></button>
      <button type="button" className="update-pop-button primary" onClick={actions.check}><RotateCcw aria-hidden="true" />{ui.updateTryAgain}</button>
    </div>
  </>;
}

/**
 * The header chip (updates option B): a quiet `1.1.0 ready` while an update waits to install at the
 * next quit, `Restarting…` while it installs, and amber when it failed. Clicking opens a small
 * popover with What's new and Restart now, or the friendly error.
 */
export function UpdateChip({ updater, kind, blocking, currentVersion, actions, open, onOpenChange }: {
  updater: UpdaterState; kind: UpdateChipKind; blocking: number; currentVersion: string; actions: UpdateActions;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const version = nextVersion(updater);
  const content = useRef<HTMLDivElement>(null);
  if (kind === 'restarting') {
    return <span className="update-chip cart" data-kind={kind} role="status" aria-label={ui.updateChipRestartingLabel.replace('{version}', version)}>
      <MarchingCells /><span aria-hidden="true">{ui.updateChipRestarting}</span>
    </span>;
  }
  const failed = kind === 'failed';
  const notes = releaseNoteItems(updater.releaseNotes);
  const failedText = (errorKind(updater) === 'download' ? ui.updateChipFailedDownload : ui.updateChipFailedInstall).replace('{version}', version);
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>
      {failed
        ? <button type="button" className="update-chip cart warn" data-kind={kind} aria-label={ui.updateChipFailedLabel.replace('{version}', version)}>
          <AlertTriangle aria-hidden="true" /><span aria-hidden="true">{failedText}</span>
        </button>
        : <button type="button" className="update-chip cart" data-kind={kind} aria-label={ui.updateChipReadyLabel.replace('{version}', version)}>
          <PixelButton size={13} /><span aria-hidden="true"><span className="update-pixel update-chip-version">{version}</span> {ui.updateChipReady}</span>
        </button>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="update-popover" data-kind={kind} side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-labelledby="update-popover-title" tabIndex={-1}
        // Like Settings: focus the popover itself, so Tab and Escape work without lighting up a button.
        ref={content} onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }}>
        {failed ? <UpdateErrorBody updater={updater} currentVersion={currentVersion} actions={actions} titleId="update-popover-title" /> : <>
          <h2 id="update-popover-title" className="update-pop-title">SnagThis <span className="update-pixel">{version}</span> is ready</h2>
          {notes.length > 0 && <>
            <NotesList notes={notes.slice(0, 3)} />
            <button type="button" className="update-link" onClick={() => actions.openReleaseNotes(version)}>{ui.updateFullNotes}<ExternalLink aria-hidden="true" /></button>
          </>}
          <p className="update-pop-line">{ui.updatePopoverLine}</p>
          <div className="update-pop-actions">
            {blocking > 0 && <span className="update-pop-note" id="update-restart-note">{afterDownloads(blocking)}</span>}
            <button type="button" className="update-pop-button primary" disabled={blocking > 0} aria-describedby={blocking > 0 ? 'update-restart-note' : undefined}
              onClick={() => { onOpenChange(false); actions.restart(); }}>{ui.restartNow}</button>
          </div>
        </>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

const noteSnapshot = (value: NonNullable<UpdaterState['updatedTo']>) => ({ version: value.version, notes: releaseNoteItems(value.releaseNotes) });

/**
 * After relaunching into a new version: one fading `Updated to 1.1.0 · What's new` toast, shown once.
 * What's new opens a small popover with the notes from the version that was installed.
 */
export function UpdatedNotice({ updater, actions, initialNotesOpen = false }: { updater: UpdaterState; actions: UpdateActions; initialNotesOpen?: boolean }) {
  const updated = updater.updatedTo;
  // The notes popover keeps its own copy: main forgets updatedTo as soon as the toast is up.
  const [shown, setShown] = useState<{ version: string; notes: ReleaseNote[] } | null>(() => (initialNotesOpen && updated ? noteSnapshot(updated) : null));
  const toasted = useRef(initialNotesOpen ? updated?.version || '' : '');
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!updated?.version || toasted.current === updated.version) return;
    toasted.current = updated.version;
    const snapshot = noteSnapshot(updated);
    // After this render, so the Toaster (mounted beside the app) is listening.
    window.setTimeout(() => toast(ui.updatedToast.replace('{version}', snapshot.version), {
      id: 'update-updated', className: 'update-toast', icon: <PixelButton size={16} />, duration: 8000,
      action: snapshot.notes.length ? { label: ui.updateWhatsNew, onClick: () => setShown(snapshot) } : undefined,
    }), 0);
    // Shown once: main forgets it, so later windows and launches don't repeat it.
    actions.markUpdatedSeen();
  }, [updated, actions]);
  if (!shown || !shown.notes.length) return null;
  return <Popover.Root open onOpenChange={(open) => { if (!open) setShown(null); }}>
    <Popover.Anchor className="update-notes-anchor" />
    <Popover.Portal>
      <Popover.Content className="update-popover update-notes-popover" side="top" align="end" sideOffset={8} collisionPadding={12} aria-labelledby="update-notes-title" tabIndex={-1}
        ref={content} onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.focus({ preventScroll: true }); }}>
        <div className="update-pop-head">
          <h2 id="update-notes-title" className="update-pop-title">{ui.updateWhatsNew} in <span className="update-pixel">{shown.version}</span></h2>
          <Popover.Close className="update-pop-close" aria-label={ui.updateClose}><X aria-hidden="true" /></Popover.Close>
        </div>
        <div className="update-notes-scroll" tabIndex={0} aria-label={ui.updateWhatsNewIn.replace('{version}', shown.version)}><NotesList notes={shown.notes} /></div>
        <button type="button" className="update-link" onClick={() => actions.openReleaseNotes(shown.version)}>{ui.updateFullNotes}<ExternalLink aria-hidden="true" /></button>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
