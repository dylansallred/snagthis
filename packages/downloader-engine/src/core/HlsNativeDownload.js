const { URL } = require('url');
const crypto = require('crypto');
const { buildFfmpegMetadataArgs } = require('../utils/mediaTags');

function buildHlsRequestHeaders(headers = {}, context = {}) {
  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = String(rawKey || '').trim();
    const value = String(rawValue || '').trim();
    if (!key || !value) continue;
    normalized[key] = value;
  }

  const sourcePageUrl = String(context.sourcePageUrl || '').trim();
  if (sourcePageUrl) {
    const hasReferer = Object.keys(normalized).some((key) => key.toLowerCase() === 'referer');
    const hasOrigin = Object.keys(normalized).some((key) => key.toLowerCase() === 'origin');

    if (!hasReferer) {
      normalized.Referer = sourcePageUrl;
    }

    if (!hasOrigin) {
      try {
        normalized.Origin = new URL(sourcePageUrl).origin;
      } catch {
        // Ignore malformed source page URLs.
      }
    }
  }

  const hasUserAgent = Object.keys(normalized).some((key) => key.toLowerCase() === 'user-agent');
  if (!hasUserAgent) {
    normalized['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
  }

  // Force revalidation for HLS playlists/segments to avoid stale CDN or proxy cache hits.
  normalized['Cache-Control'] = 'no-cache';
  normalized.Pragma = 'no-cache';
  return normalized;
}

function parseHlsAttributes(text) {
  const attributes = {};
  for (const match of String(text || '').matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/gi)) {
    attributes[match[1].toUpperCase()] = (match[2] == null ? match[3] : match[2]).trim();
  }
  return attributes;
}

function stableResourceUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Signed query strings may change on refresh; a different path/origin is a
    // different resource and cannot safely reuse previously downloaded pieces.
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
}

