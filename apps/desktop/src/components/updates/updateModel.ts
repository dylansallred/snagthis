import { ui } from '@/lib/strings';
import type { QueueJob } from '@/types/queue';
import type { UpdaterErrorKind, UpdaterState } from '@/types/updater';

/** What the update sheet shows. Derived from the updater phase plus the queue and Later. */
export type UpdateView = 'checking' | 'uptodate' | 'unavailable' | 'downloading' | 'ready' | 'blocked' | 'deferred' | 'installing' | 'error';
export type NoteTag = 'new' | 'better' | 'fixed';
export interface ReleaseNote { tag: NoteTag | null; title: string | null; text: string }

export const releaseNotesUrl = (version: string) => `https://github.com/dylansallred/snagthis/releases/tag/v${version.replace(/^v/, '')}`;
export const installerUrl = 'https://snagthisvid.com/#download';

/** Downloads a restart would interrupt; the same rule main.js applies before installing. */
export const blocksUpdate = (job: Pick<QueueJob, 'queueStatus' | 'status'>) =>
  job.queueStatus === 'downloading' || ['fetching-playlist', 'downloading', 'finalizing'].includes(String(job.status));

export function updateView(updater: UpdaterState, blocking: number, now = Date.now()): UpdateView {
  switch (updater.phase) {
    case 'checking': return 'checking';
    case 'downloading': return 'downloading';
    case 'installing': return 'installing';
    case 'error': return 'error';
    case 'downloaded':
      if (blocking > 0) return 'blocked';
      return updater.deferredUntil && updater.deferredUntil > now ? 'deferred' : 'ready';
    default:
      // A finished check records when it ran; unsupported builds never check.
      return updater.lastCheckedAt ? 'uptodate' : 'unavailable';
  }
}

export const nextVersion = (updater: UpdaterState) => updater.updateInfo?.version || '';
export const errorKind = (updater: UpdaterState): UpdaterErrorKind => updater.errorKind
  || (/download/i.test(updater.message) ? 'download' : /install/i.test(updater.message) ? 'install' : 'check');
/** An update was found and then failed, so the header says so; a failed background check stays quiet. */
export const updateFailed = (updater: UpdaterState) => updater.phase === 'error' && errorKind(updater) !== 'check' && !!nextVersion(updater)
  && nextVersion(updater) !== updater.currentVersion;

export type UpdateChipKind = 'downloading' | 'ready' | 'deferred' | 'failed';
/** The header chip appears only while an update is on its way, waiting or failed; never when idle. */
export function updateChipKind(updater: UpdaterState, view: UpdateView): UpdateChipKind | null {
  if (!nextVersion(updater)) return null;
  if (view === 'downloading') return 'downloading';
  if (view === 'ready' || view === 'blocked') return 'ready';
  if (view === 'deferred') return 'deferred';
  return view === 'error' && updateFailed(updater) ? 'failed' : null;
}

export const shortTime =(time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const megabytes = (bytes: number) => String(Math.max(0, Math.round(bytes / 1e6)));

/** "38 of 92 MB", or "38 MB" while the total is unknown; empty before any bytes arrive. */
export function byteProgress(updater: Pick<UpdaterState, 'transferredBytes' | 'totalBytes'>) {
  const done = updater.transferredBytes;
  if (done == null) return '';
  return updater.totalBytes ? ui.updateBytes.replace('{done}', megabytes(done)).replace('{total}', megabytes(updater.totalBytes)) : ui.updateBytesDone.replace('{done}', megabytes(done));
}

/** "about 20 s left" from the remaining bytes and the current speed; empty when unknown. */
export function timeLeft(updater: Pick<UpdaterState, 'transferredBytes' | 'totalBytes' | 'bytesPerSecond'>) {
  const { transferredBytes: done, totalBytes: total, bytesPerSecond: speed } = updater;
  if (done == null || !total || !speed || speed <= 0) return '';
  const seconds = Math.max(1, Math.ceil((total - done) / speed));
  if (seconds < 60) return ui.updateSecondsLeft.replace('{n}', String(seconds < 10 ? seconds : Math.round(seconds / 5) * 5));
  if (seconds < 3600) return ui.updateMinutesLeft.replace('{n}', String(Math.round(seconds / 60)));
  return ui.updateHoursLeft.replace('{h}', String(Math.floor(seconds / 3600))).replace('{m}', String(Math.round((seconds % 3600) / 60)));
}

export function checkedWhen(time: number | null | undefined, now = Date.now()) {
  if (!time) return '';
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return ui.updateJustNow;
  if (minutes < 60) return ui.updateMinutesAgo.replace('{n}', String(minutes));
  return ui.updateAtTime.replace('{time}', shortTime(time));
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

export interface UpdateSummary { hint: string; tone: 'muted' | 'accent' | 'attention'; action: 'see' | 'check'; meter: number | null }

/** The Settings ▸ Updates row: one line that says where the update is, and one button. */
export function updateSummary(updater: UpdaterState, view: UpdateView, blocking: number, fallback: string): UpdateSummary {
  const version = nextVersion(updater);
  const muted = (hint: string, action: UpdateSummary['action'] = 'check'): UpdateSummary => ({ hint, tone: 'muted', action, meter: null });
  switch (view) {
    case 'checking': return muted(ui.updateChecking);
    case 'uptodate': return muted(ui.updateHintUpToDate.replace('{when}', checkedWhen(updater.lastCheckedAt)));
    case 'downloading': {
      const bytes = byteProgress(updater);
      return { hint: (bytes ? ui.updateHintDownloading : ui.updateHintDownloadingPlain).replace('{version}', version).replace('{bytes}', bytes), tone: 'muted', action: 'see', meter: updater.progress || 0 };
    }
    case 'ready': return { hint: ui.updateHintReady.replace('{version}', version), tone: 'accent', action: 'see', meter: null };
    case 'blocked': return updater.installWhenIdle
      ? muted((blocking === 1 ? ui.updateHintBlockedOne : ui.updateHintBlocked).replace('{version}', version).replace('{n}', String(blocking)), 'see')
      : { hint: ui.updateHintReady.replace('{version}', version), tone: 'accent', action: 'see', meter: null };
    case 'deferred': return muted(ui.updateHintDeferred.replace('{version}', version).replace('{time}', shortTime(updater.deferredUntil || Date.now())), 'see');
    case 'installing': return muted(ui.updateInstallingHint.replace('{version}', version));
    case 'error': {
      const kind = errorKind(updater);
      const hint = kind === 'check' || !version ? ui.updateErrorCheck : (kind === 'download' ? ui.updateHintErrorDownload : ui.updateHintErrorInstall).replace('{version}', version);
      return { hint, tone: 'attention', action: 'see', meter: null };
    }
    default: return muted(fallback);
  }
}
