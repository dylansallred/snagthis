import { recordSpeeds } from '@/lib/speedHistory';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, FolderOpen, MoreHorizontal, Settings, ListX, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { classifyProblem, toRowModel, type RowModel } from '@m3u8/contracts/src/rows.mjs';
import { defaultVariant } from '@m3u8/contracts/src/hls.mjs';
import { useAppInit } from '@/hooks/useAppInit';
import { useLibrary } from '@/hooks/useLibrary';
import { createApiClient, MediaInspectionError, type MediaInspection, type MediaSelection } from '@/lib/api';
import { formatBytesPerSecond } from '@/lib/utils';
import { toWebSocketUrl } from '@/lib/network';
import { ui } from '@/lib/strings';
import { TopBar, type ListFilter } from '@/components/layout/TopBar';
import { StartupLogo } from '@/components/layout/StartupLogo';
import { QualityPicker, type AudioSampleLoader } from '@/components/layout/QualityPicker';
import { VideoList } from '@/components/list/VideoList';
import { SavedShelf, SavedViewToggle, useSavedView, type SavedView } from '@/components/library/SavedShelf';
import { CommandPalette, paletteShortcut, type PaletteActions } from '@/components/palette/CommandPalette';
import { SnagMoment } from '@/components/list/SnagMoment';
import { PixelMascot } from '@/components/brand/PixelMascot';
import { DropOverlay, type DropResult } from '@/components/layout/DropOverlay';
import '@/components/layout/PixelChrome.css';
import type { RowCommand } from '@/components/list/RowDetails';
import type { QueueJob } from '@/types/queue';
import { SettingsSheet } from '@/components/settings/SettingsSheet';
import { ChromeConnectCard, PairingApproval, galleryPairingRequest } from '@/components/settings/PairingApproval';
import { defaultSettingsSection, isSettingsSection, type SettingsSectionId } from '@/components/settings/settingsSections';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { UpdateChip, UpdateSheet, declineInstallWhenIdle, type UpdateActions } from '@/components/updates/UpdateSheet';
import { blocksUpdate, installerUrl, nextVersion, releaseNotesUrl, shortTime, updateChipKind, updateView } from '@/components/updates/updateModel';
import type { UpdaterState } from '@/types/updater';
import { galleryRows, galleryQueue, loadGalleryVideo, galleryUpdater } from '@/dev/gallery';

const params = new URLSearchParams(window.location.search);
const gallery = import.meta.env.DEV && params.has('gallery');
const emptyGallery = gallery && params.get('gallery') === 'empty';
// ?gallery&update=<state> previews the update chip and sheet; &updateSheet=0 leaves the sheet closed.
const galleryUpdate = gallery ? params.get('update') : null;
const galleryUpdateState = gallery ? galleryUpdater(galleryUpdate) : null;
const chromeInstallUrl = 'https://github.com/dylansallred/snagthis#run-locally';
const editable = (target: EventTarget | null) => target instanceof HTMLElement && (!!target.closest('input,textarea,select,[contenteditable="true"]') || target.isContentEditable);

