const fs = require('node:fs/promises');
const path = require('node:path');

function spoolError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedInteger(value, fallback, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(maximum, Math.floor(number))) : fallback;
}

// The request adapter must await onBytes(delta) before writing each chunk. A
// complete piece is published only after the adapter has closed its output file.
async function createNativePieceSpool(options = {}) {
  const { directory, request, onState, signal } = options;
  const segments = Array.isArray(options.segments) ? options.segments : [];
  if (!directory || typeof request !== 'function' || new Set(segments).size !== segments.length) {
    throw spoolError('A piece spool needs a directory, request adapter, and unique segment URLs.', 'INVALID_SPOOL_OPTIONS');
  }
  if (signal?.aborted) throw spoolError('Download cancelled.', 'ABORT_ERR');
  const concurrency = boundedInteger(options.concurrency, 4, 16);
  const maxAttempts = boundedInteger(options.maxAttempts, 30, 30);
  const maxSpoolBytes = boundedInteger(options.maxSpoolBytes, 512 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const maxPieceBytes = Math.min(maxSpoolBytes, boundedInteger(options.maxPieceBytes, 128 * 1024 * 1024, Number.MAX_SAFE_INTEGER));
  const admissionBytes = Math.min(maxPieceBytes, boundedInteger(options.admissionBytes, 64 * 1024, Number.MAX_SAFE_INTEGER));
  const lookahead = boundedInteger(options.lookahead, Math.max(4, concurrency * 2), Math.max(1, segments.length));
  // A CDN that answers the same 5xx body for the same piece again and again
  // (e.g. 502 "origin unavailable") has lost that object. Stop after a few
  // identical answers instead of spending the whole retry budget (~3.5 min).
  const identicalFailureLimit = boundedInteger(options.identicalFailureLimit, 4, 30);
  const retryDelay = typeof options.retryDelayMs === 'function' ? options.retryDelayMs
    : options.retryDelayMs === undefined ? (attempt) => Math.min(8000, 500 * (2 ** (attempt - 1)))
      : () => Math.max(0, Number(options.retryDelayMs) || 0);
  await fs.mkdir(directory, { recursive: true });
  const spoolDirectory = await fs.mkdtemp(path.join(directory, 'native-pieces-'));
  const records = segments.map((url, index) => ({
    url, index, status: 'pending', attempt: 0, bytes: 0, reserved: 0,
    retryAt: 0, controller: null, result: null, error: null, waiters: [], contentLength: null,
    failureSignature: null, identicalFailures: 0,
    partPath: path.join(spoolDirectory, `${index}.part`),
    filePath: path.join(spoolDirectory, `${index}.piece`),
  }));
  const byUrl = new Map(records.map((record) => [record.url, record]));
  const active = new Set();
  let head = 0;
  let reservedBytes = 0;
  let closed = false;
  let closePromise;
  let pumpPending = false;
  let retryTimer;
  let stoppedError = null;
  const budgetWaiters = new Set();

  function notify(record, status) {
    const message = record.error
      ? ['LINK_EXPIRED', 'SOURCE_EXPIRED'].includes(record.error.code)
        ? 'The video link expired. Open its page to refresh it.'
        : 'The video piece could not be downloaded.'
      : undefined;
    try { onState?.(record.index, { status, attempt: record.attempt, bytes: record.bytes, code: record.error?.code, statusCode: record.error?.statusCode, message }); } catch { /* Observers do not control delivery. */ }
  }

  function settleWaiters(record, error) {
    for (const waiter of record.waiters.splice(0)) {
      if (error) waiter.reject(error); else waiter.resolve(record.result);
    }
  }

  function reserve(record, bytes) {
    reservedBytes += bytes - record.reserved;
    record.reserved = bytes;
  }

  function firstUnfinished() {
    return records.slice(head, head + lookahead).find((record) => !['ready', 'released'].includes(record.status));
  }

  function canGrow(record, additionalBytes) {
    if (reservedBytes + additionalBytes > maxSpoolBytes) return false;
    const first = firstUnfinished();
    if (!first || first === record) return true;
    // Followers may use spare space, but the earliest unfinished piece must
    // always be able to finish even when its response has no Content-Length.
    const headroom = Math.max(0, maxPieceBytes - first.reserved);
    return reservedBytes + additionalBytes + headroom <= maxSpoolBytes;
  }

  function drainBudgetWaiters() {
    if (closed || stoppedError) return;
    for (const waiter of [...budgetWaiters].sort((left, right) => left.record.index - right.record.index)) {
      if (!canGrow(waiter.record, waiter.additionalBytes)) continue;
      budgetWaiters.delete(waiter);
      waiter.record.controller.signal.removeEventListener('abort', waiter.onAbort);
      reserve(waiter.record, waiter.record.reserved + waiter.additionalBytes);
      waiter.record.bytes += waiter.delta;
      waiter.resolve();
    }
  }

  function chargeBytes(record, delta) {
    const additionalBytes = Math.max(0, record.bytes + delta - record.reserved);
    if (!additionalBytes || canGrow(record, additionalBytes)) {
      reserve(record, record.reserved + additionalBytes);
      record.bytes += delta;
      return;
    }
    return new Promise((resolve, reject) => {
      const waiter = { record, delta, additionalBytes, resolve, reject, onAbort: null };
      waiter.onAbort = () => {
        budgetWaiters.delete(waiter);
        reject(spoolError('Download cancelled.', 'ABORT_ERR'));
      };
      budgetWaiters.add(waiter);
      record.controller.signal.addEventListener('abort', waiter.onAbort, { once: true });
      if (record.controller.signal.aborted) waiter.onAbort();
    });
  }

  function schedulePump() {
    if (closed || stoppedError || pumpPending) return;
    pumpPending = true;
    queueMicrotask(() => { pumpPending = false; pump(); });
  }

  async function run(record) {
    record.status = 'downloading';
    record.attempt += 1;
    record.bytes = 0;
    record.contentLength = null;
    record.controller = new AbortController();
    notify(record, 'downloading');
    try {
      const result = await request(record.url, record.partPath, {
        signal: record.controller.signal,
        onContentLength(length) {
          if (closed || record.controller.signal.aborted) throw spoolError('Download cancelled.', 'ABORT_ERR');
          if (!Number.isSafeInteger(length) || length < 0) return;
          if (length > maxPieceBytes) throw spoolError('A video piece exceeds the temporary download size limit.', 'SPOOL_PIECE_TOO_LARGE');
          if (length < record.bytes) throw spoolError('A video piece has inconsistent length metadata.', 'SPOOL_CONTENT_LENGTH_MISMATCH');
          record.contentLength = length;
          if (length <= record.reserved) { reserve(record, length); drainBudgetWaiters(); schedulePump(); }
        },
        onBytes(delta) {
          if (closed || record.controller.signal.aborted) throw spoolError('Download cancelled.', 'ABORT_ERR');
          if (!Number.isSafeInteger(delta) || delta < 0) throw spoolError('Invalid video-piece byte count.', 'SPOOL_BYTE_ACCOUNTING');
          if (record.bytes + delta > maxPieceBytes) throw spoolError('A video piece exceeds the temporary download size limit.', 'SPOOL_PIECE_TOO_LARGE');
          if (record.contentLength !== null && record.bytes + delta > record.contentLength) throw spoolError('A video piece exceeds its declared content length.', 'SPOOL_CONTENT_LENGTH_MISMATCH');
          // Returns undefined when admitted immediately; otherwise the adapter
          // must await capacity before writing these bytes to disk.
          return chargeBytes(record, delta);
        },
      });
      if (closed || record.controller.signal.aborted) throw spoolError('Download cancelled.', 'ABORT_ERR');
      const stat = await fs.stat(record.partPath);
      if (stat.size !== record.bytes) throw spoolError('Video-piece bytes were not accounted for before writing.', 'SPOOL_BYTE_ACCOUNTING');
      if (!stat.size) throw spoolError('The video server returned an empty piece.', 'EMPTY_MEDIA_PIECE');
      await fs.rename(record.partPath, record.filePath);
      reserve(record, stat.size);
      record.result = { filePath: record.filePath, headers: result?.headers || {}, statusCode: result?.statusCode || 200, bytes: stat.size };
      // Copy an optional local preview source before a consumer can release this piece.
      try { await options.onReady?.({ url: record.url, index: record.index, filePath: record.filePath, bytes: stat.size }); } catch { /* Preview failure must not fail the download. */ }
      record.status = 'ready';
      record.error = null;
      notify(record, 'ready');
      settleWaiters(record);
      drainBudgetWaiters();
    } catch (error) {
      await fs.rm(record.partPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }).catch(() => {});
      reserve(record, 0);
      record.bytes = 0;
      record.error = error;
      const status = Number(error.statusCode);
      const signature = status >= 500 && status <= 599 ? `${status}|${error.bodySample || ''}` : null;
      record.identicalFailures = signature && signature === record.failureSignature ? record.identicalFailures + 1 : signature ? 1 : 0;
      record.failureSignature = signature;
      if (signature && record.identicalFailures >= identicalFailureLimit) {
        error.code = 'PIECE_UNAVAILABLE';
        error.message = `Video piece ${record.index + 1} is unavailable from the source (status ${status}).`;
      }
      const permanent = ['SPOOL_PIECE_TOO_LARGE', 'SPOOL_CONTENT_LENGTH_MISMATCH', 'SPOOL_BYTE_ACCOUNTING',
        'LINK_EXPIRED', 'SOURCE_EXPIRED', 'INSECURE_REDIRECT', 'INVALID_MEDIA_URL', 'NATIVE_PIECE_TOO_LARGE', 'PIECE_UNAVAILABLE'].includes(error.code);
      if (closed || stoppedError || permanent || record.attempt >= maxAttempts) {
        const cancelled = closed || (stoppedError && record.controller.signal.aborted);
        record.status = cancelled ? 'cancelled' : 'failed';
        if (cancelled) record.error = spoolError('Download cancelled.', 'ABORT_ERR');
        notify(record, record.status);
        if (!closed && !stoppedError) {
          stoppedError = error;
          clearTimeout(retryTimer);
          // Once a required piece is terminally unavailable, do not keep
          // fetching unrelated pieces or repeatedly retry expired credentials.
          for (const other of records) {
            if (other !== record) other.controller?.abort(error);
            settleWaiters(other, error);
          }
        } else settleWaiters(record, stoppedError || error);
      } else {
        record.status = 'retrying';
        // A server-announced Retry-After (429/503) overrides a shorter backoff.
        const announced = Number(error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
        record.retryAt = Date.now() + Math.max(announced, Math.max(0, Number(retryDelay(record.attempt)) || 0));
        notify(record, 'retrying');
      }
      if (!closed && !stoppedError) drainBudgetWaiters();
    } finally {
      record.controller = null;
    }
  }

  function pump() {
    if (closed || stoppedError) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    const window = records.slice(head, head + lookahead);
    while (active.size < concurrency) {
      // A broken early piece must not occupy a worker while untouched pieces
      // inside this bounded lookahead window can still make progress.
      let next = window.find((record) => record.status === 'pending')
        || window.find((record) => record.status === 'retrying' && record.retryAt <= Date.now());
      if (!next) break;
      const first = firstUnfinished();
      if (next !== first && ['pending', 'retrying'].includes(first?.status)
        && (!canGrow(next, admissionBytes) || (admissionBytes < maxPieceBytes && active.size >= concurrency - 1))) {
        // Keep both byte capacity and one worker for a missing head's retry;
        // otherwise every worker could end up waiting on follower growth.
        next = first.status === 'pending' || first.retryAt <= Date.now() ? first : null;
        if (!next) break;
      }
      if (!canGrow(next, admissionBytes)) break;
      reserve(next, admissionBytes);
      const task = run(next);
      active.add(task);
      task.finally(() => { active.delete(task); schedulePump(); });
    }
    const delayed = window.filter((record) => record.status === 'retrying' && record.retryAt > Date.now());
    if (delayed.length && active.size < concurrency) {
      retryTimer = setTimeout(schedulePump, Math.max(1, Math.min(...delayed.map((record) => record.retryAt)) - Date.now()));
    }
  }

  function get(url) {
    if (stoppedError) return Promise.reject(stoppedError);
    if (closed) return Promise.reject(spoolError('Download cancelled.', 'ABORT_ERR'));
    const record = byUrl.get(url);
    if (!record) return Promise.reject(spoolError('This resource is not a registered video piece.', 'UNKNOWN_MEDIA_PIECE'));
    if (record.status === 'released') return Promise.reject(spoolError('This video piece has already been consumed.', 'SPOOL_PIECE_RELEASED'));
    if (record.status === 'failed') return Promise.reject(record.error);
    if (record.status === 'ready') return Promise.resolve(record.result);
    return new Promise((resolve, reject) => { record.waiters.push({ resolve, reject }); schedulePump(); });
  }

  async function release(url) {
    const record = byUrl.get(url);
    if (!record || record.status === 'released' || closed) return;
    if (record.status !== 'ready') throw spoolError('A video piece cannot be released before it is ready.', 'SPOOL_PIECE_NOT_READY');
    await fs.rm(record.filePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
    reserve(record, 0);
    record.bytes = 0;
    record.result = null;
    record.status = 'released';
    while (records[head]?.status === 'released') head += 1;
    drainBudgetWaiters();
    schedulePump();
  }

  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    clearTimeout(retryTimer);
    signal?.removeEventListener('abort', onAbort);
    const error = spoolError('Download cancelled.', 'ABORT_ERR');
    for (const record of records) {
      record.controller?.abort(error);
      settleWaiters(record, error);
    }
    closePromise = (async () => {
      await Promise.allSettled([...active]);
      await fs.rm(spoolDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 });
      reservedBytes = 0;
      for (const record of records) { record.bytes = 0; record.reserved = 0; record.result = null; }
    })();
    return closePromise;
  }

  const onAbort = () => { void close().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) await close(); else schedulePump();
  return {
    get, release, close,
    stats: () => ({
      directory: spoolDirectory, active: active.size, reservedBytes,
      bytes: records.reduce((total, record) => total + record.bytes, 0),
      head, windowEnd: Math.min(records.length, head + lookahead),
      ready: records.filter((record) => record.status === 'ready').length,
      failed: records.filter((record) => record.status === 'failed').length,
      waitingForBytes: budgetWaiters.size,
      closed,
    }),
  };
}

module.exports = { createNativePieceSpool };
