import { ui } from '@/lib/strings';
import type { QueueJob } from '@/types/queue';
import type { UpdaterErrorKind, UpdaterState } from '@/types/updater';

/**
 * Updates, option B · Install on quit or idle (updates spec §8.1): updates download silently, wait
 * as a quiet "1.1.0 ready" chip, and install when SnagThis quits or sits idle in the background.
 */
export type UpdateView = 'checking' | 'uptodate' | 'unavailable' | 'downloading' | 'ready' | 'installing' | 'error';
export type NoteTag = 'new' | 'better' | 'fixed';
export interface ReleaseNote { tag: NoteTag | null; title: string | null; text: string }

export const releaseNotesUrl = (version: string) => `https://github.com/dylansallred/snagthis/releases/tag/v${version.replace(/^v/, '')}`;
export const installerUrl = 'https://snagthisvid.com/#download';

/** Downloads a restart would interrupt; the same rule main.js applies before installing. */
export const blocksUpdate = (job: Pick<QueueJob, 'queueStatus' | 'status'>) =>
  job.queueStatus === 'downloading' || ['fetching-playlist', 'downloading', 'finalizing'].includes(String(job.status));

export function updateView(updater: UpdaterState): UpdateView {
  switch (updater.phase) {
    case 'checking': return 'checking';
    case 'downloading': return 'downloading';
    case 'downloaded': return 'ready';
    case 'installing': return 'installing';
    case 'error': return 'error';
    default:
      // A finished check records when it ran; unsupported builds never check.
      return updater.lastCheckedAt ? 'uptodate' : 'unavailable';
  }
}

export const nextVersion = (updater: UpdaterState) => updater.updateInfo?.version || '';
export const errorKind = (updater: UpdaterState): UpdaterErrorKind => updater.errorKind
  || (/download/i.test(updater.message) ? 'download' : /install/i.test(updater.message) ? 'install' : 'check');
/** A found update failed to download or install, so the header says so; a failed background check stays quiet. */
export const updateFailed = (updater: UpdaterState) => updater.phase === 'error' && errorKind(updater) !== 'check' && !!nextVersion(updater)
  && nextVersion(updater) !== updater.currentVersion;

export type UpdateChipKind = 'ready' | 'restarting' | 'failed';
/** The header chip: only while an update is ready, restarting into it, or failed. Downloads are silent. */
export function updateChipKind(updater: UpdaterState): UpdateChipKind | null {
  if (!nextVersion(updater)) return null;
  if (updater.phase === 'downloaded') return 'ready';
  if (updater.phase === 'installing') return 'restarting';
  return updateFailed(updater) ? 'failed' : null;
}

/** "After 2 downloads finish" under a disabled Restart now. */
export const afterDownloads = (count: number) => (count === 1 ? ui.updateAfterOne : ui.updateAfterMany.replace('{n}', String(count)));

const megabytes = (bytes: number) => String(Math.max(0, Math.round(bytes / 1e6)));

/** "38 of 92 MB", or "38 MB" while the total is unknown; empty before any bytes arrive. */
export function byteProgress(updater: Pick<UpdaterState, 'transferredBytes' | 'totalBytes'>) {
  const done = updater.transferredBytes;
  if (done == null) return '';
  return updater.totalBytes ? ui.updateBytes.replace('{done}', megabytes(done)).replace('{total}', megabytes(updater.totalBytes)) : ui.updateBytesDone.replace('{done}', megabytes(done));
}

