const { fetchText, requestWithRedirects } = require('./PlaylistUtils');
const { inspectHlsPlaylist, buildHlsRequestHeaders } = require('./HlsNativeDownload');
const { parseHlsManifest } = require('../../../contracts/src/hls');

function mediaError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function classifyMedia(contentType, prefix) {
  const text = String(prefix || '').replace(/^\uFEFF/, '').trimStart();
  if (text.startsWith('#EXTM3U')) return 'hls';
  if (/^\s*<(?:\?xml[^>]*>\s*)?MPD\b/i.test(text)) return 'dash';
  if (/text\/html|application\/xhtml/i.test(contentType) || /^<!doctype\s+html|^<html/i.test(text)) return 'page';
  if (/mpegurl/i.test(contentType)) return 'hls';
  return 'direct';
}

async function sniffMedia(url, headers, options = {}) {
  return requestWithRedirects(url, { ...headers, Range: 'bytes=0-4095' }, (response, finalUrl, request) => new Promise((resolve, reject) => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      reject(mediaError(`Request failed with status ${response.statusCode}`, [401, 403, 410].includes(response.statusCode) ? 'SOURCE_EXPIRED' : 'NETWORK_ERROR'));
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

async function resolveHlsSelection(job) {
  const headers = buildHlsRequestHeaders(job.headers || {}, { sourcePageUrl: job.sourcePageUrl });
  const options = { credentialOrigin: job.credentialOrigin || job.url, sourcePageUrl: job.sourcePageUrl };
  const selection = job.selection || {};
  let currentUrl = job.url;
  let audioUrl;
  let subtitleUrl;
  let selectedHeight;
  const seen = new Set();
  for (let depth = 0; depth < 5; depth += 1) {
    if (seen.has(currentUrl)) throw mediaError('The video playlist contains a loop', 'UNSUPPORTED_MEDIA');
    seen.add(currentUrl);
    const fetched = await fetchText(currentUrl, headers, options);
    if (!String(fetched.text).replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) throw mediaError('The source did not return a video playlist', 'UNSUPPORTED_MEDIA');
    const info = inspectHlsPlaylist(fetched.text, fetched.finalUrl);
    if (info.unsupportedReason) throw mediaError(info.unsupportedReason, info.errorCode);
    const parsed = parseHlsManifest(fetched.text, fetched.finalUrl);
    if (!parsed.isMaster) {
      return { playlistUrl: fetched.finalUrl, playlistText: fetched.text, playlistInfo: info, headers, audioUrl, subtitleUrl, selectedHeight };
    }
    const variants = [...(parsed.variants || [])].sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0));
    let chosen = selection.variantUrl ? variants.find((item) => item.url === selection.variantUrl || item.variantUrl === selection.variantUrl) : null;
    if (selection.variantUrl && !chosen) throw mediaError('The selected video quality is no longer available', 'SELECTION_UNAVAILABLE');
    if (!chosen && Number(selection.height) > 0) chosen = variants.find((item) => item.height && item.height <= Number(selection.height));
    if (!chosen && Number(selection.height) > 0 && variants.some((item) => item.height)) throw mediaError('The requested quality is unavailable', 'SELECTION_UNAVAILABLE');
    chosen ||= variants[0];
    if (!chosen) throw mediaError('No downloadable video was found in this playlist', 'UNSUPPORTED_MEDIA');
    selectedHeight = chosen.height;
    const audio = selectedRendition(parsed.audio, chosen.audioGroup, selection.audioLang);
    if (audio && audio.url) audioUrl = audio.url;
    if (selection.subtitleLang && selection.subtitleLang !== 'none') {
      const subtitle = selectedRendition(parsed.subtitles, chosen.subtitleGroup, selection.subtitleLang);
      subtitleUrl = subtitle && subtitle.url;
    }
    currentUrl = chosen.url || chosen.variantUrl;
  }
  throw mediaError('The video playlist is nested too deeply', 'UNSUPPORTED_MEDIA');
}

module.exports = { classifyMedia, sniffMedia, resolveHlsSelection, mediaError };
