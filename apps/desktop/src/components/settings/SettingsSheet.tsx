import { useState } from 'react';
import { ChevronRight, Eye, EyeOff, LoaderCircle, X } from 'lucide-react';
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
  const run = async (name: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name);
    try { await action(); } catch (err) { toast.error(err instanceof Error ? err.message : ui.downloadingError); }
    finally { setBusy(''); }
  };
  const save = (patch: Partial<DesktopSettings>) => { run('settings', () => onSave(patch)); };
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
        <div className="preference-row"><div><label>{ui.saveVideosTo}</label><small title={settings.outputDirectory}>{settings.outputDirectory || 'Downloads/VidSnag'}</small></div><button className="row-action labelled" disabled={busy === 'folder'} onClick={chooseFolder}>{busy === 'folder' ? <LoaderCircle className="spin" /> : ui.change}</button></div>
        <div className="preference-row"><label htmlFor="preferred-quality">{ui.preferredQuality}</label><select id="preferred-quality" value={settings.preferredQuality} onChange={(event) => save({ preferredQuality: event.target.value as DesktopSettings['preferredQuality'] })}><option value="best">{ui.best}</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></div>
        <div className="preference-row"><label htmlFor="subtitle-language">{ui.subtitles}</label><select id="subtitle-language" value={settings.subtitleLanguage} onChange={(event) => save({ subtitleLanguage: event.target.value })}>{languages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
        <div className="preference-row"><label htmlFor="notify-complete">{ui.notify}</label><Switch id="notify-complete" checked={settings.notifyOnComplete} onCheckedChange={(value) => save({ notifyOnComplete: value })} /></div>
        <div className="preference-row"><label htmlFor="launch-login">{ui.login}</label><Switch id="launch-login" checked={settings.launchAtLogin} onCheckedChange={(value) => save({ launchAtLogin: value })} /></div>
        <details className="advanced-settings">
          <summary><ChevronRight />{ui.advanced}</summary>
          <div className="preference-row"><label htmlFor="downloads-at-once">{ui.atOnce}</label><input id="downloads-at-once" type="number" min={1} max={16} defaultValue={settings.queueMaxConcurrent} onBlur={(event) => save({ queueMaxConcurrent: Math.max(1, Math.min(16, Number(event.target.value) || 1)) })} /></div>
          <div className="preference-row"><label htmlFor="download-connections">{ui.connections}</label><input id="download-connections" type="number" min={1} max={16} defaultValue={settings.downloadThreads} onBlur={(event) => save({ downloadThreads: Math.max(1, Math.min(16, Number(event.target.value) || 1)) })} /></div>
          <div className="preference-row"><label htmlFor="auto-start">{ui.autoStart}</label><Switch id="auto-start" checked={settings.queueAutoStart} onCheckedChange={(value) => save({ queueAutoStart: value })} /></div>
          <div className="preference-row"><label htmlFor="file-naming">{ui.naming}</label><select id="file-naming" value={settings.fileNaming} onChange={(event) => save({ fileNaming: event.target.value as DesktopSettings['fileNaming'] })}><option value="title">{ui.titleNaming}</option><option value="resource">{ui.resourceNaming}</option><option value="custom">{ui.customNaming}</option></select></div>
          {settings.fileNaming === 'custom' && <div className="preference-row stack"><label htmlFor="custom-filename">{ui.customFilename}</label><input id="custom-filename" defaultValue={settings.customFilename} onBlur={(event) => save({ customFilename: event.target.value })} /></div>}
          <div className="preference-row stack"><label htmlFor="tmdb-key">{ui.tmdbKey}</label><div className="key-field"><input id="tmdb-key" type={showKeys ? 'text' : 'password'} defaultValue={settings.tmdbApiKey || ''} autoComplete="off" spellCheck={false} onBlur={(event) => save({ tmdbApiKey: event.target.value })} /><button className="row-action" aria-label={showKeys ? ui.hideKey : ui.showKey} onClick={() => setShowKeys(!showKeys)}>{showKeys ? <EyeOff /> : <Eye />}</button></div></div>
          <div className="preference-row stack"><label htmlFor="subdl-key">{ui.subdlKey}</label><div className="key-field"><input id="subdl-key" type={showKeys ? 'text' : 'password'} defaultValue={settings.subdlApiKey || ''} autoComplete="off" spellCheck={false} onBlur={(event) => save({ subdlApiKey: event.target.value })} /><button className="row-action" aria-label={showKeys ? ui.hideKey : ui.showKey} onClick={() => setShowKeys(!showKeys)}>{showKeys ? <EyeOff /> : <Eye />}</button></div></div>
          <div className="advanced-group"><h3>{ui.chrome}</h3><p>{appInfo?.extensionConnected ? 'Chrome has connected to VidSnag.' : 'Connect the VidSnag extension to this app.'}</p><button className="row-action labelled" onClick={() => run('pairing', async () => setPairing(gallery ? { code: '483921', expiresAt: Date.now() + 300000 } : await window.desktop.getPairingInfo()))}>{ui.connectChrome}</button>{pairing && <div className="pairing-code"><p>{ui.pairingHelp}</p><output aria-label="Connection code">{pairing.code}</output><small>{ui.pairingExpires}</small></div>}</div>
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
