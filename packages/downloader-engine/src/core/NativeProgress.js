// Native FFmpeg output progress and observed source-piece delivery are different
// measurements. Never infer completed pieces from an output-time percentage.
const { createDownloadEta } = require('./DownloadEta');

function describeSegments(playlistInfo = {}, playlistText = '', playlistUrl = '') {
  const urls = Array.isArray(playlistInfo.segments) ? playlistInfo.segments : [];
  if (!urls.length) return null;
  const descriptors = [];
  let pendingRange = null;
  let previousRange = null;
  try {
    for (const raw of String(playlistText).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-BYTERANGE:')) {
        const match = line.slice(17).match(/^(\d+)(?:@(\d+))?$/);
        if (!match || Number(match[1]) <= 0) return null;
        pendingRange = { length: Number(match[1]), start: match[2] === undefined ? null : Number(match[2]) };
        continue;
      }
      if (line.startsWith('#')) continue;
      const url = new URL(line, playlistUrl).href;
      if (url !== urls[descriptors.length]) return null;
      let range = null;
      if (pendingRange) {
        const start = pendingRange.start ?? (previousRange?.url === url ? previousRange.end + 1 : null);
        if (!Number.isSafeInteger(start) || start < 0) return null;
        range = { start, end: start + pendingRange.length - 1 };
        previousRange = { url, ...range };
      } else previousRange = null;
      descriptors.push({ url, index: descriptors.length, range });
      pendingRange = null;
    }
  } catch { return null; }
  if (descriptors.length !== urls.length) return null;
  const byUrl = new Map();
  for (const descriptor of descriptors) {
    const prior = byUrl.get(descriptor.url) || [];
    // Repeated, indistinguishable URLs cannot be assigned to request indices
    // reliably: a repeated request may be probing, retrying, or the next piece.
    if (prior.some((item) => !item.range || !descriptor.range || (item.range.start <= descriptor.range.end && descriptor.range.start <= item.range.end))) return null;
    prior.push(descriptor);
    byUrl.set(descriptor.url, prior);
  }
  return byUrl;
}

function createNativeProgress(job, { playlistInfo = {}, playlistText = '', playlistUrl = '', durationSeconds = 0, now = Date.now } = {}) {
  const descriptors = describeSegments(playlistInfo, playlistText, playlistUrl);
  const coverage = new Map();
  const starts = new Set();
  const samples = [{ time: now(), bytes: 0, seconds: 0 }];
  const eta = createDownloadEta({ now });
  let outputSeconds = 0;
  let realtimeFactor = null;
  job.segmentProgressAvailable = Boolean(descriptors);
  job.segmentStates = {};
  job.completedSegments = 0;
  job.totalSegments = Number(playlistInfo.totalSegments) || 0;
  job.speedBps = 0;
  job.etaSeconds = null;
  if (descriptors) for (const items of descriptors.values()) for (const item of items) job.segmentStates[item.index] = { status: 'pending', attempt: 0 };

  function matchesRange(item, range) {
    return !item.range || !range || (item.range.start <= range.end && range.start <= item.range.end);
  }

  function recordCoverage(url, event) {
    const record = coverage.get(url) || { full: false, ranges: [] };
    record.full ||= event.completeResource === true;
    if (event.range && Number.isFinite(event.range.start) && Number.isFinite(event.range.end)) {
      record.ranges.push({ start: event.range.start, end: event.range.end });
      record.ranges.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const range of record.ranges) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
        else merged.push({ ...range });
      }
      record.ranges = merged;
    }
    coverage.set(url, record);
    return record;
  }

  function onResourceEvent(event) {
    if (!descriptors || event.consumer === 'preview') return;
    const items = descriptors.get(event.url);
    if (!items) return; // Manifest, initialization, key, and other track requests.
    const affected = items.filter((item) => matchesRange(item, event.range));
    if (event.type === 'start') {
      const requestKey = `${event.requestId}`;
      if (!starts.has(requestKey)) {
        starts.add(requestKey);
        for (const item of affected) {
          const state = job.segmentStates[item.index];
          if (state.status !== 'completed') job.segmentStates[item.index] = { status: 'downloading', attempt: state.attempt + 1 };
        }
      }
    } else if (event.type === 'cancelled') {
      for (const item of affected) {
        const state = job.segmentStates[item.index];
        if (state.status !== 'completed' && state.status !== 'failed') job.segmentStates[item.index] = { ...state, status: 'pending' };
      }
    } else if (event.type === 'failed') {
      for (const item of affected) {
        const state = job.segmentStates[item.index];
        if (state.status === 'completed') job.completedSegments = Math.max(0, job.completedSegments - 1);
        job.segmentStates[item.index] = { ...state, status: 'failed', code: event.code || 'MEDIA_REQUEST_FAILED' };
        job.failedSegments ||= [];
        if (!job.failedSegments.includes(item.index)) job.failedSegments.push(item.index);
      }
    } else if (event.type === 'error') {
      for (const item of affected) {
        const state = job.segmentStates[item.index];
        if (state.status !== 'completed') job.segmentStates[item.index] = { ...state, status: 'retrying' };
      }
    } else if (event.type === 'complete') {
      const record = recordCoverage(event.url, event);
      for (const item of items) {
        const needed = item.range || (Number(event.totalBytes) > 0 ? { start: 0, end: Number(event.totalBytes) - 1 } : null);
        const complete = record.full || (needed && record.ranges.some((range) => range.start <= needed.start && range.end >= needed.end));
        const state = job.segmentStates[item.index];
        if (complete && state.status !== 'completed') {
          job.segmentStates[item.index] = { ...state, status: 'completed' };
          job.completedSegments += 1;
        }
      }
    }
    job.updatedAt = now();
  }

  function updateRates() {
    const time = now();
    const sample = { time, bytes: Number(job.bytesDownloaded) || 0, seconds: outputSeconds };
    samples.push(sample);
    while (samples.length > 2 && samples[1].time < time - 5000) samples.shift();
    const elapsed = (time - samples[0].time) / 1000;
    if (elapsed > 0) {
      job.speedBps = Math.max(0, (sample.bytes - samples[0].bytes) / elapsed);
      const measuredFactor = Math.max(0, (sample.seconds - samples[0].seconds) / elapsed);
      const factor = realtimeFactor > 0 ? realtimeFactor : measuredFactor;
      const remaining = Math.max(0, durationSeconds - outputSeconds);
      job.etaSeconds = durationSeconds > 0 ? eta.update(remaining, factor) : null;
    }
  }

  function onFfmpegProgress(key, value) {
    if (key === 'total_size') {
      const bytes = Number(value);
      if (Number.isFinite(bytes) && bytes >= 0) job.bytesDownloaded = bytes;
    } else if (key === 'out_time_ms' || key === 'out_time_us') {
      const microseconds = Number(value);
      if (Number.isFinite(microseconds) && microseconds >= 0) {
        outputSeconds = microseconds / 1_000_000;
        if (durationSeconds > 0) job.progress = Math.max(Number(job.progress) || 0, Math.min(99, outputSeconds / durationSeconds * 100));
      }
    } else if (key === 'speed') {
      const factor = Number.parseFloat(value);
      realtimeFactor = Number.isFinite(factor) && factor > 0 ? factor : null;
    } else if (key === 'progress') {
      updateRates();
      if (value === 'end') { job.progress = 99; job.etaSeconds = 0; }
    }
    job.updatedAt = now();
  }

  return { onResourceEvent, onFfmpegProgress };
}

module.exports = { createNativeProgress, describeSegments };
