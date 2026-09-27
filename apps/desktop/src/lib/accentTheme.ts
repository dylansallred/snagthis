import { accentVariables } from '@m3u8/contracts/src/accents.mjs';
import { getAccent, type AccentId } from '@/lib/accent';
import './accentTheme.css';

// Runtime token maps live in @m3u8/contracts so the Chrome extension applies the same values.
export { ACCENT_TOKENS } from '@m3u8/contracts/src/accents.mjs';
export type { AccentTokens } from '@m3u8/contracts/src/accents.mjs';

const CROSSFADE_MS = 240;
// Mirrors the private event name in lib/accent.ts (its API stays unchanged).
const CHANGE_EVENT = 'snagthis:accent';
let applied: AccentId | null = null;
let fadeTimer = 0;

/**
 * Sets the accent tokens on <html>. Chrome and buttons crossfade over 240ms when `animate`
 * is set; reduced motion and the startup call swap instantly. The pixel logo always swaps
 * instantly because its colours are not registered (animatable) properties.
 */
export function applyAccent(id: AccentId, { animate = false }: { animate?: boolean } = {}): void {
  if (typeof document === 'undefined' || id === applied) return;
  applied = id;
  const root = document.documentElement;
  const fade = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.clearTimeout(fadeTimer);
  root.classList.toggle('accent-crossfade', fade);
  for (const [name, value] of accentVariables(id)) root.style.setProperty(name, value);
  root.dataset.accent = id;
  if (fade) fadeTimer = window.setTimeout(() => root.classList.remove('accent-crossfade'), CROSSFADE_MS + 60);
}

/** Apply the saved accent before the first render, then follow changes from Settings or the Chrome extension. */
export function installAccentTheme(): () => void {
  applyAccent(getAccent());
  const follow = () => applyAccent(getAccent(), { animate: true });
  window.addEventListener(CHANGE_EVENT, follow);
  return () => window.removeEventListener(CHANGE_EVENT, follow);
}
