import { useCallback, useEffect, useState } from 'react';
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
  const [settings, setSettings] = useState<DesktopSettings>(gallery ? { ...defaultSettings, outputDirectory: '~/Downloads/VidSnag' } : defaultSettings);
  const [updater, setUpdater] = useState<UpdaterState>({ phase: 'idle', message: gallery ? 'You’re up to date.' : '', progress: 0 });
  const [error, setError] = useState('');
  const initialize = useCallback(async () => {
    if (gallery) return;
    if (!window.desktop) { setError('Open the VidSnag desktop app to see your downloads.'); return; }
    try {
      const [info, preferences, updates] = await Promise.all([window.desktop.getAppInfo(), window.desktop.getSettings(), window.desktop.getUpdaterState()]);
      setAppInfo(info); setSettings({ ...defaultSettings, ...preferences }); setUpdater(updates); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'VidSnag could not start'); }
  }, [gallery]);
  useEffect(() => {
    if (gallery || !window.desktop) { initialize(); return; }
    initialize();
    const stopInfo = window.desktop.onAppInfoUpdate((info) => { setAppInfo(info); });
    const stopUpdates = window.desktop.onUpdaterEvent(setUpdater);
    return () => { stopInfo(); stopUpdates(); };
  }, [gallery, initialize]);
  const saveSettings = useCallback(async (next: Partial<DesktopSettings>) => {
    if (gallery) { setSettings((previous) => ({ ...previous, ...next })); return; }
    const saved = await window.desktop.saveSettings(next);
    setSettings({ ...defaultSettings, ...saved });
  }, [gallery]);
  return { appInfo, settings, saveSettings, updater, error, initialize };
}
