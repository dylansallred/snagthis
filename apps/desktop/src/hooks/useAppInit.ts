import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo } from '@/types/desktop-bridge';
import type { DesktopSettings } from '@/types/settings';
import type { UpdaterState } from '@/types/updater';

export const defaultSettings: DesktopSettings = {
  queueMaxConcurrent: 1, queueAutoStart: true, checkUpdatesOnStartup: true,
  outputDirectory: '', tmdbApiKey: '', subdlApiKey: '', downloadThreads: 8,
  preferredQuality: 'best', subtitleLanguage: 'none', notifyOnComplete: true, launchAtLogin: false,
  fileNaming: 'title', customFilename: '',
};

export function useAppInit(gallery = false) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<DesktopSettings>(gallery ? { ...defaultSettings, outputDirectory: '~/Downloads/SnagThis' } : defaultSettings);
  const [updater, setUpdater] = useState<UpdaterState>({ phase: 'idle', message: gallery ? 'You’re up to date.' : '', progress: 0 });
  const [error, setError] = useState('');
  const generation = useRef(0);
  const infoRevision = useRef(0);
  const updaterRevision = useRef(0);
  const initialize = useCallback(async () => {
    if (gallery) return;
    if (!window.desktop) { setError('Open the SnagThis desktop app to see your downloads.'); return; }
    const current = generation.current;
    const revision = infoRevision.current;
    const updatesRevision = updaterRevision.current;
    try {
      const [info, preferences, updates] = await Promise.all([window.desktop.getAppInfo(), window.desktop.getSettings(), window.desktop.getUpdaterState()]);
      if (current !== generation.current) return;
      // Readiness can arrive while settings are still loading.
      if (revision === infoRevision.current) setAppInfo(info);
      setSettings({ ...defaultSettings, ...preferences });
      if (updatesRevision === updaterRevision.current) setUpdater(updates);
      setError('');
    } catch (err) {
      if (current !== generation.current) return;
      setError(err instanceof Error ? err.message : 'SnagThis could not start');
    }
  }, [gallery]);
  useEffect(() => {
    const current = ++generation.current;
    const invalidate = () => { generation.current += 1; };
    if (gallery || !window.desktop) { initialize(); return invalidate; }
    const stopInfo = window.desktop.onAppInfoUpdate((info) => {
      if (current !== generation.current) return;
      infoRevision.current += 1;
      setAppInfo(info);
    });
    const stopUpdates = window.desktop.onUpdaterEvent((updates) => {
      if (current !== generation.current) return;
      updaterRevision.current += 1;
      setUpdater(updates);
    });
    initialize();
    return () => { invalidate(); stopInfo(); stopUpdates(); };
  }, [gallery, initialize]);
  const saveSettings = useCallback(async (next: Partial<DesktopSettings>) => {
    if (gallery) { setSettings((previous) => ({ ...previous, ...next })); return; }
    const saved = await window.desktop.saveSettings(next);
    setSettings({ ...defaultSettings, ...saved });
  }, [gallery]);
  return { appInfo, settings, saveSettings, updater, error, initialize };
}