function App() {
  const { appInfo, settings, saveSettings, updater, previewUpdater, error: startupError, initialize } = useAppInit(gallery, galleryUpdateState);
  const [demoRows, setDemoRows] = useState(emptyGallery ? [] : params.get('gallery') === 'states' ? galleryRows : galleryRows.filter((row) => !['paused', 'missing'].includes(row.id)));
  const [filter, setFilter] = useState<ListFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [checking, setChecking] = useState(false);
  const [pasteError, setPasteError] = useState('');
  // Saved-tab dot for completions the snag moment could not show (hidden window, reduced motion).
  const [savedDot, setSavedDot] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(gallery && params.get('sheet') === 'settings');
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>(() => { const requested = gallery ? params.get('section') : null; return isSettingsSection(requested) ? requested : defaultSettingsSection; });
  /** Opens Settings on `section`, or where the person last left it. */
  const openSettings = useCallback((section?: SettingsSectionId) => { if (section) setSettingsSection(section); setSettingsOpen(true); }, []);
  const [expandedId, setExpandedId] = useState<string | null>(gallery && params.get('details') ? 'downloading' : null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Busy state is per row or action, so a long Locate dialog on one video does
  // not silently swallow clicks elsewhere (such as Undo on a cancel notice).
  const busyRef = useRef(new Set<string>());
  const creatingJob = useRef(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{ row: RowModel; mode: 'cancel' | 'remove' } | null>(null);
  const [confirmPlace, setConfirmPlace] = useState<{ left: number; top: number; above: boolean; caret: number } | null>(null);
  const [pending, setPending] = useState<{ url: string; inspection: MediaInspection; selection: MediaSelection } | null>(() => gallery && params.has('picker') ? {
    url: 'https://videos.example/neon-rain/',
    inspection: { title: 'Neon Rain — night drive', durationSeconds: 757, thumbnailUrl: galleryRows.find((row) => row.id === 'downloading')?.thumbnailUrl || undefined, mediaType: 'hls', variants: [{ url: '1080', height: 1080, estimatedSizeBytes: 1_400_000_000 }, { url: '720', height: 720, estimatedSizeBytes: 720_000_000 }, { url: '480', height: 480, estimatedSizeBytes: 380_000_000 }], audio: params.get('picker') === 'tracks'
      // cinejoy.pk shape: four nameless renditions, only the first DEFAULT=YES.
      ? [1, 2, 3, 4].map((n) => ({ groupId: 'audio', name: `Track ${n}`, url: `track-${n}`, default: n === 1 }))
      : [{ language: 'en', name: 'English', url: 'en', default: true }, { language: 'es', name: 'Spanish', url: 'es' }], subtitles: [{ language: 'en', name: 'English' }] },
    selection: { variantUrl: '1080', height: 1080, subtitleLang: 'none' },
  } : null);
  // Expired rows whose page was reopened: the next step is in Chrome, so the status says so.
  const [pageOpened, setPageOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [galleryVideo, setGalleryVideo] = useState<{ title: string; url: string } | null>(null);
  const [chromeSessionRow, setChromeSessionRow] = useState<RowModel | null>(null);
  const [savedView, setSavedViewState] = useSavedView();
  // Swapping list ⇄ shelf crossfades once; filtering and paging never do.
  const [viewFade, setViewFade] = useState(false);
  const setSavedView = (view: SavedView) => { if (view === savedView) return; setViewFade(true); setSavedViewState(view); };
  useEffect(() => { if (!viewFade) return; const timer = setTimeout(() => setViewFade(false), 200); return () => clearTimeout(timer); }, [viewFade]);
  const [paletteOpen, setPaletteOpen] = useState(gallery && params.has('palette'));
  const [updateOpen, setUpdateOpen] = useState(!!galleryUpdateState && galleryUpdate !== 'later' && params.get('updateSheet') !== '0');
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const brandRef = useRef<SVGSVGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const apiBase = appInfo?.apiBaseUrl || 'http://127.0.0.1:49732';
  const api = useMemo(() => !gallery && appInfo?.apiStartupState === 'ready' && appInfo.apiAuthToken ? createApiClient(appInfo.apiBaseUrl, appInfo.apiAuthToken) : null, [appInfo?.apiAuthToken, appInfo?.apiBaseUrl, appInfo?.apiStartupState]);
  const requestThumbnailPreview = useCallback(async (id: string, kind: 'job' | 'history', thumbnailUrl: string | null) => {
    if (gallery) return thumbnailUrl ? loadGalleryVideo({ thumbnailUrl }) : null;
    if (!api) return null;
    const result = kind === 'history' ? await api.ensureHistoryPreview(id) : await api.ensureJobPreview(id);
    return result.previewClipUrl || null;
  }, [api]);
  const library = useLibrary(api, query);
  const expandedJob = library.rows.find((row) => row.id === expandedId);
  const expandedJobId = expandedJob && !expandedJob.isHistory ? expandedJob.jobId : null;
  const connectedOnce = gallery ? !emptyGallery : !!appInfo?.extensionConnected;
  const folder = settings.outputDirectory || 'Downloads/SnagThis';
  const baseRows = gallery ? demoRows.filter((row) => row.title.toLowerCase().includes(query.toLowerCase())) : library.rows;
  const rows = baseRows.filter((row) => filter === 'all' || (filter === 'saved' ? ['saved', 'missing'].includes(row.state) : !['saved', 'missing'].includes(row.state))).map((row) => {
    const reopened = row.problem?.code === 'expired' && pageOpened.has(row.id) ? { ...row, statusLine: ui.expiredPageOpened.replace('{percent}', String(row.percent)) } : row;
    if (row.id !== expandedId || !detail || detail.id !== row.jobId) return reopened;
    const live = toRowModel({ ...row.source, ...detail, progress: row.source.progress, queueStatus: row.source.queueStatus, status: row.source.status }, { surface: 'desktop', folder }) || row;
    return reopened === row ? live : { ...live, statusLine: reopened.statusLine };
  });
  // The gallery footer follows the sample rows, so an empty or edited gallery never reports phantom downloads.
  const allQueue = gallery ? demoRows.filter((row) => !row.isHistory).map((row) => row.source as QueueJob) : library.queue.queue;
  const active = allQueue.filter((job) => job.queueStatus === 'downloading' && !/finaliz|convert|remux/.test(job.status));
  const totalSpeed = active.reduce((total, job) => total + (job.speedBps || 0), 0);
  // Downloads a restart would interrupt. The gallery shows them only in its blocked preview.
  const updateBlocking = gallery && galleryUpdate !== 'blocked' ? [] : allQueue.filter(blocksUpdate);
  const updateState = updateView(updater, updateBlocking.length);
  const chipKind = updateChipKind(updater, updateState);
  const updaterRef = useRef<UpdaterState>(updater);
  updaterRef.current = updater;
  const updateActions = useMemo<UpdateActions>(() => {
    const preview = previewUpdater;
    const call = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
      try { const result = await action(); if (!result.ok && result.error) toast.error(result.error); }
      catch (err) { toast.error(err instanceof Error ? err.message : ui.downloadingError); }
    };
    const open = (url: string) => { if (!gallery) void call(() => window.desktop.openExternal(url)); };
    return {
      check: () => {
        if (!preview) { void call(() => window.desktop.checkForUpdates()); return; }
        preview((current) => ({ ...current, phase: 'checking', error: null, errorKind: null }));
        window.setTimeout(() => preview((current) => ({ ...current, phase: 'idle', progress: 0, lastCheckedAt: Date.now(), updateInfo: { version: current.currentVersion || '1.0.0' }, releaseNotes: [] })), 1200);
      },
      install: () => {
        if (preview) preview((current) => ({ ...current, phase: 'installing', installWhenIdle: false }));
        else void call(() => window.desktop.installUpdateNow());
      },
      setInstallWhenIdle: (enabled) => {
        if (preview) preview((current) => ({ ...current, installWhenIdle: enabled, ...(enabled ? { deferredUntil: null } : {}) }));
        else void call(() => window.desktop.installUpdateWhenIdle(enabled));
      },
      later: async () => {
        declineInstallWhenIdle(nextVersion(updaterRef.current));
        let until: number | undefined;
        if (preview) { until = Date.now() + 30 * 60_000; preview((current) => ({ ...current, deferredUntil: until, installWhenIdle: false })); }
        else {
          const result = await window.desktop.remindLater(30).catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : ui.downloadingError, deferredUntil: undefined }));
          if (!result.ok) { toast.error(result.error || ui.downloadingError); return; }
          until = result.deferredUntil;
        }
        setUpdateOpen(false);
        toast(ui.updateRemindingToast.replace('{time}', shortTime(until || Date.now() + 30 * 60_000)), {
          id: 'update-later', icon: <Clock aria-hidden="true" />, duration: 6000,
          action: { label: ui.undo, onClick: () => {
            if (preview) preview((current) => ({ ...current, deferredUntil: null, nextReminderAt: null }));
            else void call(() => window.desktop.cancelUpdateReminder());
            setUpdateOpen(true);
          } },
        });
      },
      openInstaller: () => open(installerUrl),
      openReleaseNotes: (version) => open(releaseNotesUrl(version)),
    };
  }, [previewUpdater]);
  useEffect(() => { recordSpeeds(active); }, [active]);
  const ready = gallery || (!!api && !library.loading);
  const failure = startupError || appInfo?.apiStartupError || (!gallery && library.error) || '';
  const firstLaunch = ready && !failure && baseRows.length === 0 && !query && filter === 'all';
  const emptyLibrary = ready && !failure && baseRows.length === 0 && !query;

  useEffect(() => { const timer = setTimeout(() => setQuery(search), 180); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    // Once a reopened row recovers (or goes), forget it, so a later expiry starts from the usual advice.
    setPageOpened((current) => {
      if (!current.size) return current;
      const kept = [...current].filter((id) => baseRows.some((row) => row.id === id && row.problem?.code === 'expired'));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [baseRows]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => { if (filter === 'saved') setSavedDot(false); }, [filter]);
  useEffect(() => {
    // Gallery only: ?gallery&snag[=1-3] finishes sample downloads live (from 2.4s, 400ms apart) to preview the snag moment.
    if (!gallery || !params.has('snag')) return;
    const ids = ['finishing', 'downloading', 'placeholder'].slice(0, Math.max(1, Math.min(3, Number(params.get('snag')) || 1)));
    const timers = ids.map((id, index) => setTimeout(() => setDemoRows((current) => current.map((row) => row.id !== id ? row
      : toRowModel({ ...row.source, queueStatus: 'completed', status: 'completed', progress: 100, completedAt: Date.now() }, { surface: 'desktop' }) || row)), 2400 + index * 400));
    return () => timers.forEach(clearTimeout);
  }, []);
  useEffect(() => { if (!pasteError) return; const timer = setTimeout(() => setPasteError(''), 5000); return () => clearTimeout(timer); }, [pasteError]);
  useEffect(() => {
    if (gallery || !window.desktop) return;
    // The extension's Open app settings and snagthis://settings are about connecting Chrome;
    // the app menu's Settings… reopens the last section used.
    return window.desktop.onOpenSettings(({ section }) => openSettings(section));
  }, [openSettings]);
  // Clicking an update notification opens the update sheet.
  useEffect(() => {
    if (gallery || !window.desktop?.onOpenUpdate) return;
    return window.desktop.onOpenUpdate(() => setUpdateOpen(true));
  }, []);
  // Any open dialog owns the keyboard: app shortcuts never open something behind or on top of it.
  const [pairingOpen, setPairingOpen] = useState(false);
  const modalOpen = settingsOpen || updateOpen || pairingOpen || !!confirm || !!chromeSessionRow || !!galleryVideo;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k' && !modalOpen) { event.preventDefault(); setPaletteOpen((open) => !open); return; }
      if (paletteOpen) return;
      if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); if (!modalOpen) { setSearchOpen(true); searchRef.current?.focus(); } }
      if (mod && event.key === ',') { event.preventDefault(); if (!modalOpen) setSettingsOpen(true); }
      // Escape that closes a dialog or menu (or that a panel already handled) closes only that.
      const layer = event.target instanceof Element && event.target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]');
      if (event.key === 'Escape' && !event.defaultPrevented && !layer && !modalOpen && !editable(event.target)) { setExpandedId(null); setPending(null); }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target) || modalOpen) return;
      const value = event.clipboardData?.getData('text/plain')?.trim();
      if (value && /^https?:\/\//i.test(value)) { event.preventDefault(); setPaste(value); pasteRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown); document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('paste', onPaste); };
  }, [modalOpen, paletteOpen]);
  useEffect(() => {
    setDetail(null);
    if (!api || !expandedJobId) return;
    let stopped = false;
    api.getJob(expandedJobId).then((job) => { if (!stopped) setDetail(job as unknown as Record<string, unknown>); }).catch(() => {});
    const socket = new WebSocket(toWebSocketUrl(api.baseUrl), ['snagthis', `snagthis-auth.${api.authToken}`]);
    socket.onopen = () => { if (stopped) socket.close(); else socket.send(JSON.stringify({ type: 'subscribe', jobId: expandedJobId })); };
    socket.onmessage = (event) => { try { const payload = JSON.parse(event.data); if (payload.type === 'job:update' && payload.data?.id === expandedJobId && !stopped) setDetail(payload.data); } catch {} };
    return () => { stopped = true; if (socket.readyState === WebSocket.OPEN) socket.close(); };
  }, [api, expandedJobId]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    if (busyRef.current.has(id)) { toast(ui.actionBusy, { id: `busy-${id}`, duration: 2500 }); return false; }
    busyRef.current.add(id);
    setBusyIds(new Set(busyRef.current));
    try { await action(); if (api) await library.refresh(); return true; }
    catch (err) { toast.error(err instanceof Error ? err.message : ui.downloadingError); return false; }
    finally { busyRef.current.delete(id); setBusyIds(new Set(busyRef.current)); }
  };
  const confirmBusy = !!confirm && busyIds.has(confirm.row.id);
  const openExternal = async (url: string) => {
    if (gallery) return;
    const result = await window.desktop.openExternal(url);
    if (!result.ok) throw new Error(result.error || 'Could not open this page');
  };
  const save = async (patch: Parameters<typeof saveSettings>[0]) => { await saveSettings(patch); if (api) await library.refresh(); };
  const mutateDemo = (row: RowModel, patch: Record<string, unknown>) => setDemoRows((current) => current.flatMap((item) => {
    if (item.id !== row.id) return [item];
    const next = toRowModel({ ...item.source, ...patch }, { surface: 'desktop' });
    return next ? [next] : [];
  }));
  const cancelRow = async (row: RowModel) => {
    const previous = demoRows;
    const success = await run(row.id, async () => {
      if (gallery) mutateDemo(row, { queueStatus: 'cancelled' });
      else await api?.cancelJob(row.jobId || row.id);
    });
    if (success) {
      setConfirm(null);
      toast(row.state === 'problem' ? ui.removed : ui.cancelled, { duration: 5000, action: { label: ui.undo, onClick: () => { if (gallery) setDemoRows(previous); else run(row.id, () => api!.retryJob(row.jobId || row.id)); } } });
    }
  };
  const removeRow = async (mode: 'list' | 'trash') => {
    if (!confirm) return;
    const row = confirm.row;
    const success = await run(row.id, async () => {
      if (gallery) { setDemoRows((current) => current.filter((item) => item.id !== row.id)); return; }
      if (mode === 'trash') {
        const result = await window.desktop.moveHistoryFileToTrash(String(row.source.id));
        if (!result.ok) throw new Error(result.error || 'Could not move the file to Trash');
      } else await api?.removeHistoryItem(String(row.source.id), 'list');
    });
    if (success) { setConfirm(null); toast.success(mode === 'list' ? ui.removed : ui.trashed); }
  };
  const command = (row: RowModel, action: RowCommand) => {
    if (action === 'use-chrome-session') { setChromeSessionRow(row); return; }
    if (action === 'details') { setExpandedId((current) => current === row.id ? null : row.id); return; }
    if (action === 'rename') { setRenamingId(row.id); return; }
    if (action === 'remove') {
      // The remove popover opens beside whatever asked for it: the details button, or otherwise the row's More button.
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest('.detail-links button') : null;
      const rowElement = document.querySelector(`[data-row-key="${CSS.escape(row.id)}"]`);
      const rect = (focused || rowElement?.querySelector('.more-action') || rowElement)?.getBoundingClientRect();
      const height = row.state === 'missing' ? 98 : 160;
      const above = !!rect && !!focused && rect.top - height - 10 > 56;
      const left = rect ? Math.max(8, Math.min(window.innerWidth - 288, rect.right - 280)) : 0;
      setConfirmPlace(rect ? { left, top: above ? rect.top - height - 10 : Math.min(window.innerHeight - height - 52, rect.bottom + 8), above, caret: Math.max(16, Math.min(264, rect.left + rect.width / 2 - left)) } : null);
      setConfirm({ row, mode: 'remove' });
      return;
    }
    if (action === 'cancel') { if (row.state !== 'problem' && row.progress > 50) setConfirm({ row, mode: 'cancel' }); else cancelRow(row); return; }
    if (action === 'open-page' && row.problem?.code === 'expired') setPageOpened((current) => new Set(current).add(row.id));
    run(row.id, async () => {
      const jobId = row.jobId || row.id;
      if (gallery) {
        if (action === 'pause') mutateDemo(row, { queueStatus: 'paused' });
        else if (['resume', 'retry', 'start'].includes(action)) mutateDemo(row, { queueStatus: 'downloading', status: 'downloading', error: null });
        else if (action === 'locate') mutateDemo(row, { missing: false });
        else if (action === 'choose-folder') openSettings('downloads');
        else if (action === 'play') { const url = await loadGalleryVideo(row); if (url) setGalleryVideo({ title: row.title, url }); }
        else if (action === 'copy-link' || action === 'copy-link-inline') { await navigator.clipboard.writeText(row.source.url || 'https://videos.example/'); if (action === 'copy-link') toast.success(ui.linkCopied); }
        return;
      }
      if (!api) throw new Error(ui.unavailable);
      if (action === 'pause') await api.pauseJob(jobId);
      if (action === 'resume') await api.resumeJob(jobId);
      if (action === 'retry') await api.retryJob(jobId);
      if (action === 'start') await api.startJob(jobId);
      if (action === 'play') { const result = await window.desktop.openHistoryFile(String(row.source.id)); if (!result.ok) throw new Error(result.error); }
      if (action === 'show-folder') { const result = await window.desktop.openHistoryFolder(row.isHistory ? String(row.source.id) : jobId); if (!result.ok) throw new Error(result.error); }
      if (action === 'locate') { const result = await window.desktop.locateHistoryFile(String(row.source.id)); if (!result.ok && !result.cancelled) throw new Error(result.error); }
      if (action === 'open-page') await openExternal(row.source.sourcePageUrl || row.source.url || row.source.mediaUrl);
      if (action === 'copy-link' || action === 'copy-link-inline') { await navigator.clipboard.writeText(row.source.url || row.source.sourcePageUrl); if (action === 'copy-link') toast.success(ui.linkCopied); }
      if (action === 'choose-folder') { const result = await window.desktop.chooseOutputDirectory(); if (result.ok && result.path) await save({ outputDirectory: result.path }); else if (!result.cancelled) throw new Error(result.error); }
      if (action === 'move-up' || action === 'move-down') {
        const index = library.queue.queue.findIndex((job) => job.id === jobId);
        await api.moveJob(jobId, Math.max(0, Math.min(library.queue.queue.length - 1, index + (action === 'move-up' ? -1 : 1))));
      }
    });
  };
  const rename = async (row: RowModel, title: string | null) => {
    if (title === null || !title.trim() || title.trim() === row.title) { setRenamingId(null); return; }
    const success = await run(row.id, async () => { if (gallery) mutateDemo(row, { title: title.trim() }); else await api?.renameJob(row.jobId || row.id, title.trim()); });
    if (success) setRenamingId(null);
  };
  const selectionFor = (inspection?: MediaInspection): MediaSelection => {
    const wanted = settings.preferredQuality === 'best' ? Infinity : Number(settings.preferredQuality);
    // Prefer renditions the page's player loaded; some CDNs publish dead ones.
    const variant = defaultVariant(inspection?.variants || [], settings.preferredQuality, { atMost: true });
    const subtitleLang = inspection?.mediaType === 'hls'
      && !(inspection.subtitles || []).some(track => (track.language || track.name) === settings.subtitleLanguage)
      ? 'none' : settings.subtitleLanguage;
    return { ...(variant ? { variantUrl: variant.url, height: variant.height } : Number.isFinite(wanted) ? { height: wanted } : {}), subtitleLang };
  };
  // Also the drop-to-snag path: a dropped link is submitted exactly as if it had been pasted.
  const submitPaste = async (text: string = paste): Promise<DropResult> => {
    if (checking) return 'busy';
    if (!text.trim()) return 'error';
    if (gallery) { setPaste(''); return 'added'; }
    if (!api) { setPasteError(ui.unavailable); return 'error'; }
    const urls = text.split(/\s+/).filter(Boolean);
    try { for (const value of urls) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } }
    catch { setPasteError('Paste a complete video link beginning with https://'); return 'error'; }
    setChecking(true); setPasteError(''); setPending(null);
    const failed: string[] = [];
    for (const url of urls) {
      try {
        const inspection = await api.inspectMedia(url);
        if (inspection.isDrm || inspection.isLive) throw new Error('This video is unsupported');
        if (urls.length === 1 && ((inspection.variants?.length || 0) > 1 || inspection.subtitles?.length || (inspection.audio?.length || 0) > 1)) {
          setPending({ url, inspection, selection: selectionFor(inspection) }); setChecking(false); return 'picker';
        }
        await api.createJob(url, selectionFor(inspection), inspection);
      } catch (err) { failed.push(url); setPasteError(err instanceof MediaInspectionError ? err.message : classifyProblem(err instanceof Error ? err.message : err, { folder }).message); }
    }
    setPaste(failed.join('\n')); setChecking(false); setFilter('all'); await library.refresh();
    return failed.length ? 'error' : 'added';
  };
  const paletteActions: PaletteActions = {
    pasteLink: () => pasteRef.current?.focus(),
    clipboardLink: async () => {
      const text = await navigator.clipboard.readText().then((value) => value.trim(), () => '');
      pasteRef.current?.focus();
      if (/^https?:\/\//i.test(text)) { setPaste(text); void submitPaste(text); } else toast(ui.paletteClipboardEmpty);
    },
    snagLink: (url) => { setPaste(url); void submitPaste(url); },
    pauseAll: () => { void run('all', async () => { if (api) await api.pauseAll(); }); },
    resumeAll: () => { void run('all', async () => { if (api) await api.startAll(); }); },
    openFolder: () => { void run('folder', async () => { if (!gallery) { const result = await window.desktop.openSaveFolder(); if (!result.ok) throw new Error(result.error); } }); },
    focusSearch: () => { setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); },
    filter, setFilter, savedView, setSavedView, openSettings,
    jumpTo: (row) => {
      const saved = ['saved', 'missing'].includes(row.state);
      if (filter !== 'all' && (filter === 'saved') !== saved) setFilter('all');
      // Wait for the filter to render, then bring the row (or shelf tile) into view with focus.
      requestAnimationFrame(() => requestAnimationFrame(() => { const element = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(row.id)}"]`); element?.scrollIntoView({ block: 'nearest' }); element?.focus(); }));
    },
  };
  // Hover-to-hear: the bridge cuts a short excerpt with the saved request context.
  const loadSample: AudioSampleLoader | undefined = gallery
    ? async (track) => {
      const url = await loadGalleryVideo(galleryRows[(track.ordinal - 1) % galleryRows.length]);
      if (!url) throw new Error('Sample unavailable');
      return { url, startFraction: 0.25 };
    }
    : api && pending ? async (track, signal) => {
      const rendition = track.renditions.find((item) => item.url) || track.renditions[0];
      const blob = await api.audioSample({
        mediaUrl: pending.inspection.mediaUrl || pending.url, renditionUrl: rendition?.url || undefined,
        streamIndex: rendition?.url ? undefined : rendition?.streamIndex, durationSeconds: pending.inspection.durationSeconds,
        headers: pending.inspection.headers,
      }, signal);
      const url = URL.createObjectURL(blob);
      return { url, release: () => URL.revokeObjectURL(url) };
    } : undefined;
  const finishSelection = async (selection: MediaSelection) => {
    if (gallery) { setPending(null); return; }
    // A second Enter can arrive before `checking` re-renders the picker as busy.
    if (!pending || !api || creatingJob.current) return;
    creatingJob.current = true;
    setChecking(true);
    try { await api.createJob(pending.url, selection, pending.inspection); setPending(null); setPaste(''); setFilter('all'); await library.refresh(); }
    catch (err) { setPasteError(classifyProblem(err instanceof Error ? err.message : err, { folder }).message); }
    finally { creatingJob.current = false; setChecking(false); }
  };
  // Development gallery only: exercises the window-level error boundary.
  if (gallery && params.has('crash')) throw new Error('Gallery render failure at https://viewer:secret@example.com/video.m3u8?token=private');
  return (
    <div className="workbench" data-gallery={gallery || undefined}>
      <h1 className="sr-only">SnagThis</h1>
      <TopBar brandRef={brandRef} pasteRef={pasteRef} searchRef={searchRef} value={paste} onValue={setPaste} onSubmit={() => { void submitPaste(); }} filter={filter} onFilter={setFilter} showNavigation={!emptyLibrary || filter !== 'all'} searchOpen={searchOpen} onSearchOpen={setSearchOpen} search={search} onSearch={setSearch} checking={checking} error={pasteError} firstLaunch={firstLaunch} gallery={gallery} savedDot={savedDot}
        viewToggle={filter === 'saved' && !emptyLibrary ? <SavedViewToggle view={savedView} onView={setSavedView} /> : undefined}
        updateChip={chipKind ? <UpdateChip updater={updater} kind={chipKind} onOpen={() => setUpdateOpen(true)} /> : undefined} />
      <StartupLogo targetRef={brandRef} />
      <SnagMoment rows={baseRows} onQuietCompletion={() => { if (filter !== 'saved') setSavedDot(true); }} />
      <DropOverlay disabled={modalOpen || paletteOpen}onDropLinks={(text) => { setPaste(text); return submitPaste(text); }} />
      {pending && <QualityPicker key={pending.url} apiBase={gallery ? window.location.origin : apiBase} inspection={pending.inspection} initial={pending.selection} onDownload={finishSelection} onCancel={() => setPending(null)} busy={checking} loadSample={loadSample} />}
      {failure && <div className="connection-banner" role="alert"><span>{ui.unavailable}</span><button className="row-action labelled" onClick={() => { initialize(); library.refresh(); }}>{ui.tryAgain}</button><button className="row-action" onClick={() => openSettings('about')}>{ui.settings}</button></div>}
      <main className="workbench-content" data-view-fade={viewFade || undefined}>
        {!ready && !failure ? <div className="skeleton-list" role="status"><span className="sr-only">{ui.startup}</span>{[0, 1, 2].map((index) => <div key={index} className="skeleton-row" aria-hidden="true"><i /><div><span /><span /></div></div>)}</div> : rows.length ? filter === 'saved' && savedView === 'shelf' ? <SavedShelf rows={rows} apiBase={gallery ? window.location.origin : apiBase} busyIds={busyIds} hasMore={!gallery && library.hasMore} loadingMore={library.loadingMore} onLoadMore={library.loadMore} onRequestPreview={requestThumbnailPreview}
          onCommand={(row, action) => { if (action === 'details') { setSavedView('list'); setExpandedId(row.id); } else command(row, action); }} /> : <VideoList rows={rows} motionScope={`${filter}\n${query}`} apiBase={gallery ? window.location.origin : apiBase} folder={folder} expandedId={expandedId} renamingId={renamingId} busyIds={busyIds} hasMore={!gallery && library.hasMore && filter !== 'downloading'} loadingMore={library.loadingMore} onLoadMore={library.loadMore} onToggle={(row) => setExpandedId(expandedId === row.id ? null : row.id)} onCommand={command} onRename={rename} onRequestPreview={requestThumbnailPreview}
          onRefreshLink={async (row, url) => { await run(row.id, async () => { if (gallery) mutateDemo(row, { queueStatus: 'downloading', error: null }); else await api?.refreshSource(row.jobId || row.id, url); }); }}
          onMoveTo={(sourceId, targetId) => { if (gallery) { setDemoRows((current) => { const moving = current.find((row) => row.id === sourceId); const target = current.findIndex((row) => row.id === targetId); if (!moving || target < 0) return current; const next = current.filter((row) => row !== moving); next.splice(target, 0, moving); return next; }); return; } const index = library.queue.queue.findIndex((job) => job.id === targetId); if (index >= 0) run(sourceId, () => api!.moveJob(sourceId, index)); }} /> : firstLaunch ? <div className="first-download"><PixelMascot variant="first" /><h2>{ui.firstTitle}</h2><p>{ui.firstBody}</p>{!connectedOnce && <ChromeConnectCard variant="first" active={!modalOpen} gallery={gallery} demo={gallery ? params.get('pair') : null} onInstall={() => run('chrome', () => openExternal(chromeInstallUrl))} />}</div> : !failure && (query ? <p className="empty-note">{ui.noMatches}</p> : <div className="empty-state-quiet"><PixelMascot variant={filter === 'downloading' ? 'dozing' : 'shelf'} /><p className="empty-note">{filter === 'downloading' ? ui.nothingDownloading : ui.noSaved}</p></div>)}
      </main>
      <footer className="workbench-footer"><span className="footer-status">{active.length ? `${active.length} downloading${totalSpeed > 0 ? ` · ${formatBytesPerSecond(totalSpeed)}` : ''}` : `Saving to ${folder}`}</span>{!connectedOnce && !firstLaunch && <button className="footer-link" onClick={() => openSettings('chrome')}>{ui.connectChrome}</button>}<div className="footer-space" />
        <button className="footer-palette-hint" aria-label={`${ui.commands} (${paletteShortcut})`} onClick={() => setPaletteOpen(true)}><kbd aria-hidden="true">{paletteShortcut}</kbd><span aria-hidden="true">{ui.commands}</span></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button className={`row-action footer-more${active.length >= 2 ? ' pinned' : ''}`} aria-label="Download actions"><MoreHorizontal /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => run('all', async () => { if (api) await api.pauseAll(); })}>{ui.pauseAll}</DropdownMenuItem><DropdownMenuItem onSelect={() => run('all', async () => { if (api) await api.startAll(); })}>{ui.resumeAll}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <button className="row-action" aria-label={ui.saveFolder} title={ui.saveFolder} onClick={() => run('folder', async () => { if (!gallery) { const result = await window.desktop.openSaveFolder(); if (!result.ok) throw new Error(result.error); } })}><FolderOpen /></button>
        <button className="row-action" aria-label={ui.settings} title="Settings (⌘,)" onClick={() => setSettingsOpen(true)}><Settings /></button>
      </footer>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} section={settingsSection} onSectionChange={setSettingsSection} settings={settings} onSave={save} updater={updater} appInfo={appInfo} api={api} gallery={gallery}
        updateView={updateState} updateBlocking={updateBlocking.length} onOpenUpdate={(check) => { if (check) updateActions.check(); setUpdateOpen(true); }} />
      <UpdateSheet open={updateOpen} onOpenChange={setUpdateOpen} updater={updater} view={updateState} blocking={updateBlocking} autoCheck={settings.checkUpdatesOnStartup}
        currentVersion={appInfo?.version || 'development'} actions={updateActions} initialExpanded={galleryUpdate === 'notes'} />
      <PairingApproval onOpenChange={setPairingOpen} demo={gallery && params.get('pair') === 'dialog' ? galleryPairingRequest() : null} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={paletteActions} videos={baseRows} apiBase={gallery ? window.location.origin : apiBase} />
      <Dialog open={!!chromeSessionRow} onOpenChange={(open) => { if (!open && !(chromeSessionRow && busyIds.has(chromeSessionRow.id))) setChromeSessionRow(null); }}><DialogContent className="remove-dialog"><DialogTitle>{ui.chromeSessionTitle}</DialogTitle><DialogDescription>{ui.chromeSessionBody}</DialogDescription><p>{ui.chromeSessionHint}</p><div className="remove-options"><button className="row-action labelled primary-action" disabled={!!chromeSessionRow && busyIds.has(chromeSessionRow.id)} onClick={async () => {
        if (!chromeSessionRow) return;
        const row = chromeSessionRow;
        const success = await run(row.id, async () => {
          if (gallery) mutateDemo(row, { queueStatus: 'downloading', status: 'downloading', error: null });
          else if (api) await api.useChromeSession(row.jobId || row.id);
          else throw new Error(ui.unavailable);
        });
        if (success) setChromeSessionRow(null);
      }}>{ui.useChromeSession}</button><button className="row-action" disabled={!!chromeSessionRow && busyIds.has(chromeSessionRow.id)} onClick={() => setChromeSessionRow(null)}>{ui.cancel}</button></div></DialogContent></Dialog>
      {gallery && <Dialog open={!!galleryVideo} onOpenChange={(open) => { if (!open) setGalleryVideo(null); }}><DialogContent className="gallery-video-dialog"><DialogTitle>{galleryVideo?.title}</DialogTitle><DialogDescription className="sr-only">{ui.galleryVideoDescription}</DialogDescription>{galleryVideo && <video src={galleryVideo.url} controls autoPlay playsInline preload="metadata" aria-label={galleryVideo.title} />}</DialogContent></Dialog>}
      <Dialog open={!!confirm} onOpenChange={(open) => { if (!open && !confirmBusy) setConfirm(null); }}>{confirm?.mode === 'remove'
        ? <DialogContent className={`remove-popover translate-x-0 translate-y-0${confirmPlace?.above ? ' above' : ''}`} showCloseButton={false} style={confirmPlace ? { left: confirmPlace.left, top: confirmPlace.top, '--caret-x': `${confirmPlace.caret}px` } as React.CSSProperties : undefined}><DialogTitle>{ui.removeTitle}</DialogTitle><DialogDescription>{ui.removeBody} {confirm.row.title}</DialogDescription>
          <div className="remove-popover-title" title={confirm.row.title} aria-hidden="true">{confirm.row.title}</div>
          <button className="remove-choice" autoFocus disabled={confirmBusy} onClick={() => removeRow('list')}><ListX aria-hidden="true" /><span><strong>{ui.removeList}</strong><small>{ui.keepFile}</small></span></button>
          {confirm.row.state !== 'missing' && <><hr /><button className="remove-choice destructive-text" disabled={confirmBusy} onClick={() => removeRow('trash')}><Trash2 aria-hidden="true" /><span><strong>{ui.trash}</strong><small>{ui.trashAlso}</small></span></button></>}
        </DialogContent>
        : <DialogContent className="remove-dialog"><DialogTitle>{ui.cancelTitle}</DialogTitle><DialogDescription>{ui.cancelBody}</DialogDescription><p className="dialog-video-title">{confirm?.row.title}</p><button className="row-action labelled destructive-text" disabled={confirmBusy} onClick={() => confirm && cancelRow(confirm.row)}>{ui.cancelDownload}</button><button className="row-action" disabled={confirmBusy} onClick={() => setConfirm(null)}>{ui.cancel}</button></DialogContent>}</Dialog>
    </div>
  );
}

export default App;
