const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { probeMediaFile } = require('@m3u8/downloader-engine/src/core/PreviewClip');
const { readJsonState, writeFileDurable } = require('@m3u8/downloader-engine/src/utils/durableJson');
const logger = require('../utils/logger');
const { readDirInfo, sideFilesOf, stemOf } = require('./libraryLayout');

/*
 * What is inside a saved video, for its details panel: the container, length, the video stream,
 * every audio track and subtitle, and subtitle files kept beside it.
 *
 * The bundled ffprobe runs once per file version. Results are cached in the app data folder
 * (`media-info-cache.json`), keyed by a hash of the file's path, size and modification time, so
 * the cache holds no paths; a changed file is probed again. Side files are read fresh each time.
 */

const CACHE_VERSION = 1;
const MAX_ENTRIES = 5000;
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const text = (value, max = 120) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const positive = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; };

function frameRate(stream) {
  for (const value of [stream.avg_frame_rate, stream.r_frame_rate]) {
    const [numerator, denominator] = String(value || '').split('/').map(Number);
    const fps = denominator ? numerator / denominator : numerator;
    if (Number.isFinite(fps) && fps > 0 && fps < 1000) return Math.round(fps * 1000) / 1000;
  }
  return null;
}

function hdrOf(stream) {
  const dolbyVision = (stream.side_data_list || []).some((entry) => /dovi|dolby vision/i.test(String(entry.side_data_type || '')));
  if (dolbyVision) return 'Dolby Vision';
  if (stream.color_transfer === 'smpte2084') return 'HDR10';
  if (stream.color_transfer === 'arib-std-b67') return 'HLG';
  return null;
}

const languageOf = (stream) => {
  const value = text(stream.tags && (stream.tags.language || stream.tags.LANGUAGE), 35);
  return value && !/^und$/i.test(value) ? value : null;
};
// Muxers stamp handler names ("SoundHandler", "VideoHandler"); they name nothing a person chose.
const titleOf = (stream) => {
  const value = text(stream.tags && (stream.tags.title || stream.tags.TITLE), 120);
  return value && !/handler$/i.test(value) ? value : null;
};

/** The plain facts from ffprobe's JSON. Codec names stay ffprobe's; the interface words them. */
function summarizeProbe(probe) {
  const streams = Array.isArray(probe && probe.streams) ? probe.streams : [];
  const format = (probe && probe.format) || {};
  const video = streams.find((stream) => stream.codec_type === 'video' && !(stream.disposition && stream.disposition.attached_pic));
  return {
    formatName: text(format.format_name, 80) || null,
    durationSeconds: positive(format.duration) || positive(video && video.duration),
    bitRate: positive(format.bit_rate),
    video: video ? {
      codec: text(video.codec_name, 40) || null,
      profile: text(video.profile, 60) || null,
      width: positive(video.width),
      height: positive(video.height),
      fps: frameRate(video),
      bitRate: positive(video.bit_rate) || positive(video.tags && video.tags.BPS),
      hdr: hdrOf(video),
    } : null,
    audio: streams.filter((stream) => stream.codec_type === 'audio').map((stream) => ({
      codec: text(stream.codec_name, 40) || null,
      profile: text(stream.profile, 40) || null,
      channels: positive(stream.channels),
      layout: text(stream.channel_layout, 40) || null,
      language: languageOf(stream),
      title: titleOf(stream),
      bitRate: positive(stream.bit_rate) || positive(stream.tags && stream.tags.BPS),
      default: !!(stream.disposition && stream.disposition.default),
    })),
    subtitles: streams.filter((stream) => stream.codec_type === 'subtitle').map((stream) => ({
      codec: text(stream.codec_name, 40) || null,
      language: languageOf(stream),
      title: titleOf(stream),
      default: !!(stream.disposition && stream.disposition.default),
      forced: !!(stream.disposition && stream.disposition.forced),
    })),
  };
}

/**
 * Subtitle files that belong to the video (`Name.en.srt`, `Name.vtt`, its job's `{id}-subtitles.srt`).
 * Only file names and what they say about language go back to the interface.
 */
function sideSubtitles(filePath, jobId) {
  let names;
  try { names = readDirInfo(path.dirname(filePath)).files; } catch { return []; }
  const fileName = path.basename(filePath);
  const stem = stemOf(fileName);
  return sideFilesOf(fileName, names, jobId)
    .filter((name) => SUBTITLE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const ext = path.extname(name).slice(1).toLowerCase();
      // `Name.en.srt` / `Name.pt-BR.vtt` carry a language between the video's name and the extension.
      const middle = name.startsWith(`${stem}.`) ? name.slice(stem.length + 1, name.length - ext.length - 1) : '';
      const language = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(middle) ? middle.replace('_', '-') : null;
      return { fileName: name, format: ext, language };
    });
}

function createMediaInfoService({ dataDir, getFfprobePath, probe = probeMediaFile, signal }) {
  const cachePath = path.join(dataDir, 'media-info-cache.json');
  let entries = null;
  let loading = null;
  let writing = Promise.resolve();
  const inFlight = new Map();

  async function load() {
    if (entries) return entries;
    if (!loading) {
      loading = (async () => {
        const result = await readJsonState(fs.promises, cachePath, {
          validate: (parsed) => (parsed && parsed.version === CACHE_VERSION && parsed.entries && typeof parsed.entries === 'object' ? null : 'not a media info cache'),
          logger, label: 'media info cache',
        }).catch(() => ({ status: 'missing' }));
        entries = new Map(result.status === 'loaded' ? Object.entries(result.data.entries) : []);
        return entries;
      })();
    }
    return loading;
  }

  function persist() {
    const snapshot = JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(entries) });
    const write = () => writeFileDurable(fs.promises, cachePath, snapshot).catch((error) => logger.warn('Media info cache not saved', { code: error && error.code }));
    writing = writing.then(write, write);
    return writing;
  }

  /** Facts about the saved file at `filePath`: probed once per path + size + modification time. */
  async function mediaInfo(filePath, { jobId } = {}) {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
    const key = createHash('sha256').update(`${path.resolve(filePath)}\n${stat.size}\n${stat.mtimeMs}`).digest('hex').slice(0, 40);
    const cache = await load();
    let cached = true;
    let entry = cache.get(key);
    if (!entry) {
      cached = false;
      let task = inFlight.get(key);
      if (!task) {
        const ffprobe = getFfprobePath();
        if (!ffprobe) throw Object.assign(new Error('ffprobe is not available'), { code: 'NO_PROBE' });
        task = (async () => {
          const summary = summarizeProbe(await probe(filePath, { FFPROBE_PATH: ffprobe, signal }));
          const next = { ...summary, probedAt: Date.now() };
          cache.delete(key);
          cache.set(key, next);
          while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
          await persist();
          return next;
        })().finally(() => inFlight.delete(key));
        inFlight.set(key, task);
      }
      entry = await task;
    }
    return { ...entry, cached, sideSubtitles: sideSubtitles(filePath, jobId) };
  }

  return { mediaInfo, cachePath };
}

module.exports = { createMediaInfoService, summarizeProbe, sideSubtitles };
