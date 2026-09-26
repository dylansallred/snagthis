import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle, X, FolderOpen, MonitorPlay, Captions, Bell, Power, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { DesktopSettings } from '@/types/settings';
import type { AppInfo, ConnectedExtension, PairingRequest } from '@/types/desktop-bridge';
import type { UpdaterState } from '@/types/updater';
import type { ApiClient } from '@/lib/api';
import { ui } from '@/lib/strings';
import { buildSiteReportUrl } from '@/lib/siteReport';
import { defaultSettings } from '@/hooks/useAppInit';
import { NumberSetting, SettingTitle, SettingsFormContext, TextSetting, type Draft, type SettingsForm } from './settingsFields';
import { AccentPicker } from './AccentPicker';
import { PairingDigits, countdown, reviewPairing, shortExtensionId } from './PairingApproval';
import { settingsSections, type SettingsSectionId } from './settingsSections';
import './settings.css';

const languages = [['none', 'None'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']];
const namingHints: Record<DesktopSettings['fileNaming'], string> = { title: ui.titleNamingHint, resource: ui.resourceNamingHint, custom: ui.customNamingHint };
/** Advanced values that "Restore defaults" resets. Credentials and update choices are left alone. */
const speedAndNaming = ['queueMaxConcurrent', 'downloadThreads', 'queueAutoStart', 'fileNaming', 'customFilename'] as const;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function lastSeen(time: number | null) {
  if (!time) return 'not used yet';
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return 'last seen just now';
  if (minutes < 60) return `last seen ${minutes} min ago`;
  if (minutes < 24 * 60) return `last seen ${Math.floor(minutes / 60)} hr ago`;
  return `last seen ${shortDate(time)}`;
}
const galleryExtensions: ConnectedExtension[] = [{ id: 'gallery', extensionId: 'kpldfbnhcgkemcoimbeoeialgfajmeno', createdAt: Date.now() - 86_400_000, lastSeenAt: Date.now(), legacy: false, identity: 'store' }];

/**
 * Desktop Settings as a 640px sheet with a section rail (settings-refresh option 2). The owner of
 * `section` keeps it for the app session and points deep links, such as Connect Chrome, at a section.
 */
export function SettingsSheet({ open, onOpenChange, section, onSectionChange, settings, onSave, updater, appInfo, api, gallery }: {
  open: boolean; onOpenChange: (open: boolean) => void; section: SettingsSectionId; onSectionChange: (section: SettingsSectionId) => void;
  settings: DesktopSettings; onSave: (next: Partial<DesktopSettings>) => Promise<void>;
  updater: UpdaterState; appInfo: AppInfo | null; api: ApiClient | null; gallery: boolean;
}) {
  const [busy, setBusy] = useState('');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairingNow, setPairingNow] = useState(Date.now);
  const [codeCopied, setCodeCopied] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PairingRequest | null>(null);
  const [extensions, setExtensions] = useState<ConnectedExtension[]>(gallery ? galleryExtensions : []);
  const [confirmDisconnect, setConfirmDisconnect] = useState('');
  const [disconnected, setDisconnected] = useState(false);
  const [saved, setSaved] = useState({ key: '', announcement: '' });
  const savedTimer = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const customNameRef = useRef<HTMLInputElement>(null);
  const revealNext = useRef<HTMLElement | null>(null);
  const focusCustomName = useRef(false);
  const drafts = useRef(new Map<string, Draft>());
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
  // Connected browsers and a waiting one-click request, kept current while Settings is open.
  const apiReady = appInfo?.apiStartupState === 'ready';
  useEffect(() => {
    if (!open || gallery || !apiReady || !window.desktop?.listExtensions) return undefined;
    let live = true;
    void window.desktop.listExtensions().then((list) => { if (live) setExtensions(list); }).catch(() => {});
    void window.desktop.getPairingRequest().then((next) => { if (live) setPendingRequest(next?.status === 'pending' ? next : null); }).catch(() => {});
    const offState = window.desktop.onPairingState((next) => setPendingRequest(next?.status === 'pending' ? next : null));
    const offList = window.desktop.onExtensionsChange((list) => { setExtensions(list); if (list.length) setDisconnected(false); });
    return () => { live = false; offState(); offList(); };
  }, [open, gallery, apiReady]);
  useEffect(() => {
    if (!pendingRequest) return undefined;
    const timer = window.setInterval(() => setPairingNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pendingRequest]);
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);
  useEffect(() => {
    if (!focusCustomName.current || settings.fileNaming !== 'custom') return;
    focusCustomName.current = false;
    customNameRef.current?.focus();
  }, [settings.fileNaming]);
  const run = async (name: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name);
    try { await action(); } catch (err) { toast.error(err instanceof Error ? err.message : ui.downloadingError); }
    finally { setBusy(''); }
  };
  const flashSaved = useCallback((key: string, label: string) => {
    window.clearTimeout(savedTimer.current);
    setSaved({ key, announcement: ui.savedAnnouncement.replace('{label}', label) });
    savedTimer.current = window.setTimeout(() => setSaved({ key: '', announcement: '' }), 1800);
  }, []);
  // Settings saves are not gated on `busy`: two quick toggles must both be saved, never silently dropped.
  const commit = useCallback(async (patch: Partial<DesktopSettings>, key: string, label: string) => {
    try { await onSave(patch); }
    catch (err) { toast.error(err instanceof Error ? err.message : ui.downloadingError); return false; }
    flashSaved(key, label);
    return true;
  }, [onSave, flashSaved]);
  const register = useCallback((id: string, draft: Draft) => { drafts.current.set(id, draft); return () => { drafts.current.delete(id); }; }, []);
  const form = useMemo<SettingsForm>(() => ({ commit, savedKey: saved.key, register }), [commit, saved.key, register]);
  const save = (patch: Partial<DesktopSettings>, key: string, label: string) => { void commit(patch, key, label); };
  const close = (next: boolean) => {
    // Closing with the pointer or ⌘W keeps a typed value; invalid values are discarded.
    if (!next) for (const draft of drafts.current.values()) if (draft.dirty()) draft.commit();
    onOpenChange(next);
  };
  const escape = (event: KeyboardEvent) => {
    const active = document.activeElement;
    const draft = active instanceof HTMLInputElement ? drafts.current.get(active.id) : undefined;
    if (draft?.dirty()) { event.preventDefault(); draft.revert(); }
  };
  /** Brings a just-opened disclosure's header near the top of the pane so its content is visible. */
  const reveal = useCallback((element: HTMLElement) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, []);
  const onDisclosureToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const details = event.currentTarget;
    if (details.open && revealNext.current === details) requestAnimationFrame(() => reveal(details));
    revealNext.current = null;
  };
  // Only a person's click or key press on a summary scrolls; restoring a remembered open state does not.
  const markReveal = (event: React.MouseEvent<HTMLElement>) => { revealNext.current = event.currentTarget.parentElement; };
  const showPairing = () => run('pairing', async () => {
    const next = gallery ? { code: '483921', expiresAt: Date.now() + 300000 } : await window.desktop.getPairingInfo();
    setPairingNow(Date.now()); setCodeCopied(false); setPairing(next);
  });
  const chooseFolder = () => run('folder', async () => {
    if (gallery) { await commit({ outputDirectory: '~/Movies/SnagThis' }, 'save-folder', ui.saveVideosTo); return; }
    const result = await window.desktop.chooseOutputDirectory();
    if (result.cancelled) return;
    if (!result.ok || !result.path) throw new Error(result.error || 'Could not select this folder');
    await commit({ outputDirectory: result.path }, 'save-folder', ui.saveVideosTo);
  });
  const openFolder = () => run('open-folder', async () => {
    if (gallery) return;
    const result = await window.desktop.openSaveFolder();
    if (!result.ok) throw new Error(result.error);
  });
  const diagnostics = async (copyOnly = false) => {
    const data = gallery ? { app: 'SnagThis', mode: 'design gallery', credentials: '[redacted]' } : await api?.getDiagnostics();
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
  const advancedAreDefaults = speedAndNaming.every((key) => settings[key] === defaultSettings[key]);
  const restoreDefaults = () => save(Object.fromEntries(speedAndNaming.map((key) => [key, defaultSettings[key]])), 'restore-defaults', ui.restoreDefaults);
  const folderPath = settings.outputDirectory || ui.defaultFolder;
  const updatesAvailable = gallery || !!appInfo?.isPackaged;
  const tabs = useRef(new Map<SettingsSectionId, HTMLButtonElement>());
  const current = settingsSections.find((entry) => entry.id === section) || settingsSections[0];
  // A new section starts at its top; the rail swaps the pane without animation.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [section]);
  const onRailKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = settingsSections.findIndex((entry) => entry.id === section);
    const last = settingsSections.length - 1;
    const next = { ArrowDown: index === last ? 0 : index + 1, ArrowUp: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = settingsSections[next].id;
    onSectionChange(id);
    tabs.current.get(id)?.focus();
  };
  const sub = (id: string, title: string, children: React.ReactNode) => <div className="advanced-group" role="group" aria-labelledby={id}><h4 id={id}>{title}</h4>{children}</div>;
  const panes: Record<SettingsSectionId, () => React.ReactNode> = {
    chrome: () => {
      const connected = extensions.length > 0;
      const waiting = pendingRequest && pendingRequest.expiresAt > pairingNow ? pendingRequest : null;
      const disconnect = (entry: ConnectedExtension) => run(`disconnect-${entry.id}`, async () => {
        if (gallery) { setExtensions([]); setDisconnected(true); setConfirmDisconnect(''); return; }
        const result = await window.desktop.disconnectExtension(entry.id);
        if (!result.ok) throw new Error('This browser was already disconnected.');
        setExtensions(await window.desktop.listExtensions());
        setConfirmDisconnect(''); setDisconnected(true);
      });
      return <section className="settings-group pairing-settings" aria-label="Chrome extension setup">
        <p role="status">{connected ? 'Chrome is connected. Keep SnagThis open while downloading.' : disconnected ? 'Chrome is disconnected. Its key no longer works.' : 'Connect the extension once to send videos from Chrome to this app.'}</p>
        {waiting && <div className="pairing-pending" role="status">
          <span className="pairing-spinner" aria-hidden="true" />
          <div className="pairing-pending-text"><b>{ui.pairingWaiting}</b><small>{ui.pairingExpiresIn.replace('{time}', countdown(waiting.expiresAt - pairingNow))}</small></div>
          <PairingDigits code={waiting.matchCode} size="sm" />
          <button type="button" className="row-action primary-action" onClick={() => reviewPairing(waiting)}>{ui.pairingReview}</button>
        </div>}
        {connected && <ul className="connected-extensions" aria-label="Connected browsers">{extensions.map((entry) => <li key={entry.id} className="connected-extension">
          {confirmDisconnect === entry.id ? <>
            <b>Disconnect {entry.identity === 'store' ? ui.pairingStoreName : 'this Chrome extension'}?</b>
            <small className="pairing-note">Chrome will stop sending downloads here until you connect it again. Finished files and your library stay.</small>
            <div className="connected-extension-actions"><button type="button" className="row-action labelled" onClick={() => setConfirmDisconnect('')}>{ui.cancel}</button><button type="button" className="row-action danger-action" disabled={!!busy} onClick={() => disconnect(entry)}>Disconnect</button></div>
          </> : <div className="connected-extension-row">
            <Check aria-hidden="true" />
            <div className="connected-extension-text"><b>{entry.identity === 'store' ? ui.pairingStoreName : 'Chrome extension'} <span className="sr-only">{entry.extensionId}</span></b><small title={entry.extensionId}>{entry.identity === 'store' ? 'Web Store build' : shortExtensionId(entry.extensionId)} · connected {shortDate(entry.createdAt)} · {lastSeen(entry.lastSeenAt)}</small></div>
            <button type="button" className="row-action danger-action" aria-label={`Disconnect ${shortExtensionId(entry.extensionId)}`} onClick={() => setConfirmDisconnect(entry.id)}>Disconnect</button>
          </div>}
        </li>)}</ul>}
        {connected && <p className="pairing-note">Each browser gets its own key, so disconnecting one leaves the others.</p>}
        {!waiting && <ol className="pairing-steps">{ui.pairingSteps.map((step) => <li key={step}>{step}</li>)}</ol>}
        <div className="pairing-code-fallback">
          <p>Another browser, or SnagThis didn’t come forward? Connect with a code instead.</p>
          {pairing && <ol className="pairing-steps">{ui.pairingCodeSteps.map((step) => <li key={step}>{step}</li>)}</ol>}
          {pairing && pairingSeconds > 0 ? <div className="pairing-code"><label htmlFor="chrome-connection-code">{ui.pairingHelp}</label><div className="pairing-code-actions"><output id="chrome-connection-code" aria-label="Connection code">{pairing.code}</output><button type="button" className="row-action labelled" disabled={!!busy} onClick={() => run('copy-code', async () => { await navigator.clipboard.writeText(pairing.code); setCodeCopied(true); })}>{codeCopied ? 'Copied' : 'Copy code'}</button></div><small>Expires in {Math.floor(pairingSeconds / 60)}:{String(pairingSeconds % 60).padStart(2, '0')}. Keep SnagThis open.</small></div>
            : <>{pairing && <p className="tone-attention" role="status">This code expired. Get a new code and try again.</p>}<button type="button" className="row-action labelled" disabled={!!busy || (!gallery && !apiReady)} onClick={showPairing}>{busy === 'pairing' ? 'Getting code…' : pairing ? 'Get a new code' : 'Show connection code'}</button></>}
        </div>
        {!appInfo?.extensionConnected && !connected && <button type="button" className="detail-refresh pairing-install" onClick={() => run('install-extension', async () => { if (!gallery) await window.desktop.openExternal('https://github.com/dylansallred/snagthis#run-locally'); })}>Need the extension? Add to Chrome</button>}
      </section>;
    },
    downloads: () => <div className="settings-group">
      <div className="preference-row folder-row">
        <span className="setting-icon warm" aria-hidden="true"><FolderOpen /></span>
        <div className="setting-text"><SettingTitle id="save-folder">{ui.saveVideosTo}</SettingTitle><span className="folder-path" id="save-folder-path" title={folderPath}>{folderPath}</span></div>
        <div className="settings-actions folder-actions">
          <button type="button" className="row-action labelled" aria-describedby="save-folder-path" aria-label={ui.changeFolderLabel} disabled={!!busy} onClick={chooseFolder}>{busy === 'folder' ? <LoaderCircle className="spin" /> : ui.changeFolder}</button>
          <button type="button" className="row-action labelled" aria-describedby="save-folder-path" aria-label={ui.saveFolder} disabled={!!busy} onClick={openFolder}>{ui.openFolderShort}</button>
        </div>
      </div>
      <div className="preference-row"><span className="setting-icon" aria-hidden="true"><MonitorPlay /></span><div className="setting-text"><SettingTitle id="preferred-quality" htmlFor="preferred-quality">{ui.preferredQuality}</SettingTitle><small>{ui.qualityHint}</small></div><select id="preferred-quality" value={settings.preferredQuality} onChange={(event) => save({ preferredQuality: event.target.value as DesktopSettings['preferredQuality'] }, 'preferred-quality', ui.preferredQuality)}><option value="best">{ui.best}</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></div>
      <div className="preference-row"><span className="setting-icon" aria-hidden="true"><Captions /></span><div className="setting-text"><SettingTitle id="subtitle-language" htmlFor="subtitle-language">{ui.subtitles}</SettingTitle><small>{ui.subtitlesHint}</small></div><select id="subtitle-language" value={settings.subtitleLanguage} onChange={(event) => save({ subtitleLanguage: event.target.value }, 'subtitle-language', ui.subtitles)}>{languages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
    </div>,
    app: () => <div className="settings-group">
      <div className="preference-row"><span className="setting-icon" aria-hidden="true"><Bell /></span><div className="setting-text"><SettingTitle id="notify-complete" htmlFor="notify-complete">{ui.notify}</SettingTitle></div><Switch id="notify-complete" checked={settings.notifyOnComplete} onCheckedChange={(value) => save({ notifyOnComplete: value }, 'notify-complete', ui.notify)} /></div>
      <div className="preference-row"><span className="setting-icon" aria-hidden="true"><Power /></span><div className="setting-text"><SettingTitle id="launch-login" htmlFor="launch-login">{ui.login}</SettingTitle></div><Switch id="launch-login" checked={settings.launchAtLogin} onCheckedChange={(value) => save({ launchAtLogin: value }, 'launch-login', ui.login)} /></div>
    </div>,
    appearance: () => <div className="settings-group"><AccentPicker onSaved={() => flashSaved('accent-colour', ui.accentColour)} /></div>,
    advanced: () => <div className="settings-group">
      {sub('advanced-speed', ui.advancedSpeed, <>
        <NumberSetting id="downloads-at-once" settingKey="queueMaxConcurrent" label={ui.atOnce} hint={ui.atOnceHint} value={settings.queueMaxConcurrent} min={1} max={16} />
        <NumberSetting id="download-connections" settingKey="downloadThreads" label={ui.connections} hint={ui.connectionsHint} value={settings.downloadThreads} min={1} max={16} />
        <div className="preference-row"><div className="setting-text"><SettingTitle id="auto-start" htmlFor="auto-start">{ui.autoStart}</SettingTitle><small>{ui.autoStartHint}</small></div><Switch id="auto-start" checked={settings.queueAutoStart} onCheckedChange={(value) => save({ queueAutoStart: value }, 'auto-start', ui.autoStart)} /></div>
      </>)}
      {sub('advanced-names', ui.advancedNames, <>
        <div className="preference-row"><div className="setting-text"><SettingTitle id="file-naming" htmlFor="file-naming">{ui.naming}</SettingTitle><small id="file-naming-hint">{namingHints[settings.fileNaming]}</small></div><select id="file-naming" aria-describedby="file-naming-hint" value={settings.fileNaming} onChange={(event) => { const next = event.target.value as DesktopSettings['fileNaming']; focusCustomName.current = next === 'custom'; save({ fileNaming: next }, 'file-naming', ui.naming); }}><option value="title">{ui.titleNaming}</option><option value="resource">{ui.resourceNaming}</option><option value="custom">{ui.customNaming}</option></select></div>
        {settings.fileNaming === 'custom' && <TextSetting id="custom-filename" settingKey="customFilename" label={ui.customFilename} hint={ui.customFilenameHint} value={settings.customFilename} placeholder={ui.customFilenamePlaceholder} inputRef={customNameRef}
          validate={(draft) => /[/\\]/.test(draft) ? ui.customFilenameSlash : draft.length > 200 ? ui.customFilenameLong : ''} />}
        <div className="settings-actions restore-defaults"><button type="button" className="detail-refresh" disabled={advancedAreDefaults} onClick={restoreDefaults}>{advancedAreDefaults ? ui.usingDefaults : ui.restoreDefaults}</button></div>
      </>)}
      {sub('advanced-lookups', ui.advancedLookups, <>
        <TextSetting id="tmdb-key" settingKey="tmdbApiKey" label={ui.tmdbKey} hint={ui.tmdbHint} value={settings.tmdbApiKey || ''} placeholder={ui.keyPlaceholder} secret />
        <TextSetting id="subdl-key" settingKey="subdlApiKey" label={ui.subdlKey} hint={ui.subdlHint} value={settings.subdlApiKey || ''} placeholder={ui.keyPlaceholder} secret />
      </>)}
    </div>,
    about: () => <div className="settings-group">
      {sub('advanced-updates', ui.updates, <>
        <div className="preference-row inset"><SettingTitle id="update-startup" htmlFor="update-startup">{ui.checkStartup}</SettingTitle><Switch id="update-startup" checked={settings.checkUpdatesOnStartup} onCheckedChange={(value) => save({ checkUpdatesOnStartup: value }, 'update-startup', ui.checkStartup)} /></div>
        <p>{updater.message || `Version ${appInfo?.version || 'development'}`}</p>{!updatesAvailable && <p>{ui.updatesInstalledOnly}</p>}{updater.error && <p className="tone-attention">{updater.error}</p>}{updater.phase === 'downloading' && <progress value={updater.progress} max={100} aria-label="Update download" />}
        <div className="settings-actions"><button type="button" className="row-action labelled" disabled={!!busy || !updatesAvailable || ['checking', 'downloading', 'installing'].includes(updater.phase)} onClick={() => run('update', async () => { if (gallery) { toast.success('You’re up to date.'); return; } const result = await window.desktop.checkForUpdates(); if (!result.ok) throw new Error('Could not check for updates'); })}>{ui.checkUpdates}</button>{updater.phase === 'downloaded' && <><button type="button" className="row-action labelled" onClick={() => run('install', async () => { if (!gallery) { const result = await window.desktop.installUpdateNow(); if (!result.ok) throw new Error(result.error); } })}>{ui.install}</button><button type="button" className="row-action" onClick={() => run('later', async () => { if (!gallery) await window.desktop.remindLater(30); })}>{ui.later}</button></>}</div>
        {notes.length > 0 && <details className="release-notes" onToggle={onDisclosureToggle}><summary onClick={markReveal}>What’s new</summary>{notes.map((note, index) => <p key={index}>{note}</p>)}</details>}
      </>)}
      {sub('advanced-diagnostics', ui.diagnostics, <>
        <div className="settings-actions"><button type="button" className="row-action labelled" onClick={() => run('diagnostics', () => diagnostics())}>{ui.exportDiagnostics}</button><button type="button" className="row-action labelled" onClick={() => run('copy', () => diagnostics(true))}>{ui.copyDiagnostics}</button></div>
        <button type="button" className="detail-refresh" onClick={() => run('report', reportSite)}>{ui.reportSite}</button>
        <button type="button" className="detail-refresh" onClick={() => run('temporary', async () => { if (!gallery) await api?.clearTempDownloads(); toast.success('Stale temporary download data cleared'); })}>{ui.clearTemp}</button>
      </>)}
    </div>,
  };
  return <Dialog open={open} onOpenChange={close}>
    <DialogContent ref={contentRef} className="settings-sheet settings-sidebar top-0 left-auto translate-x-0 translate-y-0" showCloseButton={false} onEscapeKeyDown={escape}
      // Start on the sheet itself rather than lighting up the close button; Tab reaches it first.
      onOpenAutoFocus={(event) => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}>
      <div className="sheet-heading"><DialogTitle>{ui.settings}</DialogTitle><button type="button" className="row-action" aria-label={ui.closeSettings} title={ui.closeSettingsHint} onClick={() => close(false)}><X /></button></div>
      <DialogDescription className="sr-only">{ui.settingsDescription}</DialogDescription>
      <p className="sr-only" role="status" aria-live="polite">{saved.announcement}</p>
      <SettingsFormContext.Provider value={form}>
      <div className="settings-split">
        <div className="settings-rail">
          <div role="tablist" aria-orientation="vertical" aria-label={ui.settingsSections} onKeyDown={onRailKey}>
            {settingsSections.map(({ id, title, icon: Icon }) => <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-controls="settings-pane" aria-selected={id === section} tabIndex={id === section ? 0 : -1}
              ref={(element) => { if (element) tabs.current.set(id, element); else tabs.current.delete(id); }} onClick={() => onSectionChange(id)}><Icon aria-hidden="true" />{title}</button>)}
          </div>
          <span className="settings-version">{ui.appVersion.replace('{version}', appInfo?.version || 'development')}</span>
        </div>
        <div className="settings-pane" id="settings-pane" role="tabpanel" aria-labelledby={`settings-tab-${current.id}`} ref={scrollRef}>
          <h3 className="settings-pane-title">{current.title}</h3>
          <p className="settings-pane-description">{current.description}</p>
          {panes[current.id]()}
        </div>
      </div>
      </SettingsFormContext.Provider>
    </DialogContent>
  </Dialog>;
}
