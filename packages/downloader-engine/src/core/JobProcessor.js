const fs = require('fs');
const path = require('path');
const os = require('os');
const tls = require('node:tls');
const { spawn, spawnSync } = require('child_process');
const { requestWithRedirects } = require('./PlaylistUtils');
const { createHash } = require('crypto');
const { isOwnedJobStorageDir } = require('./JobStorage');
const { createNativeProgress } = require('./NativeProgress');
const { createProcessStopper, processTreeSpawnOptions } = require('./ProcessTermination');
const { createTransferMetrics } = require('./TransferMetrics');
const { generatePreviewAssets, INTERIM_PREVIEW_CLIP_SUFFIX, isCurrentPreviewClipPath } = require('./PreviewClip');
const { createLocalPreviewCollector } = require('./LocalPreviewCollector');
const { createDownloadEta } = require('./DownloadEta');
const { sniffMedia, resolveHlsSelection, mediaError } = require('./MediaSelection');
const { startScopedMediaProxy, scopeMediaHeaders } = require('./MediaRequest');
const { getRetryBackoffMs, downloadSegment, isLocalWriteError, isSourceExpiredSegmentError } = require('./SegmentDownloader');
const {
  buildHlsRequestHeaders,
  buildNativeHlsArgs,
  inspectHlsPlaylist,
  shouldPreferNativeHlsDownload,
} = require('./HlsNativeDownload');
const {
  analyzeSegmentProbe,
  ensureSegmentDiagnostics,
  probeSegmentFile,
  recordSegmentDiagnostic,
  writeSegmentDiagnosticsReport,
} = require('./HlsSegmentDiagnostics');
const { generateThumbnailFromMp4, normalizeMp4ForPlayback, remuxAndGenerateThumbnails } = require('./VideoConverter');
const logger = require('../utils/logger');

// Dead renditions tried before a job fails (failover copies count too).
const MAX_VARIANT_FALLBACKS = 4;

function isYouTubeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    const host = String(parsed.hostname || '').toLowerCase();
    return host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'youtu.be'
      || host.endsWith('.youtu.be');
  } catch {
    return false;
  }
}


function resolveYouTubeVideoUrl(job = {}) {
  if (!isYouTubeUrl(job.url)) return job.url;
  const videoIdFromUrl = (value) => {
    if (!isYouTubeUrl(value)) return null;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const id = host === 'youtu.be' || host.endsWith('.youtu.be')
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.pathname === '/watch' ? url.searchParams.get('v')
        : /^\/(?:shorts|embed|live|v)\/([^/]+)/.exec(url.pathname)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
  };
  const metadataId = String(job.youtubeMetadata?.videoId || '');
  // YouTube pages also request UI sounds such as /s/search/audio/no_input.mp3.
  // Those URLs describe neither the selected video nor an authenticated channel.
  const id = videoIdFromUrl(job.url) || videoIdFromUrl(job.sourcePageUrl)
    || (/^[A-Za-z0-9_-]{11}$/.test(metadataId) ? metadataId : null);
  if (!id) throw mediaError('This YouTube link does not identify a video. Open the video and copy its link.', 'INVALID_VIDEO_URL');
  return `https://www.youtube.com/watch?v=${id}`;
}

function buildYouTubeBrowserSessionArgs(job = {}) {
  if (job.youtubeBrowserSession !== 'chrome') return [];
  if (!isYouTubeUrl(job.url)) {
    throw mediaError('Chrome sign-in is only available for YouTube downloads.', 'UNSUPPORTED_AUTH_SOURCE');
  }
  return ['--cookies-from-browser', 'chrome'];
}

function buildYtDlpRuntimeOptions({
  execPath = process.execPath,
  electron = Boolean(process.versions.electron),
  env = process.env,
} = {}) {
  // yt-dlp only enables Deno by default. Reuse our supported Node runtime so
  // its bundled YouTube challenge solver also works on a fresh desktop install.
  return {
    args: ['--js-runtimes', `node:${execPath}`],
    env: electron ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
  };
}

