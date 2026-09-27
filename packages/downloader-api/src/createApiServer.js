const express = require('express');
const path = require('path');
const { extractYouTubeVideoId, youtubeVideoIdOf, youtubeArtwork } = require('./utils/youtubeArtwork');
const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const { spawnSync } = require('child_process');
const WebSocket = require('ws');
const { createHash } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { API, HEADER, CLIENT, validateSelection, classifyProblem, isAccent, isAccentTimestamp } = require('@m3u8/contracts');
const { createBridgeSecurity, redact, EXTENSION_ORIGIN } = require('./utils/security');
const { generatePreviewAssets, PREVIEW_CLIP_SUFFIX } = require('@m3u8/downloader-engine/src/core/PreviewClip');
const { isMediaFilePath, normalizeMediaExtension, withMediaExtension } = require('@m3u8/downloader-engine/src/utils/mediaFiles');
const { redactPaths } = require('@m3u8/downloader-engine/src/utils/redact');
const { isHttpUrl } = require('./utils/urls');
const { downloadRemoteImage } = require('./utils/remoteImage');
const {
  QueueManager,
  createJobProcessor,
  startCleanupScheduler,
  config: engineConfig,
} = require('@m3u8/downloader-engine');

const registerHistoryRoutes = require('./routes/history');
const registerQueueRoutes = require('./routes/queue');
const registerJobRoutes = require('./routes/jobs');
const { HistoryIndexService } = require('./services/historyIndex');
const logger = require('./utils/logger');
const { inferMediaMetadata } = require('./utils/mediaMetadata');
const { inspectMedia } = require('./services/mediaInspection');
const { createAudioSampler } = require('./services/audioSample');
const { lookupPoster } = require('./services/tmdb');
const {
  buildDownloadAssetUrl,
  buildJobStorageDir,
  decodeExternalDownloadPath,
  EXTERNAL_DOWNLOAD_PREFIX,
  isInsideDirectory,
} = require('./utils/downloadPaths');
const appConfig = require('./config');

const TMDB_CACHE_VERSION = 1;
const TMDB_CACHE_MAX_ENTRIES = 2000;
const TMDB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function detectFFmpegPath(explicitPath, options = {}) {
  const trustExplicitPath = Boolean(options.trustExplicitPath);
  if (trustExplicitPath && explicitPath && fs.existsSync(explicitPath)) {
    logger.info('FFmpeg detected (trusted explicit path)', { ffmpegPath: explicitPath });
    return explicitPath;
  }

  const possiblePaths = [
    explicitPath,
    process.env.FFMPEG_PATH,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'ffmpeg',
  ].filter(Boolean);
  const dedupedPaths = [...new Set(possiblePaths)];

  for (const ffmpegPath of dedupedPaths) {
    try {
      const probe = spawnSync(ffmpegPath, ['-version'], {
        stdio: 'ignore',
        timeout: 20_000,
      });
      if (probe.status !== 0) {
        // Some binaries can exceed the probe timeout in constrained environments.
        if (probe.error && probe.error.code === 'ETIMEDOUT' && fs.existsSync(ffmpegPath)) {
          logger.info('FFmpeg probe timed out; using configured path', { ffmpegPath });
          return ffmpegPath;
        }
        continue;
      }
      logger.info('FFmpeg detected', { ffmpegPath });
      return ffmpegPath;
    } catch {
      continue;
    }
  }

  logger.warn('FFmpeg not detected - conversion and thumbnails disabled');
  return null;
}

function detectYtDlpPath(explicitPath, options = {}) {
  const trustExplicitPath = Boolean(options.trustExplicitPath);
  if (trustExplicitPath && explicitPath && fs.existsSync(explicitPath)) {
    logger.info('yt-dlp detected (trusted explicit path)', { ytDlpPath: explicitPath });
    return explicitPath;
  }

  const possiblePaths = [
    explicitPath,
    process.env.YTDLP_PATH,
    process.env.YT_DLP_PATH,
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp',
  ].filter(Boolean);
  const dedupedPaths = [...new Set(possiblePaths)];

  for (const ytDlpPath of dedupedPaths) {
    try {
      const probe = spawnSync(ytDlpPath, ['--version'], {
        stdio: 'ignore',
        timeout: 20_000,
      });
      if (probe.status === 0) {
        return ytDlpPath;
      }
      if (probe.error && probe.error.code === 'ETIMEDOUT' && fs.existsSync(ytDlpPath)) {
        logger.info('yt-dlp probe timed out; using configured path', { ytDlpPath });
        return ytDlpPath;
      }
    } catch {
      continue;
    }
  }

  return '';
}

function isYouTubeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    const host = String(parsed.hostname || '').toLowerCase();
    return host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'youtu.be'
      || host.endsWith('.youtu.be');
  } catch {
    return false;
  }
}

function isJobStorageDirectoryName(name) {
  const value = String(name || '').trim();
  if (!value) return false;
  return /^[a-z0-9]+-[a-z0-9]+$/i.test(value);
}