function inspectHlsPlaylist(playlistText, playlistUrl) {
  const lines = String(playlistText || '').split(/\r?\n/);
  const segments = [];
  const topology = [];
  let totalDurationSeconds = 0;
  let hasDiscontinuity = false;
  let hasMap = false;
  let hasByteRange = false;
  let hasFmp4Segments = false;
  let isMasterPlaylist = false;
  let hasEndList = false;
  let hasEncryption = false;
  let hasDrm = false;
  let hasUnsupportedEncryption = false;
  let mediaSequence = '0';
  let discontinuitySequence = '0';
  let discontinuities = 0;
  let currentKey = null;
  let currentMap = null;
  let pendingDuration = null;
  let pendingByteRange = null;
  let topologyValid = true;

  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;

    if (/^#EXT-X-(?:STREAM-INF|I-FRAME-STREAM-INF|MEDIA):/i.test(trimmed)) {
      isMasterPlaylist = true;
      continue;
    }
    if (/^#EXT-X-ENDLIST\b/i.test(trimmed)) { hasEndList = true; continue; }
    if (/^#EXT-X-MEDIA-SEQUENCE:/i.test(trimmed)) { mediaSequence = trimmed.split(':')[1].trim(); continue; }
    if (/^#EXT-X-DISCONTINUITY-SEQUENCE:/i.test(trimmed)) { discontinuitySequence = trimmed.split(':')[1].trim(); continue; }
    if (/^#EXT-X-DISCONTINUITY\b/i.test(trimmed)) {
      hasDiscontinuity = true;
      discontinuities += 1;
      continue;
    }
    if (/^#EXT-X-(?:SESSION-)?KEY:/i.test(trimmed)) {
      const attributes = parseHlsAttributes(trimmed.slice(trimmed.indexOf(':') + 1));
      const method = String(attributes.METHOD || '').toUpperCase();
      if (method === 'NONE') { currentKey = null; continue; }
      hasEncryption = true;
      if (/^SAMPLE-AES/.test(method) || (attributes.KEYFORMAT && attributes.KEYFORMAT !== 'identity')) {
        hasDrm = true;
      } else if (method !== 'AES-128') {
        hasUnsupportedEncryption = true;
      }
      currentKey = {
        method,
        uri: stableResourceUrl(attributes.URI, playlistUrl),
        iv: attributes.IV || null,
        format: attributes.KEYFORMAT || 'identity',
        versions: attributes.KEYFORMATVERSIONS || null,
      };
      if (!currentKey.uri) topologyValid = false;
      continue;
    }
    if (/^#EXT-X-MAP:/i.test(trimmed)) {
      hasMap = true;
      const attributes = parseHlsAttributes(trimmed.slice(trimmed.indexOf(':') + 1));
      currentMap = {
        uri: stableResourceUrl(attributes.URI, playlistUrl),
        byteRange: attributes.BYTERANGE || null,
        key: currentKey,
      };
      if (!currentMap.uri) topologyValid = false;
      if (/\.(?:mp4|m4s|cmf[av])$/i.test(currentMap.uri || '')) hasFmp4Segments = true;
      continue;
    }
    if (/^#EXT-X-BYTERANGE:/i.test(trimmed)) {
      hasByteRange = true;
      pendingByteRange = trimmed.slice(trimmed.indexOf(':') + 1).trim();
      continue;
    }
    const extInfMatch = trimmed.match(/^#EXTINF:([0-9.]+)/i);
    if (extInfMatch) {
      const duration = Number.parseFloat(extInfMatch[1]);
      if (Number.isFinite(duration) && duration > 0) {
        totalDurationSeconds += duration;
        pendingDuration = duration;
      } else topologyValid = false;
      continue;
    }
    // Skipped/gap pieces cannot be safely reused as an ordinary complete VOD.
    if (/^#EXT-X-(?:GAP|SKIP|PART|PRELOAD-HINT)(?::|$)/i.test(trimmed)) topologyValid = false;
    if (trimmed.startsWith('#')) continue;
    try {
      const segmentUrl = new URL(trimmed, playlistUrl).toString();
      segments.push(segmentUrl);
      const stableUrl = stableResourceUrl(segmentUrl, playlistUrl);
      if (!stableUrl || pendingDuration == null) topologyValid = false;
      topology.push({
        url: stableUrl,
        duration: pendingDuration,
        byteRange: pendingByteRange,
        map: currentMap,
        key: currentKey,
        discontinuities,
      });
      pendingDuration = null;
      pendingByteRange = null;
      if (/\.(?:m4s|mp4|cmfa|cmfv)(?:[?#].*)?$/i.test(segmentUrl)) hasFmp4Segments = true;
    } catch { topologyValid = false; }
  }
  const isLive = !isMasterPlaylist && !hasEndList;
  const hasAdvancedFeatures = isMasterPlaylist || hasDiscontinuity || hasMap
    || hasByteRange || hasFmp4Segments || hasEncryption;
  let unsupportedReason = null;
  let errorCode = null;
  if (hasDrm) {
    unsupportedReason = 'This video uses DRM and cannot be downloaded.';
    errorCode = 'DRM_PROTECTED';
  } else if (hasUnsupportedEncryption) {
    unsupportedReason = 'This video uses an unsupported encryption method.';
    errorCode = 'UNSUPPORTED_ENCRYPTION';
  } else if (!/^\uFEFF?\s*#EXTM3U(?:\s|$)/.test(String(playlistText || ''))) {
    unsupportedReason = 'The link did not return a valid video playlist.';
    errorCode = 'INVALID_PLAYLIST';
  } else if (isLive) {
    unsupportedReason = 'Live-stream recording is not supported. Try a finished video.';
    errorCode = 'LIVE_STREAM_UNSUPPORTED';
  } else if (!isMasterPlaylist && segments.length === 0) {
    unsupportedReason = 'The video playlist contains no media segments.';
    errorCode = 'INVALID_PLAYLIST';
  }
  const topologyFingerprint = topologyValid && !isMasterPlaylist && hasEndList && topology.length > 0
    ? crypto.createHash('sha256').update(JSON.stringify({ mediaSequence, discontinuitySequence, topology })).digest('hex')
    : null;
  return {
    segments,
    totalSegments: segments.length,
    totalDurationSeconds,
    hasDiscontinuity,
    hasMap,
    hasByteRange,
    hasFmp4Segments,
    isMasterPlaylist,
    hasAdvancedFeatures,
    hasEncryption,
    hasDrm,
    hasUnsupportedEncryption,
    hasEndList,
    isLive,
    unsupportedReason,
    errorCode,
    topologyFingerprint,
  };
}

function shouldPreferNativeHlsDownload(playlistInfo) {
  return !!(playlistInfo && playlistInfo.hasAdvancedFeatures);
}

function buildFfmpegHeaderBlob(headers = {}) {
  const blockedHeaders = new Set([
    'connection',
    'content-length',
    'host',
    'transfer-encoding',
  ]);

  const entries = [];
  for (const [rawKey, rawValue] of Object.entries(buildHlsRequestHeaders(headers))) {
    const key = String(rawKey || '').trim();
    const value = String(rawValue || '').trim();
    if (!key || !value) continue;
    if (blockedHeaders.has(key.toLowerCase())) continue;
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) continue;
    entries.push(`${key}: ${value}`);
  }

  if (entries.length === 0) {
    return '';
  }

  return `${entries.join('\r\n')}\r\n`;
}

function buildNativeHlsArgs({ job = {}, playlistUrl, outputPath, headers, selection = job.selection || {}, audioUrl, subtitleUrl, streamSelection = {}, scopedProxy = false, inputIsHls = true, spooledInput = false, maxSegmentAttempts = job.maxSegmentAttempts }) {
  const metadataArgs = buildFfmpegMetadataArgs(job);
  const headerBlob = scopedProxy ? '' : buildFfmpegHeaderBlob(headers);
  const args = [
    '-y',
    '-nostdin',
    '-loglevel', 'warning',
    '-nostats',
    '-progress', 'pipe:2',
  ];

  if (headerBlob) {
    args.push('-headers', headerBlob);
  }

  const attempts = Number.isFinite(Number(maxSegmentAttempts)) ? Math.max(1, Math.min(30, Math.floor(Number(maxSegmentAttempts)))) : 30;
  const addInput = (inputUrl, isHls = true, usesSpool = false) => {
    if (isHls) {
      // Playlist analysis already verified the content. Some CDNs label valid
      // HLS/fMP4 resources as JPEGs, so their suffixes must not choose a demuxer.
      args.push('-f', 'hls', '-allowed_extensions', 'ALL');
      // The spool owns retries for its pieces; other HLS inputs use the same
      // finite attempt budget. FFmpeg's default is to skip after the first error.
      args.push('-seg_max_retry', String(usesSpool ? 0 : attempts - 1));
      if (usesSpool) args.push('-http_multiple', '0');
      if (scopedProxy) {
        // Recent FFmpeg versions separately check segment suffixes against the
        // detected container. The relay only serves registered playlist URLs;
        // permit their real bytes to determine the format (e.g. fMP4 in .jpg).
        args.push('-allowed_segment_extensions', 'ALL', '-extension_picky', '0');
      }
    }
    args.push(
      '-protocol_whitelist', scopedProxy ? 'http,tcp,crypto' : 'file,http,https,tcp,tls,crypto,data',
      '-fflags', '+genpts+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-i', inputUrl,
    );
  };
  addInput(playlistUrl, inputIsHls, spooledInput);
  let nextInput = 1;
  let audioInput = 0;
  let subtitleInput = 0;
  if (audioUrl) { audioInput = nextInput++; addInput(audioUrl); }
  if (subtitleUrl) { subtitleInput = nextInput++; addInput(subtitleUrl, /\.m3u8(?:[?#]|$)/i.test(subtitleUrl)); }
  const index = (value) => Number.isInteger(value) && value >= 0 ? value : null;
  const language = (value) => /^[A-Za-z0-9_-]{1,35}$/.test(String(value || '')) ? String(value) : null;
  if (!selection.audioOnly) {
    args.push('-map', index(streamSelection.videoIndex) != null ? `0:${streamSelection.videoIndex}` : '0:v:0');
  } else args.push('-vn');
  const audioLanguage = language(selection.audioLang);
  let audioMap;
  if (audioUrl) audioMap = `${audioInput}:a:0`;
  else if (index(streamSelection.audioIndex) != null) audioMap = `0:${streamSelection.audioIndex}`;
  else if (audioLanguage) audioMap = `0:a:m:language:${audioLanguage}`;
  else audioMap = selection.audioOnly ? '0:a:0' : '0:a:0?';
  args.push('-map', audioMap);
  const subtitleLanguage = language(selection.subtitleLang);
  const includeSubtitles = !selection.audioOnly && (
    subtitleUrl || index(streamSelection.subtitleIndex) != null || (subtitleLanguage && subtitleLanguage !== 'none')
  );
  if (includeSubtitles) {
    const subtitleMap = subtitleUrl ? `${subtitleInput}:s:0`
      : index(streamSelection.subtitleIndex) != null ? `0:${streamSelection.subtitleIndex}`
        : `0:s:m:language:${subtitleLanguage}`;
    args.push('-map', subtitleMap);
  }
  args.push('-c', 'copy');
  if (includeSubtitles) args.push('-c:s', 'mov_text');
  const probeSeconds = Number(job.probe && job.probe.seconds);
  if (Number.isFinite(probeSeconds) && probeSeconds > 0) args.push('-t', String(Math.min(30, Math.max(1, probeSeconds))));
  args.push(
    '-movflags', '+faststart',
    '-max_interleave_delta', '0',
    ...metadataArgs,
    // The temporary suffix is intentionally .mp4.part, so select its muxer.
    '-f', 'mp4',
    outputPath,
  );

  return args;
}

module.exports = {
  buildHlsRequestHeaders,
  inspectHlsPlaylist,
  shouldPreferNativeHlsDownload,
  buildFfmpegHeaderBlob,
  buildNativeHlsArgs,
  parseHlsAttributes,
};
