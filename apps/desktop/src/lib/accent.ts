import { useEffect, useState } from 'react';
import { ACCENTS as SHARED_ACCENTS, DEFAULT_ACCENT, isAccent, type AccentId } from '@m3u8/contracts/src/accents.mjs';

/** Owner-selected accent colours (unique-look option 9), shared with the Chrome extension. Orange is the brand default. */
export type { AccentId };
export const ACCENTS = SHARED_ACCENTS;

// The accent lives in the desktop's settings.json (shared with the extension through the local bridge).
// Before that it lived only in this window's localStorage; the browser-only gallery still keeps it there.
const LEGACY_KEY = 'snagthis.accent';
const CHANGE_EVENT = 'snagthis:accent';
let current: AccentId | null = null;

function bridge() { return typeof window === 'undefined' ? undefined : window.desktop; }
function legacyAccent(): AccentId | null {
  try { const stored = localStorage.getItem(LEGACY_KEY); return isAccent(stored) ? stored : null; } catch { return null; }
}
function forgetLegacy() { try { localStorage.removeItem(LEGACY_KEY); } catch { /* Storage may be unavailable. */ } }
function announce(id: AccentId) {
  current = id;
  window.dispatchEvent(new CustomEvent<AccentId>(CHANGE_EVENT, { detail: id }));
}

function initialize(): AccentId {
  const desktop = bridge();
  const saved = desktop?.initialAccent;
  if (!desktop || !saved || !isAccent(saved.accent)) return legacyAccent() || DEFAULT_ACCENT;
  // Changes from Settings in another window, or from the Chrome extension, arrive from the main process.
  desktop.onAccentChange?.((state) => { if (isAccent(state?.accent) && state.accent !== current) announce(state.accent); });
  const legacy = legacyAccent();
  forgetLegacy();
  // One-time migration of a choice made before the accent was a real setting.
  if (legacy && !saved.accentChangedAt) {
    void desktop.saveSettings({ accent: legacy }).catch(() => {});
    return legacy;
  }
  return saved.accent;
}

export function getAccent(): AccentId {
  if (!current) current = initialize();
  return current;
}

export function setAccent(id: AccentId): void {
  if (!isAccent(id)) return;
  getAccent();
  announce(id);
  const desktop = bridge();
  if (desktop?.initialAccent) void desktop.saveSettings({ accent: id }).catch(() => {});
  else { try { localStorage.setItem(LEGACY_KEY, id); } catch { /* The gallery keeps the choice in memory. */ } }
}

/** The current accent, updated whenever any part of the app (or the Chrome extension) changes it. */
export function useAccent(): [AccentId, (id: AccentId) => void] {
  const [accent, setState] = useState<AccentId>(getAccent);
  useEffect(() => {
    const onChange = () => setState(getAccent());
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);
  return [accent, setAccent];
}
