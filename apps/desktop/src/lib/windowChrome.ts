/**
 * Unified header (spec §6): the top bar is the window's title bar. Classes on <html> let the header
 * clear the macOS traffic lights (`platform-darwin`, dropped in `window-fullscreen`) or the
 * Windows/Linux caption-button overlay. Outside Electron (the browser gallery) nothing is added.
 */
export function installWindowChrome(): () => void {
  const bridge = typeof window !== 'undefined' ? window.desktop : undefined;
  if (!bridge?.platform) return () => {};
  const root = document.documentElement;
  root.classList.add(`platform-${bridge.platform}`);
  const apply = (state: { fullScreen: boolean } | undefined) => root.classList.toggle('window-fullscreen', !!state?.fullScreen);
  const stop = bridge.onWindowState(apply);
  bridge.getWindowState().then(apply, () => {});
  return stop;
}
