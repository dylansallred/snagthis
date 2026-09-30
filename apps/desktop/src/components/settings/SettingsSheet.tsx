import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { DesktopSettings } from '@/types/settings';
import type { AppInfo, ConnectedExtension, PairingRequest } from '@/types/desktop-bridge';
import type { UpdaterState } from '@/types/updater';
import type { ApiClient } from '@/lib/api';
import { ui } from '@/lib/strings';
import { buildSiteReportUrl } from '@/lib/siteReport';
import { defaultSettings } from '@/hooks/useAppInit';
import { NumberSetting, SavedMark, SettingRow, SettingsFormContext, SettingsGroup, SwitchRow, TextSetting, type Draft, type SettingsForm } from './settingsFields';
import { AccentPicker } from './AccentPicker';
import { PairingDigits, countdown, reviewPairing, shortExtensionId } from './PairingApproval';
import { settingsSections, type SettingsSectionId } from './settingsSections';
import { UpdateErrorBody, type UpdateActions } from '@/components/updates/UpdateChip';
import { afterDownloads, updateSummary } from '@/components/updates/updateModel';
import './settings.css';

const languages = [['none', 'None'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']];
const namingHints: Record<DesktopSettings['fileNaming'], string> = { title: ui.titleNamingHint, resource: ui.resourceNamingHint, custom: ui.customNamingHint };
/** Advanced values that "Restore defaults" resets. Credentials and update choices are left alone. */
const speedAndNaming = ['queueMaxConcurrent', 'downloadThreads', 'queueAutoStart', 'fileNaming', 'customFilename'] as const;
const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function lastSeen(time: number | null) {
  if (!time) return 'not used yet';
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return 'seen just now';
  if (minutes < 60) return `seen ${minutes} min ago`;
  if (minutes < 24 * 60) return `seen ${Math.floor(minutes / 60)} hr ago`;
  return `seen ${shortDate(time)}`;
}
/** Lets a long path wrap after each separator instead of mid-name. */
const breakablePath = (path: string) => path.split(/(?<=[/\\])/).flatMap((part, index) => index ? [<wbr key={index} />, part] : [part]);
const galleryExtensions: ConnectedExtension[] = [{ id: 'gallery', extensionId: 'kpldfbnhcgkemcoimbeoeialgfajmeno', createdAt: Date.now() - 86_400_000, lastSeenAt: Date.now(), legacy: false, identity: 'store' }];

/**
 * Desktop Settings as a 640px sheet with a section rail (settings-refresh option 2). The owner of
 * `section` keeps it for the app session and points deep links, such as Connect Chrome, at a section.
 */
export function SettingsSheet({ open, onOpenChange, section, onSectionChange, settings, onSave, updater, updateBlocking, updateActions, appInfo, api, gallery }: {
  open: boolean; onOpenChange: (open: boolean) => void; section: SettingsSectionId; onSectionChange: (section: SettingsSectionId) => void;
  settings: DesktopSettings; onSave: (next: Partial<DesktopSettings>) => Promise<void>;
  updater: UpdaterState; updateBlocking: number; updateActions: UpdateActions;
  appInfo: AppInfo | null; api: ApiClient | null; gallery: boolean;
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
  // One summary row: Up to date · Check now, 1.1.0 ready · Restart now, Couldn't update · Details.
  const summary = updateSummary(updater, updateBlocking, updatesAvailable);
  const [updateDetails, setUpdateDetails] = useState(false);
  const showUpdateDetails = updateDetails && summary.action === 'details';
  const button = (label: React.ReactNode, onClick: () => void, extra: { className?: string; disabled?: boolean; label?: string; describedBy?: string } = {}) =>
    <button type="button" className={`settings-button ${extra.className || ''}`.trim()} disabled={extra.disabled} aria-label={extra.label} aria-describedby={extra.describedBy} onClick={onClick}>{label}</button>;
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
      const name = (entry: ConnectedExtension) => entry.identity === 'store' ? ui.pairingStoreName : 'Chrome extension';
      const legacyConnected = !connected && !disconnected && !!appInfo?.extensionConnected;
      const codeLive = pairing && pairingSeconds > 0;
      return <section className="settings-chrome" aria-label="Chrome extension setup">
        <SettingsGroup id="chrome-status" title={ui.chromeStatus} list={connected} listLabel="Connected browsers" footer={connected ? ui.chromeKeysNote : undefined}>
          {waiting && <SettingRow as={connected ? 'li' : 'div'} id="chrome-waiting" className="settings-pairing-waiting" label={<><span className="pairing-spinner" aria-hidden="true" />{ui.pairingWaiting}</>} hintRole="status"
            hint={ui.pairingWaitingHint.replace('{time}', countdown(waiting.expiresAt - pairingNow))}
            control={<><PairingDigits code={waiting.matchCode} size="sm" />{button(ui.pairingReview, () => reviewPairing(waiting), { className: 'primary' })}</>} />}
          {connected ? extensions.map((entry) => confirmDisconnect === entry.id
            ? <SettingRow as="li" key={entry.id} id={`extension-${entry.id}`} className="settings-confirm" label={ui.chromeDisconnectTitle.replace('{name}', entry.identity === 'store' ? ui.pairingStoreName : 'this Chrome extension')} hint={ui.chromeDisconnectBody}
              control={<>{button(ui.cancel, () => setConfirmDisconnect(''))}{button('Disconnect', () => disconnect(entry), { className: 'danger', disabled: !!busy })}</>} />
            : <SettingRow as="li" key={entry.id} id={`extension-${entry.id}`} label={<><span className="status-dot" aria-hidden="true" />{ui.chromeConnectedTo.replace('{name}', name(entry))} <span className="sr-only">{entry.extensionId}</span></>}
              hint={<span title={entry.extensionId}>{entry.identity === 'store' ? 'Web Store build' : shortExtensionId(entry.extensionId)} · connected {shortDate(entry.createdAt)} · {lastSeen(entry.lastSeenAt)}</span>}
              control={button('Disconnect', () => setConfirmDisconnect(entry.id), { className: 'danger', label: `Disconnect ${shortExtensionId(entry.extensionId)}` })} />)
            : legacyConnected ? <SettingRow id="chrome-connected" label={<><span className="status-dot" aria-hidden="true" />{ui.chromeIsConnected}</>} hint={ui.chromeConnectedFallbackHint} hintRole="status" />
            : <SettingRow id="chrome-off" label={<><span className="status-dot off" aria-hidden="true" />{ui.chromeNotConnected}</>} hint={disconnected ? ui.chromeDisconnectedHint : ui.chromeNotConnectedHint} hintRole="status"
              control={!appInfo?.extensionConnected && button(<>{ui.chromeAddToChrome}<ExternalLink aria-hidden="true" /></>, () => run('install-extension', async () => { if (!gallery) await window.desktop.openExternal('https://github.com/dylansallred/snagthis#run-locally'); }))} />}
        </SettingsGroup>
        <SettingsGroup id="chrome-connect" title={connected || legacyConnected ? ui.chromeConnectAnother : ui.chromeConnectGroup}>
          {!connected && !legacyConnected && !waiting && <SettingRow id="chrome-one-click" label={ui.chromeOneClick} below={<ol className="settings-steps">{ui.pairingSteps.map((step) => <li key={step}>{step}</li>)}</ol>} />}
          <SettingRow id="chrome-code" label={ui.chromeUseCode} hint={pairing && !codeLive ? ui.chromeCodeExpired : ui.chromeUseCodeHint} error={!!pairing && !codeLive} hintRole={pairing && !codeLive ? 'status' : undefined}
            control={codeLive
              ? button(codeCopied ? 'Copied' : 'Copy code', () => run('copy-code', async () => { await navigator.clipboard.writeText(pairing.code); setCodeCopied(true); }), { disabled: !!busy })
              : button(busy === 'pairing' ? 'Getting code…' : pairing ? 'Get a new code' : 'Show connection code', showPairing, { disabled: !!busy || (!gallery && !apiReady) })}
            below={codeLive && <div className="settings-code"><output id="chrome-connection-code" aria-label="Connection code">{pairing.code}</output><small>{ui.chromeCodeHint.replace('{time}', countdown(pairingSeconds * 1000))}</small></div>} />
        </SettingsGroup>
      </section>;
    },
    downloads: () => <>
      <SettingsGroup id="downloads-saving" title={ui.groupSaving}>
        <SettingRow id="save-folder" className="settings-folder" label={ui.saveVideosTo}
          control={<>
            {button(busy === 'folder' ? <LoaderCircle className="spin" /> : ui.changeFolder, chooseFolder, { disabled: !!busy, label: ui.changeFolderLabel, describedBy: 'save-folder-path' })}
            {button(ui.openFolderShort, openFolder, { disabled: !!busy, describedBy: 'save-folder-path' })}
          </>}
          below={<p className="settings-path" id="save-folder-path" title={folderPath}>{breakablePath(folderPath)}{!settings.outputDirectory && <span className="settings-tag">{ui.defaultTag}</span>}</p>} />
      </SettingsGroup>
      <SettingsGroup id="downloads-quality" title={ui.groupQuality}>
        <SettingRow id="preferred-quality" htmlFor="preferred-quality" label={ui.preferredQuality} hint={ui.qualityHint} hintId="preferred-quality-hint"
          control={<select id="preferred-quality" aria-describedby="preferred-quality-hint" value={settings.preferredQuality} onChange={(event) => save({ preferredQuality: event.target.value as DesktopSettings['preferredQuality'] }, 'preferred-quality', ui.preferredQuality)}><option value="best">{ui.best}</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select>} />
        <SettingRow id="subtitle-language" htmlFor="subtitle-language" label={ui.subtitles} hint={ui.subtitlesHint} hintId="subtitle-language-hint"
          control={<select id="subtitle-language" aria-describedby="subtitle-language-hint" value={settings.subtitleLanguage} onChange={(event) => save({ subtitleLanguage: event.target.value }, 'subtitle-language', ui.subtitles)}>{languages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>} />
      </SettingsGroup>
    </>,
    app: () => <>
      <SettingsGroup id="app-notifications" title={ui.groupNotifications}>
        <SwitchRow id="notify-complete" label={ui.notify} hint={ui.notifyHint} checked={settings.notifyOnComplete} onChange={(value) => save({ notifyOnComplete: value }, 'notify-complete', ui.notify)} />
      </SettingsGroup>
      <SettingsGroup id="app-startup" title={ui.groupStartup}>
        <SwitchRow id="launch-login" label={ui.login} hint={ui.loginHint} checked={settings.launchAtLogin} onChange={(value) => save({ launchAtLogin: value }, 'launch-login', ui.login)} />
      </SettingsGroup>
    </>,
    appearance: () => <SettingsGroup id="appearance-accent" title={ui.accentColour}><AccentPicker onSaved={() => flashSaved('accent-colour', ui.accentColour)} /></SettingsGroup>,
    advanced: () => <>
      <SettingsGroup id="advanced-speed" title={ui.advancedSpeed}>
        <NumberSetting id="downloads-at-once" settingKey="queueMaxConcurrent" label={ui.atOnce} hint={ui.atOnceHint} value={settings.queueMaxConcurrent} min={1} max={16} />
        <NumberSetting id="download-connections" settingKey="downloadThreads" label={ui.connections} hint={ui.connectionsHint} value={settings.downloadThreads} min={1} max={16} />
        <SwitchRow id="auto-start" label={ui.autoStart} hint={ui.autoStartHint} checked={settings.queueAutoStart} onChange={(value) => save({ queueAutoStart: value }, 'auto-start', ui.autoStart)} />
      </SettingsGroup>
      <SettingsGroup id="advanced-names" title={ui.advancedNames} footer={advancedAreDefaults ? undefined : ui.restoreDefaultsNote}
        action={<><SavedMark id="restore-defaults" />{button(advancedAreDefaults ? ui.usingDefaults : ui.restoreDefaults, restoreDefaults, { className: 'mini', disabled: advancedAreDefaults, label: advancedAreDefaults ? ui.usingDefaultsLabel : ui.restoreDefaultsLabel })}</>}>
        <SettingRow id="file-naming" htmlFor="file-naming" label={ui.naming} hint={`${namingHints[settings.fileNaming]}.`} hintId="file-naming-hint"
          control={<select id="file-naming" aria-describedby="file-naming-hint" value={settings.fileNaming} onChange={(event) => { const next = event.target.value as DesktopSettings['fileNaming']; focusCustomName.current = next === 'custom'; save({ fileNaming: next }, 'file-naming', ui.naming); }}><option value="title">{ui.titleNaming}</option><option value="resource">{ui.resourceNaming}</option><option value="custom">{ui.customNaming}</option></select>} />
        {settings.fileNaming === 'custom' && <TextSetting id="custom-filename" settingKey="customFilename" label={ui.customFilename} hint={ui.customFilenameHint} value={settings.customFilename} placeholder={ui.customFilenamePlaceholder} inputRef={customNameRef}
          validate={(draft) => /[/\\]/.test(draft) ? ui.customFilenameSlash : draft.length > 200 ? ui.customFilenameLong : ''} />}
      </SettingsGroup>
      <SettingsGroup id="advanced-lookups" title={ui.advancedLookups}>
        <TextSetting id="tmdb-key" settingKey="tmdbApiKey" label={ui.tmdbKey} hint={ui.tmdbHint} value={settings.tmdbApiKey || ''} placeholder={ui.keyPlaceholder} secret />
        <TextSetting id="subdl-key" settingKey="subdlApiKey" label={ui.subdlKey} hint={ui.subdlHint} value={settings.subdlApiKey || ''} placeholder={ui.keyPlaceholder} secret />
      </SettingsGroup>
    </>,
    about: () => <>
      <SettingsGroup id="about-updates" title={ui.updates}>
        <SettingRow id="update-status" label={ui.appVersion.replace('{version}', appInfo?.version || updater.currentVersion || 'development')} hintRole="status"
          hint={<span className={`update-summary-hint tone-${summary.tone}`}>{summary.hint}</span>}
          control={summary.action === 'restart'
            ? button(ui.restartNow, updateActions.restart, { className: 'primary', disabled: summary.disabled, label: summary.disabled ? `${ui.restartNow}. ${afterDownloads(updateBlocking)}` : undefined })
            : summary.action === 'details'
              ? <button type="button" className="settings-button" aria-expanded={showUpdateDetails} aria-controls="update-summary-details" onClick={() => setUpdateDetails((shown) => !shown)}>{showUpdateDetails ? ui.updateHideDetails : ui.updateDetails}</button>
              : summary.action === 'move'
                ? button(ui.moveToApplications, updateActions.moveToApplications, { className: 'primary' })
                : button(ui.checkUpdates, updateActions.check, { disabled: summary.disabled })}
          below={showUpdateDetails && <div id="update-summary-details" className="update-summary-details"><UpdateErrorBody updater={updater} currentVersion={appInfo?.version || 'development'} actions={updateActions} rawLabel={ui.updateTechnical} /></div>} />
        <SwitchRow id="update-startup" label={ui.checkStartup} hint={ui.checkStartupHint} checked={settings.checkUpdatesOnStartup} onChange={(value) => save({ checkUpdatesOnStartup: value }, 'update-startup', ui.checkStartup)} />
      </SettingsGroup>
      <SettingsGroup id="about-support" title={ui.diagnostics}>
        <SettingRow id="support-bundle" label={ui.supportBundle} hint={ui.supportBundleHint}
          control={<>{button(ui.exportDiagnostics, () => run('diagnostics', () => diagnostics()), { label: ui.exportDiagnosticsLabel })}{button(ui.copyDiagnostics, () => run('copy', () => diagnostics(true)), { label: ui.copyDiagnosticsLabel })}</>} />
        <SettingRow id="report-site" label={ui.reportSiteTitle} hint={ui.reportSiteHint}
          control={button(<>{ui.reportSite}<ExternalLink aria-hidden="true" /></>, () => run('report', reportSite), { label: ui.reportSiteLabel })} />
        <SettingRow id="temporary-data" label={ui.tempData} hint={ui.tempDataHint}
          control={button(ui.clearTemp, () => run('temporary', async () => { if (!gallery) await api?.clearTempDownloads(); toast.success('Stale temporary download data cleared'); }), { label: ui.clearTempLabel })} />
      </SettingsGroup>
    </>,
  };
  return <Dialog open={open} onOpenChange={close}>
    <DialogContent ref={contentRef} className="settings-sheet settings-sidebar top-0 left-auto translate-x-0 translate-y-0" showCloseButton={false} onEscapeKeyDown={escape}
      // Start on the sheet itself rather than lighting up the close button; Tab reaches it first.
      onOpenAutoFocus={(event) => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}>
      <DialogDescription className="sr-only">{ui.settingsDescription}</DialogDescription>
      <p className="sr-only" role="status" aria-live="polite">{saved.announcement}</p>
      <SettingsFormContext.Provider value={form}>
      <div className="settings-split">
        <div className="settings-rail">
          <DialogTitle className="settings-rail-title">{ui.settings}</DialogTitle>
          <div role="tablist" aria-orientation="vertical" aria-label={ui.settingsSections} onKeyDown={onRailKey}>
            {settingsSections.map(({ id, title, icon: Icon }) => <button key={id} type="button" role="tab" id={`settings-tab-${id}`} aria-controls="settings-pane" aria-selected={id === section} tabIndex={id === section ? 0 : -1}
              ref={(element) => { if (element) tabs.current.set(id, element); else tabs.current.delete(id); }} onClick={() => onSectionChange(id)}><span className="settings-tab-icon" aria-hidden="true"><Icon /></span>{title}</button>)}
          </div>
          <span className="settings-version">{ui.appVersion.replace('{version}', appInfo?.version || 'development')}</span>
        </div>
        <div className="settings-column">
          <div className="settings-pane-head">
            <h3 className="settings-pane-title">{current.title}</h3>
            <button type="button" className="settings-close" aria-label={ui.closeSettings} title={ui.closeSettingsHint} onClick={() => close(false)}><X /></button>
          </div>
          <div className="settings-pane" id="settings-pane" role="tabpanel" aria-labelledby={`settings-tab-${current.id}`} ref={scrollRef}>
            <p className="settings-pane-description">{current.description}</p>
            {panes[current.id]()}
            <p className="settings-autosave"><Check aria-hidden="true" />{ui.autosaveNote}</p>
          </div>
        </div>
      </div>
      </SettingsFormContext.Provider>
    </DialogContent>
  </Dialog>;
}
