const { fetchText, requestWithRedirects } = require('./PlaylistUtils');
const { inspectHlsPlaylist, buildHlsRequestHeaders } = require('./HlsNativeDownload');
const { parseHlsManifest } = require('../../../contracts/src/hls');
const { findAudioRendition } = require('../../../contracts/src/audioTracks');

function mediaError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function classifyMedia(contentType, prefix) {
  const text = String(prefix || '').replace(/^\uFEFF/, '').trimStart();
  if (text.startsWith('#EXTM3U')) return 'hls';
  // Real manifests usually open with an XML declaration before <MPD>.
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<MPD\b/i.test(text) || /dash\+xml/i.test(contentType)) return 'dash';
  if (/text\/html|application\/xhtml/i.test(contentType) || /^<!doctype\s+html|^<html/i.test(text)) return 'page';
  if (/mpegurl/i.test(contentType)) return 'hls';
  return 'direct';
}

async function sniffMedia(url, headers, options = {}) {
  return requestWithRedirects(url, { ...headers, Range: 'bytes=0-4095' }, (response, finalUrl, request) => new Promise((resolve, reject) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      reject(Object.assign(mediaError(`Request failed with status ${response.statusCode}`, [401, 403, 410].includes(response.statusCode) ? 'SOURCE_EXPIRED' : 'NETWORK_ERROR'), { statusCode: response.statusCode }));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const prefix = Buffer.concat(chunks).subarray(0, 4096).toString('utf8');
      resolve({ mediaType: classifyMedia(response.headers['content-type'] || '', prefix), finalUrl });
      // An origin may ignore Range. Stop after the sniff instead of downloading its body.
      response.destroy();
      request.destroy();
    };
    response.on('data', (chunk) => { chunks.push(chunk); size += chunk.length; if (size >= 4096) finish(); });
    response.on('end', finish);
    response.on('error', (error) => { if (!done) reject(error); });
  }), { timeoutMs: 15_000, ...options });
}

function selectedRendition(items, groupId, language) {
  const grouped = (items || []).filter((item) => !groupId || item.groupId === groupId);
  if (language && language !== 'none') {
    const match = grouped.find((item) => item.language === language || item.name === language);
    if (!match) throw mediaError(`The requested ${language} track is unavailable`, 'SELECTION_UNAVAILABLE');
    return match;
  }
  return grouped.find((item) => item.default) || grouped[0];
}