async function createYtDlpTrustOptions(env, fsPromises = fs.promises) {
  if (env.SSL_CERT_FILE || env.SSL_CERT_DIR) return { env, cleanup: async () => {} };
  // Static OpenSSL builds may point at a CA directory on the build machine.
  // Give the child the same public CA roots trusted by our Node requests.
  const certificates = typeof tls.getCACertificates === 'function'
    ? tls.getCACertificates('default') : tls.rootCertificates;
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'snagthis-ca-'));
  const cleanup = () => fsPromises.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
  try {
    const filePath = path.join(directory, 'certificates.pem');
    await fsPromises.writeFile(filePath, certificates.join('\n') + '\n', { mode: 0o600 });
    return { env: { ...env, SSL_CERT_FILE: filePath }, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function getYtDlpTransportError(line) {
  if (/certificate verify failed|unable to get local issuer certificate|self[- ]signed certificate/i.test(String(line))) {
    return mediaError('The video server\'s security certificate could not be verified.', 'TLS_CERTIFICATE_ERROR');
  }
  return null;
}

// Sites label tracks by region or script ("en-US", "zh-Hans"), and YouTube
// often only has automatic captions. Match the whole language family, and let
// yt-dlp fall back to automatic captions when no uploaded track exists.
function buildYtDlpSubtitleArgs(selection = {}) {
  const language = String(selection && selection.subtitleLang || '').trim();
  if (!language || language === 'none') return [];
  const base = language.split(/[-_]/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!base) return [];
  return ['--write-subs', '--write-auto-subs', '--sub-langs', `${base}(?:[-_].*)?`, '--embed-subs'];
}

function createJobProcessor({
  downloadDir,
  FFMPEG_PATH,
  FFPROBE_PATH,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_SEGMENT_ATTEMPTS,
  fsPromises,
  getJobTempDirForUrl = (url, id) => path.join(downloadDir, `temp-${createHash('sha256').update(url).digest('hex').slice(0, 12)}-${id}`),
}) {
  const MAX_TS_PART_BYTES = 512 * 1024 * 1024; // ~512 MiB per TS part
  const DIRECT_MAX_ATTEMPTS = 4;
  const SOURCE_EXPIRED_SEGMENT_ATTEMPTS = 3;
  const YT_DLP_PATH = String(process.env.YTDLP_PATH || process.env.YT_DLP_PATH || 'yt-dlp').trim() || 'yt-dlp';
  let ytDlpAvailable = null;
  const isExplicitYtDlpPath = /[\\/]/.test(YT_DLP_PATH);

  function classifyError(error) {
    if (error && error.code === 'LINK_EXPIRED') return 'SOURCE_EXPIRED';
    if (error && error.code) return error.code;
    const message = String(error && error.message || '');
    if (/\b(?:401|403|410)\b/.test(message)) return 'SOURCE_EXPIRED';
    if (/ENOSPC|disk full|no space left/i.test(message)) return 'DISK_FULL';
    if (/EACCES|EPERM|not writable/i.test(message)) return 'FOLDER_NOT_WRITABLE';
    if (/timeout|network|ECONN|ENOTFOUND|socket/i.test(message)) return 'NETWORK_ERROR';
    return 'DOWNLOAD_FAILED';
  }

  function buildYtDlpSelector(selection = {}) {
    const maxHeight = Number(selection.height);
    const video = Number.isFinite(maxHeight) && maxHeight > 0 ? `[height<=${Math.floor(maxHeight)}]` : '';
    const language = selection.audioLang ? `[language=${String(selection.audioLang).replace(/[^a-zA-Z0-9_-]/g, '')}]` : '';
    if (selection.audioOnly) return `ba${language}[ext=m4a]/ba${language}`;
    return `bv*${video}[ext=mp4]+ba${language}[ext=m4a]/b${video}[ext=mp4]/bv*${video}+ba${language}/b${video}`;
  }

  function attemptEarlyThumbnail(job, inputPath) {
    if (!FFMPEG_PATH || !FFPROBE_PATH || !path.isAbsolute(inputPath || '') || job.cancelled || job.earlyThumbnailAttempted || isCurrentPreviewClipPath(job.previewClipPath, { allowInterim: true }) || job.selection?.audioOnly || job._previewEncoding) return;
    const now = Date.now();
    const bytes = Number(job.bytesDownloaded) || 0;
    if (now < (job._nextPreviewAttemptAt || 0) || (inputPath === job._previewAttemptPath && bytes <= (job._previewAttemptBytes || 0))) return;
    job._nextPreviewAttemptAt = now + 10000;
    job._previewAttemptBytes = bytes;
    job._previewAttemptPath = inputPath;
    job._previewEncoding = true;
    job._previewAbort ||= new AbortController();
    const outputDir = job.storageDir || path.dirname(job.filePath);
    const key = createHash('sha256').update(`${job.id}:early-preview`).digest('hex').slice(0, 32);
    const outputPath = path.join(downloadDir, '__previews', `${key}${INTERIM_PREVIEW_CLIP_SUFFIX}`);
    const posterPath = path.join(outputDir, `${job.id}-opening-poster-v2.jpg`);
    job._earlyThumbnailPromise = (async () => {
      let snapshotDirectory;
      try {
        // Snapshot only existing local bytes, so preview readers cannot lock a
        // downloader's output while it renames or removes its current transfer.
        const stat = await fsPromises.stat(inputPath);
        if (!stat.isFile() || !stat.size) return;
        snapshotDirectory = await fsPromises.mkdtemp(path.join(outputDir, 'local-preview-'));
        const source = path.join(snapshotDirectory, `source${path.extname(inputPath).replace('.part', '') || '.mp4'}`);
        await require('node:stream/promises').pipeline(fs.createReadStream(inputPath, { start: 0, end: Math.min(stat.size, 64 * 1024 * 1024) - 1 }), fs.createWriteStream(source));
        const { poster, clip } = await generatePreviewAssets(source, outputPath, posterPath, {
          FFMPEG_PATH, FFPROBE_PATH, signal: job._previewAbort.signal, interim: true,
        });
        if (job.cancelled) return;
        if (!job.youtubeMetadata?.thumbnailUrl && !(isYouTubeUrl(job.url) && job.thumbnailUrls?.length)) {
          job.thumbnailPath = poster.path;
          job.thumbnailPaths = [poster.path];
        } else if (poster?.path && poster.path !== job.thumbnailPath) {
          // An unused poster is not relocated with the saved file and would
          // keep the job's download folder alive after completion.
          await unlinkIfExists(poster.path, { jobId: job.id, reason: 'unused-early-poster' });
        }
        job.previewClipPath = clip.path;
        job.previewClipDurationSeconds = clip.durationSeconds;
        job.updatedAt = Date.now();
      } catch { /* More local bytes can make the next bounded attempt usable. */ }
      finally {
        if (snapshotDirectory) await fsPromises.rm(snapshotDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }).catch(() => {});
        job._previewEncoding = false;
      }
    })();
  }

  async function dispatchJob(job) {
    let downloadAbort;
    const stopCancelled = () => {
      if (!job.cancelled) return false;
      job.status = 'cancelled';
      job.error = null;
      job.updatedAt = Date.now();
      return true;
    };
    try {
      if (stopCancelled()) return;
      downloadAbort = new AbortController();
      job._downloadAbort = downloadAbort;
      job._transferMetrics = createTransferMetrics(job, { maxConnections: Math.max(1, Math.min(16, Number(job.maxConcurrent || DEFAULT_MAX_CONCURRENT) || 4)), available: !isYouTubeUrl(job.url) });
      job.url = resolveYouTubeVideoUrl(job);
      buildYouTubeBrowserSessionArgs(job); // Validate explicit browser access before any network request.
      job.credentialOrigin ||= new URL(job.headerOrigin || job.url).origin;
      job.error = null;
      job.errorCode = null;
      if (job.probe) job.probe = { seconds: Math.max(1, Math.min(30, Number(job.probe.seconds) || 30)) };

      if (isYouTubeUrl(job.url)) return await runDirectJobInternal(job);
      const headers = buildHlsRequestHeaders(job.headers || {}, { sourcePageUrl: job.sourcePageUrl });
      job._headerPolicy ||= new Map();
      // A captured playlist snapshot (POST/blob) must not be re-requested by GET.
      const detected = typeof job.manifestText === 'string' && /^\uFEFF?\s*#EXTM3U/.test(job.manifestText)
        ? { mediaType: 'hls', finalUrl: job.url }
        : await sniffMedia(job.url, headers, { credentialOrigin: job.credentialOrigin, sourcePageUrl: job.sourcePageUrl, signal: downloadAbort.signal, headerPolicy: job._headerPolicy });
      // A pause may arrive while sniffing. Do not begin another manifest
      // request before the old runner gives its slot back to the queue.
      if (stopCancelled()) return;
      job.mediaType = detected.mediaType;
      if (detected.mediaType === 'hls') return await runHlsJobInternal(job);
      if (job.probe && detected.mediaType === 'direct') {
        await runNativeHlsJob(job, detected.finalUrl, { totalDurationSeconds: Math.max(1, Math.min(30, Number(job.probe.seconds) || 30)), totalSegments: 0 });
        return;
      }
      return await runDirectJobInternal(job);
    } catch (error) {
      job.status = job.cancelled ? 'cancelled' : 'error';
      job.error = job.cancelled ? null : error.message;
      job.errorCode = classifyError(error);
      job.updatedAt = Date.now();
    } finally {
      job._transferMetrics?.finish();
      if (job.cancelled) job._previewAbort?.abort();
      await job._localPreviewCollector?.close();
      if (job._earlyThumbnailPromise) await job._earlyThumbnailPromise;
      delete job._localPreviewCollector;
      delete job._previewAbort;
      if (job._downloadAbort === downloadAbort) delete job._downloadAbort;
      // Consent applies to this attempt, never to an automatic retry or restart.
      delete job.youtubeBrowserSession;
    }
  }

  const runJob = dispatchJob;
  const runDirectJob = dispatchJob;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function summarizeSegmentIndexes(indexes, limit = 8) {
    if (!Array.isArray(indexes) || indexes.length === 0) {
      return '';
    }
    const normalized = indexes
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value >= 0)
      .sort((a, b) => a - b);

    if (normalized.length === 0) {
      return '';
    }

    const sample = normalized.slice(0, limit).join(', ');
    if (normalized.length <= limit) {
      return sample;
    }
    return `${sample} ...`;
  }

  function buildIncompleteHlsError(totalSegments, indexes, reason = 'missing or failed') {
    const count = Array.isArray(indexes) ? indexes.length : 0;
    const sample = summarizeSegmentIndexes(indexes);
    const sampleSuffix = sample ? ` Segment indexes: ${sample}.` : '';
    return `Incomplete HLS download: ${count} of ${totalSegments} segment(s) are ${reason}.${sampleSuffix}`;
  }


  function hasYtDlp() {
    if (typeof ytDlpAvailable === 'boolean') {
      return ytDlpAvailable;
    }

    try {
      const probe = spawnSync(YT_DLP_PATH, ['--version'], {
        stdio: 'ignore',
        timeout: 5000,
      });
      if (probe.status === 0) {
        ytDlpAvailable = true;
      } else if (probe.error && probe.error.code === 'ETIMEDOUT' && isExplicitYtDlpPath && fs.existsSync(YT_DLP_PATH)) {
        // Keep parity with API startup detection: trust explicit/bundled binary path on probe timeout.
        ytDlpAvailable = true;
        logger.info('yt-dlp probe timed out; using configured path', { ytDlpPath: YT_DLP_PATH });
      } else {
        ytDlpAvailable = false;
      }
    } catch {
      ytDlpAvailable = isExplicitYtDlpPath && fs.existsSync(YT_DLP_PATH);
    }

    if (!ytDlpAvailable) {
      logger.warn('yt-dlp not detected; YouTube URLs cannot be downloaded', {
        ytDlpPath: YT_DLP_PATH,
      });
    }

    return ytDlpAvailable;
  }

  async function findLatestJobAsset(storageDir, jobId) {
    if (!storageDir || !jobId) return '';
    try {
      const entries = await fsPromises.readdir(storageDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry && entry.isFile && entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.startsWith(`${jobId}-`) && !name.endsWith('.part'));
      if (files.length === 0) return '';

      const withStats = await Promise.all(
        files.map(async (name) => {
          const fullPath = path.join(storageDir, name);
          const stats = await fsPromises.stat(fullPath);
          return {
            fullPath,
            mtimeMs: Number(stats && stats.mtimeMs || 0),
            size: Number(stats && stats.size || 0),
          };
        })
      );

      withStats.sort((a, b) => {
        if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
        return b.size - a.size;
      });
      return withStats[0] ? withStats[0].fullPath : '';
    } catch {
      return '';
    }
  }

  async function resolveAccessibleOutputPath(candidatePath, storageDir, jobId) {
    const raw = String(candidatePath || '').trim();
    if (raw) {
      const fullPath = path.isAbsolute(raw) ? raw : path.resolve(storageDir, raw);
      try {
        await fsPromises.access(fullPath);
        return fullPath;
      } catch {
        // Fall back to scanning known outputs if reported path is stale/missing.
      }
    }

    const latest = await findLatestJobAsset(storageDir, jobId);
    if (!latest) return '';
    try {
      await fsPromises.access(latest);
      return latest;
    } catch {
      return '';
    }
  }

  async function runYouTubeDirectJob(job) {
    if (!job || !job.url) {
      throw new Error('Missing job URL for yt-dlp download');
    }
    job._transferMetrics = createTransferMetrics(job, { maxConnections: job.maxConnections || job.maxConcurrent || DEFAULT_MAX_CONCURRENT || 4, available: false });
    if (!hasYtDlp()) {
      throw new Error('yt-dlp is not installed. Install yt-dlp, restart the desktop app, and retry.');
    }

    if (!job.storageDir && job.filePath) {
      job.storageDir = path.dirname(job.filePath);
    }
    const storageDir = job.storageDir || (job.filePath ? path.dirname(job.filePath) : downloadDir);
    await fsPromises.mkdir(storageDir, { recursive: true });
    job.storageDir = storageDir;
    if (!job.ytDlpPartFiles) {
      // Earlier builds ran yt-dlp with --no-part, so an interrupted format is
      // indistinguishable from a finished one and would be merged truncated.
      // Start such a job's media over once; later restarts resume .part files.
      const entries = await fsPromises.readdir(storageDir).catch(() => []);
      await Promise.all(entries
        .filter((name) => name.startsWith(`${job.id}-`) && /\.(?:mp4|m4a|webm|mkv|mp3|opus|ogg|aac|flv|3gp|ytdl|part)$/i.test(name))
        .map((name) => unlinkIfExists(path.join(storageDir, name), { jobId: job.id, reason: 'ytdlp-legacy-partial' })));
      job.ytDlpPartFiles = true;
    }

    const outputTemplate = path.join(storageDir, `${job.id}-%(title).120B.%(ext)s`);
    let previewInputPath = '';
    let ffmpegLocation = '';
    if (typeof FFMPEG_PATH === 'string' && FFMPEG_PATH.trim()) {
      const normalizedFfmpegPath = FFMPEG_PATH.trim();
      try {
        if (fs.existsSync(normalizedFfmpegPath)) {
          const stats = fs.statSync(normalizedFfmpegPath);
          ffmpegLocation = stats.isDirectory()
            ? normalizedFfmpegPath
            : path.dirname(normalizedFfmpegPath);
        }
      } catch {
        ffmpegLocation = '';
      }
    }

    const browserSessionArgs = buildYouTubeBrowserSessionArgs(job);
    const runtimeOptions = buildYtDlpRuntimeOptions();
    const args = [
      '--ignore-config',
      ...browserSessionArgs,
      ...runtimeOptions.args,
      '--no-playlist',
      // Keep yt-dlp's .part files. A finished format is then renamed and
      // skipped on the next launch; with --no-part yt-dlp re-requests it past
      // its end, which YouTube rejects with HTTP 416.
      '--no-keep-video',
      '--no-simulate',
      '--progress',
      '--no-quiet',
      '--newline',
      '--no-mtime',
      '--restrict-filenames',
      '--merge-output-format',
      'mp4',
      '--remux-video',
      'mp4',
      '-f',
      buildYtDlpSelector(job.selection),
      '--progress-template',
      'download:bytes=%(progress.downloaded_bytes)s,total=%(progress.total_bytes)s,total_estimate=%(progress.total_bytes_estimate)s,speed=%(progress.speed)s,eta=%(progress.eta)s',
      '--print',
      'before_dl:snagthis_title=%(title)j',
      '--print',
      'after_move:filepath=%(filepath)s',
      '-o',
      outputTemplate,
      job.url,
    ];

    if (ffmpegLocation) {
      args.push('--ffmpeg-location', ffmpegLocation);
    }

    const rawHeaders = scopeMediaHeaders(job.headers || {}, job.url, { credentialOrigin: job.credentialOrigin || job.url, sourcePageUrl: job.sourcePageUrl });
    const safeYtHeaders = new Set(['user-agent', 'referer', 'origin', 'accept', 'accept-language']);
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (safeYtHeaders.has(key.toLowerCase())) args.push('--add-header', `${key}: ${value}`);
    }
    let cookieJarPath = null;
    let cookieJarDirectory = null;
    // The browser-session flow lets yt-dlp load its own cookies. Do not combine
    // them with a captured Cookie header or create a second cookie file.
    if (rawHeaders.cookie && browserSessionArgs.length === 0) {
      const source = new URL(job.url);
      const cookies = rawHeaders.cookie.split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const separator = entry.indexOf('=');
        if (separator < 1 || /[\r\n\t]/.test(entry)) return null;
        return `${source.hostname}\tFALSE\t/\t${source.protocol === 'https:' ? 'TRUE' : 'FALSE'}\t0\t${entry.slice(0, separator)}\t${entry.slice(separator + 1)}`;
      }).filter(Boolean);
      cookieJarDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'snagthis-cookies-'));
      cookieJarPath = path.join(cookieJarDirectory, 'cookies.txt');
      await fsPromises.writeFile(cookieJarPath, '# Netscape HTTP Cookie File\n' + cookies.join('\n') + '\n', { mode: 0o600 });
      args.push('--cookies', cookieJarPath);
    }
    let trustOptions = null;
    try {
    trustOptions = await createYtDlpTrustOptions(runtimeOptions.env, fsPromises);
    if (job.selection && job.selection.audioOnly) args.push('--extract-audio', '--audio-format', 'm4a');
    const subtitleArgs = buildYtDlpSubtitleArgs(job.selection);
    args.push(...subtitleArgs);
    if (job.probe) args.push('--download-sections', `*0-${Math.max(1, Math.min(30, Number(job.probe.seconds) || 30))}`);

    let resolvedPath = '';
    let subtitleWritten = false;
    let lastErrorLine = '';
    let transportError = null;
    let totalDownloadPhases = 1;
    let currentDownloadPhaseIndex = 0;
    let currentPhaseProgress = 0;
    let destinationLineCount = 0;
    const eta = createDownloadEta();
    const updateEta = (downloadedBytes, totalBytes, speedBps, reportedEta) => {
      const remaining = totalBytes > 0 ? Math.max(0, totalBytes - downloadedBytes)
        : reportedEta > 0 && speedBps > 0 ? reportedEta * speedBps : null;
      job.etaSeconds = eta.update(remaining, speedBps);
    };
    const ytDebugEnabled = String(process.env.DEBUG_YTDLP_PROGRESS || '').trim() === '1';
    let ytDebugLineCount = 0;
    logger.info('yt-dlp debug mode', {
      jobId: job && job.id,
      enabled: ytDebugEnabled,
      envValue: String(process.env.DEBUG_YTDLP_PROGRESS || ''),
    });
    const parseMetricNumber = (raw) => {
      const text = String(raw || '').trim();
      if (!text || text.toLowerCase() === 'na' || text.toLowerCase() === 'none') return 0;
      const normalized = text.replace(/,/g, '');
      const value = Number(normalized);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    };
    const parseByteMetric = (raw) => {
      const text = String(raw || '').trim();
      if (!text) return 0;

      const numeric = parseMetricNumber(text);
      if (numeric > 0) return numeric;

      const normalized = text
        .replace(/\/s$/i, '')
        .replace(/\s+/g, '')
        .trim();
      const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([kmgtp]?i?b)$/i);
      if (!match) return 0;

      const value = Number(match[1]);
      if (!Number.isFinite(value) || value < 0) return 0;
      const unit = String(match[2] || 'b').toLowerCase();
      const multiplier = {
        b: 1,
        kb: 1_000,
        mb: 1_000_000,
        gb: 1_000_000_000,
        tb: 1_000_000_000_000,
        pb: 1_000_000_000_000_000,
        kib: 1_024,
        mib: 1_048_576,
        gib: 1_073_741_824,
        tib: 1_099_511_627_776,
        pib: 1_125_899_906_842_624,
      }[unit] || 0;
      if (!multiplier) return 0;
      return Math.max(0, Math.floor(value * multiplier));
    };
    const parseEtaSeconds = (raw) => {
      const text = String(raw || '').trim();
      if (!text || /^na$/i.test(text) || /^none$/i.test(text)) return 0;

      const numeric = parseMetricNumber(text);
      if (numeric > 0) return Math.floor(numeric);

      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
        const parts = text.split(':').map((part) => Number.parseInt(part, 10));
        if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
        if (parts.length === 2) return (parts[0] * 60) + parts[1];
        if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      }
      return 0;
    };

    await new Promise((resolve, reject) => {
      const child = spawn(YT_DLP_PATH, args, {
        cwd: storageDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: trustOptions.env,
        ...processTreeSpawnOptions(),
      });
      // yt-dlp starts ffmpeg to merge and remux. Stop the whole tree and
      // escalate, or a paused job can keep writing after its slot is freed.
      const stopper = createProcessStopper(child, { processTree: true });
      if (ytDebugEnabled) {
        logger.info('yt-dlp spawned', {
          jobId: job && job.id,
          pid: child && child.pid,
          hasStdout: Boolean(child && child.stdout),
          hasStderr: Boolean(child && child.stderr),
        });
      }

      const cancelPoll = setInterval(() => {
        if (!job.cancelled) return;
        job._previewAbort?.abort();
        void stopper.stop();
      }, 250);

      const finalize = (cb) => {
        clearInterval(cancelPoll);
        stopper.dispose();
        cb();
      };

      const handleYtDlpLine = (line, fromStderr = false) => {
        const text = String(line || '').trim();
        if (!text) return;

        if (!fromStderr && text.startsWith('snagthis_title=')) {
          try {
            const value = JSON.parse(text.slice('snagthis_title='.length));
            const title = typeof value === 'string'
              ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255)
              : '';
            if (title) {
              if (isYouTubeUrl(job.url)) job.youtubeMetadata = { ...(job.youtubeMetadata || {}), title };
              if (!job.manualTitleOverride && job.fileNaming !== 'resource') {
                job.title = title;
                // Completion naming prefers this inferred hint to the title.
                // Replace the initial placeholder along with the display name.
                job.mediaHints = { ...(job.mediaHints || {}), lookupTitle: title };
              }
              job.updatedAt = Date.now();
            }
          } catch { /* Missing or malformed metadata must retain the existing name. */ }
          return;
        }

        if (/^\[info\].*Downloading\s+\d+\s+format\(s\):/i.test(text)) {
          const formatMatch = text.match(/format\(s\):\s*(.+)$/i);
          const rawFormats = formatMatch ? String(formatMatch[1] || '').trim() : '';
          const formatCount = rawFormats
            ? rawFormats.split(',').reduce((count, group) => {
              const parts = String(group || '')
                .split('+')
                .map((part) => String(part || '').trim())
                .filter(Boolean);
              return count + (parts.length || 0);
            }, 0)
            : 0;
          if (formatCount > 0) {
            totalDownloadPhases = Math.max(1, Math.min(6, formatCount));
            currentDownloadPhaseIndex = 0;
            currentPhaseProgress = 0;
            destinationLineCount = 0;
          }
        }

        if (/^\[download\]\s+Destination:/i.test(text)) {
          const destination = path.resolve(text.replace(/^\[download\]\s+Destination:\s*/i, ''));
          const relative = path.relative(storageDir, destination);
          previewInputPath = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? `${destination}.part` : '';
          eta.reset();
          job.etaSeconds = null;
          job.speedBps = 0;
          destinationLineCount += 1;
          currentDownloadPhaseIndex = Math.min(
            Math.max(0, destinationLineCount - 1),
            Math.max(0, totalDownloadPhases - 1),
          );
          currentPhaseProgress = 0;
        }

        // A format finished before a restart is skipped without a Destination
        // line. Count it as a completed phase so the next one maps correctly.
        if (/^\[download\]\s+.+\s+has already been downloaded$/i.test(text)) {
          destinationLineCount += 1;
          currentDownloadPhaseIndex = Math.min(destinationLineCount - 1, Math.max(0, totalDownloadPhases - 1));
          currentPhaseProgress = 100;
          const doneShare = ((currentDownloadPhaseIndex + 1) / totalDownloadPhases) * 100;
          job.progress = Math.max(Number(job.progress || 0), Math.min(99, Math.round(doneShare)));
          job.updatedAt = Date.now();
          return;
        }

        if (/^\[info\] Writing video subtitles to:/i.test(text)) subtitleWritten = true;

        if (text.startsWith('filepath=')) {
          resolvedPath = text.slice('filepath='.length).trim();
          return;
        }

        const applyProgress = (phasePercent = 0) => {
          const boundedPhasePercent = Math.max(0, Math.min(100, Math.round(phasePercent)));
          if (boundedPhasePercent > currentPhaseProgress) {
            currentPhaseProgress = boundedPhasePercent;
          }

          let nextProgress = 0;
          if (totalDownloadPhases > 1) {
            const completedPhases = Math.max(0, Math.min(currentDownloadPhaseIndex, totalDownloadPhases));
            const combinedPercent = ((completedPhases + (currentPhaseProgress / 100)) / totalDownloadPhases) * 100;
            nextProgress = Math.max(0, Math.min(99, Math.round(combinedPercent)));
          } else {
            nextProgress = Math.max(0, Math.min(99, currentPhaseProgress));
          }

          // Keep in-flight progress monotonic; final 100 is set only after yt-dlp exits.
          job.progress = Math.max(Number(job.progress || 0), nextProgress);
        };

        let progressUpdated = false;
        const customProgressMatch = text.match(
          /(?:download:)?bytes=([^,]+),total=([^,]+),total_estimate=([^,]+),speed=([^,]+),eta=([^,]+)$/i
        );
        if (customProgressMatch) {
          const downloadedBytes = parseByteMetric(customProgressMatch[1]);
          const totalBytes = parseByteMetric(customProgressMatch[2]);
          const estimatedTotalBytes = parseByteMetric(customProgressMatch[3]);
          const speedBps = parseByteMetric(customProgressMatch[4]);
          const etaSeconds = parseEtaSeconds(customProgressMatch[5]);
          const resolvedTotalBytes = totalBytes > 0 ? totalBytes : estimatedTotalBytes;
          const computedPercent = resolvedTotalBytes > 0
            ? (downloadedBytes / resolvedTotalBytes) * 100
            : 0;

          if (downloadedBytes > 0) {
            job.bytesDownloaded = downloadedBytes;
          }
          if (resolvedTotalBytes > 0) {
            job.totalBytes = resolvedTotalBytes;
          }
          if (speedBps > 0) {
            job.speedBps = speedBps;
          }
          updateEta(downloadedBytes, resolvedTotalBytes, speedBps, etaSeconds);
          applyProgress(computedPercent);
          progressUpdated = true;
        }

        if (!progressUpdated && /^\[download\]/i.test(text)) {
          const percentMatch = text.match(/\[download\]\s+([0-9]+(?:\.[0-9]+)?)%/i);
          const totalMatch = text.match(/\bof\s+~?\s*([0-9.]+\s*[kmgtp]?i?b)\b/i);
          const speedMatch = text.match(/\bat\s+([0-9.]+\s*[kmgtp]?i?b\/s)\b/i);
          const etaMatch = text.match(/\bETA\s+([0-9:]+)\b/i);
          const downloadedOnlyMatch = text.match(/\[download\]\s+([0-9.]+\s*[kmgtp]?i?b)(?:\s+at|\s+ETA|\s*$)/i);

          const percent = percentMatch ? parseMetricNumber(percentMatch[1]) : 0;
          const totalBytes = totalMatch ? parseByteMetric(totalMatch[1]) : 0;
          const speedBps = speedMatch ? parseByteMetric(speedMatch[1]) : 0;
          const etaSeconds = etaMatch ? parseEtaSeconds(etaMatch[1]) : 0;
          const downloadedBytes = downloadedOnlyMatch ? parseByteMetric(downloadedOnlyMatch[1]) : 0;
          let computedPercent = percent;

          if (downloadedBytes > 0) {
            job.bytesDownloaded = downloadedBytes;
            progressUpdated = true;
          }
          if (totalBytes > 0) {
            job.totalBytes = totalBytes;
            if (job.bytesDownloaded > 0) {
              computedPercent = (job.bytesDownloaded / totalBytes) * 100;
            }
            progressUpdated = true;
          }
          if (percent > 0 || (Number.isFinite(computedPercent) && computedPercent > 0)) {
            applyProgress(computedPercent);
            if (job.totalBytes > 0 && job.progress > 0 && job.bytesDownloaded <= 0) {
              job.bytesDownloaded = Math.round((job.totalBytes * job.progress) / 100);
            }
            progressUpdated = true;
          }
          if (speedBps > 0) {
            job.speedBps = speedBps;
            progressUpdated = true;
          }
          if (etaMatch) progressUpdated = true;
          if (progressUpdated) updateEta(totalBytes > 0 && percentMatch ? totalBytes * percent / 100 : downloadedBytes, totalBytes, speedBps, etaSeconds);
        }

        if (progressUpdated) {
          if (previewInputPath && job.bytesDownloaded >= 2 * 1024 * 1024) attemptEarlyThumbnail(job, previewInputPath);
          if (ytDebugEnabled && ytDebugLineCount < 40) {
            ytDebugLineCount += 1;
            logger.info('yt-dlp progress parsed', {
              jobId: job && job.id,
              progress: Number(job.progress || 0),
              bytesDownloaded: Number(job.bytesDownloaded || 0),
              totalBytes: Number(job.totalBytes || 0),
              speedBps: Number(job.speedBps || 0),
              etaSeconds: Number(job.etaSeconds || 0),
            });
          }
          job.updatedAt = Date.now();
          return;
        }

        if (fromStderr) transportError ||= getYtDlpTransportError(text);
        if (fromStderr && /error/i.test(text)) {
          lastErrorLine = text.replace(/https?:\/\/\S+/g, '[URL]');
        }

        if (ytDebugEnabled && ytDebugLineCount < 40) {
          ytDebugLineCount += 1;
          logger.info('yt-dlp raw line', {
            jobId: job && job.id,
            from: fromStderr ? 'stderr' : 'stdout',
            line: text.slice(0, 240),
          });
        }
      };
      const bindStreamLines = (stream, fromStderr = false) => {
        if (!stream) return () => {};
        let pending = '';
        const onData = (chunk) => {
          const text = `${pending}${String(chunk || '')}`;
          const parts = text.split(/\r?\n|\r/g);
          pending = parts.pop() || '';
          for (const part of parts) {
            handleYtDlpLine(part, fromStderr);
          }
        };
        stream.on('data', onData);
        return () => {
          if (pending) {
            handleYtDlpLine(pending, fromStderr);
            pending = '';
          }
          stream.off('data', onData);
        };
      };

      const flushStdout = bindStreamLines(child.stdout, false);
      const flushStderr = bindStreamLines(child.stderr, true);

      child.on('error', (err) => finalize(() => reject(err)));
      child.on('close', (code) => finalize(() => {
        flushStdout();
        flushStderr();

        if (job.cancelled) {
          resolve();
          return;
        }

        if (code === 0) {
          resolve();
          return;
        }

        reject(transportError || new Error(lastErrorLine || `yt-dlp exited with code ${code}`));
      }));
    });

    if (job.cancelled) {
      if (job.cleanupOnCancel) {
        await cleanupCancelledDirectArtifacts(job);
      }
      job.status = 'cancelled';
      job.updatedAt = Date.now();
      return;
    }

    if (!resolvedPath) {
      resolvedPath = await findLatestJobAsset(storageDir, job.id);
    }

    const finalPath = await resolveAccessibleOutputPath(resolvedPath, storageDir, job.id);
    if (!finalPath) {
      throw new Error('yt-dlp completed but no output file was reported');
    }

    const stats = await fsPromises.stat(finalPath);

    job.filePath = finalPath;
    job.mp4Path = finalPath;
    job.downloadName = path.basename(finalPath);
    job.downloadNameMp4 = path.basename(finalPath);
    job.bytesDownloaded = Number(stats && stats.size || 0);
    job.totalBytes = Number(stats && stats.size || 0);
    // Record the absence so Details can say so instead of failing silently.
    job.subtitleMissing = subtitleArgs.length > 0 && !subtitleWritten;
    job.progress = 100;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.status = 'completed';
    job.updatedAt = Date.now();
    } finally {
      try {
        if (trustOptions) await trustOptions.cleanup();
      } finally {
        if (cookieJarDirectory) await fsPromises.rm(cookieJarDirectory, { recursive: true, force: true });
      }
    }

  }

  async function closeWriteStream(stream) {
    if (!stream || stream.closed) return;
    // Windows cannot rename or remove a file until the write handle is closed.
    // Destroying also releases unfinished writes after a cancelled HTTP request.
    await new Promise((resolve) => {
      stream.once('close', resolve);
      stream.destroy();
    });
  }

  async function unlinkIfExists(filePath, context = {}) {
    if (!filePath) return;
    try {
      await fsPromises.unlink(filePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      logger.warn('Failed to delete file during job cleanup', {
        filePath,
        error: err && err.message,
        ...context,
      });
    }
  }

  async function cleanupCancelledHlsArtifacts(job, jobTempDir, options = {}) {
    const preserveSegments = Boolean(options.preserveSegments);
    const context = { jobId: job && job.id, preserveSegments };
    const jobStorageDir = (() => {
      if (job && typeof job.storageDir === 'string' && job.storageDir.trim()) {
        return job.storageDir;
      }
      if (job && typeof job.filePath === 'string' && job.filePath.trim()) {
        return path.dirname(job.filePath);
      }
      return downloadDir;
    })();

    try {
      if (jobTempDir) {
        if (preserveSegments) {
          const files = await fsPromises.readdir(jobTempDir);
          await Promise.all(
            files
              .filter((fileName) => fileName.endsWith('.tmp'))
              .map((fileName) => unlinkIfExists(path.join(jobTempDir, fileName), context))
          );
        } else {
          await fsPromises.rm(jobTempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
        }
      }
    } catch (err) {
      logger.warn('Failed to cleanup cancelled HLS temp directory', {
        ...context,
        tempDir: jobTempDir,
        error: err && err.message,
      });
    }

    if (preserveSegments || !job) {
      return;
    }

    const cleanupPaths = new Set();
    const addPath = (candidatePath) => {
      if (typeof candidatePath === 'string' && candidatePath.trim()) {
        cleanupPaths.add(candidatePath);
      }
    };

    addPath(job.filePath);
    addPath(job.mp4Path);
    addPath(job.filePath ? `${job.filePath}.part` : null);
    addPath(job.mp4Path ? `${job.mp4Path}.part` : null);
    addPath(job.subtitlePath);
    addPath(job.subtitleZipPath);
    addPath(job.thumbnailPath);
    addPath(job.id && jobStorageDir ? path.join(jobStorageDir, `ts-parts-${job.id}.txt`) : null);

    if (Array.isArray(job.tsParts)) {
      job.tsParts.forEach((candidate) => addPath(candidate));
    }

    await Promise.all(Array.from(cleanupPaths).map((candidatePath) => unlinkIfExists(candidatePath, context)));

    if (
      job
      && job.id
      && typeof jobStorageDir === 'string'
      && isOwnedJobStorageDir(downloadDir, job.id, jobStorageDir)
    ) {
      try {
        await fsPromises.rm(jobStorageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
      } catch (err) {
        logger.warn('Failed to remove job storage directory during cancellation cleanup', {
          ...context,
          jobStorageDir,
          error: err && err.message,
        });
      }
    }
  }

  async function cleanupCancelledDirectArtifacts(job) {
    if (!job) return;
    const context = { jobId: job && job.id, preserveSegments: false, mode: 'direct' };
    const cleanupPaths = new Set();
    const addPath = (candidatePath) => {
      if (typeof candidatePath === 'string' && candidatePath.trim()) {
        cleanupPaths.add(candidatePath);
      }
    };

    addPath(job.filePath);
    addPath(job.mp4Path);
    addPath(job.filePath ? `${job.filePath}.part` : null);
    addPath(job.mp4Path ? `${job.mp4Path}.part` : null);
    addPath(job.subtitlePath);
    addPath(job.subtitleZipPath);
    addPath(job.thumbnailPath);
    addPath(job.id && job.storageDir ? path.join(job.storageDir, `${job.id}-thumb.jpg`) : null);
    addPath(job.id && job.storageDir ? path.join(job.storageDir, `${job.id}-subtitles.srt`) : null);
    addPath(job.id && job.storageDir ? path.join(job.storageDir, `${job.id}-subtitles.zip`) : null);

    if (Array.isArray(job.thumbnailPaths)) {
      job.thumbnailPaths.forEach((candidatePath) => addPath(candidatePath));
    }

    await Promise.all(Array.from(cleanupPaths).map((candidatePath) => unlinkIfExists(candidatePath, context)));

    const jobStorageDir = (() => {
      if (typeof job.storageDir === 'string' && job.storageDir.trim()) {
        return job.storageDir;
      }
      if (typeof job.filePath === 'string' && job.filePath.trim()) {
        return path.dirname(job.filePath);
      }
      return '';
    })();

    if (
      jobStorageDir
      && job.id
      && isOwnedJobStorageDir(downloadDir, job.id, jobStorageDir)
    ) {
      try {
        await fsPromises.rm(jobStorageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
      } catch (err) {
        logger.warn('Failed to remove direct job storage directory during cancellation cleanup', {
          ...context,
          jobStorageDir,
          error: err && err.message,
        });
      }
    }
  }

  async function runNativeHlsJob(job, playlistUrl, playlistInfo, resolved = {}) {
    if (!job || !playlistUrl) {
      throw new Error('Missing playlist URL for native HLS download');
    }
    if (!FFMPEG_PATH) {
      throw new Error('FFmpeg not available');
    }

    const outputDir = job.storageDir || (job.filePath ? path.dirname(job.filePath) : downloadDir);
    await fsPromises.mkdir(outputDir, { recursive: true });
    job.storageDir = outputDir;

    const mp4Path = path.join(outputDir, `${job.id}-${job.downloadNameMp4}`);
    const tempMp4Path = `${mp4Path}.part`;
    const sourceDurationSeconds = Number(playlistInfo && playlistInfo.totalDurationSeconds) || 0;
    const estimatedDurationSeconds = job.probe?.seconds ? Math.min(sourceDurationSeconds || job.probe.seconds, job.probe.seconds) : sourceDurationSeconds;
    const progressTracker = createNativeProgress(job, { playlistInfo, playlistText: resolved.playlistText || '', playlistUrl, durationSeconds: estimatedDurationSeconds });
    const primaryTrackSelected = !(job.selection?.audioOnly && resolved.audioUrl);
    // A single resource holding multiple byte-range pieces stays on the scoped
    // streaming path; downloading the entire object would defeat the disk bound.
    const spooledInput = job.mediaType === 'hls' && primaryTrackSelected
      && !playlistInfo.hasByteRange && playlistInfo.segments?.length > 0
      && new Set(playlistInfo.segments).size === playlistInfo.segments.length;
    const configuredAttempts = Number.isFinite(job.maxSegmentAttempts) ? job.maxSegmentAttempts : DEFAULT_MAX_SEGMENT_ATTEMPTS;
    const maxSegmentAttempts = Math.max(1, Math.min(30, Number(configuredAttempts) || 30));
    const requiredPlaylistUrls = job.mediaType === 'hls' ? [
      ...(primaryTrackSelected ? [playlistUrl] : []),
      ...(resolved.audioUrl ? [resolved.audioUrl] : []),
      ...(!job.selection?.audioOnly && resolved.subtitleUrl ? [resolved.subtitleUrl] : []),
    ] : [];
    const proxy = await startScopedMediaProxy({ rootUrl: playlistUrl, headers: job.headers || {}, sourcePageUrl: job.sourcePageUrl, credentialOrigin: job.credentialOrigin || job.url, onResourceEvent: progressTracker.onResourceEvent,
      playlistSnapshots: resolved.playlistSnapshots || {}, headerPolicy: job._headerPolicy || new Map(),
      onTransferStart: () => job._transferMetrics?.begin(),
      onLocalResource: (url, bytes) => job._localPreviewCollector?.captureBytes(url, bytes),
      localResourceUrls: [...String(resolved.playlistText || '').matchAll(/^#EXT-X-(?:KEY|MAP):.*?URI="([^"]+)"/gm)].map(match => new URL(match[1], playlistUrl).href),
      requiredPlaylistUrls,
      pieceSpool: spooledInput ? { segments: playlistInfo.segments, directory: outputDir,
        concurrency: job.maxConcurrent || DEFAULT_MAX_CONCURRENT, maxAttempts: maxSegmentAttempts,
        onReady: ({ url, filePath }) => job._localPreviewCollector?.captureFile(url, filePath) } : undefined,
    });
    const nativeArgs = buildNativeHlsArgs({
      job,
      playlistUrl: proxy.url,
      audioUrl: resolved.audioUrl ? proxy.mapUrl(resolved.audioUrl) : undefined,
      subtitleUrl: resolved.subtitleUrl ? proxy.mapUrl(resolved.subtitleUrl) : undefined,
      outputPath: tempMp4Path,
      headers: {},
      scopedProxy: true,
      inputIsHls: job.mediaType === 'hls',
      spooledInput,
      maxSegmentAttempts,
    });

    job.status = 'downloading';
    job.updatedAt = Date.now();
    job.progress = 0;
    job.bytesDownloaded = 0;
    job.totalBytes = 0;
    job.speedBps = 0;
    job.etaSeconds = null;
    job.downloadMode = job.mediaType === 'hls' ? 'native-hls' : 'native-file';
    job.threadStates = [];
    job.failedSegments = [];

    const parseProgressLine = (line) => {
      const text = String(line || '').trim();
      if (!text) return;
      const [rawKey, ...rest] = text.split('=');
      if (!rawKey || rest.length === 0) return;
      const key = rawKey.trim();
      const value = rest.join('=').trim();

      progressTracker.onFfmpegProgress(key, value);

      job.updatedAt = Date.now();
    };

    let lastErrorSummary = '';
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(FFMPEG_PATH, nativeArgs, {
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        const stopper = createProcessStopper(child, { onStop: () => proxy.close() });
        // Exhausted piece retries must stop the muxer; otherwise its HLS
        // demuxer can skip a missing URI and return a deceptively successful MP4.
        proxy.failure.then(error => { if (error) void stopper.stop(); });

        let progressBuffer = '';
        const cancelPoll = setInterval(() => {
          if (job.cancelled) void stopper.stop();
        }, 250);

        const finalize = (cb) => {
          clearInterval(cancelPoll);
          stopper.dispose();
          cb();
        };

        if (child.stderr) {
          child.stderr.on('data', (chunk) => {
            const text = Buffer.from(chunk).toString('utf8');
            if (!text) return;
            lastErrorSummary = text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .slice(-8)
              .join(' | ')
              .slice(0, 1200);

            progressBuffer += text;
            const lines = progressBuffer.split(/\r?\n/);
            progressBuffer = lines.pop() || '';
            for (const line of lines) {
              parseProgressLine(line);
            }
          });
        }

        child.on('error', (err) => finalize(() => reject(err)));
        child.on('close', (code) => finalize(() => {
          if (progressBuffer) {
            parseProgressLine(progressBuffer);
            progressBuffer = '';
          }

          if (job.cancelled) {
            resolve();
            return;
          }

          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(lastErrorSummary || `ffmpeg exited with code ${code}`));
        }));
      });
      if (!job.cancelled && !job.probe) proxy.assertComplete();
      if (!job.cancelled) {
        // FFmpeg's HLS demuxer can exit 0 after every input request failed.
        // Report the upstream failure instead of a missing-file rename error.
        try { await fsPromises.access(tempMp4Path); } catch {
          const error = new Error('The media tools finished without writing a video. The source refused or broke the request.');
          error.code = 'NO_MEDIA_OUTPUT';
          throw proxy.fatalError || proxy.lastError || error;
        }
      }
    } catch (err) {
      try {
        await fsPromises.unlink(tempMp4Path);
      } catch (_) {
      }
      throw proxy.fatalError || proxy.lastError || err;
    } finally {
      if (job.cancelled) job._previewAbort?.abort();
      if (job._earlyThumbnailPromise) await job._earlyThumbnailPromise;
      await proxy.close();
      await job._localPreviewCollector?.close();
    }

    if (job.cancelled) {
      try {
        await fsPromises.unlink(tempMp4Path);
      } catch (_) {
      }
      if (job.cleanupOnCancel) {
        await cleanupCancelledHlsArtifacts(job, null, { preserveSegments: false });
      }
      job.status = 'cancelled';
      job.updatedAt = Date.now();
      return;
    }

    job.status = 'finalizing';
    job.progress = Math.max(97, Number(job.progress) || 0);
    await fsPromises.rename(tempMp4Path, mp4Path);

    if (job.forcePlaybackCompatibility !== false && !job.selection?.audioOnly) {
      await normalizeMp4ForPlayback(job, mp4Path, { FFMPEG_PATH, FFPROBE_PATH });
    }

    try {
      await generateThumbnailFromMp4(job, mp4Path, {
        outputDir,
        FFMPEG_PATH,
        FFPROBE_PATH,
        skipThumbnailGeneration: job.skipThumbnailGeneration !== false,
      });
    } catch (thumbErr) {
      logger.warn('Thumbnail generation failed after native HLS ingest', {
        jobId: job.id,
        message: thumbErr && thumbErr.message,
      });
    }

    job.mp4Path = mp4Path;
    const completedFile = await fsPromises.stat(mp4Path);
    job.bytesDownloaded = completedFile.size;
    job.totalBytes = completedFile.size;
    job.totalBytesKnown = true;
    // Keep the observed piece count. Successful muxing is not evidence that a
    // particular HTTP resource response completed in full.
    job.totalSegments = Number(playlistInfo && playlistInfo.totalSegments) || 0;
    job.progress = 100;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.status = 'completed';
    job.error = null;
    job.updatedAt = Date.now();
  }

  async function concatenateSegmentsStreaming(job, segments, jobTempDir, maxPartBytes, options = {}) {
    const deleteTempSegments = options.deleteTempSegments !== false;
    const tsParts = [];
    let partIndex = 0;
    let currentStream = null;
    let currentPartBytes = 0;
    let totalBytesWritten = 0;
    const missingSegments = [];

    function openNextPartStream() {
      const basePath = job.filePath.replace(/\.ts$/i, '');
      const partPath = partIndex === 0
        ? `${basePath}.ts`
        : `${basePath}-part${partIndex}.ts`;
      partIndex += 1;
      currentPartBytes = 0;
      currentStream = fs.createWriteStream(partPath);
      currentStream.on('error', (err) => {
        console.error('TS part file stream error during concat', {
          jobId: job.id,
          partPath,
          partIndex: partIndex - 1,
          currentPartBytes,
          totalBytesWritten,
          message: err && err.message,
          code: err && err.code,
          info: err && err.info,
        });
      });
      tsParts.push(partPath);
    }

    try {
      for (let i = 0; i < segments.length; i++) {
        const tempSegmentPath = path.join(jobTempDir, `seg-${i}.ts`);
        try {
          await fsPromises.access(tempSegmentPath);
        } catch {
          missingSegments.push(i);
          continue;
        }

        let stats;
        try {
          stats = await fsPromises.stat(tempSegmentPath);
        } catch (err) {
          console.warn('Failed to stat temp segment during concat', {
            jobId: job.id,
            tempSegmentPath,
            message: err && err.message,
          });
          missingSegments.push(i);
          continue;
        }

        if (!stats || !Number.isFinite(stats.size) || stats.size <= 0) {
          logger.warn('Temp segment missing content during concat', {
            jobId: job.id,
            tempSegmentPath,
            size: stats && stats.size,
          });
          missingSegments.push(i);
          continue;
        }

        if (!currentStream || (currentPartBytes + stats.size) > maxPartBytes) {
          if (currentStream) {
            await new Promise((resolve) => {
              currentStream.once('finish', resolve);
              currentStream.end();
            });
          }
          openNextPartStream();
        }

        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(tempSegmentPath);
          readStream.on('error', (err) => {
            console.error('TS segment read error during concat', {
              jobId: job.id,
              tempSegmentPath,
              message: err && err.message,
            });
            reject(err);
          });
          readStream.on('end', resolve);
          readStream.pipe(currentStream, { end: false });
        });

        currentPartBytes += stats.size;
        totalBytesWritten += stats.size;

        if (deleteTempSegments) {
          try {
            await fsPromises.unlink(tempSegmentPath);
          } catch (_) {
          }
        }
      }

      if (missingSegments.length > 0) {
        throw new Error(buildIncompleteHlsError(segments.length, missingSegments));
      }

      if (!currentStream) {
        return tsParts;
      }

      await new Promise((resolve, reject) => {
        currentStream.once('finish', resolve);
        currentStream.once('error', (err) => {
          console.error('TS part file stream error on finish', {
            jobId: job.id,
            partIndex: partIndex - 1,
            currentPartBytes,
            totalBytesWritten,
            message: err && err.message,
            code: err && err.code,
            info: err && err.info,
          });
          reject(err);
        });
        currentStream.end();
      });
    } catch (err) {
      if (currentStream) {
        currentStream.destroy();
      }
      await Promise.all(
        tsParts.map(async (partPath) => {
          try {
            await fsPromises.unlink(partPath);
          } catch (_) {
          }
        })
      );
      throw err;
    }

    return tsParts;
  }

  // Direct file download helper (for non-HLS resources like MP4)
  async function runDirectJobInternal(job) {
    try {
      logger.info('Direct job started', { jobId: job && job.id, url: job && job.url });
      job.status = 'downloading';
      job.updatedAt = Date.now();
      job.speedBps = 0;
      job.etaSeconds = null;

      if (isYouTubeUrl(job && job.url) || job.mediaType === 'page' || job.mediaType === 'dash') {
        await runYouTubeDirectJob(job);
        logger.info('Direct job finished via yt-dlp', { jobId: job && job.id, status: job && job.status });
        return;
      }

      if (!job.storageDir && job.filePath) {
        job.storageDir = path.dirname(job.filePath);
      }
      if (job.filePath) {
        await fsPromises.mkdir(path.dirname(job.filePath), { recursive: true });
      }

      // The whole file is requested; a captured player Range would save a slice.
      const headers = Object.fromEntries(Object.entries(buildHlsRequestHeaders(job.headers || {}, { sourcePageUrl: job.sourcePageUrl }))
        .filter(([key]) => !/^(?:range|if-range)$/i.test(key)));
      const tempFilePath = `${job.filePath}.part`;
      let downloaded = false;
      let lastErr = null;

      // Direct retries write to temp + rename to avoid exposing partial files.
      // Kept bytes continue only when the server proves the same resource
      // (If-Range with its validator) and answers with the requested range.
      for (let attempt = 1; attempt <= DIRECT_MAX_ATTEMPTS && !job.cancelled; attempt += 1) {
        let directWriteStream = null;
        try {
          const keptBytes = job.directValidator ? await fsPromises.stat(tempFilePath).then((stats) => stats.size, () => 0) : 0;
          job.bytesDownloaded = 0;
          job.totalBytes = 0;
          job.progress = keptBytes > 0 ? Number(job.progress || 0) : 0;
          job.updatedAt = Date.now();

          if (keptBytes === 0) await unlinkIfExists(tempFilePath, { jobId: job.id, reason: 'direct-restart' });
          const requestHeaders = keptBytes > 0 ? { ...headers, Range: `bytes=${keptBytes}-`, 'If-Range': job.directValidator } : headers;

          await requestWithRedirects(job.url, requestHeaders, (res, _finalUrl, req) => {
            return new Promise((resolve, reject) => {
              if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`Request failed with status ${res.statusCode}`));
                res.resume();
                return;
              }

              const contentRange = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(String(res.headers['content-range'] || '').trim());
              const resumed = keptBytes > 0 && res.statusCode === 206 && contentRange && Number(contentRange[1]) === keptBytes;
              if (res.statusCode === 206 && !resumed) {
                reject(new Error('The server returned only part of the file'));
                res.resume();
                return;
              }
              const etag = String(res.headers.etag || '');
              job.directValidator = etag && !/^W\//i.test(etag) ? etag : String(res.headers['last-modified'] || '') || null;

              const totalBytesHeader = res.headers['content-length'];
              const totalBytes = totalBytesHeader ? parseInt(totalBytesHeader, 10) : null;
              const expectedBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes + (resumed ? keptBytes : 0) : 0;
              if (expectedBytes > 0) {
                job.totalBytes = expectedBytes;
              }
              job.bytesDownloaded = resumed ? keptBytes : 0;

              const outStream = fs.createWriteStream(tempFilePath, { flags: resumed ? 'a' : 'w' });
              directWriteStream = outStream;
              outStream.on('error', (err) => {
                console.error('Direct job file stream error', {
                  jobId: job.id,
                  message: err && err.message,
                });
                reject(err);
              });
              outStream.on('finish', () => {
                // A connection that closes early must not be saved as the file.
                if (expectedBytes > 0 && job.bytesDownloaded !== expectedBytes) reject(new Error('The download ended before the whole file arrived'));
                else resolve();
              });

              res.on('data', (chunk) => {
                if (job.cancelled) {
                  job._previewAbort?.abort();
                  req.destroy(new Error('Job cancelled'));
                  return;
                }
                job.bytesDownloaded += chunk.length;
                job._transferMetrics?.recordBytes(chunk.length);
                if (job.bytesDownloaded >= 2 * 1024 * 1024) attemptEarlyThumbnail(job, tempFilePath);
                if (job.totalBytes) {
                  job.progress = Math.max(0, Math.min(100, Math.round((job.bytesDownloaded / job.totalBytes) * 100)));
                }
                job.updatedAt = Date.now();
              });

              res.on('error', reject);
              res.pipe(outStream);
            });
          }, { timeoutMs: 30_000, credentialOrigin: job.credentialOrigin || job.url, sourcePageUrl: job.sourcePageUrl, signal: job._downloadAbort?.signal }).finally(job._transferMetrics?.begin() || (() => {}));

          await closeWriteStream(directWriteStream);
          if (job._earlyThumbnailPromise) await job._earlyThumbnailPromise;
          await fsPromises.rename(tempFilePath, job.filePath);
          downloaded = true;
          break;
        } catch (err) {
          await closeWriteStream(directWriteStream);
          lastErr = err;
          if (job.cancelled || isLocalWriteError(err) || attempt >= DIRECT_MAX_ATTEMPTS) {
            break;
          }

          const delayMs = getRetryBackoffMs(attempt);
          logger.warn('Direct job attempt failed, retrying', {
            jobId: job.id,
            attempt,
            nextAttempt: attempt + 1,
            delayMs,
            error: err && err.message,
          });
          await sleep(delayMs);
        }
      }

      // A preview reader can also hold the partial file open on Windows.
      if (job._earlyThumbnailPromise) await job._earlyThumbnailPromise;
      if (!downloaded && job.cancelled) {
        // Pause and quit keep the bytes for the next attempt to continue.
        if (!job.pauseRequested || job.cleanupOnCancel) await unlinkIfExists(tempFilePath, { jobId: job && job.id, reason: 'direct-cancelled' });
        if (job.cleanupOnCancel) {
          await cleanupCancelledDirectArtifacts(job);
        }
        job.status = 'cancelled';
        job.updatedAt = Date.now();
        return;
      }

      if (!downloaded) {
        throw lastErr || new Error('Direct download failed after retries');
      }

      if (job.cancelled) {
        if (job.cleanupOnCancel) {
          await cleanupCancelledDirectArtifacts(job);
        }
        job.status = 'cancelled';
        job.speedBps = 0;
        job.etaSeconds = null;
      } else {
        job.status = 'completed';
        job.progress = 100;
        // For direct MP4 downloads, the primary asset is already an MP4 file.
        // Point mp4Path at filePath so the existing /api/jobs/:id/file route works.
        job.mp4Path = job.filePath;
        job.speedBps = 0;
        job.etaSeconds = 0;
      }
      job.updatedAt = Date.now();
      logger.info('Direct job finished', { jobId: job && job.id, status: job.status });
    } catch (err) {
      logger.error('Direct job failed', { jobId: job && job.id, error: err && err.message });
      if (job) {
        if (job.cancelled) {
          if (job.cleanupOnCancel) {
            await cleanupCancelledDirectArtifacts(job);
          }
          job.status = 'cancelled';
          job.error = null;
          job.speedBps = 0;
          job.etaSeconds = null;
        } else {
          job.status = 'error';
          job.error = (err && err.message) || 'Direct download failure';
          job.errorCode = classifyError(err);
          job.speedBps = 0;
          job.etaSeconds = null;
        }
        job.updatedAt = Date.now();
      }
    }
  }

  async function tryDirectFallback(job, cause) {
    if (!job || !job.fallbackUrl || job.cancelled || job.fallbackAttempted) {
      return false;
    }
    if (isLocalWriteError(cause) || ['LINK_EXPIRED', 'SOURCE_EXPIRED', 'INSECURE_REDIRECT', 'INVALID_MEDIA_URL'].includes(cause?.code)) return false;

    // Fallback is intended for HLS jobs that made no usable progress.
    if ((job.completedSegments || 0) > 0) {
      return false;
    }

    job.fallbackAttempted = true;

    const original = {
      url: job.url,
      filePath: job.filePath,
      downloadName: job.downloadName,
      downloadNameMp4: job.downloadNameMp4,
      totalSegments: job.totalSegments,
      completedSegments: job.completedSegments,
      threadStates: job.threadStates,
      segmentStates: job.segmentStates,
      failedSegments: job.failedSegments,
      error: job.error,
      progress: job.progress,
    };

    if (!job.originalHlsUrl) {
      job.originalHlsUrl = original.url;
    }
    if (!job.originalHlsDownloadName) {
      job.originalHlsDownloadName = original.downloadName;
    }
    if (!job.originalHlsDownloadNameMp4) {
      job.originalHlsDownloadNameMp4 = original.downloadNameMp4;
    }

    job.url = job.fallbackUrl;
    job.filePath = job.directFallbackFilePath || job.filePath;
    job.downloadName = job.directFallbackDownloadName || job.downloadName;
    job.downloadNameMp4 = job.directFallbackDownloadNameMp4 || job.downloadNameMp4;
    job.totalSegments = 0;
    job.completedSegments = 0;
    job.threadStates = [];
    job.segmentStates = {};
    job.failedSegments = [];
    job.error = null;
    job.progress = 0;
    job.updatedAt = Date.now();

    logger.warn('Switching HLS job to direct fallback URL', {
      jobId: job.id,
      originalUrl: original.url,
      fallbackUrl: job.fallbackUrl,
      cause: cause && cause.message,
    });

    await runDirectJob(job);

    if (job.status === 'error') {
      const fallbackError = job.error || 'Direct fallback failed';
      job.error = `${fallbackError} (original HLS failure: ${(cause && cause.message) || original.error || 'unknown'})`;
      job.fallbackUsed = false;
    } else {
      job.fallbackUsed = true;
    }

    return true;
  }

  // A rendition whose playlist, init or first pieces the CDN refuses (403) or
  // has lost (404/5xx) before any output exists is a dead quality, not a dead
  // video: the page's own player typically uses a different one.
  function isDeadVariantFailure(job, err, resolved) {
    if (!err || job.cancelled || !resolved?.selectedVariant?.url || job.selection?.audioOnly) return false;
    if ((Number(job.progress) || 0) >= 1) return false;
    const status = Number(err.statusCode) || Number(String(err.message || '').match(/\bstatus (\d{3})\b/)?.[1]) || 0;
    return err.code === 'PIECE_UNAVAILABLE' || err.code === 'NO_MEDIA_OUTPUT' || status === 403 || status === 404 || (status >= 500 && status <= 599);
  }

  // The final report for a rendition the CDN has lost: a quality problem the
  // user can act on (choose another quality), not "link expired" or unknown.
  function deadQualityError(job, err) {
    if (!err || job.cancelled || (Number(job.progress) || 0) >= 1) return err;
    const status = Number(err.statusCode) || Number(String(err.message || '').match(/\bstatus (\d{3})\b/)?.[1]) || 0;
    if (err.code !== 'PIECE_UNAVAILABLE' && !(status >= 500 && status <= 599)) return err;
    const error = new Error(`This quality is unavailable from the source${status ? ` (status ${status})` : ''}. Choose another quality.`);
    error.code = 'VARIANT_UNAVAILABLE';
    error.statusCode = status || undefined;
    error.cause = err;
    return error;
  }

  async function runHlsJobInternal(job) {
    try {
      logger.info('HLS job started', { jobId: job && job.id, url: job && job.url });
      job.status = 'fetching-playlist';
      job.updatedAt = Date.now();
      if (!job.storageDir && job.filePath) {
        job.storageDir = path.dirname(job.filePath);
      }
      if (job.filePath) {
        await fsPromises.mkdir(path.dirname(job.filePath), { recursive: true });
      }

      job.qualityFallback = null;
      let resolved = await resolveHlsSelection(job);
      const { headers, playlistInfo, playlistUrl } = resolved;
      const segmentDiagnostics = ensureSegmentDiagnostics(job);
      const segments = playlistInfo.segments;
      job.durationSeconds = playlistInfo.totalDurationSeconds;
      job.selectedHeight = resolved.selectedHeight || job.selection && job.selection.height || null;
      job.totalSegments = playlistInfo.totalSegments || segments.length;
      job.status = 'downloading';
      job.failedSegments = [];
      job.threadStates = [];
      job.segmentStates = {};
      job.updatedAt = Date.now();

      if (!job.selection?.audioOnly && !job.earlyThumbnailAttempted) {
        job.storageDir ||= job.filePath ? path.dirname(job.filePath) : downloadDir;
        job._localPreviewCollector = createLocalPreviewCollector({ job, playlistText: resolved.playlistText, playlistUrl,
          directory: job.storageDir, previewDirectory: path.join(downloadDir, '__previews'), FFMPEG_PATH, FFPROBE_PATH });
      }

      const needsNative = shouldPreferNativeHlsDownload(playlistInfo) || resolved.audioUrl || resolved.subtitleUrl || job.selection && job.selection.audioOnly || job.probe;
      if (needsNative && !FFMPEG_PATH) throw mediaError('This video needs the media tools included with SnagThis', 'MEDIA_TOOLS_MISSING');
      if (FFMPEG_PATH && needsNative) {
        // FFmpeg starts native downloads from the beginning, so no saved pieces
        // depend on the playlist staying the same. A fingerprint kept here would
        // refuse a resume after a quality fallback or a rotated piece path.
        job.playlistTopology = null;
        job.resumePartialSegments = false;
        logger.info('Using native FFmpeg HLS ingest for advanced playlist', {
          jobId: job.id,
          playlistUrl: playlistUrl || job.url,
          totalSegments: playlistInfo.totalSegments,
          isMasterPlaylist: playlistInfo.isMasterPlaylist,
          hasDiscontinuity: playlistInfo.hasDiscontinuity,
          hasMap: playlistInfo.hasMap,
          hasByteRange: playlistInfo.hasByteRange,
          hasFmp4Segments: playlistInfo.hasFmp4Segments,
        });
        const originalHeight = resolved.selectedHeight || null;
        const excludedUrls = new Set();
        let firstError = null;
        for (let fallbacks = 0; ; fallbacks += 1) {
          try {
            await runNativeHlsJob(job, resolved.playlistUrl || job.url, resolved.playlistInfo, resolved);
            return;
          } catch (err) {
            if (fallbacks >= MAX_VARIANT_FALLBACKS || !isDeadVariantFailure(job, err, resolved)) throw deadQualityError(job, firstError || err);
            firstError ||= err;
            excludedUrls.add(resolved.selectedVariant.url);
            let next;
            try {
              next = await resolveHlsSelection(job, { excludedUrls, belowHeight: resolved.selectedVariant.height, audioTrack: job.selection?.audioTrack });
            } catch (resolveError) {
              if (resolveError.code === 'ABORT_ERR') throw resolveError;
              throw deadQualityError(job, firstError);
            }
            logger.warn('Selected HLS quality is unavailable; continuing with another rendition', {
              jobId: job.id, failedHeight: resolved.selectedHeight || null, nextHeight: next.selectedHeight || null,
              statusCode: err.statusCode || null, code: err.code || null,
            });
            if (originalHeight && next.selectedHeight && next.selectedHeight !== originalHeight) {
              job.qualityFallback = { from: originalHeight, to: next.selectedHeight };
            }
            resolved = next;
            job.selectedHeight = next.selectedHeight || job.selectedHeight;
            job.durationSeconds = next.playlistInfo.totalDurationSeconds;
            job.totalSegments = next.playlistInfo.totalSegments || next.playlistInfo.segments.length;
            job.error = null;
            if (!job.selection?.audioOnly && !job.earlyThumbnailAttempted) {
              job._localPreviewCollector = createLocalPreviewCollector({ job, playlistText: next.playlistText, playlistUrl: next.playlistUrl,
                directory: job.storageDir, previewDirectory: path.join(downloadDir, '__previews'), FFMPEG_PATH, FFPROBE_PATH });
            }
          }
        }
      }

      // Saved pieces are reused by index, so they are only safe to keep when
      // the playlist still describes exactly the same pieces.
      const previousTopology = job.playlistTopology;
      if (job.resumePartialSegments && previousTopology && previousTopology !== playlistInfo.topologyFingerprint) {
        throw mediaError('The video changed. Start a new download to keep the existing pieces safe.', 'SOURCE_CHANGED');
      }
      job.playlistTopology = playlistInfo.topologyFingerprint;
      job.downloadMode = 'segmented';
      job.segmentProgressAvailable = true;
      // Initialize all segments as pending
      for (let i = 0; i < segments.length; i++) {
        job.segmentStates[i] = { status: 'pending', attempt: 0 };
      }

      const maxConcurrent = job.maxConcurrent && job.maxConcurrent > 0
        ? Math.min(16, job.maxConcurrent)
        : DEFAULT_MAX_CONCURRENT;

      // Create or reuse temp directory for this playlist's segment files, based on URL
      const jobTempDir = job.segmentTempDir || getJobTempDirForUrl(job.url, job.id);
      job.segmentTempDir = jobTempDir;
      const shouldResumePartialSegments = job.resumePartialSegments === true && !!previousTopology;
      if (!shouldResumePartialSegments) {
        try {
          await fsPromises.rm(jobTempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
        } catch (err) {
          logger.warn('Failed to reset stale HLS temp directory before download', {
            jobId: job.id,
            tempDir: jobTempDir,
            error: err && err.message,
          });
        }
      }
      await fsPromises.mkdir(jobTempDir, { recursive: true });
      job.resumePartialSegments = false;

      // Check for existing segments from previous download attempts
      const existingSegments = new Set();
      if (shouldResumePartialSegments) {
        try {
          const existingFiles = await fsPromises.readdir(jobTempDir);
          await Promise.all(
            existingFiles.map(async (file) => {
              const match = file.match(/^seg-(\d+)\.ts$/);
              if (!match) return;
              const segIndex = parseInt(match[1], 10);
              const filePathSeg = path.join(jobTempDir, file);
              try {
                const stats = await fsPromises.stat(filePathSeg);
                // Only consider files with non-zero size as valid
                if (stats.size > 0) {
                  existingSegments.add(segIndex);
                }
              } catch (err) {
                console.warn('Error stat-ing existing segment file', {
                  jobId: job.id,
                  filePath: filePathSeg,
                  message: err && err.message,
                });
              }
            })
          );
          if (existingSegments.size > 0) {
            logger.info('Resuming HLS job from existing local segments', {
              jobId: job.id,
              existingSegments: existingSegments.size,
            });
          }
        } catch (err) {
          console.warn('Error checking for existing segments:', err.message);
        }
      } else {
        logger.info('Starting HLS job with a clean temp segment directory', {
          jobId: job.id,
          tempDir: jobTempDir,
        });
      }

      // Track how many times each segment has been attempted in total.
      const attempts = new Array(segments.length).fill(0);
      let expectedSegmentProfile = segmentDiagnostics.expectedProfile || null;

      // Track when a segment is next eligible to be retried (for backoff).
      const nextAttemptAt = new Array(segments.length).fill(0);

      // Pre-compute maximum attempts allowed per segment.
      const maxAttemptsPerSegment =
        job.maxSegmentAttempts === Infinity
          ? Infinity
          : (Number.isFinite(job.maxSegmentAttempts)
              ? job.maxSegmentAttempts
              : DEFAULT_MAX_SEGMENT_ATTEMPTS);
      // A direct fallback only runs before any segment succeeds; reach it
      // quickly instead of spending the whole retry budget first.
      const getSegmentAttemptLimit = () => (
        job.fallbackUrl && !job.fallbackAttempted && !job.completedSegments
          ? Math.min(5, maxAttemptsPerSegment)
          : maxAttemptsPerSegment
      );

      // Index for new segments; failed segments are managed in a separate queue.
      let nextIndex = 0;
      const failedQueue = [];
      let terminalSegmentError = null;
      const areAllSegmentsTerminal = () => {
        for (let idx = 0; idx < segments.length; idx += 1) {
          const state = job.segmentStates[idx];
          if (!state) return false;
          if (state.status !== 'completed' && state.status !== 'failed') {
            return false;
          }
        }
        return true;
      };
      const hasActiveSegmentDownloads = () => {
        for (let idx = 0; idx < segments.length; idx += 1) {
          const state = job.segmentStates[idx];
          if (state && state.status === 'downloading') {
            return true;
          }
        }
        return false;
      };

      async function worker(workerId) {
        while (!job.cancelled && !terminalSegmentError) {
          if (nextIndex >= segments.length && failedQueue.length === 0 && areAllSegmentsTerminal()) {
            break;
          }

          let i = null;

          // First exhaust all primary segments, then consume retries.
          if (nextIndex < segments.length) {
            i = nextIndex;
            nextIndex += 1;
          } else if (failedQueue.length > 0) {
            // Find the first failed segment whose backoff has elapsed and is still
            // eligible for another attempt. This lets any idle worker pick up
            // retries without blocking on a per-segment sleep.
            const now = Date.now();
            let chosenIndexInQueue = -1;

            for (let q = 0; q < failedQueue.length; q++) {
              const candidate = failedQueue[q];
              const state = job.segmentStates[candidate];

              // Skip segments that have since been marked completed/failed.
              if (!state || state.status === 'completed' || state.status === 'failed') {
                continue;
              }

              // Respect per-segment backoff window.
              if (now < (nextAttemptAt[candidate] || 0)) {
                continue;
              }

              chosenIndexInQueue = q;
              break;
            }

            if (chosenIndexInQueue !== -1) {
              i = failedQueue.splice(chosenIndexInQueue, 1)[0];
            } else {
              // No retryable retry work available right now; fall through to
              // potential race attempts on already-downloading segments below.
              i = null;
            }
          }

          if (i == null) {
            if (areAllSegmentsTerminal()) {
              break;
            }

            // Another worker is already downloading the remaining in-flight work.
            // Wait for it to complete or fail instead of spending more attempts on
            // the same segment in parallel.
            if (hasActiveSegmentDownloads()) {
              await sleep(25);
              continue;
            }

            if (failedQueue.length > 0) {
              const now = Date.now();
              let nextDueAt = Infinity;

              for (const segIdx of failedQueue) {
                const dueAt = nextAttemptAt[segIdx] || 0;
                if (dueAt > now && dueAt < nextDueAt) {
                  nextDueAt = dueAt;
                }
              }

              if (Number.isFinite(nextDueAt)) {
                const waitMs = Math.max(25, Math.min(300, nextDueAt - now));
                await sleep(waitMs);
              } else {
                await sleep(25);
              }
              continue;
            }

            // Nothing left to do for this worker.
            break;
          }

          const segmentUrl = segments[i];
          let success = false;
          const canonicalSegmentPath = path.join(jobTempDir, `seg-${i}.ts`);
          let attemptTempPath = null;
          let segmentStream = null;

          // Check if segment already exists from previous download
          if (existingSegments.has(i)) {
            const probeResult = await probeSegmentFile(canonicalSegmentPath, { FFPROBE_PATH });
            if (!probeResult.skipped) {
              if (probeResult.ok) {
                const analysis = analyzeSegmentProbe(probeResult.probeData, expectedSegmentProfile);
                const promoteObservedProfile =
                  !expectedSegmentProfile && analysis.observedProfile.streamCount > 0;
                recordSegmentDiagnostic(job, {
                  index: i,
                  url: segmentUrl,
                  path: canonicalSegmentPath,
                  observedProfile: analysis.observedProfile,
                  issues: analysis.issues,
                  validatedAt: Date.now(),
                  promoteObservedProfile,
                });
                if (promoteObservedProfile) {
                  expectedSegmentProfile = analysis.observedProfile;
                }
              } else {
                recordSegmentDiagnostic(job, {
                  index: i,
                  url: segmentUrl,
                  path: canonicalSegmentPath,
                  observedProfile: null,
                  issues: probeResult.issues,
                  validatedAt: Date.now(),
                  promoteObservedProfile: false,
                });
              }
            }
            success = true;
            job.completedSegments += 1;
            
            // Mark segment as completed immediately
            job.segmentStates[i] = {
              status: 'completed',
              attempt: 1,
              completedAt: Date.now(),
              resumed: true,
            };
            
            // Update progress
            const actuallyCompleted = Object.values(job.segmentStates).filter(
              s => s && s.status === 'completed'
            ).length;
            job.progress = job.totalSegments
              ? Math.round((actuallyCompleted / job.totalSegments) * 100)
              : 0;
            job.updatedAt = Date.now();
            
            continue; // Skip to next segment
          }

          // Check if another racing thread already completed this segment
          const currentState = job.segmentStates[i];
          if (currentState && currentState.status === 'completed') {
            // Mark this thread as idle since the segment is already done
            job.threadStates[workerId] = {
              workerId,
              segmentIndex: null,
              url: null,
              status: 'idle',
            };
            continue;
          }

          attempts[i] += 1;
          const attempt = attempts[i];

          // Update segment state to downloading
          job.segmentStates[i] = {
            status: 'downloading',
            attempt,
            startedAt: Date.now(),
          };

          job.threadStates[workerId] = {
            workerId,
            segmentIndex: i,
            url: segmentUrl,
            status: attempt > 1 ? 'retrying' : 'downloading',
            attempt,
            startedAt: Date.now(),
          };

          try {
            // Download this attempt into its own temporary file in the
            // job-specific folder. The first successful attempt will be promoted
            // to the canonical segment file; later successes will be discarded.
            attemptTempPath = path.join(
              jobTempDir,
              `seg-${i}-w${workerId}-a${attempt}-${Date.now()}.tmp`
            );
            segmentStream = fs.createWriteStream(attemptTempPath);
            segmentStream.on('error', (err) => {
              console.error('Segment file stream error during download', {
                jobId: job.id,
                workerId,
                segmentIndex: i,
                attempt,
                attemptTempPath,
                message: err && err.message,
                code: err && err.code,
                info: err && err.info,
              });
            });
            await downloadSegment(segmentUrl, headers, segmentStream, job);
            await closeWriteStream(segmentStream);

            // Check again if another thread completed this segment while we were downloading
            const stateAfterDownload = job.segmentStates[i];
            if (stateAfterDownload && stateAfterDownload.status === 'completed') {
              // Another thread won the race; discard our temp file and move on
              try {
                fs.unlinkSync(attemptTempPath);
              } catch (_) {
                // ignore cleanup errors
              }
              // Mark this thread as idle since another thread completed the segment
              job.threadStates[workerId] = {
                workerId,
                segmentIndex: null,
                url: null,
                status: 'idle',
              };
              continue;
            }

            success = true;

            // Promote this attempt to the canonical segment file *only if*
            // no other racing attempt has already completed this segment.
            const currentStateAfter = job.segmentStates[i];
            if (!currentStateAfter || currentStateAfter.status !== 'completed') {
              try {
                fs.renameSync(attemptTempPath, canonicalSegmentPath);
              } catch (renameErr) {
                console.warn('Failed to promote temp segment file', {
                  jobId: job.id,
                  segmentIndex: i,
                  message: renameErr.message,
                });
              }

              const validationPath = fs.existsSync(canonicalSegmentPath)
                ? canonicalSegmentPath
                : attemptTempPath;
              const probeResult = await probeSegmentFile(validationPath, { FFPROBE_PATH });

              if (!probeResult.skipped) {
                if (probeResult.ok) {
                  const analysis = analyzeSegmentProbe(probeResult.probeData, expectedSegmentProfile);
                  const promoteObservedProfile =
                    !expectedSegmentProfile && analysis.observedProfile.streamCount > 0;
                  recordSegmentDiagnostic(job, {
                    index: i,
                    url: segmentUrl,
                    path: validationPath,
                    observedProfile: analysis.observedProfile,
                    issues: analysis.issues,
                    validatedAt: Date.now(),
                    promoteObservedProfile,
                  });
                  if (promoteObservedProfile) {
                    expectedSegmentProfile = analysis.observedProfile;
                  }
                  if (analysis.issues.length > 0) {
                    logger.warn('HLS segment validation reported suspicious media characteristics', {
                      jobId: job.id,
                      segmentIndex: i,
                      issues: analysis.issues.map((issue) => issue.code),
                      observedProfile: analysis.observedProfile,
                    });
                  }
                  if (analysis.shouldRetry) {
                    throw new Error(`Segment validation failed: ${analysis.issues.map((issue) => issue.code).join(', ')}`);
                  }
                } else {
                  recordSegmentDiagnostic(job, {
                    index: i,
                    url: segmentUrl,
                    path: validationPath,
                    observedProfile: null,
                    issues: probeResult.issues,
                    validatedAt: Date.now(),
                    promoteObservedProfile: false,
                  });
                  logger.warn('HLS segment validation failed', {
                    jobId: job.id,
                    segmentIndex: i,
                    issues: probeResult.issues.map((issue) => issue.code),
                  });
                  throw new Error(`Segment validation failed: ${probeResult.issues.map((issue) => issue.code).join(', ')}`);
                }
              }

              job.segmentStates[i] = {
                status: 'completed',
                attempt,
                completedAt: Date.now(),
              };
            } else {
              // Another attempt already won the race; discard our temp file.
              try {
                fs.unlinkSync(attemptTempPath);
              } catch (_) {
                // ignore cleanup errors
              }
            }
          } catch (err) {
            if (isLocalWriteError(err) && !terminalSegmentError) {
              terminalSegmentError = err;
              job._downloadAbort?.abort(err);
              job._previewAbort?.abort();
            } else if (isSourceExpiredSegmentError(err) && attempt >= SOURCE_EXPIRED_SEGMENT_ATTEMPTS && !terminalSegmentError
              && !(job.fallbackUrl && !job.fallbackAttempted && !job.completedSegments)) {
              // A brief retry absorbs a CDN hiccup; a lasting 401/403/404/410
              // means the signed link lapsed and waiting will never finish it.
              terminalSegmentError = mediaError('Link expired. Reopen the page to continue.', 'SOURCE_EXPIRED');
              job._downloadAbort?.abort(terminalSegmentError);
              job._previewAbort?.abort();
            }
            await closeWriteStream(segmentStream);
            if (attemptTempPath) {
              try {
                await fsPromises.unlink(attemptTempPath);
              } catch (_) {
              }
            }
            try {
              if (fs.existsSync(canonicalSegmentPath)) {
                await fsPromises.unlink(canonicalSegmentPath);
              }
            } catch (_) {
            }
            if (terminalSegmentError || job.cancelled) {
              job.segmentStates[i] = { status: terminalSegmentError ? 'failed' : 'pending', attempt, error: err.message };
              break;
            }
            console.warn(attempt > 1 ? 'Retry segment failed' : 'Segment download failed', {
              jobId: job.id,
              segmentIndex: i,
              attempt,
              message: err.message,
            });

            // Check if another thread completed this segment while we were downloading
            const stateAfterError = job.segmentStates[i];
            if (stateAfterError && stateAfterError.status === 'completed') {
              // Another thread won the race; don't update state to retrying/failed
              // Mark this thread as idle since another thread completed the segment
              job.threadStates[workerId] = {
                workerId,
                segmentIndex: null,
                url: null,
                status: 'idle',
              };
              continue;
            }

            if (attempt < getSegmentAttemptLimit()) {
              // Queue for another retry with a backoff timestamp.
              job.segmentStates[i] = {
                status: 'retrying',
                attempt,
                error: err.message,
              };
              const delayMs = getRetryBackoffMs(attempt);
              nextAttemptAt[i] = Date.now() + delayMs;
              if (!failedQueue.includes(i)) {
                failedQueue.push(i);
              }
            } else {
              // Mark segment as failed after all attempts exhausted
              job.segmentStates[i] = {
                status: 'failed',
                attempt,
                error: err.message,
              };
              job.failedSegments.push({ index: i, url: segmentUrl, error: err.message });
            }
          }

          if (success) {
            const state = job.segmentStates[i];
            if (state && state.status === 'completed') {
              const completedCount = Object.values(job.segmentStates).filter(
                (s) => s && s.status === 'completed'
              ).length;
              job.completedSegments = completedCount;
              await job._localPreviewCollector?.captureFile(segmentUrl, canonicalSegmentPath);
            }
          }
          
          const segmentStateValues = Object.values(job.segmentStates);
          const actuallyCompleted = segmentStateValues.filter(
            (s) => s && s.status === 'completed'
          ).length;
          const hasInFlight = segmentStateValues.some(
            (s) => s && s.status !== 'completed' && s.status !== 'failed'
          );
          let computedProgress = job.totalSegments
            ? Math.round((actuallyCompleted / job.totalSegments) * 100)
            : 0;
          // Keep progress below 100 while post-download finalize steps are pending.
          // "100%" should only mean the download is fully complete and usable.
          if (computedProgress >= 100) {
            computedProgress = 99;
          }
          job.progress = computedProgress;
          job.updatedAt = Date.now();

          job.threadStates[workerId] = {
            workerId,
            segmentIndex: null,
            url: null,
            status: 'idle',
          };
        }
      }

      const workers = [];
      const workerCount = Math.min(maxConcurrent, segments.length || 1);
      logger.info('Starting segment workers', { jobId: job.id, requestedThreads: job.maxConcurrent, maxConcurrent, workerCount, segmentCount: segments.length });
      for (let i = 0; i < workerCount; i++) {
        job.threadStates[i] = { workerId: i, segmentIndex: null, url: null, status: 'idle' };
        workers.push(worker(i));
      }
      await Promise.all(workers);
      if (terminalSegmentError) throw terminalSegmentError;
      if (job._earlyThumbnailPromise) await job._earlyThumbnailPromise;

      const incompleteSegmentIndexes = [];
      for (let i = 0; i < segments.length; i += 1) {
        const state = job.segmentStates[i];
        if (!state || state.status !== 'completed') {
          incompleteSegmentIndexes.push(i);
        }
      }

      if (!job.cancelled && incompleteSegmentIndexes.length > 0) {
        throw new Error(buildIncompleteHlsError(segments.length, incompleteSegmentIndexes));
      }

      if (job.cancelled) {
        const preserveSegmentsForPause = !!job.pauseRequested && !job.cleanupOnCancel;
        await cleanupCancelledHlsArtifacts(job, jobTempDir, { preserveSegments: preserveSegmentsForPause });
        job.status = 'cancelled';
        job.updatedAt = Date.now();
        logger.info('HLS job cancelled before finalization', {
          jobId: job && job.id,
          preserveSegmentsForPause,
          cleanupOnCancel: !!job.cleanupOnCancel,
        });
        return;
      }

      if (!job.cancelled && job.failedSegments.length > 0 && job.completedSegments === 0) {
        throw new Error('All segments failed to download.');
      }

      if (!job.cancelled) {
        job.status = 'finalizing';
        if (job.progress >= 100) {
          job.progress = 99;
        }
        job.updatedAt = Date.now();
      }

      const segmentFiles = segments.map((_, index) => path.join(jobTempDir, `seg-${index}.ts`));
      job.segmentFiles = segmentFiles;

      const tsParts = await concatenateSegmentsStreaming(job, segments, jobTempDir, MAX_TS_PART_BYTES, {
        deleteTempSegments: !FFMPEG_PATH,
      });
      job.tsParts = tsParts;
      const filePathFinal = tsParts && tsParts.length > 0 ? tsParts[0] : job.filePath;

      await job._localPreviewCollector?.close();
      const remuxResult = await remuxAndGenerateThumbnails(job, filePathFinal, {
        downloadDir,
        FFMPEG_PATH,
        FFPROBE_PATH,
        skipThumbnailGeneration: job.skipThumbnailGeneration !== false,
      });
      if (remuxResult && remuxResult.usedTsFallback && remuxResult.error) {
        job.error = remuxResult.error;
      }

      try {
        const remainingFiles = await fsPromises.readdir(jobTempDir);

        // Delete any leftover temp files after remux/fallback has finished using them.
        for (const file of remainingFiles) {
          try {
            await fsPromises.unlink(path.join(jobTempDir, file));
          } catch (unlinkErr) {
            logger.warn('Failed to delete temp file during cleanup', {
              jobId: job.id,
              file,
              error: unlinkErr && unlinkErr.message,
            });
          }
        }

        await fsPromises.rmdir(jobTempDir);
        logger.info('Cleaned up temp segment directory', {
          jobId: job.id,
          tempDir: jobTempDir,
          filesDeleted: remainingFiles.length,
        });
      } catch (err) {
        logger.warn('Failed to cleanup temp directory', {
          jobId: job.id,
          tempDir: jobTempDir,
          error: err && err.message,
        });
      }
      job.segmentFiles = null;
      try {
        const diagnosticsOutputDir = job.storageDir || (job.filePath ? path.dirname(job.filePath) : downloadDir);
        const reportPath = await writeSegmentDiagnosticsReport(job, diagnosticsOutputDir);
        if (reportPath) {
          logger.info('Wrote HLS segment diagnostics report', {
            jobId: job.id,
            reportPath,
            validatedSegments: job.segmentDiagnostics && job.segmentDiagnostics.validatedSegments,
            issueCount: job.segmentDiagnostics && job.segmentDiagnostics.issueCount,
          });
        }
      } catch (diagnosticErr) {
        logger.warn('Failed to finalize HLS segment diagnostics report', {
          jobId: job.id,
          error: diagnosticErr && diagnosticErr.message,
        });
      }

      if (job.cancelled) {
        job.status = 'cancelled';
      } else if (job.failedSegments.length > 0 && job.completedSegments === 0) {
        job.status = 'error';
        job.error = 'All segments failed to download.';
      } else if (remuxResult && remuxResult.usedTsFallback) {
        job.status = 'completed-with-errors';
      } else if (job.failedSegments.length > 0) {
        job.status = 'error';
        if (!job.error) {
          job.error = buildIncompleteHlsError(
            job.totalSegments || job.failedSegments.length,
            job.failedSegments.map((segment) => segment && segment.index)
          );
        }
      } else {
        job.status = 'completed';
        job.error = null;
      }
      if (job.status === 'completed' || job.status === 'completed-with-errors' || job.status === 'error') {
        if (job.totalSegments && job.completedSegments > 0) {
          job.progress = 100;
        }
      }
      job.updatedAt = Date.now();
      logger.info('HLS job finished', { jobId: job && job.id, status: job.status });
    } catch (err) {
      logger.error('HLS job failed', { jobId: job && job.id, error: err && err.message });
      if (job) {
        try {
          const diagnosticsOutputDir = job.storageDir || (job.filePath ? path.dirname(job.filePath) : downloadDir);
          await writeSegmentDiagnosticsReport(job, diagnosticsOutputDir);
        } catch (_) {
        }
      }
      const usedFallback = !['DRM_PROTECTED', 'LIVE_STREAM_UNSUPPORTED', 'SOURCE_CHANGED', 'SELECTION_UNAVAILABLE'].includes(err && err.code) && await tryDirectFallback(job, err);
      if (usedFallback) {
        return;
      }
      if (job) {
        if (job.cancelled) {
          const cleanupOnCancel = !!job.cleanupOnCancel;
          const jobTempDir = job.segmentTempDir || getJobTempDirForUrl(job.url, job.id);
          await cleanupCancelledHlsArtifacts(job, jobTempDir, {
            preserveSegments: !!job.pauseRequested && !cleanupOnCancel,
          });
          job.status = 'cancelled';
          job.error = null;
        } else {
          job.status = 'error';
          job.error = (err && err.message) || 'Unknown job failure';
          job.errorCode = classifyError(err);
        }
        job.updatedAt = Date.now();
      }
    }
  }

  return { runJob, runDirectJob };
}

module.exports = { createJobProcessor, __test: { buildYouTubeBrowserSessionArgs, buildYtDlpSubtitleArgs, buildYtDlpRuntimeOptions, createYtDlpTrustOptions, getYtDlpTransportError, resolveYouTubeVideoUrl } };
