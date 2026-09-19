/* Isolated-world page metadata and video observation. Source pages never receive app credentials. */
(() => {
  'use strict';
  const CHANNEL = 'vidsnag:media';
  let lastPage = location.href;
  let scanTimer;
  const watchedVideos = new WeakSet();
  function send(message) { chrome.runtime.sendMessage(message).catch(() => {}); }
  function absolute(value) {
    if (!value) return '';
    try { const url = new URL(value, document.baseURI); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function meta(selector) { return document.querySelector(selector)?.getAttribute('content')?.trim() || ''; }
  function frameGrab(video) {
    if (!video || video.readyState < 2 || !video.videoWidth) return '';
    try {
      const canvas = document.createElement('canvas'); canvas.width = 208; canvas.height = 116;
      const context = canvas.getContext('2d'); if (!context) return '';
      context.drawImage(video, 0, 0, 208, 116);
      for (const quality of [0.65, 0.4, 0.2]) { const data = canvas.toDataURL('image/jpeg', quality); if (data.length <= 20480) return data; }
    } catch { /* Cross-origin video frames may have a tainted canvas. */ }
    return '';
  }
  function collectPageContext(mediaUrl = '') {
    const videos = Array.from(document.querySelectorAll('video'));
    const video = videos.find(item => absolute(item.currentSrc || item.src) === mediaUrl) || (videos.length === 1 ? videos[0] : null);
    const candidates = [
      { source: 'document.title', value: document.title },
      { source: 'meta.og:title', value: meta('meta[property="og:title"]') },
      { source: 'meta.twitter:title', value: meta('meta[name="twitter:title"]') },
      { source: 'dom.h1', value: document.querySelector('h1')?.textContent || '' },
    ].map(item => ({ source: item.source, value: String(item.value || '').trim().slice(0, 255) })).filter(item => item.value);
    const url = new URL(location.href);
    const id = /(^|\.)youtube\.com$/.test(url.hostname) ? url.searchParams.get('v') || /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1] : url.hostname === 'youtu.be' ? url.pathname.slice(1) : '';
    const youtube = /^[\w-]{6,20}$/.test(id || '') ? {
      videoId: id, title: (meta('meta[property="og:title"]') || document.title).replace(/\s*[-|]\s*YouTube\s*$/i, ''),
      thumbnailUrl: absolute(meta('meta[property="og:image"]')) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      durationSeconds: video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      channelName: document.querySelector('[itemprop="author"] [itemprop="name"]')?.getAttribute('content') || '',
    } : null;
    const thumbnailUrl = youtube?.thumbnailUrl || absolute(video?.poster) || absolute(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]')) || frameGrab(video);
    let pageEpisodeHint = null;
    let decodedPath = url.pathname; try { decodedPath = decodeURIComponent(url.pathname); } catch { /* Keep the encoded path if it is malformed. */ }
    const episode = /(?:^|\W)s(\d{1,2})e(\d{1,3})(?:\W|$)|(?:^|\W)(\d{1,2})x(\d{1,3})(?:\W|$)/i.exec(`${document.title} ${decodedPath}`);
    if (episode) pageEpisodeHint = { source: 'page', matchedPattern: 'explicit-season-episode', seasonNumber: Number(episode[1] || episode[3]), episodeNumber: Number(episode[2] || episode[4]) };
    return {
      sourcePageUrl: location.href, sourcePageTitle: document.title.slice(0, 255), pageTitleCandidates: candidates,
      thumbnailUrl, poster: absolute(video?.poster), durationSeconds: video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      height: video?.videoHeight || null, youtubeMetadata: youtube, pageEpisodeHint, pageIsTvContext: Boolean(pageEpisodeHint), pageContextCollectedAt: Date.now(),
    };
  }
  function navigation() {
    if (lastPage === location.href) return;
    lastPage = location.href;
    send({ cmd: 'PAGE_NAVIGATED', pageUrl: lastPage });
    scheduleScan();
  }
  function scan() {
    navigation();
    const context = collectPageContext();
    send({ cmd: 'PAGE_CONTEXT', context });
    if (context.youtubeMetadata) {
      send({ cmd: 'STORE_DETECTED_MEDIA', media: { ...context, url: `https://www.youtube.com/watch?v=${context.youtubeMetadata.videoId}`, type: 'youtube', mediaKind: 'youtube-page', contentType: 'video/youtube' } });
    }
    for (const video of Array.from(document.querySelectorAll('video')).slice(0, 20)) {
      if (!watchedVideos.has(video)) {
        watchedVideos.add(video);
        for (const event of ['loadedmetadata', 'playing', 'durationchange']) video.addEventListener(event, scheduleScan, { passive: true });
      }
      const sources = [video.currentSrc, video.getAttribute('src'), ...Array.from(video.querySelectorAll('source')).map(source => source.src)];
      for (const candidate of new Set(sources.map(absolute).filter(Boolean))) {
        send({ cmd: 'STORE_DETECTED_MEDIA', media: { ...collectPageContext(candidate), url: candidate, contentType: video.querySelector('source')?.type || 'video/unknown', detectedAt: Date.now() } });
      }
    }
  }
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 150); }
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== CHANNEL) return;
    if (event.data.navigation) { navigation(); return; }
    const incoming = event.data.media;
    if (!incoming || typeof incoming.url !== 'string' || !absolute(incoming.url)) return;
    if (String(incoming.manifestText || '').length > 262144) return;
    send({ cmd: 'STORE_DETECTED_MEDIA', media: { ...incoming, ...collectPageContext(absolute(incoming.url)) } });
  });
  chrome.runtime.onMessage.addListener(message => { if (message?.cmd === 'SCAN_PAGE') scan(); });
  window.addEventListener('popstate', navigation); window.addEventListener('hashchange', navigation);
  const observer = new MutationObserver(scheduleScan);
  function start() {
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'poster', 'content'] });
    scan();
  }
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
