#!/usr/bin/env node
/*
 * Bounded compatibility survey for third-party streaming sites (e.g. the FMHY
 * video list). Detection + short probes only:
 *   - loads the real unpacked extension in an isolated, headless profile;
 *   - blocks popups/new windows and downloads, never solves challenges;
 *   - reads what the extension detected (GET_TAB_MEDIA) plus a network log;
 *   - probes playlist -> first init/segment with the engine's own request code;
 *   - runs a bounded engine download (a few seconds) and deletes it;
 *   - optionally compares yt-dlp --simulate.
 * Raw evidence goes to compat/results/fmhy/ (git-ignored). Report text is
 * written by hand from that evidence.
 *
 * node compat/fmhy-survey.js [--site id] [--parallel 3] [--no-ytdlp] [--headed]
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'results', 'fmhy');
const SITES = path.join(__dirname, 'fmhy-video-sites.json');
const SITE_BUDGET_MS = 120_000;
const MEDIA_PATH = /\.(?:m3u8|mpd|mp4|m4v|webm|m4s|ts|m4a|aac|mkv)(?:[?#]|$)/i;
const MEDIA_TYPE = /mpegurl|dash\+xml|^video\/|^audio\/|mp2t/i;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const host = (value) => { try { return new URL(value).hostname; } catch { return ''; } };

process.env.LOG_LEVEL = 'error';
process.env.DISABLE_FILE_LOGS = '1';

function stripSecrets(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(':')) continue;
    result[key] = /^(cookie|authorization|x-api-key)$/i.test(key) ? `[${String(value).length} chars]` : value;
  }
  return result;
}

// Instrumentation only: records EME use, MSE/blob playback and never alters media requests.
const INIT_SCRIPT = `(() => {
  try {
    window.open = function() { return null; };
    const rec = (k, v) => { try { (window.__fmhy = window.__fmhy || {})[k] = v; } catch {} };
    if (navigator.requestMediaKeySystemAccess) {
      const original = navigator.requestMediaKeySystemAccess.bind(navigator);
      navigator.requestMediaKeySystemAccess = function(system, config) { rec('eme', String(system)); return original(system, config); };
    }
    if (window.MediaSource) {
      const add = MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer = function(type) { rec('mse', String(type)); return add.call(this, type); };
    }
  } catch {}
})();`;

async function probeFrames(page) {
  const frames = [];
  for (const frame of page.frames()) {
    const info = await frame.evaluate(() => ({
      url: location.href,
      eme: window.__fmhy?.eme || null,
      mse: window.__fmhy?.mse || null,
      videos: [...document.querySelectorAll('video')].map((video) => ({ src: String(video.currentSrc || video.src || '').slice(0, 200), duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null, paused: video.paused, h: video.videoHeight })),
      challenge: /just a moment|attention required|verify you are human|checking your browser/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 400)),
    })).catch(() => ({ url: frame.url(), unreachable: true }));
    frames.push(info);
  }
  return frames;
}

async function discoverWatchPage(page, entry) {
  // Follow one same-site content link per hop (e.g. listing -> title -> episode).
  const hops = Array.isArray(entry.linkPattern) ? entry.linkPattern : [entry.linkPattern || '/(?:watch|movie|movies|film|tv|series|show|anime|episode|video|videos|v|play|live|channel|drama|title|details?)/[^#?]*[\\w-]{3,}'];
  let visited = null;
  for (const hop of hops) {
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href)).catch(() => []);
    const origin = new URL(page.url()).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
    const pattern = new RegExp(hop, 'i');
    const candidate = links.find((href) => host(href).replace(/^www\./, '').endsWith(origin) && pattern.test(new URL(href).pathname + new URL(href).hash) && href !== page.url());
    if (!candidate) return visited;
    await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    visited = candidate;
    await delay(3000);
  }
  return visited;
}

async function tryStartPlayback(page) {
  // Text buttons first, then the centre of the largest player-like element.
  for (const frame of [page.mainFrame()]) {
    const button = frame.locator('button, a, div[role=button], span').filter({ hasText: /^\s*(?:play|play now|watch|watch now|watch movie|start watching|stream now|▶)\s*$/i }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) await button.click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
  }
  const box = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('video, iframe, [class*=player i], [id*=player i], [class*=video i]')]
      .map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 240 && rect.height > 130 && rect.top < innerHeight)
      .sort((a, b) => b.width * b.height - a.width * a.height);
    const rect = elements[0];
    return rect ? { x: rect.x + rect.width / 2, y: Math.max(rect.y + 10, Math.min(innerHeight - 10, rect.y + rect.height / 2)) } : null;
  }).catch(() => null);
  if (box) await page.mouse.click(box.x, box.y).catch(() => {});
}

async function readDetections(worker, page) {
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url()).catch(() => null);
  if (!tabId) return { error: 'tab not found' };
  const detection = await worker.evaluate((id) => handleMessage({ cmd: 'GET_TAB_MEDIA', tabId: id }, { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') }), tabId)
    .catch((error) => ({ error: error.message }));
  // The popup only learns that a POST/blob playlist snapshot exists; the worker
  // attaches its text to a download. Read it the same way for the engine probe.
  const snapshots = await worker.evaluate(async (id) => Object.fromEntries((await readPage(id)).items.filter((item) => item.manifestSnapshot).map((item) => [item.url, item.manifestSnapshot])), tabId).catch(() => ({}));
  for (const item of detection.items || []) if (snapshots[item.url]) item.manifestSnapshot = snapshots[item.url];
  return detection;
}

async function browse(entry, headedFlag) {
  const headed = headedFlag || entry.headed === true;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-fmhy-'));
  const extensionPath = path.join(ROOT, 'apps/extension');
  const result = { id: entry.id, url: entry.url, startedAt: new Date().toISOString(), popupsBlocked: [], network: [] };
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: !headed, acceptDownloads: false, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const deadline = Date.now() + SITE_BUDGET_MS - 25_000;
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await context.addInitScript(INIT_SCRIPT);
    let main;
    context.on('page', (page) => { if (main && page !== main) { result.popupsBlocked.push(page.url()); page.close().catch(() => {}); } });
    main = await context.newPage();
    context.on('response', async (response) => {
      const request = response.request();
      const url = request.url();
      const contentType = response.headers()['content-type'] || '';
      const pathOnly = url.split(/[?#]/)[0];
      const media = MEDIA_PATH.test(pathOnly) || MEDIA_TYPE.test(contentType) || /\.m3u8|\.mpd|\/playlist|master|manifest\b|\/hls\//i.test(url);
      if (!media || result.network.length > 400) return;
      let body = '';
      if (/mpegurl|dash|text|json|octet/i.test(contentType) || /\.(?:m3u8|mpd)/i.test(pathOnly)) {
        try { const buffer = await response.body(); const text = buffer.subarray(0, 6000).toString('utf8'); if (/^﻿?\s*(?:#EXTM3U|<\?xml|<MPD)/.test(text)) body = text; } catch { /* Redirect or aborted body. */ }
      }
      let frame = '';
      try { frame = request.frame().url(); } catch { frame = 'worker'; }
      result.network.push({ at: Date.now(), url, status: response.status(), type: request.resourceType(), contentType, frame, requestHeaders: stripSecrets(await request.allHeaders().catch(() => ({}))), body });
    });
    try {
      await main.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (error) { result.gotoError = error.message.split('\n')[0]; }
    await delay(5000);
    if (entry.discover) {
      try { result.discovered = await discoverWatchPage(main, entry); } catch (error) { result.discoverError = error.message.split('\n')[0]; }
      await delay(4000);
    }
    for (const step of entry.steps || []) {
      try {
        if (step.click) await main.locator(step.click).first().click({ timeout: 5000, noWaitAfter: true });
        if (step.goto) await main.goto(step.goto, { waitUntil: 'domcontentloaded', timeout: 25_000 });
        if (step.wait) await delay(step.wait);
      } catch (error) { (result.stepErrors ||= []).push(error.message.split('\n')[0]); }
    }
    let rounds = 0;
    let firstMediaAt = null;
    while (Date.now() < deadline) {
      const sawMedia = result.network.some((item) => /mpegurl|dash\+xml|^video\//i.test(item.contentType) || item.body);
      if (sawMedia && !firstMediaAt) firstMediaAt = Date.now();
      if (firstMediaAt && Date.now() - firstMediaAt > 10_000) break;
      if (!sawMedia && rounds < 4) { rounds += 1; await tryStartPlayback(main); }
      await delay(4000);
    }
    result.finalUrl = main.url();
    result.title = await main.title().catch(() => '');
    result.frames = await probeFrames(main);
    result.detection = await readDetections(worker, main);
    await main.screenshot({ path: path.join(OUT, `${entry.id}.png`) }).catch(() => {});
  } catch (error) {
    result.browseError = error.message.split('\n')[0];
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return result;
}

// ----- Engine-side probes: exactly the request code a desktop job uses. -----
const { requestMediaWithRedirects } = require('../packages/downloader-engine/src/core/MediaRequest');
const { buildHlsRequestHeaders } = require('../packages/downloader-engine/src/core/HlsNativeDownload');
const { parseHlsManifest, defaultVariant } = require('../packages/contracts/src/hls');

async function fetchBounded(url, headers, item, maxBytes) {
  const started = Date.now();
  try {
    return await requestMediaWithRedirects(url, headers, (response, finalUrl, request) => new Promise((resolve) => {
      const chunks = []; let bytes = 0; let done = false;
      const finish = () => {
        if (done) return; done = true;
        const body = Buffer.concat(chunks);
        resolve({ status: response.statusCode, finalUrl, contentType: response.headers['content-type'] || '', bytes, ms: Date.now() - started, body,
          cf: Boolean(response.headers['cf-ray']), server: response.headers.server || '' });
        response.destroy(); request.destroy();
      };
      response.on('data', (chunk) => { chunks.push(chunk); bytes += chunk.length; if (bytes >= maxBytes) finish(); });
      response.on('end', finish);
      response.on('error', finish);
    }), { credentialOrigin: item.requestHeadersOrigin || item.url, sourcePageUrl: item.sourcePageUrl, timeoutMs: 15_000 });
  } catch (error) { return { error: error.message, code: error.code, ms: Date.now() - started }; }
}
const brief = (response) => response && ({ status: response.status, contentType: response.contentType, bytes: response.bytes, ms: response.ms, error: response.error,
  magic: response.body && response.status < 400 ? response.body.subarray(0, 8).toString('hex') : undefined,
  text: response.body && response.status >= 400 ? response.body.toString('utf8').slice(0, 120).trim() : undefined });

async function probeItem(item) {
  const headers = buildHlsRequestHeaders(item.requestHeaders || {}, { sourcePageUrl: item.sourcePageUrl });
  const probe = { url: item.url, type: item.type, streamType: item.streamType, sentHeaders: Object.keys(headers) };
  if (item.type === 'file' && item.streamType !== 'dash') {
    probe.file = brief(await fetchBounded(item.url, { ...headers, Range: 'bytes=0-65535' }, item, 65536));
    return probe;
  }
  if (item.streamType === 'dash' || item.mediaKind === 'dash-manifest') {
    const manifest = await fetchBounded(item.url, headers, item, 2e6);
    probe.dash = brief(manifest);
    const text = manifest.body?.toString('utf8') || '';
    probe.dashDrm = /ContentProtection[^>]+(?:edef8ba9|9a04f079|94ce86fb)/i.test(text) || /cenc:default_KID/i.test(text);
    return probe;
  }
  const master = await fetchBounded(item.url, headers, item, 5e6);
  probe.master = brief(master);
  if (master.status !== 200) return probe;
  let parsed;
  try { parsed = parseHlsManifest(master.body.toString('utf8'), master.finalUrl); } catch (error) { probe.parseError = error.message; return probe; }
  probe.variants = parsed.variants.map((variant) => ({ height: variant.height, bandwidth: variant.bandwidth, codecs: variant.codecs, audioGroup: variant.audioGroup, url: variant.url }));
  probe.audio = parsed.audio.map((audio) => ({ name: audio.name, language: audio.language, groupId: audio.groupId, default: audio.default, channels: audio.channels, hasUri: Boolean(audio.url) }));
  probe.subtitles = parsed.subtitles.map((subtitle) => ({ name: subtitle.name, language: subtitle.language }));
  probe.encryption = [...new Set(parsed.encryption.map((key) => `${key.method}/${key.keyFormat}`))];
  const lists = parsed.isMaster ? parsed.variants.slice(0, 6).map((variant) => ({ label: `${variant.height || '?'}p`, url: variant.url }))
    .concat(parsed.audio.filter((audio) => audio.url).slice(0, 4).map((audio) => ({ label: `audio:${audio.name}`, url: audio.url })))
    : [{ label: 'media', url: item.url, text: master.body.toString('utf8'), finalUrl: master.finalUrl }];
  probe.playlists = [];
  for (const list of lists) {
    const record = { label: list.label };
    let text = list.text; let finalUrl = list.finalUrl;
    if (!text) { const response = await fetchBounded(list.url, headers, item, 5e6); record.playlist = brief(response); if (response.status !== 200) { probe.playlists.push(record); continue; } text = response.body.toString('utf8'); finalUrl = response.finalUrl; }
    try {
      const child = parseHlsManifest(text, finalUrl);
      record.segments = child.segmentUrls.length; record.durationSeconds = child.durationSeconds && Math.round(child.durationSeconds); record.live = child.isLive;
      record.encryption = [...new Set(child.encryption.map((key) => `${key.method}/${key.keyFormat}`))];
      record.segmentExt = (child.segmentUrls[0] || '').split(/[?#]/)[0].split('.').pop().slice(0, 8);
      if (child.initializationUrls[0]) record.init = brief(await fetchBounded(child.initializationUrls[0], headers, item, 65536));
      if (child.segmentUrls[0]) record.segment0 = brief(await fetchBounded(child.segmentUrls[0], headers, item, 131072));
      const middle = child.segmentUrls[Math.floor(child.segmentUrls.length / 2)];
      if (middle && child.segmentUrls.length > 4) record.segmentMid = brief(await fetchBounded(middle, headers, item, 16384));
    } catch (error) { record.parseError = error.message; }
    probe.playlists.push(record);
  }
  return probe;
}

async function engineProbe(item, seconds = 8, variantUrl) {
  const { createJobProcessor } = require('../packages/downloader-engine/src/core/JobProcessor');
  const { randomUUID } = require('node:crypto');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-fmhy-dl-'));
  const binary = (name) => fs.existsSync(path.join(ROOT, 'apps/desktop/bin', name)) ? path.join(ROOT, 'apps/desktop/bin', name) : name;
  const processor = createJobProcessor({ downloadDir: directory, FFMPEG_PATH: binary('ffmpeg'), FFPROBE_PATH: binary('ffprobe'), fsPromises: fs.promises,
    DEFAULT_MAX_CONCURRENT: 3, DEFAULT_MAX_SEGMENT_ATTEMPTS: 3, getJobTempDirForUrl: (_url, id) => path.join(directory, `temp-${id}`) });
  const id = randomUUID(); const output = path.join(directory, id); fs.mkdirSync(output);
  const isFile = item.type === 'file' && item.streamType !== 'dash';
  // The product default: the highest rendition the page player loaded, else
  // the highest broadly playable one (packages/contracts defaultVariant).
  const variants = item.variants || [];
  const variant = variantUrl ? variants.find((candidate) => candidate.url === variantUrl) : defaultVariant(variants);
  const job = { id, url: item.url, mediaType: isFile ? 'file' : item.streamType === 'dash' ? 'dash' : 'hls', headers: item.requestHeaders || {}, sourcePageUrl: item.sourcePageUrl, credentialOrigin: item.requestHeadersOrigin,
    ...(item.manifestSnapshot ? { manifestText: item.manifestSnapshot } : {}),
    selection: variant ? { variantUrl: variant.url, ...(variant.height ? { height: variant.height } : {}), subtitleLang: 'none' } : { subtitleLang: 'none' },
    probe: { seconds }, title: 'probe', status: 'pending', queueStatus: 'downloading', progress: 0, bytesDownloaded: 0, completedSegments: 0, failedSegments: [],
    filePath: path.join(output, isFile ? 'p.mp4' : 'p.ts'), storageDir: output, downloadName: 'p.ts', downloadNameMp4: 'p.mp4', skipThumbnailGeneration: true, earlyThumbnailAttempted: true };
  const timer = setTimeout(() => { job.cancelled = true; job.childProcess?.kill('SIGTERM'); }, 60_000);
  const started = Date.now();
  try { await (isFile ? processor.runDirectJob(job) : processor.runJob(job)); } catch (error) { job.thrown = error.message; }
  clearTimeout(timer);
  const result = { variantHeight: variant?.height || null, qualityFallback: job.qualityFallback || null, status: job.status, error: job.error || job.thrown || null, errorCode: job.errorCode || null, progress: job.progress, ms: Date.now() - started };
  const file = job.mp4Path || job.filePath;
  if (job.status === 'completed' && fs.existsSync(file)) {
    result.ffprobe = await new Promise((resolve) => execFile(binary('ffprobe'), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], (error, stdout) => {
      if (error) { resolve({ error: error.message }); return; }
      const data = JSON.parse(stdout); resolve({ durationSeconds: Number(data.format.duration), bytes: Number(data.format.size), streams: data.streams.map((stream) => `${stream.codec_type}:${stream.codec_name}${stream.height ? `:${stream.height}p` : ''}`) });
    }));
  }
  fs.rmSync(directory, { recursive: true, force: true });
  return result;
}

function ytdlp(url) {
  const binary = path.join(ROOT, 'apps/desktop/bin/yt-dlp');
  return new Promise((resolve) => execFile(binary, ['--simulate', '-J', '--no-warnings', '--no-playlist', '--socket-timeout', '15', url], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) { resolve({ ok: false, error: String(stderr || error.message).split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 240) }); return; }
    try {
      const data = JSON.parse(stdout);
      resolve({ ok: true, extractor: data.extractor_key || data.extractor, formats: (data.formats || []).length, protocols: [...new Set((data.formats || []).map((format) => format.protocol))], maxHeight: Math.max(0, ...(data.formats || []).map((format) => format.height || 0)) });
    } catch (parseError) { resolve({ ok: false, error: parseError.message }); }
  }));
}

