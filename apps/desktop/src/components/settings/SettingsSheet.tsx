import { useEffect, useState } from 'react';
import { ChevronRight, Eye, EyeOff, LoaderCircle, X, FolderOpen, MonitorPlay, Captions, Bell, Power, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { DesktopSettings } from '@/types/settings';
import type { AppInfo } from '@/types/desktop-bridge';
import type { UpdaterState } from '@/types/updater';
import type { ApiClient } from '@/lib/api';
import { ui } from '@/lib/strings';
import { buildSiteReportUrl } from '@/lib/siteReport';

const languages = [['none', 'None'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']];
export function SettingsSheet({ open, onOpenChange, settings, onSave, updater, appInfo, api, gallery }: {
  open: boolean; onOpenChange: (open: boolean) => void; settings: DesktopSettings; onSave: (next: Partial<DesktopSettings>) => Promise<void>;
  updater: UpdaterState; appInfo: AppInfo | null; api: ApiClient | null; gallery: boolean;
}) {
  const [busy, setBusy] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairingNow, setPairingNow] = useState(Date.now);
  const [codeCopied, setCodeCopied] = useState(false);
  const pairingSeconds = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - pairingNow) / 1000)) : 0;
  useEffect(() => {
    if (!open || !pairing) return;
    setPairingNow(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now(); setPairingNow(now);
      if (now >= pairing.expiresAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, pairing]);
  useEffect(() => { if (appInfo?.extensionConnected) setPairing(null); }, [appInfo?.extensionConnected]);
  const run = async (name: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name);
    try { await action(); } catch (err) { toast.error(err instanceof Error ? err.message : ui.downloadingError); }
    finally { setBusy(''); }
  };
  const save = (patch: Partial<DesktopSettings>) => { run('settings', () => onSave(patch)); };
  const showPairing = () => run('pairing', async () => {
    const next = gallery ? { code: '483921', expiresAt: Date.now() + 300000 } : await window.desktop.getPairingInfo();
    setPairingNow(Date.now()); setCodeCopied(false); setPairing(next);
  });
  const chooseFolder = () => run('folder', async () => {
    if (gallery) return onSave({ outputDirectory: '~/Movies/VidSnag' });
    const result = await window.desktop.chooseOutputDirectory();
    if (result.cancelled) return;
    if (!result.ok || !result.path) throw new Error(result.error || 'Could not select this folder');
    await onSave({ outputDirectory: result.path });
  });
  const diagnostics = async (copyOnly = false) => {
    const data = gallery ? { app: 'VidSnag', mode: 'design gallery', credentials: '[redacted]' } : await api?.getDiagnostics();
    if (copyOnly) { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); toast.success('Diagnostics copied'); return; }
    if (gallery) { toast.success('Support bundle preview ready'); return; }
    const result = await window.desktop.exportSupportBundle(data);
    if (!result.ok) throw new Error(result.error || 'Could not export the support bundle');
    toast.success('Support bundle saved');
  };
  const notes = Array.isArray(updater.releaseNotes) ? updater.releaseNotes : updater.releaseNotes ? [updater.releaseNotes] : [];
  const reportSite = async () => {
    if (gallery) { toast(ui.reportPreview); return; }
    const data = await api?.getDiagnostics().catch(() => null);
    const result = await window.desktop.openExternal(buildSiteReportUrl(data || null, appInfo?.version));
    if (!result.ok) throw new Error(result.error || ui.reportOpenError);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="settings-sheet" showCloseButton={false}>
      <div className="sheet-heading"><DialogTitle>{ui.settings}</DialogTitle><button className="row-action" aria-label={ui.closeSettings} onClick={() => onOpenChange(false)}><X /></button></div>
      <DialogDescription className="sr-only">Choose how VidSnag saves your videos.</DialogDescription>
      <div className="sheet-scroll">
        <h3 className="settings-group-title">{ui.chrome}</h3>
        <section className="settings-group pairing-settings" aria-label="Chrome extension setup">
          <p role="status">{appInfo?.extensionConnected && !pairing ? 'Chrome is connected. Keep VidSnag open while downloading.' : 'Connect the extension once to send videos from Chrome to this app.'}</p>
          {(!appInfo?.extensionConnected || pairing) && <ol className="pairing-steps"><li>Show a code here and copy it.</li><li>In Chrome, click Extensions (the puzzle icon) → VidSnag → Connect.</li><li>Paste the code there and choose Connect.</li></ol>}
          {pairing && pairingSeconds > 0 ? <div className="pairing-code"><label htmlFor="chrome-connection-code">{ui.pairingHelp}</label><div className="pairing-code-actions"><output id="chrome-connection-code" aria-label="Connection code">{pairing.code}</output><button className="row-action labelled" disabled={!!busy} onClick={() => run('copy-code', async () => { await navigator.clipboard.writeText(pairing.code); setCodeCopied(true); })}>{codeCopied ? 'Copied' : 'Copy code'}</button></div><small>Expires in {Math.floor(pairingSeconds / 60)}:{String(pairingSeconds % 60).padStart(2, '0')}. Keep VidSnag open.</small></div>
            : <>{pairing && <p className="tone-attention" role="status">This code expired. Get a new code and try again.</p>}<button className="row-action labelled" disabled={!!busy || (!gallery && appInfo?.apiStartupState !== 'ready')} onClick={showPairing}>{busy === 'pairing' ? 'Getting code…' : pairing ? 'Get a new code' : appInfo?.extensionConnected ? 'Connect another browser' : 'Show connection code'}</button></>}
          {!appInfo?.extensionConnected && <button className="detail-refresh pairing-install" onClick={() => run('install-extension', async () => { if (!gallery) await window.desktop.openExternal('https://github.com/dylansallred/vidsnag#run-locally'); })}>Need the extension? Add to Chrome</button>}
        </section>
        <h3 className="settings-group-title">{ui.groupDownloads}</h3>
        <div className="settings-group">
        <div className="preference-row"><span className="setting-icon warm" aria-hidden="true"><FolderOpen /></span><div><label>{ui.saveVideosTo}</label><small title={settings.outputDirectory}>{settings.outputDirectory || 'Downloads/VidSnag'}</small></div><button className="row-action labelled" disabled={busy === 'folder'} onClick={chooseFolder}>{busy === 'folder' ? <LoaderCircle className="spin" /> : ui.change}</button></div>
        <div className="preference-row"><span className="setting-icon" aria-hidden="true"><MonitorPlay /></span><label htmlFor="preferred-quality">{ui.preferredQuality}</label><select id="preferred-quality" value={settings.preferredQuality} onChange={(event) => save({ preferredQuality: event.target.value as DesktopSettings['preferredQuality'] })}><option value="best">{ui.best}</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></div>
        <div className="preference-row"><span className="setting-icon" aria-hidden="true"><Captions /></span><label htmlFor="subtitle-language">{ui.subtitles}</label><select id="subtitle-language" value={settings.subtitleLanguage} onChange={(event) => save({ subtitleLanguage: event.target.value })}>{languages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
        </div>
        <h3 className="settings-group-title">{ui.groupApp}</h3>
        <div className="settings-group">
        <div className="preference-row"><span className="setting-icon" aria-hidden="true"><Bell /></span><label htmlFor="notify-complete">{ui.notify}</label><Switch id="notify-complete" checked={settings.notifyOnComplete} onCheckedChange={(value) => save({ notifyOnComplete: value })} /></div>
        <div className="preference-row"><span className="setting-icon" aria-hidden="true"><Power /></span><label htmlFor="launch-login">{ui.login}</label><Switch id="launch-login" checked={settings.launchAtLogin} onCheckedChange={(value) => save({ launchAtLogin: value })} /></div>
        </div>
        <h3 className="settings-group-title">{ui.groupMore}</h3>
        <details className="advanced-settings settings-group">
          <summary><span className="setting-icon" aria-hidden="true"><SlidersHorizontal /></span><span>{ui.advanced}</span><small>{ui.advancedHint}</small><ChevronRight /></summary>
          <div className="preference-row"><label htmlFor="downloads-at-once">{ui.atOnce}</label><input id="downloads-at-once" type="number" min={1} max={16} defaultValue={settings.queueMaxConcurrent} onBlur={(event) => save({ queueMaxConcurrent: Math.max(1, Math.min(16, Number(event.target.value) || 1)) })} /></div>
          <div className="preference-row"><label htmlFor="download-connections">{ui.connections}</label><input id="download-connections" type="number" min={1} max={16} defaultValue={settings.downloadThreads} onBlur={(event) => save({ downloadThreads: Math.max(1, Math.min(16, Number(event.target.value) || 1)) })} /></div>
          <div className="preference-row"><label htmlFor="auto-start">{ui.autoStart}</label><Switch id="auto-start" checked={settings.queueAutoStart} onCheckedChange={(value) => save({ queueAutoStart: value })} /></div>
          <div className="preference-row"><label htmlFor="file-naming">{ui.naming}</label><select id="file-naming" value={settings.fileNaming} onChange={(event) => save({ fileNaming: event.target.value as DesktopSettings['fileNaming'] })}><option value="title">{ui.titleNaming}</option><option value="resource">{ui.resourceNaming}</option><option value="custom">{ui.customNaming}</option></select></div>
          {settings.fileNaming === 'custom' && <div className="preference-row stack"><label htmlFor="custom-filename">{ui.customFilename}</label><input id="custom-filename" defaultValue={settings.customFilename} onBlur={(event) => save({ customFilename: event.target.value })} /></div>}
          <div className="preference-row stack"><label htmlFor="tmdb-key">{ui.tmdbKey}</label><div className="key-field"><input id="tmdb-key" type={showKeys ? 'text' : 'password'} defaultValue={settings.tmdbApiKey || ''} autoComplete="off" spellCheck={false} onBlur={(event) => save({ tmdbApiKey: event.target.value })} /><button className="row-action" aria-label={showKeys ? ui.hideKey : ui.showKey} onClick={() => setShowKeys(!showKeys)}>{showKeys ? <EyeOff /> : <Eye />}</button></div></div>
          <div className="preference-row stack"><label htmlFor="subdl-key">{ui.subdlKey}</label><div className="key-field"><input id="subdl-key" type={showKeys ? 'text' : 'password'} defaultValue={settings.subdlApiKey || ''} autoComplete="off" spellCheck={false} onBlur={(event) => save({ subdlApiKey: event.target.value })} /><button className="row-action" aria-label={showKeys ? ui.hideKey : ui.showKey} onClick={() => setShowKeys(!showKeys)}>{showKeys ? <EyeOff /> : <Eye />}</button></div></div>
          <div className="advanced-group"><h3>{ui.updates}</h3><div className="preference-row inset"><label htmlFor="update-startup">{ui.checkStartup}</label><Switch id="update-startup" checked={settings.checkUpdatesOnStartup} onCheckedChange={(value) => save({ checkUpdatesOnStartup: value })} /></div><p>{updater.message || `Version ${appInfo?.version || 'development'}`}</p>{updater.error && <p className="tone-attention">{updater.error}</p>}{updater.phase === 'downloading' && <progress value={updater.progress} max={100} aria-label="Update download" />}
            <div className="settings-actions"><button className="row-action labelled" disabled={!!busy || (!gallery && !appInfo?.isPackaged) || ['checking', 'downloading', 'installing'].includes(updater.phase)} onClick={() => run('update', async () => { if (gallery) { toast.success('You’re up to date.'); return; } const result = await window.desktop.checkForUpdates(); if (!result.ok) throw new Error('Could not check for updates'); })}>{ui.checkUpdates}</button>{updater.phase === 'downloaded' && <><button className="row-action labelled" onClick={() => run('install', async () => { if (!gallery) { const result = await window.desktop.installUpdateNow(); if (!result.ok) throw new Error(result.error); } })}>{ui.install}</button><button className="row-action" onClick={() => run('later', async () => { if (!gallery) await window.desktop.remindLater(30); })}>{ui.later}</button></>}</div>
            {notes.length > 0 && <details className="release-notes"><summary>What’s new</summary>{notes.map((note, index) => <p key={index}>{note}</p>)}</details>}
          </div>
          <div className="advanced-group"><h3>{ui.diagnostics}</h3><div className="settings-actions"><button className="row-action labelled" onClick={() => run('diagnostics', () => diagnostics())}>{ui.exportDiagnostics}</button><button className="row-action" onClick={() => run('copy', () => diagnostics(true))}>{ui.copyDiagnostics}</button></div><button className="detail-refresh" onClick={() => run('report', reportSite)}>{ui.reportSite}</button><button className="detail-refresh" onClick={() => run('temporary', async () => { if (!gallery) await api?.clearTempDownloads(); toast.success('Stale temporary download data cleared'); })}>{ui.clearTemp}</button></div>
        </details>
      </div>
    </DialogContent>
  </Dialog>;
}