export function checkedWhen(time: number | null | undefined, now = Date.now()) {
  if (!time) return '';
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return ui.updateJustNow;
  if (minutes < 60) return ui.updateMinutesAgo.replace('{n}', String(minutes));
  return ui.updateAtTime.replace('{time}', new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
}

/** The friendly words for a failed update: a title, then what happened and that nothing changed. */
export function updateErrorText(updater: UpdaterState, currentVersion: string) {
  const kind = errorKind(updater);
  const version = nextVersion(updater);
  const bytes = byteProgress(updater);
  const title = kind === 'check' || !version ? ui.updateErrorCheck
    : { download: ui.updateErrorDownload, install: ui.updateErrorInstall, location: ui.updateErrorLocation }[kind].replace('{version}', version);
  const what = { check: ui.updateCheckFailed, download: bytes && updater.totalBytes ? ui.updateDroppedAt.replace('{bytes}', bytes) : ui.updateDownloadStopped, install: ui.updateInstallFailed, location: ui.updateMoveApp }[kind];
  return { title, body: `${what} ${ui.updateNothingChanged.replace('{version}', updater.currentVersion || currentVersion)}` };
}

const TAG = /^(new|better|fixed)\s*:\s*/i;
// A short leading sentence ("Accent colours.") followed by more text becomes the note's bold title.
const TITLE = /^([^.!?]{1,60}[.!?])\s+(\S.*)$/;

function parseNote(line: string): ReleaseNote {
  const text = line.replace(/^[•\-*]\s*/, '').trim();
  const tagged = TAG.exec(text);
  if (!tagged) return { tag: null, title: null, text };
  const rest = text.slice(tagged[0].length).trim();
  const titled = TITLE.exec(rest);
  return { tag: tagged[1].toLowerCase() as NoteTag, title: titled ? titled[1] : null, text: titled ? titled[2] : rest };
}

/**
 * Release notes arrive as plain lines (main.js converts GitHub's HTML; list items start "• ").
 * Keep the "What's new" section when there is one, so the installer guide below it is left out.
 */
export function releaseNoteItems(notes: UpdaterState['releaseNotes']): ReleaseNote[] {
  const lines = (Array.isArray(notes) ? notes : notes ? String(notes).split('\n') : []).map((line) => line.trim()).filter(Boolean);
  const bullet = (line: string) => /^[•\-*]\s/.test(line);
  const heading = lines.findIndex((line) => /^what[’']s new:?$/i.test(line));
  let items: string[] = [];
  if (heading >= 0) {
    for (const line of lines.slice(heading + 1)) { if (!bullet(line)) break; items.push(line); }
    if (!items.length) items = lines.slice(heading + 1);
  } else items = lines.some(bullet) ? lines.filter(bullet) : lines;
  return items.map(parseNote).filter((note) => note.text || note.title);
}

export type UpdateSummaryAction = 'check' | 'restart' | 'details' | 'move';
export interface UpdateSummary { hint: string; tone: 'muted' | 'accent' | 'attention'; action: UpdateSummaryAction; disabled: boolean }

/**
 * The Settings ▸ Updates row: one line saying where the update is, and one button
 * ("Up to date" · Check now, "1.1.0 ready" · Restart now, "Couldn't update" · Details).
 */
export function updateSummary(updater: UpdaterState, blocking: number, available: boolean): UpdateSummary {
  const version = nextVersion(updater);
  const row = (hint: string, action: UpdateSummaryAction = 'check', disabled = false, tone: UpdateSummary['tone'] = 'muted'): UpdateSummary => ({ hint, tone, action, disabled });
  if (updater.needsMove) return row(ui.updateHintMove, 'move');
  if (!available) return row(ui.updatesInstalledOnly, 'check', true);
  switch (updateView(updater)) {
    case 'checking': return row(ui.updateChecking, 'check', true);
    case 'uptodate': return row(ui.updateHintUpToDate.replace('{when}', checkedWhen(updater.lastCheckedAt)));
    case 'downloading': {
      const bytes = byteProgress(updater);
      return row((bytes ? ui.updateHintDownloading : ui.updateHintDownloadingPlain).replace('{version}', version).replace('{bytes}', bytes), 'check', true);
    }
    case 'ready': return blocking > 0
      ? row(`${ui.updateHintReady.replace('{version}', version)} · ${afterDownloads(blocking).toLowerCase()}`, 'restart', true, 'accent')
      : row(ui.updateHintReady.replace('{version}', version), 'restart', false, 'accent');
    case 'installing': return row(ui.updateHintInstalling.replace('{version}', version), 'check', true);
    case 'error': return row(ui.updateHintError, 'details', false, 'attention');
    default: return row(ui.updatesNotChecked);
  }
}
