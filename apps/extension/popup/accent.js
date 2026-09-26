/* Accent colour (unique-look option 9), shared with the desktop app.
 * Loaded in <head> so the saved accent is on <html> before the popup's first paint.
 * chrome.storage.local holds the choice ({ accent, changedAt }) for the worker's toolbar icon;
 * localStorage mirrors it because chrome.storage cannot be read synchronously. */
window.SnagThisPopupAccent = (() => {
  'use strict';
  const A = SnagThisAccents;
  const CACHE_KEY = 'snagthis.accent';
  const STORAGE_KEY = 'accent';
  const CROSSFADE_MS = 240;
  const storage = typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
  let applied = null; let fadeTimer = 0;
  let local = { accent: A.DEFAULT_ACCENT, changedAt: 0 };

  function valid(record) { return Boolean(record) && A.isAccent(record.accent) && A.isAccentTimestamp(record.changedAt); }
  function readCache() { try { const record = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return valid(record) ? record : null; } catch { return null; } }

  /** Sets the accent tokens on <html>; chrome and buttons crossfade over 240ms unless motion is reduced. */
  function apply(id, { animate = false } = {}) {
    if (!A.isAccent(id) || id === applied) return;
    applied = id;
    const root = document.documentElement;
    const fade = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearTimeout(fadeTimer);
    root.classList.toggle('accent-crossfade', fade);
    for (const [name, value] of A.accentVariables(id)) root.style.setProperty(name, value);
    root.dataset.accent = id;
    if (fade) fadeTimer = setTimeout(() => root.classList.remove('accent-crossfade'), CROSSFADE_MS + 60);
  }

  async function persist() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(local)); } catch { /* The mirror is only a paint hint. */ }
    if (storage) await storage.set({ [STORAGE_KEY]: local }).catch(() => {});
  }

  /** chrome.storage.local is the extension's record; the mirror only paints the first frame. */
  async function load() {
    const stored = storage ? (await storage.get(STORAGE_KEY).catch(() => ({})))[STORAGE_KEY] : null;
    const winner = A.newerAccent(local, valid(stored) ? stored : null);
    if (winner !== local) { local = { accent: winner.accent, changedAt: winner.changedAt }; apply(local.accent); }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(local)); } catch { /* Mirror unavailable. */ }
    return local;
  }

  /** A choice made in this popup. Later than anything seen so far, so it wins the next reconcile. */
  async function choose(id) {
    if (!A.isAccent(id)) return local;
    local = { accent: id, changedAt: Math.max(Date.now(), local.changedAt + 1) };
    apply(id, { animate: true });
    await persist();
    return local;
  }

  /**
   * Compares the desktop's accent ({ accent, accentChangedAt }) with this browser's.
   * Returns 'pulled' when the desktop's later choice was adopted, 'push' when this browser's
   * later choice should be sent to the desktop, and 'same' otherwise (including an older app
   * that has no accent, which is never written to).
   */
  function reconcile(remote) {
    if (!remote || !A.isAccent(remote.accent) || !A.isAccentTimestamp(remote.accentChangedAt)) return 'same';
    const theirs = { accent: remote.accent, changedAt: remote.accentChangedAt };
    if (theirs.changedAt > local.changedAt) {
      const changed = theirs.accent !== local.accent;
      local = theirs; apply(local.accent, { animate: true }); persist();
      return changed ? 'pulled' : 'same';
    }
    return local.changedAt > theirs.changedAt && local.accent !== theirs.accent ? 'push' : 'same';
  }

  const cached = readCache();
  if (cached) local = cached;
  // The development gallery may preview another accent (popup.html?demo&accent=cobalt).
  const params = new URLSearchParams(location.search);
  if (location.protocol !== 'chrome-extension:' && params.has('demo') && A.isAccent(params.get('accent'))) local = { accent: params.get('accent'), changedAt: 0 };
  apply(local.accent);

  return { load, choose, reconcile, apply, current: () => ({ ...local }) };
})();
