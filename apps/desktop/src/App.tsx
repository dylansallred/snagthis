import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, MoreHorizontal, Settings, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { classifyProblem, toRowModel, type RowModel } from '@m3u8/contracts/src/rows.mjs';
import { useAppInit } from '@/hooks/useAppInit';
import { useLibrary } from '@/hooks/useLibrary';
import { createApiClient, type MediaInspection, type MediaSelection } from '@/lib/api';
import { formatBytesPerSecond } from '@/lib/utils';
import { toWebSocketUrl } from '@/lib/network';
import { ui } from '@/lib/strings';
import { TopBar, type ListFilter } from '@/components/layout/TopBar';
import { QualityPicker } from '@/components/layout/QualityPicker';
import { VideoList } from '@/components/list/VideoList';
import type { RowCommand } from '@/components/list/RowDetails';
import { SettingsSheet } from '@/components/settings/SettingsSheet';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { galleryRows, galleryQueue, loadGalleryVideo } from '@/dev/gallery';

const params = new URLSearchParams(window.location.search);
const gallery = import.meta.env.DEV && params.has('gallery');
const emptyGallery = gallery && params.get('gallery') === 'empty';
const chromeInstallUrl = 'https://github.com/dylansallred/vidsnag#run-locally';
const editable = (target: EventTarget | null) => target instanceof HTMLElement && (!!target.closest('input,textarea,select,[contenteditable="true"]') || target.isContentEditable);