function createApiServer(options = {}) {
  const {
    host = API.host,
    port = API.port,
    appVersion = '0.0.0',
    dataDir,
    downloadDir,
    initialQueueSettings,
    getCompletedOutputDir,
    ffmpegPath,
    ffprobePath,
    trustBinaryPaths = false,
    // Embedding-code option for local test fixtures only; never set from request
    // input or the environment. The desktop app leaves it off.
    inspectPrivateAddresses = false,
    onFocus,
    ytDlpPath,
    authToken,
    allowedOrigins = ['null', 'http://localhost:5173', 'http://127.0.0.1:5173'],
    onTrashFile,
    onOpenFile,
    onLocateFile,
    onExtensionConnected,
    onPairingChange,
    onGetSettings,
    onSaveSettings,
    onGetAppearance,
    onDownloadComplete,
    onResolvePage,
  } = options;

  if (!dataDir) {
    throw new Error('createApiServer requires dataDir');
  }

  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('The desktop bridge must bind to loopback');
  // Disconnect, revoke, re-pair and legacy-token retirement close live sockets
  // whose credential is no longer current (closeRevokedSockets, below).
  let closeRevokedSockets = () => {};
  const security = createBridgeSecurity({
    dataDir, authToken, allowedOrigins, onExtensionConnected, onPairingChange,
    onCredentialsRevoked: () => closeRevokedSockets(),
  });
  const resolvedDownloadDir = downloadDir || path.join(dataDir, 'downloads');
  fs.mkdirSync(resolvedDownloadDir, { recursive: true });

  const FFMPEG_PATH = detectFFmpegPath(ffmpegPath, { trustExplicitPath: trustBinaryPaths });
  const FFPROBE_PATH = ffprobePath || process.env.FFPROBE_PATH
    || (FFMPEG_PATH ? FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1') : null);
  const YT_DLP_PATH = detectYtDlpPath(
    ytDlpPath || process.env.YTDLP_PATH || process.env.YT_DLP_PATH,
    { trustExplicitPath: trustBinaryPaths },
  );
  if (YT_DLP_PATH) {
    process.env.YTDLP_PATH = YT_DLP_PATH;
    logger.info('yt-dlp detected', { ytDlpPath: YT_DLP_PATH });
  } else {
    logger.warn('yt-dlp not detected - YouTube URL downloads will fail', {
      envHint: 'Set YTDLP_PATH or install yt-dlp in PATH',
    });
  }

  const fsPromises = fs.promises;

  const app = express();
  const server = http.createServer(app);

  app.use((req, res, next) => {
    res.setHeader(HEADER.apiVersion, API.apiVersion);
    next();
  });

  app.disable('x-powered-by');
  // One-click pairing routes answer only extension pages: not `null` (a sandboxed
  // iframe on any website sends it), not web origins, and not native clients.
  const ONE_CLICK_PAIRING_PATHS = new Set(['/v1/pair/request', '/v1/pair/status', '/v1/pair/cancel']);
  app.use((req, res, next) => {
    const origin = String(req.headers.origin || '');
    const oneClickPairing = ONE_CLICK_PAIRING_PATHS.has(req.path);
    const publicRequest = req.path === '/v1/health' || req.path === '/v1/pair/complete' || oneClickPairing;
    const expectedPort = server.address() && server.address().port;
    const requestHost = String(req.headers.host || '');
    const allowedHosts = new Set([`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`, `[::1]:${expectedPort}`]);
    if (!allowedHosts.has(requestHost) || !security.originAllowed(origin, { pairingRequest: publicRequest })
      || (oneClickPairing && !EXTENSION_ORIGIN.test(origin))) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', `${HEADER.authorization},Content-Type,${HEADER.client},${HEADER.protocolVersion},X-Extension-Version`);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    const client = security.authenticate(req);
    if (!publicRequest && !client && !security.verifyAsset(req)) {
      return res.status(401).json({ error: 'Connect this extension in SnagThis settings', code: 'PAIRING_REQUIRED' });
    }
    req.bridgeClient = client;
    if (client) security.markConnected(req, client);
    const json = res.json.bind(res);
    res.json = (payload) => json(security.publicPayload(payload));
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  const mediaAssetExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mkv', '.mov', '.m4v', '.ts', '.avi', '.srt', '.vtt']);
  app.get('/downloads/*asset', (req, res, next) => {
    if (req.path.startsWith(EXTERNAL_DOWNLOAD_PREFIX)) return next();
    const relative = Array.isArray(req.params.asset) ? req.params.asset.join('/') : String(req.params.asset || '');
    const candidate = path.resolve(resolvedDownloadDir, relative);
    if (!isInsideDirectory(path.resolve(resolvedDownloadDir), candidate) || !mediaAssetExtensions.has(path.extname(candidate).toLowerCase())) return res.sendStatus(404);
    try {
      if (!isInsideDirectory(fs.realpathSync(resolvedDownloadDir), fs.realpathSync(candidate))) return res.sendStatus(404);
    } catch { return res.sendStatus(404); }
    return res.sendFile(candidate);
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const jobLimitResponse = { error: 'Too many downloads were added at once. Wait a minute and try again.', code: 'RATE_LIMITED' };
  const jobCreationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: jobLimitResponse,
    standardHeaders: true,
    legacyHeaders: false,
  });
  // /api is refused to extension clients below and every request here is
  // already authenticated, so a pasted list of links gets a generous bound
  // instead of the extension's per-click limit.
  const desktopJobCreationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: jobLimitResponse,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api', apiLimiter);
  app.use('/v1', apiLimiter);
  app.post('/api/jobs', desktopJobCreationLimiter);
  app.post('/v1/jobs', jobCreationLimiter);

  // Lock /api routes to desktop-local usage boundaries. Extension bridge must use /v1.
  app.use('/api', (req, res, next) => {
    const origin = String(req.headers.origin || '').trim();
    const client = String(req.headers[HEADER.client.toLowerCase()] || '').trim();
    if (origin.startsWith('chrome-extension://') || client === CLIENT.extension || req.bridgeClient?.kind === 'extension') {
      res.status(403).json({ error: 'Use /v1 extension bridge endpoints for extension clients' });
      return;
    }
    next();
  });

  app.post('/api/maintenance/clear-temp-downloads', async (req, res) => {
    if (!queueManager.queueRestored) {
      res.status(409).json({ error: 'The download list could not be restored, so partial downloads are being kept.' });
      return;
    }
    try {
      const result = await clearInactiveTempDownloadArtifacts();
      logger.info('Cleared inactive temp download artifacts', result);
      res.json({ ok: true, ...result });
    } catch (err) {
      logger.error('Failed to clear temp download artifacts', { error: err && err.message });
      res.status(500).json({ error: 'Failed to clear temp download artifacts' });
    }
  });

  const jobs = new Map();

  function safeFilename(name) {
    return (name || 'video.ts').replace(/[^a-z0-9._-]+/gi, '_');
  }

  function createJobId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function getJobTempDirForUrl(m3u8Url, jobId = '') {
    const safeJobId = safeFilename(String(jobId || '')).slice(0, 48);
    const suffix = safeJobId ? `-${safeJobId}` : '';
    try {
      const u = new URL(m3u8Url);
      const base = `${u.hostname}${u.pathname}`;
      const slug = base
        .replace(/[^a-z0-9._-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || 'playlist';
      return path.join(resolvedDownloadDir, `temp-${slug}${suffix}`);
    } catch {
      const slug = safeFilename(String(m3u8Url)).replace(/\.[a-z0-9]{2,4}$/i, '');
      return path.join(resolvedDownloadDir, `temp-${slug}${suffix}`);
    }
  }

  const { runJob: _runJob, runDirectJob: _runDirectJob } = createJobProcessor({
    downloadDir: resolvedDownloadDir,
    FFMPEG_PATH,
    FFPROBE_PATH,
    DEFAULT_MAX_CONCURRENT: engineConfig.defaultMaxConcurrent,
    DEFAULT_MAX_SEGMENT_ATTEMPTS: engineConfig.defaultMaxSegmentAttempts,
    fsPromises,
    getJobTempDirForUrl,
  });

  // Wrap job runners to apply current downloadThreads setting at start time
  const applyThreadSetting = (job) => {
    if (appConfig.downloadThreads > 0) {
      job.maxConcurrent = Math.min(16, Math.max(1, appConfig.downloadThreads));
    }
  };
  const runJob = (job) => { applyThreadSetting(job); return _runJob(job); };
  const runDirectJob = (job) => { applyThreadSetting(job); return _runDirectJob(job); };

  const legacyQueueFile = path.join(resolvedDownloadDir, 'queue.json');
  const privateQueueFile = path.join(dataDir, 'queue.json');
  if (legacyQueueFile !== privateQueueFile && fs.existsSync(legacyQueueFile)) {
    if (!fs.existsSync(privateQueueFile)) fs.copyFileSync(legacyQueueFile, privateQueueFile);
    fs.chmodSync(privateQueueFile, 0o600);
    fs.unlinkSync(legacyQueueFile);
  }

  const queueManager = new QueueManager({
    queueFilePath: path.join(dataDir, 'queue.json'),
    downloadDir: resolvedDownloadDir,
    fsPromises,
    jobs,
    runJob,
    runDirectJob,
    initialSettings: initialQueueSettings,
    getCompletedOutputDir,
  });

  async function clearInactiveTempDownloadArtifacts() {
    const activeJobIds = new Set(
      (queueManager.getQueue() || [])
        .filter(Boolean)
        .filter((job) => {
          const status = String(job.queueStatus || job.status || '').trim();
          return status === 'queued'
            || status === 'paused'
            || status === 'downloading'
            || status === 'fetching-playlist';
        })
        .map((job) => String(job.id || '').trim())
        .filter(Boolean),
    );

    let tempDirectoriesRemoved = 0;
    let transientFilesRemoved = 0;
    let emptiedJobDirectoriesRemoved = 0;

    const entries = await fsPromises.readdir(resolvedDownloadDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(resolvedDownloadDir, entry.name);

      if (entry.isDirectory() && entry.name.startsWith('temp-')) {
        const linkedJobId = queueManager.extractJobIdFromTempDirName(entry.name);
        const shouldKeep = linkedJobId
          ? activeJobIds.has(linkedJobId)
          : activeJobIds.size > 0;
        if (shouldKeep) continue;

        await fsPromises.rm(fullPath, { recursive: true, force: true });
        tempDirectoriesRemoved += 1;
        continue;
      }

      if (entry.isDirectory() && isJobStorageDirectoryName(entry.name) && !activeJobIds.has(entry.name)) {
        const nestedEntries = await fsPromises.readdir(fullPath, { withFileTypes: true });
        for (const nestedEntry of nestedEntries) {
          if (!nestedEntry.isFile()) continue;
          const nestedName = nestedEntry.name;
          if (
            nestedName.endsWith('.part')
            || nestedName.endsWith('.tmp')
            || /^ts-parts-.*[.]txt$/i.test(nestedName)
          ) {
            await fsPromises.rm(path.join(fullPath, nestedName), { force: true });
            transientFilesRemoved += 1;
          }
        }

        const remaining = await fsPromises.readdir(fullPath);
        if (remaining.length === 0) {
          await fsPromises.rmdir(fullPath);
          emptiedJobDirectoriesRemoved += 1;
        }
        continue;
      }

      if (
        entry.isFile()
        && (entry.name.endsWith('.part') || entry.name.endsWith('.tmp') || /^ts-parts-.*[.]txt$/i.test(entry.name))
      ) {
        await fsPromises.rm(fullPath, { force: true });
        transientFilesRemoved += 1;
      }
    }

    return {
      tempDirectoriesRemoved,
      transientFilesRemoved,
      emptiedJobDirectoriesRemoved,
    };
  }

  let notifyHistoryChange = () => {};
  const historyIndex = new HistoryIndexService({
    downloadDir: resolvedDownloadDir,
    indexDir: dataDir,
    fsPromises,
    jobs,
    onChange: (payload) => notifyHistoryChange(payload),
  });

  const previewTasks = new Map();
  const previewAbort = new AbortController();
  const audioSampler = createAudioSampler({ ffmpegPath: FFMPEG_PATH, logger });
  let previewWork = Promise.resolve();
  const keepYouTubeArtwork = (item) => Boolean(item
    && (isYouTubeUrl(item.url || item.sourcePageUrl) || item.youtubeMetadata?.videoId)
    && (item.youtubeMetadata?.thumbnailUrl || item.thumbnailUrls?.length || item.thumbnailUrl));

  async function publishPreview(entry) {
    let queueChanged = false;
    let historyChanged = false;
    for (const jobId of entry.jobIds) {
      const job = jobs.get(jobId);
      if (!job || (job.previewClipPath === entry.outputPath && (keepYouTubeArtwork(job) || job.thumbnailPath === entry.posterPath))) continue;
      job.previewClipPath = entry.outputPath;
      job.previewClipDurationSeconds = entry.durationSeconds;
      if (entry.posterPath && !keepYouTubeArtwork(job)) {
        job.thumbnailPath = entry.posterPath;
        job.thumbnailPaths = [entry.posterPath];
      }
      job.updatedAt = Date.now();
      queueChanged = true;
      broadcastJobUpdate(job);
    }
    for (const item of historyIndex.items) {
      if (!entry.historyIds.has(item.id) && !entry.jobIds.has(item.jobId) && !entry.sourcePaths.has(path.resolve(item.absolutePath || ''))) continue;
      const preserveArtwork = keepYouTubeArtwork(jobs.get(item.jobId)) || keepYouTubeArtwork(item);
      const posterUrl = entry.posterPath ? buildDownloadAssetUrl(resolvedDownloadDir, entry.posterPath) : null;
      if (item.previewClipPath === entry.outputPath && (preserveArtwork || item.thumbnailUrl === posterUrl)) continue;
      item.previewClipPath = entry.outputPath;
      item.previewClipUrl = entry.url;
      item.previewClipDurationSeconds = entry.durationSeconds;
      if (posterUrl && !preserveArtwork) item.thumbnailUrl = posterUrl;
      historyChanged = true;
    }
    if (queueChanged) {
      await queueManager.saveQueue();
      broadcastQueueUpdate();
    }
    if (historyChanged) {
      await historyIndex.persistIndex();
      historyIndex.emitChange('preview');
    }
  }

  async function requestPreview({ job, historyItem } = {}) {
    if (previewAbort.signal.aborted || !FFMPEG_PATH || !FFPROBE_PATH) return { status: 'unavailable' };
    if (job && !['completed', 'completed-with-errors'].includes(job.queueStatus || job.status)) {
      const earlyUrl = queueManager.buildPreviewClipUrl(job);
      if (earlyUrl) return { status: 'ready', previewClipUrl: earlyUrl, previewClipDurationSeconds: job.previewClipDurationSeconds || null };
      return { status: ['downloading', 'finalizing'].includes(job.status) ? 'pending' : 'unavailable' };
    }
    const inputPath = historyItem ? historyIndex.resolveFilePath(historyItem.id)
      : job && (job.mp4Path && fs.existsSync(job.mp4Path) ? job.mp4Path : job.filePath);
    if (!inputPath || !path.isAbsolute(inputPath)) return { status: 'unavailable' };
    let sourcePath;
    let stat;
    try { sourcePath = await fsPromises.realpath(inputPath); stat = await fsPromises.stat(sourcePath); } catch { return { status: 'unavailable' }; }
    if (!stat.isFile() || !stat.size) return { status: 'unavailable' };
    const key = createHash('sha256').update(`${sourcePath}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 32);
    let entry = previewTasks.get(key);
    if (!entry) {
      const outputPath = path.join(resolvedDownloadDir, '__previews', `${key}${PREVIEW_CLIP_SUFFIX}`);
      const posterPath = path.join(resolvedDownloadDir, '__previews', `${key}.poster-v2.jpg`);
      entry = {
        outputPath, posterPath, url: `/downloads/__previews/${key}${PREVIEW_CLIP_SUFFIX}`,
        sourcePaths: new Set([path.resolve(inputPath), sourcePath]), jobIds: new Set(), historyIds: new Set(),
        durationSeconds: (job || historyItem).previewClipDurationSeconds || null,
        status: fs.existsSync(outputPath) && fs.existsSync(posterPath) ? 'ready' : 'pending',
      };
      previewTasks.set(key, entry);
      if (entry.status === 'pending') {
        // One bounded encoder at a time, independent of download workers.
        previewWork = previewWork.then(async () => {
          if (previewAbort.signal.aborted) { entry.status = 'unavailable'; return; }
          try {
            const { clip } = await generatePreviewAssets(sourcePath, outputPath, posterPath, { FFMPEG_PATH, FFPROBE_PATH, signal: previewAbort.signal });
            entry.durationSeconds = clip.durationSeconds;
            entry.status = 'ready';
            await publishPreview(entry);
          } catch {
            entry.status = 'unavailable';
          }
        });
      }
    }
    if (job) entry.jobIds.add(job.id);
    if (historyItem) {
      entry.historyIds.add(historyItem.id);
      if (jobs.has(historyItem.jobId)) entry.jobIds.add(historyItem.jobId);
    }
    entry.sourcePaths.add(path.resolve(inputPath));
    if (entry.status === 'ready') {
      await publishPreview(entry);
      return { status: 'ready', previewClipUrl: entry.url, previewClipDurationSeconds: entry.durationSeconds };
    }
    return { status: entry.status };
  }

  app.post(['/api/jobs/:id/preview', '/v1/jobs/:id/preview'], validateV1ClientHeaders, async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Download not found' });
    return res.json(await requestPreview({ job }));
  });

  app.post('/api/history/:id/preview', async (req, res) => {
    const historyItem = historyIndex.findById(req.params.id);
    if (!historyItem) return res.status(404).json({ error: 'Saved item not found' });
    return res.json(await requestPreview({ historyItem }));
  });

  function isKnownManagedAssetPath(candidatePath) {
    if (typeof candidatePath !== 'string' || !candidatePath.trim()) return false;
    const resolvedCandidate = path.resolve(candidatePath);

    if (historyIndex.items.some((item) => item.absolutePath === resolvedCandidate || (item.thumbnailUrl && decodeExternalDownloadPath(item.thumbnailUrl.slice(EXTERNAL_DOWNLOAD_PREFIX.length)) === resolvedCandidate))) return true;

    for (const job of jobs.values()) {
      if (!job) continue;
      const candidates = [
        job.filePath,
        job.mp4Path,
        job.outputPath,
        job.thumbnailPath,
        job.subtitlePath,
        job.subtitleZipPath,
      ];
      if (Array.isArray(job.thumbnailPaths)) {
        candidates.push(...job.thumbnailPaths);
      }
      if (candidates.some((value) => typeof value === 'string' && path.resolve(value) === resolvedCandidate)) {
        return true;
      }
    }

    return false;
  }

  app.get(`${EXTERNAL_DOWNLOAD_PREFIX}:encodedPath`, (req, res, next) => {
    const resolvedAssetPath = decodeExternalDownloadPath(req.params.encodedPath);
    if (!resolvedAssetPath || !mediaAssetExtensions.has(path.extname(resolvedAssetPath).toLowerCase()) || !isKnownManagedAssetPath(resolvedAssetPath)) {
      next();
      return;
    }
    if (!fs.existsSync(resolvedAssetPath)) {
      next();
      return;
    }
    res.sendFile(resolvedAssetPath, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  });

  function mergeThumbnailUrls(job) {
    const localThumbs = Array.isArray(job.thumbnailPaths)
      ? job.thumbnailPaths
        .filter((p) => fs.existsSync(p))
        .map((p) => buildDownloadAssetUrl(resolvedDownloadDir, p))
        .filter(Boolean)
      : (job.thumbnailPath && fs.existsSync(job.thumbnailPath)
        ? [buildDownloadAssetUrl(resolvedDownloadDir, job.thumbnailPath)].filter(Boolean)
        : []);

    const videoId = youtubeVideoIdOf(job);
    const remoteThumbs = Array.isArray(job.thumbnailUrls)
      ? job.thumbnailUrls.filter((u) => typeof u === 'string' && (u.startsWith('http') || /^data:image\/(?:jpeg|png|webp);base64,/.test(u)))
        .map((u) => youtubeArtwork(u, videoId)).filter(Boolean)
      : [];

    return [...new Set([...localThumbs, ...remoteThumbs])];
  }

  function buildJobStatusPayload(job) {
    if (!job) return null;

    return {
      id: job.id,
      status: job.status,
      title: job.title,
      progress: job.progress,
      totalSegments: job.totalSegments,
      completedSegments: job.completedSegments,
      downloadMode: job.downloadMode || null,
      segmentProgressAvailable: typeof job.segmentProgressAvailable === 'boolean' ? job.segmentProgressAvailable : null,
      bytesDownloaded: job.bytesDownloaded,
      totalBytes: Number(job.totalBytes || 0) || 0,
      totalBytesKnown: job.totalBytesKnown === true,
      speedBps: Number(job.speedBps || 0) || 0,
      activeConnections: job.connectionCountAvailable ? Number(job.activeConnections || 0) : null,
      maxConnections: Number(job.maxConnections || job.maxConcurrent || 0) || null,
      connectionCountAvailable: job.connectionCountAvailable === true,
      etaSeconds: Number.isFinite(job.etaSeconds) ? Number(job.etaSeconds) : null,
      failedSegments: Array.isArray(job.failedSegments) ? job.failedSegments.length : 0,
      threadStates: Array.isArray(job.threadStates) ? job.threadStates : [],
      segmentStates: job.segmentStates || {},
      error: redactPaths(job.error),
      fallbackUrl: job.fallbackUrl || null,
      originalHlsUrl: job.originalHlsUrl || null,
      fallbackAttempted: !!job.fallbackAttempted,
      fallbackUsed: !!job.fallbackUsed,
      thumbnailUrls: mergeThumbnailUrls(job),
      previewClipUrl: queueManager.buildPreviewClipUrl(job),
      previewClipDurationSeconds: job.previewClipDurationSeconds || null,
      updatedAt: job.updatedAt,
      tmdbId: job.tmdbId || null,
      tmdbTitle: job.tmdbTitle || null,
      tmdbReleaseDate: job.tmdbReleaseDate || null,
      tmdbMetadata: job.tmdbMetadata || null,
      youtubeMetadata: job.youtubeMetadata || null,
      mediaHints: job.mediaHints || null,
      errorCode: job.errorCode || null,
      mediaType: job.mediaType || null,
      selection: job.selection || null,
      sourcePageUrl: job.sourcePageUrl || null,
    };
  }

  function buildLegacyJobFromQueue(queue, threads, settings) {
    const id = createJobId();

    let baseName = 'video';
    const customName = settings && typeof settings.customName === 'string'
      ? settings.customName.trim()
      : '';
    const namingMode = settings && typeof settings.fileNaming === 'string'
      ? settings.fileNaming
      : 'title';

    if (customName && namingMode === 'custom') {
      baseName = customName;
    } else if (namingMode === 'resource') {
      baseName = queue.name || queue.title || 'video';
    } else {
      baseName = queue.title || queue.name || 'video';
    }
    // queue.manualTitleOverride is supplied by internal retry reconstruction;
    // public v1 creation builds its own queue object above this boundary.
    const manualTitleOverride = queue.manualTitleOverride === true || (namingMode === 'custom' && Boolean(customName));

    const fileNameBase = safeFilename(baseName);
    const isHls = queue.mediaType === 'hls' || /\.m3u8(\?|$)/i.test(queue.url || '');
    const requestedFallbackUrl = sanitizeString(
      (settings && settings.fallbackMediaUrl) || queue.fallbackUrl || '',
      4096,
    );
    const fallbackMediaUrl =
      requestedFallbackUrl
      && requestedFallbackUrl !== queue.url
      && isValidHttpUrl(requestedFallbackUrl)
        ? requestedFallbackUrl
        : '';
    const inferredHints = inferMediaMetadata({
      title: queue.title,
      resourceName: queue.name,
      sourcePageTitle: queue.title,
      mediaUrl: queue.url,
      sourcePageUrl: queue.sourcePageUrl,
    });
    const mediaHints = {
      ...inferredHints,
      ...(queue.titleHints && typeof queue.titleHints === 'object' ? queue.titleHints : {}),
      lookupTitle: (
        (queue.titleHints && queue.titleHints.lookupTitle)
        || inferredHints.lookupTitle
        || ''
      ).trim(),
      seasonNumber: Number.isFinite(queue.titleHints && queue.titleHints.seasonNumber)
        ? queue.titleHints.seasonNumber
        : inferredHints.seasonNumber,
      episodeNumber: Number.isFinite(queue.titleHints && queue.titleHints.episodeNumber)
        ? queue.titleHints.episodeNumber
        : inferredHints.episodeNumber,
      isTvCandidate: Boolean(
        (queue.titleHints && queue.titleHints.isTvCandidate)
        || inferredHints.isTvCandidate
        || (
          Number.isFinite(queue.titleHints && queue.titleHints.seasonNumber)
          && Number.isFinite(queue.titleHints && queue.titleHints.episodeNumber)
        )
      ),
    };
    if (manualTitleOverride || namingMode === 'resource') mediaHints.lookupTitle = baseName;
    const queueYoutubeMetadata = queue.youtubeMetadata && typeof queue.youtubeMetadata === 'object'
      ? queue.youtubeMetadata
      : null;
    const initialThumbnailUrls = [];
    const pushThumbnailUrl = (value) => {
      const candidate = sanitizeString(value, 350000);
      if (!candidate || (!isValidHttpUrl(candidate) && !isValidThumbnailDataUrl(candidate))) return;
      if (initialThumbnailUrls.includes(candidate)) return;
      initialThumbnailUrls.push(candidate);
    };

    const queueVideoId = youtubeVideoIdOf({ ...queue, youtubeMetadata: queueYoutubeMetadata });
    pushThumbnailUrl(youtubeArtwork(queue.thumbnailUrl, queueVideoId));
    pushThumbnailUrl(youtubeArtwork(queueYoutubeMetadata && queueYoutubeMetadata.thumbnailUrl, queueVideoId));

    if (initialThumbnailUrls.length === 0 && isYouTubeUrl(queue.url)) {
      const videoId = extractYouTubeVideoId(queue.url)
        || sanitizeString(queueYoutubeMetadata && queueYoutubeMetadata.videoId, 32);
      if (/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
        pushThumbnailUrl(`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`);
      }
    }

    let filePath;
    let tsName;
    let downloadNameMp4;
    let directFallbackFilePath = null;
    let directFallbackDownloadName = null;
    let directFallbackDownloadNameMp4 = null;
    const storageDir = buildJobStorageDir(resolvedDownloadDir, id, baseName);

    if (isHls) {
      tsName = withMediaExtension(fileNameBase, '.ts');

      filePath = path.join(storageDir, `${id}-${tsName}`);

      downloadNameMp4 = withMediaExtension(fileNameBase, '.mp4');

      if (fallbackMediaUrl) {
        let ext = '';
        try {
          const fallbackParsed = new URL(fallbackMediaUrl);
          ext = path.extname(fallbackParsed.pathname) || '';
        } catch {
          ext = '';
        }

        // Only media containers keep the source extension; the file is later
        // handed to the OS by Open, so an unknown type must not stay executable.
        ext = normalizeMediaExtension(ext);

        directFallbackDownloadName = `${fileNameBase}${ext}`;
        directFallbackDownloadNameMp4 = directFallbackDownloadName;
        directFallbackFilePath = path.join(storageDir, `${id}-${directFallbackDownloadName}`);
      }
    } else {
      let ext = '';
      try {
        const u = new URL(queue.url);
        ext = path.extname(u.pathname) || '';
      } catch {
        ext = '';
      }

      // Only media containers keep the source extension; the file is later
      // handed to the OS by Open, so an unknown type must not stay executable.
      ext = normalizeMediaExtension(ext);

      const directName = `${fileNameBase}${ext}`;
      filePath = path.join(storageDir, `${id}-${directName}`);
      tsName = directName;
      downloadNameMp4 = directName;
    }

    const job = {
      id,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: baseName || queue.title || queue.name || 'Download',
      fileNaming: namingMode,
      manualTitleOverride,
      url: queue.url,
      headers: sanitizeHeaders(queue.headers),
      headerOrigin: queue.headerOrigin || new URL(queue.url).origin,
      selection: queue.selection || undefined,
      // A playlist captured from a POST/blob response. Memory only: it can
      // hold signed piece URLs, so it is never persisted with the queue.
      ...(validManifestText(queue.manifestText) ? { manifestText: queue.manifestText } : {}),
      mediaType: queue.mediaType || (isHls ? 'hls' : 'file'),
      sourcePageUrl: queue.sourcePageUrl || '',
      totalSegments: 0,
      completedSegments: 0,
      bytesDownloaded: 0,
      progress: 0,
      error: null,
      storageDir,
      filePath,
      downloadName: tsName,
      mp4Path: null,
      thumbnailPath: null,
      thumbnailPaths: null,
      thumbnailUrls: initialThumbnailUrls,
      skipThumbnailGeneration: false,
      mediaHints,
      youtubeMetadata: queueYoutubeMetadata,
      downloadNameMp4,
      forcePlaybackCompatibility: isHls,
      fallbackUrl: fallbackMediaUrl || null,
      originalHlsUrl: isHls ? queue.url : null,
      originalHlsDownloadName: isHls ? tsName : null,
      originalHlsDownloadNameMp4: isHls ? downloadNameMp4 : null,
      directFallbackFilePath,
      directFallbackDownloadName,
      directFallbackDownloadNameMp4,
      fallbackAttempted: false,
      fallbackUsed: false,
      cancelled: false,
      maxConcurrent: Number.isFinite(threads) && threads > 0
        ? Math.min(16, threads)
        : engineConfig.defaultMaxConcurrent,
      maxSegmentAttempts: (() => {
        const raw = settings && typeof settings.maxSegmentAttempts === 'string'
          ? settings.maxSegmentAttempts
          : null;
        if (raw === 'infinite') {
          return Infinity;
        }
        const n = raw != null ? parseInt(raw, 10) : engineConfig.defaultMaxSegmentAttempts;
        if (!Number.isFinite(n) || n <= 0) {
          return engineConfig.defaultMaxSegmentAttempts;
        }
        return n;
      })(),
      lastSentSegmentStates: {},
    };

    return { job, isHls };
  }

  const tmdbCacheFilePath = path.join(dataDir, 'tmdb-cache.json');
  const tmdbCache = new Map();
  let tmdbCacheLoaded = false;
  let tmdbCacheLoadPromise = null;

  function buildTmdbCacheKey(title, type) {
    const normalizedTitle = String(title || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    const normalizedType = type === 'tv' ? 'tv' : 'movie';
    return `${normalizedType}:${normalizedTitle}`;
  }

  function sanitizeTmdbResult(result) {
    if (!result || typeof result !== 'object') return null;
    return {
      id: result.id || null,
      title: result.title || null,
      releaseDate: result.releaseDate || null,
      posterUrl: result.posterUrl || null,
      backdropUrl: result.backdropUrl || null,
      overview: result.overview || null,
      runtime: Number.isFinite(result.runtime) ? result.runtime : null,
      tagline: result.tagline || null,
      genres: Array.isArray(result.genres) ? result.genres.filter(Boolean).slice(0, 6) : [],
      imageUrls: Array.isArray(result.imageUrls)
        ? result.imageUrls.filter((url) => typeof url === 'string' && isValidHttpUrl(url)).slice(0, 6)
        : [],
      mediaType: result.mediaType === 'tv' ? 'tv' : 'movie',
    };
  }

  async function loadTmdbCache() {
    if (tmdbCacheLoaded) return;
    if (tmdbCacheLoadPromise) {
      await tmdbCacheLoadPromise;
      return;
    }

    tmdbCacheLoadPromise = (async () => {
      try {
        const raw = await fsPromises.readFile(tmdbCacheFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        const entries = parsed && typeof parsed.entries === 'object' ? parsed.entries : {};
        const now = Date.now();
        Object.entries(entries).forEach(([cacheKey, entry]) => {
          if (!cacheKey || !entry || typeof entry !== 'object') return;
          const cachedAt = Number(entry.cachedAt || 0);
          if (!Number.isFinite(cachedAt) || now - cachedAt > TMDB_CACHE_TTL_MS) return;
          const sanitized = sanitizeTmdbResult(entry.result);
          if (!sanitized) return;
          tmdbCache.set(cacheKey, { cachedAt, result: sanitized });
        });
      } catch (err) {
        if (err && err.code !== 'ENOENT') {
          logger.warn('Failed to load TMDB cache file', { error: err.message });
        }
      } finally {
        tmdbCacheLoaded = true;
      }
    })();

    await tmdbCacheLoadPromise;
  }

  async function persistTmdbCache() {
    try {
      await fsPromises.mkdir(path.dirname(tmdbCacheFilePath), { recursive: true });
      const payload = {
        version: TMDB_CACHE_VERSION,
        updatedAt: Date.now(),
        entries: Object.fromEntries(tmdbCache.entries()),
      };
      const tempPath = `${tmdbCacheFilePath}.tmp`;
      await fsPromises.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
      await fsPromises.rename(tempPath, tmdbCacheFilePath);
    } catch (err) {
      logger.warn('Failed to persist TMDB cache file', { error: err.message });
    }
  }

  async function getCachedTmdbResult(cacheKey) {
    await loadTmdbCache();
    const entry = tmdbCache.get(cacheKey);
    if (!entry) return null;

    if (Date.now() - Number(entry.cachedAt || 0) > TMDB_CACHE_TTL_MS) {
      tmdbCache.delete(cacheKey);
      persistTmdbCache();
      return null;
    }

    return sanitizeTmdbResult(entry.result);
  }

  async function cacheTmdbResult(cacheKey, result) {
    const sanitized = sanitizeTmdbResult(result);
    if (!sanitized) return;
    await loadTmdbCache();
    tmdbCache.set(cacheKey, {
      cachedAt: Date.now(),
      result: sanitized,
    });
    while (tmdbCache.size > TMDB_CACHE_MAX_ENTRIES) {
      const oldestKey = tmdbCache.keys().next().value;
      if (!oldestKey) break;
      tmdbCache.delete(oldestKey);
    }
    await persistTmdbCache();
  }

  async function ensureLocalTmdbThumbnail(job) {
    const remoteThumb = Array.isArray(job.thumbnailUrls)
      ? job.thumbnailUrls.find((url) => isValidHttpUrl(url))
      : null;
    if (!remoteThumb) return false;

    const storageDir = job.storageDir || (job.filePath ? path.dirname(job.filePath) : resolvedDownloadDir);
    const thumbPath = path.join(storageDir, `${job.id}-thumb.jpg`);
    try {
      await fsPromises.mkdir(storageDir, { recursive: true });
      if (fs.existsSync(thumbPath)) {
        job.thumbnailPath = thumbPath;
        return true;
      }
      const downloaded = await downloadRemoteImage(remoteThumb, thumbPath);
      if (!downloaded) {
        return false;
      }
      job.thumbnailPath = thumbPath;
      return true;
    } catch (err) {
      logger.warn('Failed to persist TMDB thumbnail locally', {
        jobId: job.id,
        thumbPath,
        error: err.message,
      });
      return false;
    }
  }

  function applyTmdbResultToJob(job, result, fallbackType) {
    const mediaType = result && result.mediaType === 'tv'
      ? 'tv'
      : (fallbackType === 'tv' ? 'tv' : 'movie');
    job.thumbnailUrls = Array.isArray(result && result.imageUrls)
      ? result.imageUrls.filter(Boolean)
      : [result && result.posterUrl, result && result.backdropUrl].filter(Boolean);
    job.tmdbId = (result && result.id) || null;
    job.tmdbTitle = (result && result.title) || null;
    job.tmdbReleaseDate = (result && result.releaseDate) || null;
    job.tmdbMetadata = {
      overview: (result && result.overview) || null,
      runtime: (result && result.runtime) || null,
      tagline: (result && result.tagline) || null,
      genres: Array.isArray(result && result.genres) ? result.genres : [],
      mediaType,
    };
    job.skipThumbnailGeneration = true;
  }

  async function enrichTmdb(job) {
    if (!appConfig.tmdbApiKey) return;
    if (isYouTubeUrl(job && job.url)) return;

    try {
      const hints = job.mediaHints || inferMediaMetadata({
        title: job.title,
        resourceName: job.downloadName,
        mediaUrl: job.url,
        sourcePageUrl: job.sourcePageUrl,
      });
      const lookupTitle = hints.lookupTitle || job.title || job.downloadName;
      const type = hints.isTvCandidate ? 'tv' : 'movie';
      const cacheKey = buildTmdbCacheKey(lookupTitle, type);
      let result = await getCachedTmdbResult(cacheKey);
      const usedCache = !!result;

      if (!result) {
        logger.info('TMDB lookup start', {
          jobId: job.id,
          title: lookupTitle,
          type,
          seasonNumber: hints.seasonNumber,
          episodeNumber: hints.episodeNumber,
          matchedPattern: hints.matchedPattern,
          matchedField: hints.matchedField,
        });
        result = await lookupPoster({
          apiKey: appConfig.tmdbApiKey,
          title: lookupTitle,
          type,
        });
        if (result) {
          await cacheTmdbResult(cacheKey, result);
        }
      }

      if (result) {
        applyTmdbResultToJob(job, result, type);
        const localThumbSaved = await ensureLocalTmdbThumbnail(job);
        queueManager.saveQueue();
        logger.info('TMDB metadata applied', {
          jobId: job.id,
          tmdbId: result.id,
          mediaType: (result.mediaType || type),
          thumbnails: Array.isArray(job.thumbnailUrls) ? job.thumbnailUrls.length : 0,
          localThumbSaved,
          cacheHit: usedCache,
        });
      } else {
        logger.info('TMDB lookup returned no results', { jobId: job.id, title: lookupTitle, type });
      }
    } catch (err) {
      logger.warn('TMDB lookup failed', { jobId: job.id, error: err.message });
    }
  }

  function enqueueLegacyRequest({ queue, threads, settings }) {
    const { job } = buildLegacyJobFromQueue(queue, threads, settings);
    const result = queueManager.addJob(job);
    enrichTmdb(job);
    return { ...result, job };
  }

  function findDuplicateQueuedJob(url) {
    if (!isValidHttpUrl(url)) return null;
    const normalizedUrl = String(url).trim();
    for (const job of jobs.values()) {
      if (!job) continue;
      if (String(job.url || '').trim() !== normalizedUrl) continue;
      if (job.queueStatus === 'queued' || job.queueStatus === 'downloading' || job.queueStatus === 'paused') {
        return job;
      }
    }
    return null;
  }

  function parseVersionParts(input) {
    return String(input || '')
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) && part >= 0 ? part : 0));
  }

  function compareVersions(a, b) {
    const ap = parseVersionParts(a);
    const bp = parseVersionParts(b);
    const len = Math.max(ap.length, bp.length);
    for (let i = 0; i < len; i += 1) {
      const av = ap[i] || 0;
      const bv = bp[i] || 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  function normalizeProtocolVersion(version) {
    const parsed = Number.parseInt(String(version || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.parseInt(API.protocolVersion, 10);
  }

  function getCompatibilityInfo() {
    const minProtocol = normalizeProtocolVersion(API.minProtocolVersion || API.protocolVersion);
    const maxProtocol = normalizeProtocolVersion(API.maxProtocolVersion || API.protocolVersion);
    const currentProtocol = normalizeProtocolVersion(API.protocolVersion);

    return {
      protocolVersion: currentProtocol,
      supportedProtocolVersions: {
        min: Math.min(minProtocol, maxProtocol),
        max: Math.max(minProtocol, maxProtocol),
      },
      minExtensionVersion: API.minExtensionVersion || '1.0.0',
    };
  }

  function validateV1ClientHeaders(req, res, next) {
    const client = String(req.headers[HEADER.client.toLowerCase()] || '').trim();
    const protocolVersion = String(req.headers[HEADER.protocolVersion.toLowerCase()] || '').trim();
    const compatibility = getCompatibilityInfo();
    const allowedClients = new Set([
      CLIENT.extension,
      'snagthis-desktop',
      'snagthis-extension',
    ]);

    if (client && !allowedClients.has(client)) {
      res.status(400).json({ error: `Invalid ${HEADER.client} header` });
      return;
    }

    if (protocolVersion) {
      const parsed = Number.parseInt(protocolVersion, 10);
      if (!Number.isFinite(parsed)) {
        res.status(400).json({ error: `Invalid ${HEADER.protocolVersion} header` });
        return;
      }
      if (
        parsed < compatibility.supportedProtocolVersions.min
        || parsed > compatibility.supportedProtocolVersions.max
      ) {
        res.status(426).json({
          error: `Unsupported ${HEADER.protocolVersion} header`,
          compatibility,
        });
        return;
      }
    }

    const extensionVersion = sanitizeString(req.headers['x-extension-version'], 64);
    if (
      extensionVersion
      && compareVersions(extensionVersion, compatibility.minExtensionVersion) < 0
    ) {
      res.status(426).json({
        error: 'Extension version too old',
        compatibility,
      });
      return;
    }

    next();
  }

  const isValidHttpUrl = isHttpUrl;

  function sanitizeString(value, max = 255) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
  }

  function isValidThumbnailDataUrl(value) {
    return typeof value === 'string' && value.length <= 350000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function sanitizeHeaders(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      return {};
    }

    const output = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        continue;
      }
      const normalizedKey = key.trim();
      if (!/^(?:accept|accept-language|authorization|cookie|origin|referer|user-agent|range|x-[a-z0-9-]+)$/i.test(normalizedKey) || /[\r\n]/.test(value) || normalizedKey.length > 128) {
        continue;
      }
      output[normalizedKey] = value.slice(0, 4096);
    }
    return output;
  }

  function sanitizeTitleHints(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const lookupTitle = sanitizeString(value.lookupTitle, 255);
    const seasonNumberRaw = Number(value.seasonNumber);
    const episodeNumberRaw = Number(value.episodeNumber);
    const seasonNumber = Number.isFinite(seasonNumberRaw) && seasonNumberRaw > 0
      ? Math.min(60, Math.floor(seasonNumberRaw))
      : null;
    const episodeNumber = Number.isFinite(episodeNumberRaw) && episodeNumberRaw > 0
      ? Math.min(999, Math.floor(episodeNumberRaw))
      : null;
    const isTvCandidate = Boolean(value.isTvCandidate || (seasonNumber && episodeNumber));

    if (!lookupTitle && !seasonNumber && !episodeNumber && !isTvCandidate) {
      return null;
    }

    return {
      lookupTitle,
      seasonNumber,
      episodeNumber,
      isTvCandidate,
      matchedPattern: sanitizeString(value.matchedPattern, 64),
      matchedField: sanitizeString(value.matchedField, 64),
    };
  }

  function sanitizeYoutubeMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const videoIdRaw = sanitizeString(value.videoId, 32);
    const videoId = /^[A-Za-z0-9_-]{6,20}$/.test(videoIdRaw) ? videoIdRaw : '';
    const thumbnailUrlRaw = sanitizeString(value.thumbnailUrl, 4096);
    const thumbnailUrl = isValidHttpUrl(thumbnailUrlRaw) ? thumbnailUrlRaw : '';

    const output = {
      videoId,
      title: sanitizeString(value.title, 255),
      channelName: sanitizeString(value.channelName, 180),
      channelUrl: sanitizeString(value.channelUrl, 4096),
      channelId: sanitizeString(value.channelId, 80),
      uploadDate: sanitizeString(value.uploadDate, 80),
      thumbnailUrl,
      description: sanitizeString(value.description, 1000),
      durationSeconds: (() => {
        const n = Number(value.durationSeconds);
        return Number.isFinite(n) && n > 0 ? Math.min(24 * 60 * 60, Math.floor(n)) : null;
      })(),
      viewCount: (() => {
        const n = Number(value.viewCount);
        return Number.isFinite(n) && n > 0 ? Math.min(9_999_999_999_999, Math.floor(n)) : null;
      })(),
    };

    if (!Object.values(output).some((entry) => entry != null && entry !== '')) {
      return null;
    }

    return output;
  }

  function resolveIncomingThumbnailUrl(payload) {
    const youtubeMetadata = sanitizeYoutubeMetadata(payload && payload.youtubeMetadata);
    const videoId = extractYouTubeVideoId(String(payload && payload.mediaUrl || '').trim())
      || String(youtubeMetadata && youtubeMetadata.videoId || '').trim();
    const explicit = sanitizeString(payload && payload.thumbnailUrl, 350000);
    if (isValidThumbnailDataUrl(explicit)) return explicit;
    if (isValidHttpUrl(explicit) && youtubeArtwork(explicit, videoId)) return youtubeArtwork(explicit, videoId);

    const artwork = youtubeMetadata && isValidHttpUrl(youtubeMetadata.thumbnailUrl) ? youtubeArtwork(youtubeMetadata.thumbnailUrl, videoId) : '';
    if (artwork) return artwork;
    if (videoId) {
      return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
    }

    return '';
  }

  function validManifestText(value) {
    return typeof value === 'string' && value.length <= 4 * 1024 * 1024 && /^\uFEFF?\s*#EXTM3U(?:\s|$)/.test(value);
  }

  function validateCreateJobRequest(body) {
    const payload = body && typeof body === 'object' ? body : {};
    const selectionResult = validateSelection(payload.selection);
    if (!selectionResult.ok) {
      const err = new Error(selectionResult.errors.map((entry) => entry.message).join('; '));
      err.statusCode = 400;
      throw err;
    }
    const mediaUrl = sanitizeString(payload.mediaUrl, 4096);
    const mediaType = sanitizeString(payload.mediaType, 16).toLowerCase();
    const fallbackMediaUrl = sanitizeString(payload.fallbackMediaUrl, 4096);
    const titleHints = sanitizeTitleHints(payload.titleHints);
    const youtubeMetadata = sanitizeYoutubeMetadata(payload.youtubeMetadata);
    const thumbnailUrl = resolveIncomingThumbnailUrl({ ...payload, mediaUrl, youtubeMetadata });

    if (payload.thumbnailUrl && !isValidHttpUrl(payload.thumbnailUrl) && !isValidThumbnailDataUrl(payload.thumbnailUrl)) {
      const err = new Error('thumbnailUrl must be an http/https image URL or a JPEG, PNG or WebP data URL under 350 KB');
      err.statusCode = 400;
      throw err;
    }

    if (!isValidHttpUrl(mediaUrl)) {
      const err = new Error('mediaUrl must be a valid http/https URL');
      err.statusCode = 400;
      throw err;
    }

    if (mediaType && mediaType !== 'hls' && mediaType !== 'file') {
      const err = new Error('mediaType must be one of: hls, file');
      err.statusCode = 400;
      throw err;
    }

    if (fallbackMediaUrl && !isValidHttpUrl(fallbackMediaUrl)) {
      const err = new Error('fallbackMediaUrl must be a valid http/https URL');
      err.statusCode = 400;
      throw err;
    }

    if (payload.manifestText !== undefined && !validManifestText(payload.manifestText)) {
      const err = new Error('manifestText must be an HLS playlist (#EXTM3U) of at most 4 MB');
      err.statusCode = 400;
      throw err;
    }

    if (payload.sourcePageUrl && !isValidHttpUrl(payload.sourcePageUrl)) {
      const err = new Error('sourcePageUrl must be a valid http/https URL');
      err.statusCode = 400;
      throw err;
    }

    const settingsInput = payload.settings && typeof payload.settings === 'object'
      ? payload.settings
      : {};

    const rawThreads = Number(settingsInput.threads);
    const threads = Number.isFinite(rawThreads)
      ? Math.max(1, Math.min(16, Math.floor(rawThreads)))
      : engineConfig.defaultMaxConcurrent;

    const fileNaming = ['title', 'resource', 'custom'].includes(settingsInput.fileNaming)
      ? settingsInput.fileNaming
      : 'title';

    const maxSegmentAttempts = settingsInput.maxSegmentAttempts === 'infinite'
      ? 'infinite'
      : (() => {
        const value = Number(settingsInput.maxSegmentAttempts);
        // Unbounded retries can hold the queue on a segment that will never
        // return, so clients that omit a limit get the engine's finite default.
        if (!Number.isFinite(value) || value <= 0) return String(engineConfig.defaultMaxSegmentAttempts);
        return String(Math.floor(value));
      })();

    return {
      mediaUrl,
      selection: selectionResult.value,
      mediaType: mediaType || (/\.m3u8(\?|$)/i.test(mediaUrl) ? 'hls' : 'file'),
      title: sanitizeString(payload.title, 255),
      resourceName: sanitizeString(payload.resourceName, 255),
      sourcePageUrl: sanitizeString(payload.sourcePageUrl, 4096),
      sourcePageTitle: sanitizeString(payload.sourcePageTitle, 255),
      fallbackMediaUrl,
      titleHints,
      youtubeMetadata,
      thumbnailUrl,
      headers: sanitizeHeaders(payload.headers),
      manifestText: validManifestText(payload.manifestText) ? payload.manifestText : undefined,
      settings: {
        fileNaming,
        customName: sanitizeString(settingsInput.customName, 255),
        maxSegmentAttempts,
        threads,
      },
    };
  }

  async function applyRequestDefaults(payload) {
    const preferences = typeof onGetSettings === 'function' ? await onGetSettings() : {};
    const supplied = payload && typeof payload === 'object' ? payload : {};
    let selection = supplied.selection;
    if (selection === undefined) {
      const height = Number(preferences.preferredQuality);
      const subtitleLang = preferences.subtitleLanguage;
      const defaults = {
        ...(Number.isFinite(height) && height > 0 ? { height } : {}),
        ...(subtitleLang && subtitleLang !== 'none' ? { subtitleLang } : {}),
      };
      if (Object.keys(defaults).length) selection = defaults;
    }
    return {
      ...supplied, selection,
      settings: {
        fileNaming: preferences.fileNaming || 'title',
        customName: preferences.fileNaming === 'custom' ? preferences.customFilename || '' : '',
        ...(supplied.settings || {}),
      },
    };
  }

  app.use('/v1', validateV1ClientHeaders);

  app.get('/v1/health', (req, res) => {
    const compatibility = getCompatibilityInfo();
    res.json({
      status: 'ok',
      appVersion,
      apiVersion: API.apiVersion,
      protocolVersion: String(compatibility.protocolVersion),
      supportedProtocolVersions: compatibility.supportedProtocolVersions,
      minExtensionVersion: compatibility.minExtensionVersion,
      pairingRequired: true,
      wsPath: '/ws',
      features: ['audio-track', 'audio-sample'],
    });
  });

  // Every client is 127.0.0.1, so code attempts are counted per extension
  // origin (one extension cannot lock out another), under a global ceiling
  // that still bounds guessing across many origins.
  const pairingLimiter = rateLimit({
    windowMs: 5 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `origin:${String(req.headers.origin || '')}`,
  });
  const pairingGlobalLimiter = rateLimit({
    windowMs: 5 * 60_000, max: 100, standardHeaders: true, legacyHeaders: false, keyGenerator: () => 'all',
  });
  app.post('/v1/pair/complete', pairingLimiter, pairingGlobalLimiter, (req, res) => {
    const result = security.completePairing(req);
    if (!result) return res.status(403).json({ error: 'That connection code is invalid or has expired' });
    return res.json(result);
  });

  // One-click approve. The request route counts its own 3 per 5 minutes; status
  // polling gets a separate bound. Nothing here approves anything: only the
  // desktop's Allow (Electron IPC) does.
  const pairingStatusLimiter = rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false });
  const pairingInput = (req) => ({
    origin: String(req.headers.origin || ''),
    requestId: req.body && req.body.requestId,
    secret: req.body && req.body.secret,
  });
  app.post('/v1/pair/request', (req, res) => {
    const result = security.requestPairing({
      origin: String(req.headers.origin || ''),
      secret: req.body && req.body.secret,
      extensionVersion: req.headers['x-extension-version'],
    });
    res.status(result.status).json(result.body);
  });
  app.post('/v1/pair/status', pairingStatusLimiter, (req, res) => {
    const result = security.pairingStatus(pairingInput(req));
    res.status(result.status).json(result.body);
  });
  app.post('/v1/pair/cancel', pairingStatusLimiter, (req, res) => {
    const result = security.cancelPairing(pairingInput(req));
    res.status(result.status).json(result.body);
  });
  // A paired extension forgets itself here ("Disconnect" in the popup).
  app.post('/v1/pair/disconnect', (req, res) => {
    const client = req.bridgeClient;
    if (!client || client.kind !== 'extension') return res.status(400).json({ error: 'Only a connected extension can disconnect itself' });
    const entry = client.entry;
    if (!entry || !security.revokeExtension(entry.id)) return res.status(404).json({ error: 'This extension is not connected' });
    return res.json({ ok: true });
  });
  // Extensions paired before per-extension tokens trade the shared credential for their own.
  app.post('/v1/pair/upgrade', (req, res) => {
    const issued = security.upgradeLegacy(req.bridgeClient);
    if (!issued) return res.status(409).json({ error: 'This connection is already current', code: 'TOKEN_CURRENT' });
    return res.json({ token: issued, paired: true });
  });

  app.post('/v1/jobs', async (req, res) => {
    let body;
    try {
      body = validateCreateJobRequest(await applyRequestDefaults(req.body || {}));
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message || 'Invalid job request' });
      return;
    }

    if (isYouTubeUrl(body.mediaUrl) && !YT_DLP_PATH) {
      res.status(400).json({
        error: 'YouTube URL detected, but yt-dlp is not installed. Install yt-dlp and restart the desktop app.',
      });
      return;
    }

    const queue = {
      url: body.mediaUrl,
      mediaType: body.mediaType,
      selection: body.selection,
      title: body.title || body.sourcePageTitle || body.resourceName || 'Download',
      name: body.resourceName || body.title || 'media',
      headers: body.headers || {},
      sourcePageUrl: body.sourcePageUrl || '',
      titleHints: body.titleHints || null,
      youtubeMetadata: body.youtubeMetadata || null,
      thumbnailUrl: body.thumbnailUrl || '',
      ...(body.manifestText ? { manifestText: body.manifestText } : {}),
    };

    const settings = {
      fileNaming: body.settings.fileNaming,
      customName: body.settings.customName,
      maxSegmentAttempts: body.settings.maxSegmentAttempts,
      fallbackMediaUrl: body.fallbackMediaUrl || '',
    };

    const threads = body.settings.threads;

    const duplicate = findDuplicateQueuedJob(queue.url);
    if (duplicate) {
      res.json({
        jobId: duplicate.id,
        queuePosition: duplicate.queuePosition || 0,
        status: duplicate.queueStatus || 'queued',
        acceptedAt: new Date().toISOString(),
        duplicate: true,
      });
      return;
    }

    const { id, queuePosition } = enqueueLegacyRequest({ queue, threads, settings });

    res.json({
      jobId: id,
      queuePosition,
      status: 'queued',
      acceptedAt: new Date().toISOString(),
    });
  });

  // The shared accent rides on the popup's queue poll, so a change on either side shows up within a second.
  function appearance() {
    const current = typeof onGetAppearance === 'function' ? onGetAppearance() : null;
    return current && isAccent(current.accent) ? { accent: current.accent, accentChangedAt: Number(current.accentChangedAt) || 0 } : undefined;
  }

  app.get('/v1/queue', (req, res) => {
    res.json({
      queue: queueManager.getQueue(),
      settings: queueManager.getSettings(),
      appearance: appearance(),
      ...security.getConnectionState(),
    });
  });

  app.post('/v1/app/focus', async (req, res) => {
    if (typeof onFocus === 'function') {
      try {
        await Promise.resolve(onFocus(req.body && req.body.view === 'settings' ? 'settings' : 'downloads'));
      } catch (err) {
        logger.warn('onFocus callback failed', { error: err.message });
      }
    }
    res.json({ ok: true });
  });

  app.get('/v1/connection', (req, res) => {
    res.json({ ...security.getConnectionState(), apiVersion: API.apiVersion, wsPath: '/ws' });
  });

  app.get('/v1/settings', async (req, res) => {
    const current = typeof onGetSettings === 'function' ? await onGetSettings() : {};
    const { outputDirectory = '', preferredQuality = 'best', subtitleLanguage = 'none', notifyOnComplete = true, launchAtLogin = false } = current;
    const accent = isAccent(current.accent) ? { accent: current.accent, accentChangedAt: Number(current.accentChangedAt) || 0 } : {};
    res.json({ outputDirectory, preferredQuality, subtitleLanguage, notifyOnComplete, launchAtLogin, ...accent });
  });

  app.post('/v1/settings', async (req, res) => {
    const input = req.body || {};
    const permitted = new Set(['preferredQuality', 'subtitleLanguage', 'notifyOnComplete', 'launchAtLogin', 'accent', 'accentChangedAt']);
    if (Object.keys(input).some((key) => !permitted.has(key))
      || (input.accent !== undefined && !isAccent(input.accent))
      || (input.accentChangedAt !== undefined && (input.accent === undefined || !isAccentTimestamp(input.accentChangedAt)))
      || (input.preferredQuality !== undefined && !['best', '1080', '720', '480'].includes(input.preferredQuality))
      || (input.subtitleLanguage !== undefined && (typeof input.subtitleLanguage !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(input.subtitleLanguage)))
      || ['notifyOnComplete', 'launchAtLogin'].some((key) => input[key] !== undefined && typeof input[key] !== 'boolean')) return res.status(400).json({ error: 'Invalid preference' });
    if (typeof onSaveSettings !== 'function') return res.status(501).json({ error: 'Change preferences in the desktop app' });
    await onSaveSettings(input);
    // An accent older than the desktop's own choice is ignored; the reply carries whichever won.
    res.json({ ok: true, appearance: appearance() });
  });

  // Desktop paste only. Inspection fetches the URL server-side and can load it in
  // a hidden page, so it is not part of the extension bridge (/v1), and it refuses
  // non-public destinations (services/mediaInspection.js).
  app.post('/api/media/inspect', async (req, res) => {
    const mediaUrl = String(req.body && req.body.mediaUrl || '');
    if (!isValidHttpUrl(mediaUrl)) return res.status(400).json({ error: 'Provide a valid video URL' });
    try {
      const result = await inspectMedia({
        mediaUrl, headers: sanitizeHeaders(req.body.headers), resolvePage: onResolvePage,
        allowPrivateAddresses: inspectPrivateAddresses === true,
      });
      // The authenticated desktop needs the observed request context for its
      // subsequent job submission. This private route is blocked to extension
      // clients above; public queue/bridge responses still strip all headers.
      return res.type('application/json').send(JSON.stringify({
        ...security.publicPayload(result), headers: sanitizeHeaders(result.headers),
      }));
    } catch (error) { return res.status(400).json({ error: redact(error.message) }); }
  });

  // Desktop-only "hover to hear" preview of one audio track. The /api guard
  // above rejects extension clients; saved headers never leave this process.
  app.post('/api/media/audio-sample', async (req, res) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const { mediaUrl, renditionUrl, streamIndex, durationSeconds } = body;
    if (!isValidHttpUrl(mediaUrl)
      || (renditionUrl !== undefined && renditionUrl !== null && renditionUrl !== '' && !isValidHttpUrl(renditionUrl))
      || (streamIndex !== undefined && streamIndex !== null && (!Number.isInteger(streamIndex) || streamIndex < 0 || streamIndex > 63))
      || (durationSeconds !== undefined && durationSeconds !== null && (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0))) {
      return res.status(400).json({ error: 'Provide a valid audio track' });
    }
    const abort = new AbortController();
    const onClose = () => { if (!res.writableFinished) abort.abort(); };
    res.once('close', onClose);
    try {
      const filePath = await audioSampler.generate({
        mediaUrl: mediaUrl.trim(),
        renditionUrl: renditionUrl ? renditionUrl.trim() : undefined,
        streamIndex: streamIndex ?? undefined,
        durationSeconds: durationSeconds ?? undefined,
        headers: sanitizeHeaders(body.headers),
      }, abort.signal);
      const bytes = await fsPromises.readFile(filePath);
      if (abort.signal.aborted || res.destroyed) return undefined;
      res.status(200).set({ 'Content-Type': 'audio/mp4', 'Cache-Control': 'no-store', 'Content-Length': String(bytes.length) });
      return res.end(bytes);
    } catch (error) {
      if (abort.signal.aborted || res.destroyed || res.headersSent) return undefined;
      const code = error && error.code;
      if (code === 'SAMPLE_SUPERSEDED' || code === 'SAMPLE_ABORTED') return res.status(499).json({ error: 'Sample cancelled' });
      if (code === 'INVALID_SAMPLE_REQUEST' || code === 'INVALID_MEDIA_URL') return res.status(400).json({ error: 'Provide a valid audio track' });
      return res.status(code === 'SAMPLE_SOURCE_FAILED' || code === 'SAMPLE_TIMEOUT' ? 502 : 422).json({ error: 'Sample unavailable' });
    } finally {
      res.removeListener('close', onClose);
    }
  });

  for (const action of ['pause', 'resume']) {
    app.post([`/v1/jobs/:id/${action}`, `/v1/queue/:id/${action}`], (req, res) => {
      const changed = action === 'pause' ? queueManager.pauseJob(req.params.id) : queueManager.resumeJob(req.params.id);
      res.status(changed ? 200 : 409).json(changed ? { ok: true } : { error: `This download cannot ${action} now` });
    });
  }

  app.post('/api/queue/:id/use-chrome-session', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Download not found' });
    let source;
    try { source = new URL(job.url); } catch { /* Reject invalid stored sources. */ }
    const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
    if (!source || !['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.port || !youtubeHosts.has(source.hostname.toLowerCase())) {
      return res.status(409).json({ error: 'Chrome sign-in can only retry a YouTube download' });
    }
    await queueManager.waitForJobIdle(job.id);
    if (jobs.get(job.id) !== job || job.queueStatus !== 'failed' || classifyProblem(job.error || '').code !== 'authentication') {
      return res.status(409).json({ error: 'This download does not need a sign-in retry' });
    }
    if (queueManager.getActiveCount() >= queueManager.getSettings().maxConcurrent) {
      return res.status(409).json({ error: 'Wait for an active download to finish, then try Chrome sign-in again' });
    }
    const previous = {
      status: job.status, queueStatus: job.queueStatus, cancelled: job.cancelled,
      pauseRequested: job.pauseRequested, resumeRequested: job.resumeRequested,
      error: job.error, errorCode: job.errorCode, progress: job.progress,
      completedAt: job.completedAt, requiresSourceRefresh: job.requiresSourceRefresh,
    };
    Object.assign(job, {
      status: 'pending', queueStatus: 'queued', cancelled: false,
      pauseRequested: false, resumeRequested: false, error: null, errorCode: null,
      progress: 0, completedAt: null, requiresSourceRefresh: false,
      youtubeBrowserSession: 'chrome',
    });
    if (!queueManager.startJob(job.id)) {
      Object.assign(job, previous);
      delete job.youtubeBrowserSession;
      return res.status(409).json({ error: 'The download could not be restarted' });
    }
    await queueManager.saveQueue();
    return res.json({ ok: true, jobId: job.id, status: job.queueStatus });
  });

  app.post(['/v1/jobs/:id/open', '/v1/jobs/:id/open-file'], async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || !['completed', 'completed-with-errors'].includes(job.queueStatus || job.status)) return res.status(409).json({ error: 'This download is not saved yet' });
    const filePath = job.mp4Path && fs.existsSync(job.mp4Path) ? job.mp4Path : job.filePath;
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File moved or deleted', code: 'FILE_MISSING' });
    // The OS opens whatever handler matches the extension; only media may launch.
    if (!isMediaFilePath(filePath)) return res.status(415).json({ error: 'Only video and audio files can be opened' });
    if (typeof onOpenFile !== 'function') return res.status(501).json({ error: 'Open the file from the desktop app' });
    try {
      const error = await onOpenFile(filePath);
      if (typeof error === 'string' && error) throw new Error(error);
      return res.json({ ok: true });
    } catch { return res.status(500).json({ error: 'The file could not be opened' }); }
  });

  app.post(['/v1/jobs/:id/refresh-source', '/api/jobs/:id/refresh-source'], async (req, res) => {
    const source = req.body || {};
    const selectionResult = validateSelection(source.selection);
    if (!isValidHttpUrl(source.mediaUrl || source.url) || !selectionResult.ok || (source.sourcePageUrl && !isValidHttpUrl(source.sourcePageUrl))) return res.status(400).json({ error: 'Provide a valid refreshed video URL and selection' });
    if (!jobs.has(req.params.id)) return res.status(404).json({ error: 'Download not found' });
    try {
      const result = await queueManager.refreshJobSource(req.params.id, {
        url: source.mediaUrl || source.url,
        headers: sanitizeHeaders(source.headers),
        sourcePageUrl: sanitizeString(source.sourcePageUrl, 4096),
        ...(selectionResult.value ? { selection: selectionResult.value } : {}),
        ...(validManifestText(source.manifestText) ? { manifestText: source.manifestText } : {}),
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (error) { return res.status(400).json({ error: redactPaths(redact(error.message)) }); }
  });

  app.get(['/v1/diagnostics', '/api/diagnostics'], (req, res) => {
    res.json(redact({
      appVersion,
      apiVersion: API.apiVersion,
      generatedAt: new Date().toISOString(),
      jobs: queueManager.getQueue().map((job) => ({
        id: job.id, status: job.queueStatus || job.status, mediaType: job.mediaType,
        source: job.sourcePageUrl, progress: job.progress,
        error: redactPaths(job.error), totalSegments: job.totalSegments, completedSegments: job.completedSegments,
      })),
    }));
  });

  app.post('/api/jobs/:id/retry-original-hls', (req, res) => {
    const sourceJob = jobs.get(req.params.id);
    if (!sourceJob) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (!sourceJob.originalHlsUrl || !isValidHttpUrl(sourceJob.originalHlsUrl)) {
      res.status(400).json({ error: 'Original HLS URL not available for retry' });
      return;
    }

    const queue = {
      url: sourceJob.originalHlsUrl,
      mediaType: 'hls',
      selection: sourceJob.selection,
      headerOrigin: sourceJob.credentialOrigin || sourceJob.headerOrigin,
      title: sourceJob.title || 'HLS Retry',
      name: sourceJob.title || 'HLS Retry',
      manualTitleOverride: sourceJob.manualTitleOverride === true,
      headers: sourceJob.headers || {},
      sourcePageUrl: sourceJob.sourcePageUrl || '',
      youtubeMetadata: sourceJob.youtubeMetadata || null,
      thumbnailUrl: Array.isArray(sourceJob.thumbnailUrls) ? String(sourceJob.thumbnailUrls[0] || '') : '',
    };

    const settings = {
      fileNaming: sourceJob.fileNaming || 'title',
      customName: sourceJob.fileNaming === 'custom' ? sourceJob.title || '' : '',
      maxSegmentAttempts: sourceJob.maxSegmentAttempts === Infinity
        ? 'infinite'
        : String(sourceJob.maxSegmentAttempts || engineConfig.defaultMaxSegmentAttempts),
      fallbackMediaUrl: sourceJob.fallbackUrl || '',
    };

    const threads = Number.isFinite(sourceJob.maxConcurrent) && sourceJob.maxConcurrent > 0
      ? sourceJob.maxConcurrent
      : engineConfig.defaultMaxConcurrent;

    const result = enqueueLegacyRequest({ queue, threads, settings });
    res.json({
      ...result,
      retryOf: sourceJob.id,
    });
  });

  app.post(['/api/jobs/:id/retry', '/v1/jobs/:id/retry'], (req, res) => {
    const sourceJob = jobs.get(req.params.id);
    if (!sourceJob) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // A queued or paused job resumes; retrying it would download it twice.
    if (['queued', 'paused', 'downloading'].includes(sourceJob.queueStatus) || sourceJob.status === 'downloading' || sourceJob.status === 'fetching-playlist') {
      res.status(400).json({ error: 'Cannot retry an active job' });
      return;
    }

    const retryUrl = sanitizeString(sourceJob.url, 4096);
    if (!isValidHttpUrl(retryUrl)) {
      res.status(400).json({ error: 'Source job URL is invalid for retry' });
      return;
    }
    // A repeated retry (for example a double-clicked Undo) returns the first.
    const duplicate = findDuplicateQueuedJob(retryUrl);
    if (duplicate) {
      res.json({ id: duplicate.id, jobId: duplicate.id, queuePosition: duplicate.queuePosition || 0, retryOf: sourceJob.id, duplicate: true });
      return;
    }

    const queue = {
      url: retryUrl,
      mediaType: sourceJob.mediaType,
      selection: sourceJob.selection,
      headerOrigin: sourceJob.credentialOrigin || sourceJob.headerOrigin,
      title: sourceJob.title || 'Retry Job',
      name: sourceJob.title || 'Retry Job',
      manualTitleOverride: sourceJob.manualTitleOverride === true,
      headers: sourceJob.headers || {},
      sourcePageUrl: sourceJob.sourcePageUrl || '',
      youtubeMetadata: sourceJob.youtubeMetadata || null,
      thumbnailUrl: Array.isArray(sourceJob.thumbnailUrls) ? String(sourceJob.thumbnailUrls[0] || '') : '',
    };

    const settings = {
      fileNaming: sourceJob.fileNaming || 'title',
      customName: sourceJob.fileNaming === 'custom' ? sourceJob.title || '' : '',
      maxSegmentAttempts: sourceJob.maxSegmentAttempts === Infinity
        ? 'infinite'
        : String(sourceJob.maxSegmentAttempts || engineConfig.defaultMaxSegmentAttempts),
      fallbackMediaUrl: sourceJob.fallbackUrl || '',
    };

    const threads = Number.isFinite(sourceJob.maxConcurrent) && sourceJob.maxConcurrent > 0
      ? sourceJob.maxConcurrent
      : engineConfig.defaultMaxConcurrent;

    const result = enqueueLegacyRequest({ queue, threads, settings });
    res.json({
      ...result,
      jobId: result.id,
      retryOf: sourceJob.id,
    });
  });

  registerHistoryRoutes(app, historyIndex, fsPromises, resolvedDownloadDir, {
    onTrashFile, onOpenFile, onLocateFile,
    onRemoveItem: async (item) => {
      const job = item.jobId && jobs.get(item.jobId);
      if (job && ['completed', 'completed-with-errors', 'failed', 'cancelled'].includes(job.queueStatus || job.status)) {
        queueManager.removeJob(item.jobId, false);
        await queueManager.waitForJobIdle(item.jobId);
      }
    },
  });
  registerQueueRoutes(app, queueManager, {
    onRenameJob: async (jobId, title) => {
      const job = jobs.get(jobId);
      if (!job) return;

      const inferredHints = inferMediaMetadata({
        title,
        resourceName: job.downloadName,
        sourcePageTitle: title,
        mediaUrl: job.url,
        sourcePageUrl: job.sourcePageUrl,
      });
      const previousHints = job.mediaHints && typeof job.mediaHints === 'object'
        ? job.mediaHints
        : {};
      const seasonNumber = Number.isFinite(inferredHints.seasonNumber)
        ? inferredHints.seasonNumber
        : (Number.isFinite(previousHints.seasonNumber) ? previousHints.seasonNumber : null);
      const episodeNumber = Number.isFinite(inferredHints.episodeNumber)
        ? inferredHints.episodeNumber
        : (Number.isFinite(previousHints.episodeNumber) ? previousHints.episodeNumber : null);

      job.mediaHints = {
        ...previousHints,
        ...inferredHints,
        lookupTitle: String(inferredHints.lookupTitle || title || '').trim(),
        seasonNumber,
        episodeNumber,
        isTvCandidate: Boolean(
          inferredHints.isTvCandidate
          || previousHints.isTvCandidate
          || (Number.isFinite(seasonNumber) && Number.isFinite(episodeNumber))
        ),
      };
      job.updatedAt = Date.now();

      if (appConfig.tmdbApiKey) {
        await enrichTmdb(job);
      } else {
        queueManager.saveQueue();
      }
    },
  });
  // Normalize both creation contracts before the legacy desktop route builds a job.
  app.post('/api/jobs', async (req, res, next) => {
    try {
      const source = req.body && req.body.queue || {};
      const normalized = validateCreateJobRequest(await applyRequestDefaults({
        ...source, mediaUrl: source.url, resourceName: source.name,
        selection: source.selection === undefined ? req.body && req.body.selection : source.selection, settings: req.body && req.body.settings,
      }));
      req.body.queue = { ...source, headers: normalized.headers, mediaType: normalized.mediaType, selection: normalized.selection, thumbnailUrl: normalized.thumbnailUrl };
      req.body.settings = normalized.settings;
      next();
    } catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
  });

  registerJobRoutes(
    app,
    jobs,
    queueManager,
    resolvedDownloadDir,
    createJobId,
    safeFilename,
    engineConfig.defaultMaxConcurrent,
    engineConfig.defaultMaxSegmentAttempts,
    runJob,
    runDirectJob,
  );

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error.statusCode || error.status) || 500;
    return res.status(status >= 400 && status <= 599 ? status : 500).json({
      error: status === 400 ? 'The request could not be read' : 'The request could not be completed',
    });
  });

  const webSocketServerOptions = {
    server, path: '/ws',
    handleProtocols: (protocols) => protocols.has('snagthis') ? 'snagthis' : false,
    verifyClient: ({ req }, done) => {
      const allowedHosts = new Set([`127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`, `[::1]:${server.address()?.port}`]);
      const client = allowedHosts.has(String(req.headers.host || '')) && security.originAllowed(String(req.headers.origin || '')) ? security.authenticate(req) : null;
      const allowed = Boolean(client);
      if (client) security.markConnected(req, client);
      // Bound to the socket on 'connection' and re-checked before every send.
      req.bridgeClient = client;
      done(allowed, allowed ? 200 : 401, allowed ? 'OK' : 'Unauthorized');
    },
  };
  // stop() closes the WebSocket server and detaches it from the HTTP server,
  // so start() attaches a fresh one after a stop to keep updates flowing.
  function createWebSocketServer() {
    const next = new WebSocket.Server(webSocketServerOptions);
    // ws forwards HTTP server errors before start()'s listener receives them.
    // Handle that forwarded event so a bind failure can reject start() normally.
    next.on('error', (error) => {
      logger.warn('Downloader WebSocket server error', { code: error.code, error: error.message });
    });
    next.on('connection', handleWebSocketConnection);
    return next;
  }
  let wss = createWebSocketServer();
  let webSocketServerClosed = false;
  const jobSubscriptions = new Map();
  const channelSubscriptions = new Map();
  const clientSubscriptions = new Map();
  const lastSentTimestamps = new Map();
  let lastQueueSignature = '';
  let lastHistoryQueueSignature = '';
  const notifiedCompletedJobs = new Set();

  const CHANNELS = new Set(['queue', 'history', 'compatibility']);

  function subscribeClientToJob(ws, jobId) {
    if (!jobId) return;

    let subscriptions = clientSubscriptions.get(ws);
    if (!subscriptions) {
      subscriptions = { jobs: new Set(), channels: new Set() };
      clientSubscriptions.set(ws, subscriptions);
    }
    subscriptions.jobs.add(jobId);

    let subscribers = jobSubscriptions.get(jobId);
    if (!subscribers) {
      subscribers = new Set();
      jobSubscriptions.set(jobId, subscribers);
    }
    subscribers.add(ws);
  }

  function subscribeClientToChannel(ws, channel) {
    if (!CHANNELS.has(channel)) return false;

    let subscriptions = clientSubscriptions.get(ws);
    if (!subscriptions) {
      subscriptions = { jobs: new Set(), channels: new Set() };
      clientSubscriptions.set(ws, subscriptions);
    }
    subscriptions.channels.add(channel);

    let subscribers = channelSubscriptions.get(channel);
    if (!subscribers) {
      subscribers = new Set();
      channelSubscriptions.set(channel, subscribers);
    }
    subscribers.add(ws);
    return true;
  }

  function unsubscribeClient(ws) {
    const subscriptions = clientSubscriptions.get(ws);
    if (!subscriptions) return;

    subscriptions.jobs.forEach((jobId) => {
      const subscribers = jobSubscriptions.get(jobId);
      if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          jobSubscriptions.delete(jobId);
          lastSentTimestamps.delete(jobId);
        }
      }
    });

    subscriptions.channels.forEach((channel) => {
      const subscribers = channelSubscriptions.get(channel);
      if (!subscribers) return;
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        channelSubscriptions.delete(channel);
      }
    });

    clientSubscriptions.delete(ws);
  }

  const socketClients = new WeakMap();
  // A socket whose credential was revoked or replaced never receives another message.
  function socketCurrent(ws) {
    if (security.isCurrent(socketClients.get(ws))) return true;
    unsubscribeClient(ws);
    ws.terminate();
    return false;
  }
  closeRevokedSockets = () => {
    for (const ws of wss.clients) socketCurrent(ws);
  };

  function sendWsMessage(ws, type, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !socketCurrent(ws)) return;
    ws.send(JSON.stringify({ type, data: security.publicPayload(payload) }));
  }

  function sendChannelMessage(channel, type, payload) {
    const subscribers = channelSubscriptions.get(channel);
    if (!subscribers || subscribers.size === 0) return;
    subscribers.forEach((ws) => sendWsMessage(ws, type, payload));
  }

  function getQueuePayload() {
    return {
      queue: queueManager.getQueue(),
      settings: queueManager.getSettings(),
      updatedAt: Date.now(),
    };
  }

  function getQueueSignature(payload) {
    // Every public field can affect a row; the envelope timestamp cannot.
    return JSON.stringify([payload.settings || {}, payload.queue || []]);
  }

  function getHistoryQueueSignature(payload) {
    return JSON.stringify((payload.queue || []).map((job) => {
      const source = jobs.get(job.id) || {};
      return [job.id, ['completed', 'completed-with-errors', 'failed', 'cancelled'].includes(job.queueStatus || job.status),
        source.filePath, source.mp4Path, job.thumbnailUrls, job.previewClipUrl];
    }));
  }

  function broadcastQueueUpdate(payloadOverride = null) {
    const payload = payloadOverride || getQueuePayload();
    const signature = getQueueSignature(payload);
    if (signature === lastQueueSignature) {
      return false;
    }
    lastQueueSignature = signature;
    for (const job of payload.queue || []) {
      if (!['completed', 'completed-with-errors'].includes(job.queueStatus || job.status) || notifiedCompletedJobs.has(job.id)) continue;
      notifiedCompletedJobs.add(job.id);
      requestPreview({ job: jobs.get(job.id) }).catch(() => {});
      if (typeof onDownloadComplete === 'function') Promise.resolve(onDownloadComplete(job)).catch(() => {});
    }
    sendChannelMessage('queue', 'queue:update', payload);
    return true;
  }

  function broadcastCompatibilityUpdate(ws = null) {
    const compatibility = getCompatibilityInfo();
    const payload = {
      appVersion,
      apiVersion: API.apiVersion,
      protocolVersion: compatibility.protocolVersion,
      supportedProtocolVersions: compatibility.supportedProtocolVersions,
      minExtensionVersion: compatibility.minExtensionVersion,
      pairingRequired: true,
      wsPath: '/ws',
      updatedAt: Date.now(),
    };

    if (ws) {
      sendWsMessage(ws, 'compatibility:update', payload);
      return;
    }
    sendChannelMessage('compatibility', 'compatibility:update', payload);
  }

  function broadcastHistoryUpdate(payload = {}) {
    sendChannelMessage('history', 'history:update', {
      changedAt: payload.changedAt || Date.now(),
      reason: payload.reason || 'refresh',
      total: Number(payload.total || 0),
    });
  }

  notifyHistoryChange = (payload) => {
    broadcastHistoryUpdate(payload);
  };

  function broadcastJobUpdate(job) {
    if (!job || !job.id) return;
    const subscribers = jobSubscriptions.get(job.id);
    if (!subscribers || subscribers.size === 0) return;

    const payload = buildJobStatusPayload(job);
    if (!payload) return;

    subscribers.forEach((ws) => sendWsMessage(ws, 'job:update', payload));
  }

  function handleWebSocketConnection(ws, req) {
    socketClients.set(ws, req && req.bridgeClient);
    ws.on('message', (raw) => {
      if (!socketCurrent(ws)) return;
      try {
        const message = JSON.parse(raw.toString());
        if (!message || message.type !== 'subscribe') {
          return;
        }

        // Backward compatibility: { type: 'subscribe', jobId }
        if (message.jobId && !message.channel) {
          const jobId = String(message.jobId);
          subscribeClientToJob(ws, jobId);
          const job = jobs.get(jobId);
          if (job) {
            lastSentTimestamps.set(job.id, job.updatedAt || Date.now());
            broadcastJobUpdate(job);
          }
          return;
        }

        const channel = String(message.channel || '').trim();
        if (!channel) return;

        if (channel === 'job') {
          const jobId = String(message.jobId || '').trim();
          if (!jobId) return;
          subscribeClientToJob(ws, jobId);
          const job = jobs.get(jobId);
          if (job) {
            lastSentTimestamps.set(job.id, job.updatedAt || Date.now());
            broadcastJobUpdate(job);
          }
          return;
        }

        const subscribed = subscribeClientToChannel(ws, channel);
        if (!subscribed) return;

        if (channel === 'queue') {
          sendWsMessage(ws, 'queue:update', getQueuePayload());
        } else if (channel === 'history') {
          sendWsMessage(ws, 'history:update', {
            changedAt: Date.now(),
            reason: 'subscribe',
            total: historyIndex.items.length,
          });
        } else if (channel === 'compatibility') {
          broadcastCompatibilityUpdate(ws);
        }
      } catch (err) {
        logger.warn('Failed to parse WebSocket message', { error: err.message });
      }
    });

    ws.on('close', () => {
      unsubscribeClient(ws);
    });

    ws.on('error', () => {
      unsubscribeClient(ws);
    });
  }

  // Runs only while the server is started, and only after start() has marked
  // earlier sessions' completed jobs as already announced.
  function broadcastTick() {
    const payload = getQueuePayload();
    broadcastQueueUpdate(payload);
    const historySignature = getHistoryQueueSignature(payload);
    if (historySignature !== lastHistoryQueueSignature) {
      lastHistoryQueueSignature = historySignature;
      historyIndex.refreshFromDisk({ force: true }).catch((err) => {
        logger.warn('History index refresh failed after queue update', { error: err && err.message });
      });
    }

    jobSubscriptions.forEach((subscribers, jobId) => {
      if (!subscribers || subscribers.size === 0) {
        jobSubscriptions.delete(jobId);
        lastSentTimestamps.delete(jobId);
        return;
      }

      const job = jobs.get(jobId);
      if (!job) {
        jobSubscriptions.delete(jobId);
        lastSentTimestamps.delete(jobId);
        return;
      }

      const lastSent = lastSentTimestamps.get(jobId) || 0;
      const updatedAt = job.updatedAt || 0;
      if (updatedAt > lastSent) {
        lastSentTimestamps.set(jobId, updatedAt);
        broadcastJobUpdate(job);
      }
    });
  }

  let started = false;
  let broadcastInterval = null;
  let cleanupTimer = null;
  let historyRefreshTimer = null;

  async function start() {
    if (started) return Promise.resolve({ host, port: server.address()?.port || port });

    started = true;
    await queueManager.ready;
    queueManager.suspending = false;
    await queueManager.saveQueue();
    for (const job of jobs.values()) if (['completed', 'completed-with-errors'].includes(job.queueStatus || job.status)) notifiedCompletedJobs.add(job.id);
    await historyIndex.init();
    lastQueueSignature = '';
    const initialQueue = getQueuePayload();
    lastHistoryQueueSignature = getHistoryQueueSignature(initialQueue);
    broadcastQueueUpdate(initialQueue);
    broadcastCompatibilityUpdate();
    if (webSocketServerClosed) {
      wss = createWebSocketServer();
      webSocketServerClosed = false;
    }
    broadcastInterval = setInterval(broadcastTick, 500);

    cleanupTimer = startCleanupScheduler({
      fsPromises,
      downloadDir: resolvedDownloadDir,
      intervalMs: engineConfig.cleanupIntervalMs,
      tempMaxAgeHours: engineConfig.cleanupAgeHours,
      downloadMaxAgeHours: 0,
      // null means "ownership unknown": nothing is treated as abandoned.
      getProtectedJobIds: () => (!queueManager.queueRestored ? null
        : [...jobs.values()].filter((job) => !['completed', 'completed-with-errors', 'failed', 'cancelled'].includes(job.queueStatus || job.status)).map((job) => job.id)),
    });
    historyRefreshTimer = setInterval(() => {
      historyIndex.refreshFromDisk().catch((err) => {
        logger.warn('History index refresh failed', { error: err && err.message });
      });
    }, 15_000);

    return new Promise((resolve, reject) => {
      const fail = (error) => {
        started = false;
        clearInterval(broadcastInterval);
        broadcastInterval = null;
        clearInterval(cleanupTimer);
        clearInterval(historyRefreshTimer);
        cleanupTimer = null;
        historyRefreshTimer = null;
        reject(error);
      };
      server.once('error', fail);
      server.listen(port, host, () => {
        server.off('error', fail);
        logger.info('Downloader API listening', { host, port });
        resolve({ host, port: server.address().port });
      });
    });
  }

  async function stop() {
    if (!started) return Promise.resolve();
    started = false;

    clearInterval(broadcastInterval);
    broadcastInterval = null;
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    if (historyRefreshTimer) {
      clearInterval(historyRefreshTimer);
      historyRefreshTimer = null;
    }
    previewAbort.abort();
    audioSampler.close();
    // Quitting must not leave yt-dlp/ffmpeg writing into a folder the next
    // launch will resume from; pause active downloads and keep them queued.
    await queueManager.suspendActiveJobs();
    await previewWork;
    await queueManager.persistence;
    // A scan can still enqueue an index write after the current persistence
    // promise settles. Finish that scan before draining its final write.
    await historyIndex.refreshInFlight;
    await historyIndex.persistence;

    return new Promise((resolve, reject) => {
      for (const client of wss.clients) client.terminate();
      webSocketServerClosed = true;
      wss.close(() => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
        // Electron keeps its windows alive until this finishes. A paused
        // preview response can otherwise keep HTTP shutdown waiting forever
        // for that same window to close. Persist state first, then disconnect
        // incoming clients after the server has stopped accepting connections.
        server.closeAllConnections();
      });
    });
  }

  return {
    app,
    server,
    start,
    stop,
    getAuthToken: () => security.token,
    getPairingInfo: security.getPairingInfo,
    getPendingPairing: security.getPendingPairing,
    decidePairing: security.decidePairing,
    listExtensions: security.listExtensions,
    revokeExtension: security.revokeExtension,
    getConnectionState: security.getConnectionState,
    getQueueSettings: () => queueManager.getSettings(),
    updateQueueSettings: (settings) => queueManager.updateSettings(settings || {}),
    applyLegacyQueueSettings: (legacy) => queueManager.applyLegacySettingsIfNeeded(legacy || {}),
    getState: () => ({
      queue: queueManager.getQueue(),
      settings: queueManager.getSettings(),
      pairingRequired: true,
      appVersion,
      apiVersion: API.apiVersion,
      ...security.getConnectionState(),
    }),
  };
}

module.exports = {
  createApiServer,
};
