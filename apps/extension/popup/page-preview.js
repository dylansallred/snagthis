/* A bounded recording supplied by this tab's content script, never a desktop job. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VidSnagPagePreview = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function clipBlob(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > 4 * 1024 * 1024) return null;
    const match = /^data:video\/webm(?:;codecs=[a-z0-9, "-]+)?;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) return null;
    try {
      const binary = atob(match[1]); const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type: 'video/webm' });
    } catch { return null; }
  }
  function create({ video, send, tabId, mediaId, onPlaying, onError }) {
    const requestId = crypto.randomUUID();
    let disposed = false; let currentUrl = ''; let pendingUrl = ''; let lastTime = 0;
    const context = { tabId, mediaId, requestId };
    const playing = () => { if (!disposed) onPlaying?.(); };
    const failed = () => { if (!disposed) { destroy(); onError?.(); } };
    const install = (url, phase) => {
      const previous = currentUrl; currentUrl = url; pendingUrl = ''; lastTime = 0;
      video.dataset.previewPhase = phase; video.dataset.clipKey = `page:${requestId}:${phase}`;
      video.src = url; video.load(); video.play().catch(failed);
      if (previous) URL.revokeObjectURL(previous);
    };
    const progress = () => {
      const currentTime = video.currentTime;
      if (pendingUrl && currentTime < lastTime) install(pendingUrl, 'full');
      else lastTime = currentTime;
    };
    function destroy() {
      if (disposed) return; disposed = true;
      video.removeEventListener('playing', playing); video.removeEventListener('error', failed); video.removeEventListener('timeupdate', progress);
      video.pause(); video.removeAttribute('src'); video.load();
      if (currentUrl) URL.revokeObjectURL(currentUrl); if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      send({ cmd: 'CANCEL_PAGE_VIDEO_PREVIEW', ...context }).catch(() => {});
    }
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.loop = true; video.preload = 'auto';
    video.addEventListener('playing', playing); video.addEventListener('error', failed); video.addEventListener('timeupdate', progress);
    (async () => {
      const quick = await send({ cmd: 'GET_PAGE_VIDEO_PREVIEW', ...context, phase: 'quick' });
      if (disposed) return;
      const quickBlob = quick?.ok && clipBlob(quick.sourcePreviewDataUrl);
      if (!quickBlob) { failed(); return; }
      install(URL.createObjectURL(quickBlob), quick.complete ? 'full' : 'quick');
      if (quick.complete) return;
      const full = await send({ cmd: 'GET_PAGE_VIDEO_PREVIEW', ...context, phase: 'full' });
      if (disposed) return;
      const fullBlob = full?.ok && clipBlob(full.sourcePreviewDataUrl);
      // A failed longer recording leaves the already usable quick loop intact.
      if (fullBlob) pendingUrl = URL.createObjectURL(fullBlob);
    })().catch(() => { if (!currentUrl) failed(); });
    return { destroy };
  }
  return { create, clipBlob };
});