function App() {
  const { appInfo, settings, saveSettings, updater, error: startupError, initialize } = useAppInit(gallery);
  const [demoRows, setDemoRows] = useState(emptyGallery ? [] : params.get('gallery') === 'states' ? galleryRows : galleryRows.filter((row) => !['paused', 'missing'].includes(row.id)));
  const [filter, setFilter] = useState<ListFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [paste, setPaste] = useState('');
  const [checking, setChecking] = useState(false);
  const [pasteError, setPasteError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(gallery && params.get('sheet') === 'settings');
  const [expandedId, setExpandedId] = useState<string | null>(gallery && params.get('details') ? 'downloading' : null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: RowModel; mode: 'cancel' | 'remove' } | null>(null);
  const [pending, setPending] = useState<{ url: string; inspection: MediaInspection; selection: MediaSelection } | null>(null);
  const [galleryVideo, setGalleryVideo] = useState<{ title: string; url: string } | null>(null);
  const [chromeSessionRow, setChromeSessionRow] = useState<RowModel | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
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
  const folder = settings.outputDirectory || 'Downloads/VidSnag';
  const baseRows = gallery ? demoRows.filter((row) => row.title.toLowerCase().includes(query.toLowerCase())) : library.rows;
  const rows = baseRows.filter((row) => filter === 'all' || (filter === 'saved' ? ['saved', 'missing'].includes(row.state) : !['saved', 'missing'].includes(row.state))).map((row) => {
    if (row.id !== expandedId || !detail || detail.id !== row.jobId) return row;
    return toRowModel({ ...row.source, ...detail, progress: row.source.progress, queueStatus: row.source.queueStatus, status: row.source.status }, { surface: 'desktop', folder }) || row;
  });
  const allQueue = gallery ? galleryQueue : library.queue.queue;
  const active = allQueue.filter((job) => job.queueStatus === 'downloading' && !/finaliz|convert|remux/.test(job.status));
  const totalSpeed = active.reduce((total, job) => total + (job.speedBps || 0), 0);
  const ready = gallery || (!!api && !library.loading);
  const failure = startupError || appInfo?.apiStartupError || (!gallery && library.error) || '';
  const firstLaunch = ready && !failure && baseRows.length === 0 && !query && filter === 'all';

  useEffect(() => { const timer = setTimeout(() => setQuery(search), 180); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => { if (!pasteError) return; const timer = setTimeout(() => setPasteError(''), 5000); return () => clearTimeout(timer); }, [pasteError]);
  useEffect(() => {
    if (gallery || !window.desktop) return;
    return window.desktop.onOpenSettings(() => setSettingsOpen(true));
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); searchRef.current?.focus(); }
      if (mod && event.key === ',') { event.preventDefault(); setSettingsOpen(true); }
      if (event.key === 'Escape' && !editable(event.target)) { setExpandedId(null); setPending(null); }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target) || settingsOpen || confirm) return;
      const value = event.clipboardData?.getData('text/plain')?.trim();
      if (value && /^https?:\/\//i.test(value)) { event.preventDefault(); setPaste(value); pasteRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown); document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('paste', onPaste); };
  }, [settingsOpen, confirm]);
  useEffect(() => {
    setDetail(null);
    if (!api || !expandedJobId) return;
    let stopped = false;
    api.getJob(expandedJobId).then((job) => { if (!stopped) setDetail(job as unknown as Record<string, unknown>); }).catch(() => {});
    const socket = new WebSocket(toWebSocketUrl(api.baseUrl), ['vidsnag', `vidsnag-auth.${api.authToken}`]);
    socket.onopen = () => { if (stopped) socket.close(); else socket.send(JSON.stringify({ type: 'subscribe', jobId: expandedJobId })); };
    socket.onmessage = (event) => { try { const payload = JSON.parse(event.data); if (payload.type === 'job:update' && payload.data?.id === expandedJobId && !stopped) setDetail(payload.data); } catch {} };
    return () => { stopped = true; if (socket.readyState === WebSocket.OPEN) socket.close(); };
  }, [api, expandedJobId]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return false;
    setBusyId(id);
    try { await action(); if (api) await library.refresh(); return true; }
    catch (err) { toast.error(err instanceof Error ? err.message : ui.downloadingError); return false; }
    finally { setBusyId(null); }
  };
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
    if (action === 'remove') { setConfirm({ row, mode: 'remove' }); return; }
    if (action === 'cancel') { if (row.state !== 'problem' && row.progress > 50) setConfirm({ row, mode: 'cancel' }); else cancelRow(row); return; }
    run(row.id, async () => {
      const jobId = row.jobId || row.id;
      if (gallery) {
        if (action === 'pause') mutateDemo(row, { queueStatus: 'paused' });
        else if (['resume', 'retry', 'start'].includes(action)) mutateDemo(row, { queueStatus: 'downloading', status: 'downloading', error: null });
        else if (action === 'locate') mutateDemo(row, { missing: false });
        else if (action === 'choose-folder') setSettingsOpen(true);
        else if (action === 'play') { const url = await loadGalleryVideo(row); if (url) setGalleryVideo({ title: row.title, url }); }
        else if (action === 'copy-link') { await navigator.clipboard.writeText(row.source.url || 'https://studio.blender.org/films/'); toast.success(ui.linkCopied); }
        return;
      }
      if (!api) throw new Error(ui.unavailable);
      if (action === 'pause') await api.pauseJob(jobId);
      if (action === 'resume') await api.resumeJob(jobId);
      if (action === 'retry') await api.retryJob(jobId);
      if (action === 'start') await api.startJob(jobId);
      if (action === 'play') { const result = await window.desktop.openHistoryFile(String(row.source.id)); if (!result.ok) throw new Error(result.error); }
      if (action === 'show-folder') { const result = await window.desktop.openHistoryFolder(String(row.source.id)); if (!result.ok) throw new Error(result.error); }
      if (action === 'locate') { const result = await window.desktop.locateHistoryFile(String(row.source.id)); if (!result.ok && !result.cancelled) throw new Error(result.error); }
      if (action === 'open-page') await openExternal(row.source.sourcePageUrl || row.source.url || row.source.mediaUrl);
      if (action === 'copy-link') { await navigator.clipboard.writeText(row.source.url || row.source.sourcePageUrl); toast.success(ui.linkCopied); }
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
    const variants = [...(inspection?.variants || [])].sort((a, b) => (b.height || 0) - (a.height || 0));
    const wanted = settings.preferredQuality === 'best' ? Infinity : Number(settings.preferredQuality);
    const variant = variants.find((item) => (item.height || 0) <= wanted) || variants[variants.length - 1];
    return { ...(variant ? { variantUrl: variant.url, height: variant.height } : Number.isFinite(wanted) ? { height: wanted } : {}), subtitleLang: settings.subtitleLanguage };
  };
  const submitPaste = async () => {
    if (checking || !paste.trim()) return;
    if (gallery) { setPaste(''); return; }
    if (!api) { setPasteError(ui.unavailable); return; }
    const urls = paste.split(/\s+/).filter(Boolean);
    try { for (const value of urls) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } }
    catch { setPasteError('Paste a complete video link beginning with https://'); return; }
    setChecking(true); setPasteError(''); setPending(null);
    const failed: string[] = [];
    for (const url of urls) {
      try {
        const inspection = await api.inspectMedia(url);
        if (inspection.isDrm || inspection.isLive) throw new Error('This video is unsupported');
        if (urls.length === 1 && ((inspection.variants?.length || 0) > 1 || inspection.subtitles?.length || (inspection.audio?.length || 0) > 1)) {
          setPending({ url, inspection, selection: selectionFor(inspection) }); setChecking(false); return;
        }
        await api.createJob(url, selectionFor(inspection), inspection.mediaType);
      } catch (err) { failed.push(url); setPasteError(classifyProblem(err instanceof Error ? err.message : err, { folder }).message); }
    }
    setPaste(failed.join('\n')); setChecking(false); setFilter('all'); await library.refresh();
  };
  const finishSelection = async (selection: MediaSelection) => {
    if (!pending || !api) return;
    setChecking(true);
    try { await api.createJob(pending.url, selection, pending.inspection.mediaType); setPending(null); setPaste(''); setFilter('all'); await library.refresh(); }
    catch (err) { setPasteError(classifyProblem(err instanceof Error ? err.message : err, { folder }).message); }
    finally { setChecking(false); }
  };
  return (
    <div className="workbench" data-gallery={gallery || undefined}>
      <h1 className="sr-only">VidSnag</h1>
      <TopBar pasteRef={pasteRef} searchRef={searchRef} value={paste} onValue={setPaste} onSubmit={submitPaste} filter={filter} onFilter={setFilter} searchOpen={searchOpen} onSearchOpen={setSearchOpen} search={search} onSearch={setSearch} checking={checking} error={pasteError} firstLaunch={firstLaunch} nativeMac={!gallery && /Mac/.test(navigator.platform)} gallery={gallery} />
      {pending && <QualityPicker key={pending.url} inspection={pending.inspection} initial={pending.selection} onDownload={finishSelection} onCancel={() => setPending(null)} busy={checking} />}
      {failure && <div className="connection-banner" role="alert"><span>{ui.unavailable}</span><button className="row-action labelled" onClick={() => { initialize(); library.refresh(); }}>{ui.tryAgain}</button><button className="row-action" onClick={() => setSettingsOpen(true)}>{ui.settings}</button></div>}
      <main className="workbench-content">
        {!ready && !failure ? <div className="empty-note"><LoaderCircle className="spin" />{ui.startup}</div> : rows.length ? <VideoList rows={rows} apiBase={gallery ? window.location.origin : apiBase} folder={folder} expandedId={expandedId} renamingId={renamingId} busyId={busyId} hasMore={!gallery && library.hasMore && filter !== 'downloading'} loadingMore={library.loadingMore} onLoadMore={library.loadMore} onToggle={(row) => setExpandedId(expandedId === row.id ? null : row.id)} onCommand={command} onRename={rename} onRequestPreview={requestThumbnailPreview}
          onRefreshLink={async (row, url) => { await run(row.id, async () => { if (gallery) mutateDemo(row, { queueStatus: 'downloading', error: null }); else await api?.refreshSource(row.jobId || row.id, url); }); }}
          onMoveTo={(sourceId, targetId) => { if (gallery) return; const index = library.queue.queue.findIndex((job) => job.id === targetId); if (index >= 0) run(sourceId, () => api!.moveJob(sourceId, index)); }} /> : firstLaunch ? <div className="first-download"><div className="empty-icon"><Download /></div><h2>{ui.firstTitle}</h2><p>{ui.firstBody}</p>{!connectedOnce && <button className="row-action primary-action" onClick={() => run('chrome', () => openExternal(chromeInstallUrl))}>{ui.addChrome}</button>}</div> : !failure && <p className="empty-note">{query ? ui.noMatches : filter === 'downloading' ? ui.nothingDownloading : ui.noSaved}</p>}
      </main>
      <footer className="workbench-footer"><span className="footer-status">{active.length ? `${active.length} downloading${totalSpeed > 0 ? ` · ${formatBytesPerSecond(totalSpeed)}` : ''}` : `Saving to ${folder}`}</span>{!connectedOnce && !firstLaunch && <button className="footer-link" onClick={() => run('chrome', () => openExternal(chromeInstallUrl))}>{ui.addChrome}</button>}<div className="footer-space" />
        <DropdownMenu><DropdownMenuTrigger asChild><button className="row-action footer-more" aria-label="Download actions"><MoreHorizontal /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => run('all', async () => { if (api) await api.pauseAll(); })}>{ui.pauseAll}</DropdownMenuItem><DropdownMenuItem onSelect={() => run('all', async () => { if (api) await api.startAll(); })}>{ui.resumeAll}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <button className="row-action" aria-label={ui.saveFolder} title={ui.saveFolder} onClick={() => run('folder', async () => { if (!gallery) { const result = await window.desktop.openSaveFolder(); if (!result.ok) throw new Error(result.error); } })}><FolderOpen /></button>
        <button className="row-action" aria-label={ui.settings} title="Settings (⌘,)" onClick={() => setSettingsOpen(true)}><Settings /></button>
      </footer>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onSave={save} updater={updater} appInfo={appInfo} api={api} gallery={gallery} />
      <Dialog open={!!chromeSessionRow} onOpenChange={(open) => { if (!open && !busyId) setChromeSessionRow(null); }}><DialogContent className="remove-dialog"><DialogTitle>{ui.chromeSessionTitle}</DialogTitle><DialogDescription>{ui.chromeSessionBody}</DialogDescription><p>{ui.chromeSessionHint}</p><div className="remove-options"><button className="row-action labelled primary-action" disabled={!!busyId} onClick={async () => {
        if (!chromeSessionRow) return;
        const row = chromeSessionRow;
        const success = await run(row.id, async () => {
          if (gallery) mutateDemo(row, { queueStatus: 'downloading', status: 'downloading', error: null });
          else if (api) await api.useChromeSession(row.jobId || row.id);
          else throw new Error(ui.unavailable);
        });
        if (success) setChromeSessionRow(null);
      }}>{ui.useChromeSession}</button><button className="row-action" disabled={!!busyId} onClick={() => setChromeSessionRow(null)}>{ui.cancel}</button></div></DialogContent></Dialog>
      {gallery && <Dialog open={!!galleryVideo} onOpenChange={(open) => { if (!open) setGalleryVideo(null); }}><DialogContent className="gallery-video-dialog"><DialogTitle>{galleryVideo?.title}</DialogTitle><DialogDescription className="sr-only">{ui.galleryVideoDescription}</DialogDescription>{galleryVideo && <video src={galleryVideo.url} controls autoPlay playsInline preload="metadata" aria-label={galleryVideo.title} />}</DialogContent></Dialog>}
      <Dialog open={!!confirm} onOpenChange={(open) => { if (!open && !busyId) setConfirm(null); }}><DialogContent className="remove-dialog"><DialogTitle>{confirm?.mode === 'remove' ? ui.removeTitle : ui.cancelTitle}</DialogTitle><DialogDescription>{confirm?.mode === 'remove' ? ui.removeBody : ui.cancelBody}</DialogDescription><p className="dialog-video-title">{confirm?.row.title}</p>{confirm?.mode === 'remove' ? <div className="remove-options"><button className="remove-choice" autoFocus disabled={!!busyId} onClick={() => removeRow('list')}><strong>{ui.removeList}</strong><small>{ui.keepFile}</small></button>{confirm.row.state !== 'missing' && <button className="row-action labelled destructive-text" disabled={!!busyId} onClick={() => removeRow('trash')}>{ui.trash}</button>}</div> : <button className="row-action labelled destructive-text" disabled={!!busyId} onClick={() => confirm && cancelRow(confirm.row)}>{ui.cancelDownload}</button>}<button className="row-action" disabled={!!busyId} onClick={() => setConfirm(null)}>{ui.cancel}</button></DialogContent></Dialog>
    </div>
  );
}

export default App;
