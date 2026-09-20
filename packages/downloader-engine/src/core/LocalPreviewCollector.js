const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { generatePreviewAssets, PREVIEW_CLIP_SUFFIX, INTERIM_PREVIEW_CLIP_SUFFIX, isCurrentPreviewClipPath } = require('./PreviewClip');

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const WINDOW_SECONDS = 30;
const RETRY_FOOTAGE_SECONDS = 10;

function attributes(text) {
  const result = {};
  const pattern = /([A-Z0-9-]+)\s*=\s*(?:"([^"]*)"|([^,]*))(?:,|$)/gi;
  let match;
  while ((match = pattern.exec(text))) result[match[1].toUpperCase()] = match[2] ?? match[3].trim();
  return result;
}

function parsePlaylist(text, playlistUrl) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('Not a media playlist');
  const resources = new Map();
  const segments = [];
  const headers = [];
  let sequence = 0n;
  let discontinuitySequence = 0n;
  let discontinuities = 0;
  let pendingDiscontinuities = 0;
  let pendingTags = [];
  let pendingDuration = null;
  let info = '';
  let currentKey = null;
  let currentMap = null;
  let duration = 0;
  function resource(value, kind) {
    const url = new URL(value, playlistUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported media reference');
    if (!resources.has(url.href)) resources.set(url.href, { url: url.href, name: `part-${resources.size}.${kind === 'key' ? 'key' : kind === 'map' ? 'mp4' : currentMap ? 'm4s' : 'ts'}`, kind, indices: [], path: '', bytes: 0, lastUse: -1 });
    return resources.get(url.href);
  }
  for (const line of lines.slice(1)) {
    if (/^#EXT-X-(?:STREAM-INF|I-FRAME-STREAM-INF|MEDIA|SESSION-KEY|BYTERANGE|DEFINE|PART|PRELOAD-HINT):/.test(line)) throw new Error('Unsupported preview playlist');
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequence = BigInt(line.slice(line.indexOf(':') + 1));
    else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:')) discontinuitySequence = BigInt(line.slice(line.indexOf(':') + 1));
    else if (/^#EXT-X-(?:VERSION|TARGETDURATION):/.test(line) || line === '#EXT-X-INDEPENDENT-SEGMENTS') headers.push(line);
    else if (line.startsWith('#EXT-X-KEY:')) {
      const values = attributes(line.slice(line.indexOf(':') + 1));
      if (values.METHOD === 'NONE') currentKey = null;
      else {
        if (values.METHOD !== 'AES-128' || (values.KEYFORMAT && values.KEYFORMAT !== 'identity') || !values.URI) throw new Error('Unsupported preview encryption');
        currentKey = { line, resource: resource(values.URI, 'key') };
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const values = attributes(line.slice(line.indexOf(':') + 1));
      if (!values.URI || values.BYTERANGE || (currentKey && !attributes(currentKey.line).IV)) throw new Error('Unsupported initialization range or encryption');
      currentMap = { line, resource: resource(values.URI, 'map'), key: currentKey };
    } else if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(pendingDuration) || pendingDuration <= 0) throw new Error('Invalid segment duration');
      info = line;
    } else if (line === '#EXT-X-DISCONTINUITY') {
      discontinuities += 1; pendingDiscontinuities += 1; pendingTags.push(line);
    } else if (line === '#EXT-X-ENDLIST' || line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      // Each local window is explicitly ended below, independent of the source's lifecycle.
    } else if (line.startsWith('#')) {
      if (/\bURI\s*=/i.test(line)) throw new Error('Unsupported URI-bearing playlist tag');
      pendingTags.push(line);
    } else {
      if (pendingDuration === null) throw new Error('Segment has no duration');
      const media = resource(line, 'segment');
      const index = segments.length;
      const dependencies = new Set([media, currentKey?.resource, currentMap?.resource, currentMap?.key?.resource].filter(Boolean));
      for (const dependency of dependencies) dependency.lastUse = index;
      media.indices.push(index);
      segments.push({ index, media, dependencies, key: currentKey, map: currentMap, info, tags: pendingTags, duration: pendingDuration, start: duration, end: duration + pendingDuration, discontinuitiesBefore: discontinuities - pendingDiscontinuities });
      duration += pendingDuration;
      pendingDuration = null; pendingTags = []; pendingDiscontinuities = 0;
    }
  }
  if (!segments.length || sequence < 0n || discontinuitySequence < 0n) throw new Error('No supported media segments');
  return { segments, resources, headers, sequence, discontinuitySequence, duration, complete: lines.includes('#EXT-X-ENDLIST') };
}

/**
 * Observe bytes already fetched by the downloader. This collector never opens a
 * network source. Opening and representative windows are each <=30 seconds and
 * share a strict 64 MiB budget. A successful opening preview is replaced once,
 * when the actual 35%-of-video scene arrives through the normal download.
 */
function createLocalPreviewCollector({ job, playlistText, playlistUrl, directory, previewDirectory, FFMPEG_PATH, FFPROBE_PATH } = {}) {
  const noop = { captureFile: async () => {}, captureBytes: async () => {}, close: async () => {} };
  if (!job || !FFMPEG_PATH || !FFPROBE_PATH || !path.isAbsolute(directory || '') || !path.isAbsolute(job.storageDir || '') || !path.isAbsolute(previewDirectory || '')) return noop;
  let playlist;
  try { playlist = parsePlaylist(playlistText, playlistUrl); } catch { return noop; }
  const controller = new AbortController();
  const downloadSignal = job._downloadAbort?.signal;
  const abort = () => controller.abort();
  if (downloadSignal?.aborted) abort();
  else downloadSignal?.addEventListener('abort', abort, { once: true });
  const pinned = new Set();
  const safeId = String(job.id || 'video').replace(/[^\w-]/g, '_').slice(0, 100);
  const clipKey = crypto.createHash('sha256').update(`${job.id}:early-preview`).digest('hex').slice(0, 32);
  const representativeOffset = playlist.duration * 0.35;
  const interimOffset = Math.min(30, representativeOffset);
  function windowIndices(offset) {
    const first = playlist.segments.findIndex(segment => segment.end > offset);
    const indices = [];
    let seconds = 0;
    for (let index = first; index >= 0 && index < playlist.segments.length; index += 1) {
      const segment = playlist.segments[index];
      if (seconds + segment.duration > WINDOW_SECONDS + 0.000001) break;
      indices.push(index); seconds += segment.duration;
    }
    return indices;
  }
  const representativeIndices = windowIndices(representativeOffset);
  const interimIndices = windowIndices(interimOffset);
  let temporaryDirectory = '';
  let directoryPromise;
  let storedBytes = 0;
  const lastAttemptEnd = new Map();
  let captures = Promise.resolve();
  let encoding = null;
  let closing = false;
  let published = isCurrentPreviewClipPath(job.previewClipPath);
  let interimPublished = isCurrentPreviewClipPath(job.previewClipPath, { allowInterim: true });
  let closePromise;

  function enqueue(task) {
    const next = captures.then(task).catch(() => {});
    captures = next;
    return next;
  }
  async function ensureDirectory() {
    if (!directoryPromise) directoryPromise = (async () => {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      temporaryDirectory = await fs.mkdtemp(path.join(directory, 'local-preview-'));
      await fs.chmod(temporaryDirectory, 0o700);
      return temporaryDirectory;
    })();
    return directoryPromise;
  }
  function pendingIndices() {
    return published ? [] : [...new Set([...representativeIndices, ...(!interimPublished ? interimIndices : [])])];
  }
  async function prune() {
    const needed = new Set(pendingIndices().flatMap(index => [...playlist.segments[index].dependencies]));
    for (const resource of playlist.resources.values()) {
      if (!resource.path || pinned.has(resource) || needed.has(resource)) continue;
      try {
        await fs.rm(resource.path, { force: true });
        storedBytes -= resource.bytes; resource.bytes = 0; resource.path = '';
      } catch { /* Keep accounting for a file that could not be removed. */ }
    }
  }
  function candidateFor(indices, offset, representative) {
    const chosen = [];
    for (const index of indices) {
      const segment = playlist.segments[index];
      if ([...segment.dependencies].some(resource => !resource.path)) break;
      chosen.push(segment);
    }
    if (!chosen.length) return null;
    const start = chosen[0].start;
    const end = chosen.at(-1).end;
    const phase = representative ? 'representative' : 'interim';
    if (end - offset < Math.min(10, playlist.duration - offset) - 0.000001) return null;
    if (lastAttemptEnd.has(phase) && end - lastAttemptEnd.get(phase) < RETRY_FOOTAGE_SECONDS - 0.000001) return null;
    return { segments: chosen, duration: end - start, start, end, offset: offset - start, representative, phase };
  }
  function candidate() {
    return candidateFor(representativeIndices, representativeOffset, true)
      || (!interimPublished && candidateFor(interimIndices, interimOffset, false));
  }
  function localManifest(chosen) {
    const first = chosen[0];
    const lines = ['#EXTM3U', ...playlist.headers,
      `#EXT-X-MEDIA-SEQUENCE:${playlist.sequence + BigInt(first.index)}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${playlist.discontinuitySequence + BigInt(first.discontinuitiesBefore)}`,
      '#EXT-X-PLAYLIST-TYPE:VOD'];
    let previousKey;
    let previousMap;
    const localTag = item => item.line.replace(/\bURI\s*=\s*(?:"[^"]*"|[^,]*)/i, `URI="${item.resource.name}"`);
    const setKey = key => {
      const identity = key?.line || 'NONE';
      if (previousKey === identity) return;
      if (key) lines.push(localTag(key));
      else if (previousKey !== undefined) lines.push('#EXT-X-KEY:METHOD=NONE');
      previousKey = identity;
    };
    for (const segment of chosen) {
      lines.push(...segment.tags);
      if (segment.map && previousMap !== segment.map) {
        setKey(segment.map.key); lines.push(localTag(segment.map)); previousMap = segment.map;
      }
      setKey(segment.key);
      lines.push(segment.info, segment.media.name);
    }
    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n') + '\n';
  }
  function beginEncoding() {
    if (encoding || closing || published || job.cancelled) return;
    const window = candidate();
    if (!window) return;
    lastAttemptEnd.set(window.phase, window.end);
    const clipPath = path.join(previewDirectory, clipKey + (window.representative ? PREVIEW_CLIP_SUFFIX : INTERIM_PREVIEW_CLIP_SUFFIX));
    const posterPath = path.join(job.storageDir, `${safeId}-${window.phase}-poster-v2.jpg`);
    for (const segment of window.segments) for (const resource of segment.dependencies) pinned.add(resource);
    encoding = (async () => {
      const folder = await ensureDirectory();
      const manifestPath = path.join(folder, 'candidate.m3u8');
      await fs.writeFile(manifestPath, localManifest(window.segments), { mode: 0o600 });
      // The offset is relative only when addressing this local excerpt. Its
      // source position remains the requested 35% (or the interim 30 seconds).
      const candidateOffsetsSeconds = [window.offset, window.offset + 5, window.offset + 10]
        .filter(offset => offset === window.offset || offset <= window.duration - 10);
      const { poster, clip } = await generatePreviewAssets(manifestPath, clipPath, posterPath, {
        FFMPEG_PATH, FFPROBE_PATH, signal: controller.signal, candidateOffsetsSeconds,
      });
      if (job.cancelled || controller.signal.aborted) throw new Error('Preview generation stopped');
      if (!job.youtubeMetadata?.thumbnailUrl) { job.thumbnailPath = poster.path; job.thumbnailPaths = [poster.path]; }
      job.previewClipPath = clip.path;
      job.previewClipDurationSeconds = clip.durationSeconds;
      job.updatedAt = Date.now();
      if (window.representative) published = true;
      else interimPublished = true;
    })().catch(async () => {
      // Failed candidates are not download errors; retry only when another
      // ten seconds in this bounded window becomes available.
      await fs.rm(clipPath, { force: true }).catch(() => {});
    }).finally(() => {
      pinned.clear(); encoding = null;
      enqueue(async () => { await prune(); beginEncoding(); });
    });
  }
  function findResource(url) {
    try { return playlist.resources.get(new URL(url, playlistUrl).href); } catch { return null; }
  }
  function capture(url, writeSource) {
    const resource = findResource(url);
    if (!resource || closing || published || job.cancelled) return Promise.resolve();
    return enqueue(async () => {
      if (closing || published || job.cancelled || resource.path) return;
      await prune();
      if (!pendingIndices().some(index => playlist.segments[index].dependencies.has(resource))) return;
      const folder = await ensureDirectory();
      const destination = path.join(folder, resource.name);
      try {
        const bytes = await writeSource(destination, MAX_SOURCE_BYTES - storedBytes);
        if (!(bytes > 0)) return;
        resource.path = destination; resource.bytes = bytes; storedBytes += bytes;
        beginEncoding();
      } catch { await fs.rm(destination, { force: true }).catch(() => {}); }
    });
  }
  return {
    captureFile(url, filePath) {
      if (!path.isAbsolute(filePath || '')) return Promise.resolve();
      return capture(url, async (destination, budget) => {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > budget) return 0;
        // Limit the read to the completed piece size even if its source later grows.
        await pipeline(createReadStream(filePath, { start: 0, end: stat.size - 1 }), createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
        if ((await fs.stat(destination)).size !== stat.size) throw new Error('Incomplete local piece');
        return stat.size;
      });
    },
    captureBytes(url, buffer) {
      if (!Buffer.isBuffer(buffer)) return Promise.resolve();
      return capture(url, async (destination, budget) => {
        if (!buffer.length || buffer.length > budget) return 0;
        await fs.writeFile(destination, buffer, { flag: 'wx', mode: 0o600 });
        return buffer.length;
      });
    },
    close() {
      if (job.cancelled) controller.abort();
      if (closePromise) return closePromise;
      closePromise = (async () => {
        await captures;
        if (encoding) await encoding;
        await captures;
        beginEncoding();
        closing = true;
        if (encoding) await encoding;
        await captures;
        if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
      })().finally(() => downloadSignal?.removeEventListener('abort', abort));
      return closePromise;
    },
  };
}

module.exports = { createLocalPreviewCollector };