async function runEntry(entry, options) {
  const result = await browse(entry, options.headed);
  const items = result.detection?.items || [];
  result.detectedRows = items.map((item) => ({ url: item.url, type: item.type, streamType: item.streamType, mediaKind: item.mediaKind, frameId: item.frameId, durationSeconds: item.durationSeconds,
    variants: (item.variants || []).map((variant) => variant.height), observedVariants: (item.variants || []).filter((variant) => variant.observed).map((variant) => variant.height),
    serviceWorkerServed: Boolean(item.serviceWorkerServed), manifestSnapshot: Boolean(item.manifestSnapshot || item.hasManifestSnapshot), audio: (item.audio || []).map((audio) => audio.name || audio.language), subtitles: (item.subtitles || []).length,
    headerNames: Object.keys(item.requestHeaders || {}), referer: item.requestHeaders?.referer || null, origin: item.requestHeaders?.origin || null, sourcePageUrl: item.sourcePageUrl, networkObserved: item.networkObserved, drm: item.manifest?.isDrm || false }));
  // Probe the longest detected row (the main title), not a trailer/ad.
  const ranked = [...items].sort((a, b) => (Number(b.durationSeconds) || 0) - (Number(a.durationSeconds) || 0));
  const main = ranked[0];
  if (main) {
    try { result.probe = await probeItem(main); } catch (error) { result.probe = { error: error.message }; }
    try { result.engine = await engineProbe(main, 8); } catch (error) { result.engine = { error: error.message }; }
    // If the default (highest) quality fails, check the rendition the page's own player loaded.
    const played = (main.variants || []).filter((variant) => result.network.some((request) => request.url === variant.url && request.status < 400));
    const alternative = played.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    if (result.engine?.status !== 'completed' && alternative && alternative.url !== defaultVariant(main.variants)?.url) {
      try { result.enginePlayerVariant = await engineProbe(main, 8, alternative.url); } catch (error) { result.enginePlayerVariant = { error: error.message }; }
    }
  }
  if (options.ytdlp) result.ytdlp = await ytdlp(result.discovered || result.finalUrl || entry.url);
  result.mediaHosts = [...new Set(result.network.map((request) => host(request.url)))];
  result.frameHosts = [...new Set((result.frames || []).map((frame) => host(frame.url)).filter(Boolean))];
  delete result.detection;
  fs.writeFileSync(path.join(OUT, `${entry.id}.json`), JSON.stringify(result, null, 1));
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const flag = (name) => argv.includes(name);
  const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  fs.mkdirSync(OUT, { recursive: true });
  let entries = JSON.parse(fs.readFileSync(SITES, 'utf8'));
  if (flag('--site')) { const ids = value('--site').split(','); entries = entries.filter((entry) => ids.includes(entry.id)); }
  if (flag('--skip-done')) entries = entries.filter((entry) => !fs.existsSync(path.join(OUT, `${entry.id}.json`)));
  const options = { headed: flag('--headed'), ytdlp: !flag('--no-ytdlp') };
  const queue = [...entries];
  const workers = Array.from({ length: Math.max(1, Number(value('--parallel', 3))) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      const started = Date.now();
      try {
        const result = await runEntry(entry, options);
        console.log(`${entry.id}: rows=${result.detectedRows.length} engine=${result.engine?.status || '-'} ${result.engine?.error || ''} ytdlp=${result.ytdlp?.ok ? result.ytdlp.extractor : 'no'} (${Math.round((Date.now() - started) / 1000)}s)`);
      } catch (error) { console.log(`${entry.id}: harness error ${error.message}`); }
    }
  });
  await Promise.all(workers);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { probeItem, engineProbe };
