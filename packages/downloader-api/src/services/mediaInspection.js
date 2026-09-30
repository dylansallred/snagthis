const { parseHlsManifest, parseDashAudio } = require('@m3u8/contracts');
const { scopeMediaHeaders } = require('@m3u8/downloader-engine/src/core/MediaRequest');
const { assertPublicUrl } = require('../utils/publicAddress');

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
    return filename.replace(/\.(?:m3u8|mpd|mp4|m4v|webm|mov|mkv|ts|mp3|m4a|ogg)$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 255) || undefined;
  } catch { return undefined; }
}

function urlPath(value) {
  try { const url = new URL(value); return url.origin + url.pathname; } catch { return ''; }
}

/** Flag variants that the page's own player was seen loading (exact URL, else origin+path). */
function markObservedVariants(inspection, observedUrls) {
  if (!Array.isArray(observedUrls) || !observedUrls.length || !Array.isArray(inspection.variants)) return inspection;
  const exact = new Set(observedUrls.filter((value) => typeof value === 'string').slice(0, 32));
  const paths = new Set([...exact].map(urlPath).filter(Boolean));
  const variants = inspection.variants.map((variant) => (exact.has(variant.url) || paths.has(urlPath(variant.url))
    ? { ...variant, observed: true } : variant));
  return { ...inspection, variants };
}

/**
 * Desktop paste inspection. Every fetch, including each redirect hop, goes only to
 * hosts whose DNS answers are all public addresses: never this computer, the local
 * network, link-local, CGNAT (100.64/10) or unique-local IPv6.
 * `allowPrivateAddresses` (createApiServer's `inspectPrivateAddresses`) is set only by
 * embedding code, never by a request: the desktop app sets it because its /api route
 * serves only links the user pasted, so home servers and NAS links keep working. The
 * hidden page resolver stays public-only because it runs arbitrary pages' scripts.
 */
async function inspectMedia({ mediaUrl, headers = {}, resolvePage, fetchImpl = fetch, lookup, allowPrivateAddresses = false }) {
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
      if (allowPrivateAddresses !== true) await assertPublicUrl(target, { lookup });
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
      if (!resolvePage) throw new Error('Open this page in Chrome and use SnagThis to choose its video.');
      let resolved;
      try { resolved = await resolvePage({ url: target }); }
      catch { throw new Error('Could not find a video automatically. Open this page in Chrome, press play, then choose it in SnagThis.'); }
      if (!resolved?.mediaUrl || resolved.mediaUrl === target) throw new Error('No playable video was found. Open the page in Chrome, press play, and try the SnagThis extension.');
      const resolvedUrl = httpUrl(resolved.mediaUrl).href;
      const inspection = await inspectSource(resolvedUrl, resolved.headers || {}, {
        title: typeof resolved.title === 'string' ? resolved.title.trim().slice(0, 255) : undefined,
        // The page's own title, site name and channel, for the saved video's Source.
        ...Object.fromEntries(['pageTitle', 'siteName', 'uploader'].flatMap((key) => (typeof resolved[key] === 'string' && resolved[key].trim() ? [[key, resolved[key].trim().slice(0, 255)]] : []))),
        sourcePageUrl: original.href, thumbnailUrl: resolved.thumbnailUrl,
        headers: resolved.headers || {},
      }, false, resolved.manifestText);
      return markObservedVariants(inspection, resolved.observedUrls);
    }
    if (manifestText || /mpegurl|text\/plain/i.test(contentType) || /\.m3u8(?:[?#]|$)/i.test(target)) {
      const text = manifestText || await readText(response);
      if (!/^\uFEFF?\s*#EXTM3U/.test(text)) throw new Error('This link does not point to a playable video playlist.');
      const result = parseHlsManifest(text, target);
      return { ...result, ...metadata, mediaUrl: target, mediaType: 'hls', title: metadata.title || resourceTitle(target), headers: scopeMediaHeaders(requestHeaders, target, { credentialOrigin: url }) };
    }
    if (/dash\+xml/i.test(contentType) || /\.mpd(?:[?#]|$)/i.test(target)) {
      // DASH downloads use yt-dlp; its audio adaptation sets still get labels
      // (lang, label, Role) and FFmpeg stream indexes for desktop samples.
      const text = await readText(response);
      if (!/<MPD\b/i.test(text)) throw new Error('This link does not point to a playable video.');
      return { ...metadata, mediaUrl: target, mediaType: 'file', title: metadata.title || resourceTitle(target), headers: scopeMediaHeaders(requestHeaders, target, { credentialOrigin: url }), variants: [], audio: parseDashAudio(text, target), subtitles: [] };
    }
    await response?.body?.cancel();
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('The source returned a web page instead of a video. Reopen it in Chrome and try again.');
    return { ...metadata, mediaUrl: target, mediaType: 'file', title: metadata.title || resourceTitle(target), headers: scopeMediaHeaders(requestHeaders, target, { credentialOrigin: url }), variants: [], audio: [], subtitles: [] };
  }
  return inspectSource(original.href, headers, { sourcePageUrl: original.href, headers }, true);
}

module.exports = { inspectMedia };