function stablePath(url) {
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`; } catch { return ''; }
}

function variantUrls(variant) {
  return [variant.url || variant.variantUrl, ...(variant.backupUrls || [])].filter(Boolean);
}

// `fallback` restarts a download whose chosen rendition proved dead on the CDN:
// { excludedUrls: Set, belowHeight, audioTrack } picks a failover copy of the
// same rendition first, then the next lower quality, keeping the audio choice.
async function resolveHlsSelection(job, fallback = null) {
  const headers = buildHlsRequestHeaders(job.headers || {}, { sourcePageUrl: job.sourcePageUrl });
  job._headerPolicy ||= new Map();
  const options = { credentialOrigin: job.credentialOrigin || job.url, sourcePageUrl: job.sourcePageUrl, signal: job._downloadAbort?.signal, headerPolicy: job._headerPolicy };
  const selection = job.selection || {};
  const excluded = fallback?.excludedUrls || new Set();
  let currentUrl = job.url;
  let audioUrl;
  let subtitleUrl;
  let selectedHeight;
  let selectedVariant = null;
  let variantSelectionPending = Boolean(selection.variantUrl) && !fallback;
  const seen = new Set();
  // A playlist the page received from a POST response or blob URL is not
  // replayable by GET; the captured text stands in for the root playlist.
  const snapshot = typeof job.manifestText === 'string' && /^\uFEFF?\s*#EXTM3U/.test(job.manifestText) ? job.manifestText : null;
  const playlistSnapshots = {};
  for (let depth = 0; depth < 5; depth += 1) {
    if (job.cancelled) throw mediaError('Job cancelled', 'ABORT_ERR');
    if (seen.has(currentUrl)) throw mediaError('The video playlist contains a loop', 'UNSUPPORTED_MEDIA');
    seen.add(currentUrl);
    let fetched;
    if (depth === 0 && snapshot) {
      fetched = { text: snapshot, finalUrl: currentUrl };
      playlistSnapshots[currentUrl] = snapshot;
    } else fetched = await fetchText(currentUrl, headers, options);
    if (job.cancelled) throw mediaError('Job cancelled', 'ABORT_ERR');
    if (!String(fetched.text).replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) throw mediaError('The source did not return a video playlist', 'UNSUPPORTED_MEDIA');
    const info = inspectHlsPlaylist(fetched.text, fetched.finalUrl);
    if (info.unsupportedReason) throw mediaError(info.unsupportedReason, info.errorCode);
    const parsed = parseHlsManifest(fetched.text, fetched.finalUrl);
    if (!parsed.isMaster) {
      return { playlistUrl: fetched.finalUrl, playlistText: fetched.text, playlistInfo: info, headers, audioUrl, subtitleUrl, selectedHeight, selectedVariant, playlistSnapshots };
    }
    // Ordered highest first, AVC before HEVC/HDR at equal height; redundant
    // CDN copies are merged into one rendition with failover URLs.
    const variants = parsed.variants;
    let chosen = null;
    let chosenUrl = null;
    if (fallback) {
      const failedHeight = Number(fallback.belowHeight) || 0;
      for (const variant of variants) {
        const sameRendition = variantUrls(variant).some((url) => excluded.has(url));
        const url = variantUrls(variant).find((candidate) => !excluded.has(candidate));
        if (!url) continue;
        // A failover copy of the failed rendition first; otherwise only lower qualities.
        if (sameRendition || !failedHeight || !variant.height || variant.height < failedHeight) { chosen = variant; chosenUrl = url; break; }
      }
      if (!chosen) throw mediaError('No other quality of this video is available', 'SELECTION_UNAVAILABLE');
    }
    if (!chosen && variantSelectionPending) {
      chosen = variants.find((item) => variantUrls(item).includes(selection.variantUrl));
      if (chosen) chosenUrl = selection.variantUrl;
    }
    if (variantSelectionPending && !chosen) {
      // Proxy playlists can issue a different signed child URL on every read.
      // Recover the same rendition by its path, or by an unambiguous exact
      // resolution; never silently choose a lower quality or one of several.
      const path = stablePath(selection.variantUrl);
      const samePath = variants.filter((item) => variantUrls(item).some((url) => stablePath(url) === path));
      if (path && samePath.length === 1) chosen = samePath[0];
      else if (Number(selection.height) > 0) {
        const matchingHeight = variants.filter((item) => item.height === Number(selection.height));
        if (matchingHeight.length === 1) chosen = matchingHeight[0];
      }
    }
    if (variantSelectionPending && !chosen) throw mediaError('The selected video quality is no longer available', 'SELECTION_UNAVAILABLE');
    // The selected URL names a child of this master. If that child is another
    // master, it must not be required to contain its own URL as a rendition.
    variantSelectionPending = false;
    if (!chosen && !fallback && Number(selection.height) > 0) chosen = variants.find((item) => item.height && item.height <= Number(selection.height));
    if (!chosen && !fallback && Number(selection.height) > 0 && variants.some((item) => item.height)) throw mediaError('The requested quality is unavailable', 'SELECTION_UNAVAILABLE');
    chosen ||= variants[0];
    if (!chosen) throw mediaError('No downloadable video was found in this playlist', 'UNSUPPORTED_MEDIA');
    chosenUrl ||= chosen.url || chosen.variantUrl;
    selectedHeight = chosen.height;
    selectedVariant = { url: chosenUrl, urls: variantUrls(chosen), height: chosen.height || null };
    let audio;
    const audioTrack = fallback?.audioTrack || selection.audioTrack;
    if (audioTrack) {
      // A chosen track is identified by its rendition, not its language: sites
      // such as cinejoy.pk publish several nameless tracks without LANGUAGE.
      audio = findAudioRendition(parsed.audio, chosen.audioGroup, audioTrack);
      if (!audio) throw mediaError('The selected audio track is no longer available', 'SELECTION_UNAVAILABLE');
    } else audio = selectedRendition(parsed.audio, chosen.audioGroup, selection.audioLang);
    if (audio && audio.url) audioUrl = audio.url;
    if (selection.subtitleLang && selection.subtitleLang !== 'none') {
      const subtitle = selectedRendition(parsed.subtitles, chosen.subtitleGroup, selection.subtitleLang);
      subtitleUrl = subtitle && subtitle.url;
    }
    currentUrl = chosenUrl;
  }
  throw mediaError('The video playlist is nested too deeply', 'UNSUPPORTED_MEDIA');
}

module.exports = { classifyMedia, sniffMedia, resolveHlsSelection, mediaError };
