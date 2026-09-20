const { parseHlsManifest } = require('@m3u8/contracts');
const { scopeMediaHeaders } = require('@m3u8/downloader-engine/src/core/MediaRequest');

function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Provide a valid video URL');
  return url;
}

async function readText(response, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) throw new Error('The video information is too large to inspect');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function resourceTitle(url) {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return filename.replace(/\.(?:m3u8|mp4|m4v|webm|mov|mkv|ts|mp3|m4a|ogg)$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 255) || undefined;
  } catch { return undefined; }
}

async function inspectMedia({ mediaUrl, headers = {}, resolvePage, fetchImpl = fetch }) {
  const original = httpUrl(mediaUrl);
  const youtube = /^(?:www\.|m\.|music\.)?youtube\.com$/.test(original.hostname) || original.hostname === 'youtu.be';
  if (youtube) {
    // Keep the watch URL for yt-dlp; expiring format URLs must not replace it.
    const result = { mediaUrl: original.href, sourcePageUrl: original.href, mediaType: 'file', variants: [], audio: [], subtitles: [] };
    try {
      const response = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(original.href)}&format=json`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (response.ok) {
        const metadata = JSON.parse(await readText(response, 64_000));
        if (typeof metadata.title === 'string') result.title = metadata.title.trim().slice(0, 255);
        if (typeof metadata.thumbnail_url === 'string' && httpUrl(metadata.thumbnail_url)) result.thumbnailUrl = metadata.thumbnail_url;
      } else await response.body?.cancel();
    } catch { /* Private/age-gated metadata can still be resolved by the downloader. */ }
    return result;
  }

  async function fetchSource(url, requestHeaders) {
    let target = httpUrl(url).href;
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await fetchImpl(target, { headers: scopeMediaHeaders(requestHeaders, target, { credentialOrigin: url }), redirect: 'manual', signal: AbortSignal.timeout(8000) });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        const next = httpUrl(new URL(response.headers.get('location'), target));
        await response.body?.cancel();
        if (new URL(target).protocol === 'https:' && next.protocol !== 'https:') throw new Error('This link redirects to an unsupported address');
        target = next.href;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('This link could not be checked. Open the source page and try again.'); }
      return { response, target };
    }
    throw new Error('This link redirects too many times');
  }

  async function inspectSource(url, requestHeaders, metadata = {}, allowPage = false, manifestText) {
    let target = httpUrl(url).href;
    let response;
    if (!manifestText) ({ response, target } = await fetchSource(target, requestHeaders));
    const contentType = response?.headers.get('content-type') || '';
    if (allowPage && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await response.body?.cancel();
      if (!resolvePage) throw new Error('Open this page in Chrome and use VidSnag to choose its video.');
      let resolved;
      try { resolved = await resolvePage({ url: target }); }
      catch { throw new Error('Could not find a video automatically. Open this page in Chrome, press play, then choose it in VidSnag.'); }
      if (!resolved?.mediaUrl || resolved.mediaUrl === target) throw new Error('No playable video was found. Open the page in Chrome, press play, and try the VidSnag extension.');
      const resolvedUrl = httpUrl(resolved.mediaUrl).href;
      return inspectSource(resolvedUrl, resolved.headers || {}, {
        title: typeof resolved.title === 'string' ? resolved.title.trim().slice(0, 255) : undefined,
        sourcePageUrl: original.href, thumbnailUrl: resolved.thumbnailUrl,
        headers: resolved.headers || {},
      }, false, resolved.manifestText);
    }
    if (manifestText || /mpegurl|text\/plain/i.test(contentType) || /\.m3u8(?:[?#]|$)/i.test(target)) {
      const text = manifestText || await readText(response);
      if (!/^\uFEFF?\s*#EXTM3U/.test(text)) throw new Error('This link does not point to a playable video playlist.');
      const result = parseHlsManifest(text, target);
      return { ...result, ...metadata, mediaUrl: target, mediaType: 'hls', title: metadata.title || resourceTitle(target), headers: scopeMediaHeaders(requestHeaders, target, { credentialOrigin: url }) };
    }
    await response?.body?.cancel();
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('The source returned a web page instead of a video. Reopen it in Chrome and try again.');
    return { ...metadata, mediaUrl: target, mediaType: 'file', title: metadata.title || resourceTitle(target), headers: scopeMediaHeaders(requestHeaders, target, { credentialOrigin: url }), variants: [], audio: [], subtitles: [] };
  }
  return inspectSource(original.href, headers, { sourcePageUrl: original.href, headers }, true);
}

module.exports = { inspectMedia };
