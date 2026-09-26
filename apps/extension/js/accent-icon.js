/* The toolbar icon and count badge follow the accent chosen in the popup or the desktop app.
 * Non-orange icons are drawn from the shared pixel-button geometry (shared/accents.js): one pixel
 * per cell at 16px and two at 32px, so they stay pixel-exact. Orange uses the packaged PNGs. */
globalThis.SnagThisAccentIcon = (() => {
  'use strict';
  const A = SnagThisAccents;
  const ORANGE_BADGE = '#dc4505';
  let accent = A.DEFAULT_ACCENT;
  let shown = null;

  // chrome.action accepts hex colours; white badge text keeps ≥ 4.5:1 on every accent's primary.
  function hex(hsl) {
    const [h, s, l] = hsl.match(/[\d.]+/g).map(Number);
    const a = s / 100 * Math.min(l / 100, 1 - l / 100);
    const channel = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
  }
  function badgeColor() { return accent === A.DEFAULT_ACCENT ? ORANGE_BADGE : hex(A.ACCENT_TOKENS[accent].primary); }

  async function show(id, { initial = false } = {}) {
    accent = A.isAccent(id) ? id : A.DEFAULT_ACCENT;
    // Chrome keeps a set icon while it runs and restores the manifest's orange on restart or reload.
    if (initial && accent === A.DEFAULT_ACCENT) shown = accent;
    if (accent === shown) return;
    shown = accent;
    try {
      if (accent === A.DEFAULT_ACCENT) await chrome.action.setIcon({ path: chrome.runtime.getManifest().action.default_icon });
      else {
        const imageData = {};
        for (const scale of [1, 2]) { const art = A.buttonIconPixels(accent, scale); imageData[art.width] = new ImageData(art.data, art.width, art.height); }
        await chrome.action.setIcon({ imageData });
      }
      await chrome.action.setBadgeBackgroundColor({ color: badgeColor() });
    } catch (error) { shown = null; console.warn('SnagThis could not recolour its toolbar icon.', error); }
  }

  chrome.storage.local.get('accent').then(stored => show(stored?.accent?.accent, { initial: true })).catch(() => {});
  chrome.storage.onChanged?.addListener((changes, area) => { if (area === 'local' && changes.accent) show(changes.accent.newValue?.accent); });
  return { badgeColor, hex };
})();
