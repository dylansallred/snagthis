const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { createNativePieceSpool } = require('./NativePieceSpool');
const { describeSegments } = require('./NativeProgress');

// Headers needed for media delivery can cross a CDN boundary. Everything else,
// including cookies and site-specific token headers, stays on its original origin.
const CROSS_ORIGIN_HEADERS = new Set([
  'accept', 'accept-language', 'user-agent', 'referer', 'origin',
  'range', 'if-range', 'cache-control', 'pragma',
]);
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

function mediaUrl(value, base) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    const error = new Error('Media URLs must use HTTP or HTTPS without embedded credentials.');
    error.code = 'INVALID_MEDIA_URL';
    throw error;
  }
  return url;
}

function scopeMediaHeaders(headers = {}, targetUrl, context = {}) {
  const target = mediaUrl(targetUrl);
  let credentialOrigin = '';
  try {
    credentialOrigin = mediaUrl(context.credentialOrigin || context.mediaUrl || targetUrl).origin;
  } catch { /* An invalid credential origin must not receive credentials. */ }
  const sameOrigin = target.origin === credentialOrigin;
  const scoped = {};
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = String(rawKey || '').trim().toLowerCase();
    const value = String(rawValue == null ? '' : rawValue).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || !value || /[\r\n]/.test(value)) continue;
    if (HOP_BY_HOP_HEADERS.has(key) || (!sameOrigin && !CROSS_ORIGIN_HEADERS.has(key))) continue;
    // CORS preflight headers describe an OPTIONS request, never a media GET.
    if (key.startsWith('access-control-request-')) continue;
    try { http.validateHeaderValue(key, value); } catch { continue; }
    scoped[key] = value;
  }
  if (context.sourcePageUrl) {
    try {
      const source = mediaUrl(context.sourcePageUrl);
      // Browsers send Referer on media requests but Origin only on CORS
      // requests: forward an observed Origin, never invent one.
      if (!scoped.referer) scoped.referer = source.href;
    } catch { /* Ignore invalid page metadata. */ }
  }
  if (context.reduced) {
    // A 403 fallback: first drop Origin; without one, drop Referer instead.
    if (scoped.origin) delete scoped.origin;
    else delete scoped.referer;
  }
  // Node does not transparently decompress response bodies. Request plain media.
  scoped['accept-encoding'] = 'identity';
  return scoped;
}

const MAX_RETRY_AFTER_MS = 10_000;

// Retry-After is either delta-seconds or an HTTP date. Returns milliseconds.
function parseRetryAfter(value, now = Date.now()) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

// A failed media response, with enough of its body to recognise a CDN that
// deterministically answers the same error ("origin unavailable") every time.
async function upstreamError(upstream) {
  const error = new Error(`Media request failed with status ${upstream.statusCode}.`);
  error.statusCode = upstream.statusCode;
  error.code = [401, 403, 410].includes(upstream.statusCode) ? 'LINK_EXPIRED' : 'MEDIA_REQUEST_FAILED';
  const retryAfter = parseRetryAfter(upstream.headers['retry-after']);
  if (retryAfter !== null) error.retryAfterMs = Math.min(MAX_RETRY_AFTER_MS * 6, retryAfter);
  let sample = '';
  try {
    for await (const chunk of upstream) {
      sample += Buffer.from(chunk).toString('utf8');
      if (sample.length >= 200) break;
    }
  } catch { /* The body is only a fingerprint. */ }
  upstream.destroy();
  error.bodySample = sample.slice(0, 200).replace(/\s+/g, ' ').trim();
  return error;
}

function hasReducibleHeaders(headers = {}, sourcePageUrl) {
  const keys = Object.keys(headers || {}).map((key) => key.toLowerCase());
  return keys.includes('origin') || keys.includes('referer') || Boolean(sourcePageUrl);
}

function requestMediaWithRedirects(url, headers, onResponse, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
  const maxRedirects = Number.isFinite(Number(options.maxRedirects))
    ? Math.max(0, Math.floor(Number(options.maxRedirects))) : 5;
  let initial;
  try { initial = mediaUrl(url); } catch (error) { return Promise.reject(error); }
  const credentialOrigin = options.credentialOrigin || initial.origin;
  const visited = new Set();

  return new Promise((resolve, reject) => {
    let settled = false;
    let currentRequest;
    let retryTimer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(retryTimer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onAbort = () => {
      const error = new Error('Media request cancelled.');
      error.code = 'ABORT_ERR';
      if (currentRequest) currentRequest.destroy(error);
      finish(error);
    };
    if (options.signal) {
      if (options.signal.aborted) { onAbort(); return; }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    // Shared per-host memory: once a reduced header set was needed, later
    // requests of the same job go straight to it instead of doubling each one.
    const headerPolicy = options.headerPolicy instanceof Map ? options.headerPolicy : new Map();
    const maxRetryAfterMs = Number.isFinite(Number(options.maxRetryAfterMs)) ? Math.max(0, Number(options.maxRetryAfterMs)) : MAX_RETRY_AFTER_MS;
    const retryState = { reducedTried: false, waits: 0 };
    const run = (currentUrl, redirectsRemaining, repeat = false) => {
      if (settled) return;
      if (!repeat && visited.has(currentUrl.href)) { finish(new Error('Redirect loop detected.')); return; }
      visited.add(currentUrl.href);
      const client = currentUrl.protocol === 'https:' ? https : http;
      const reduced = headerPolicy.get(currentUrl.host) === 'reduced';
      const scopedHeaders = scopeMediaHeaders(headers, currentUrl.href, {
        credentialOrigin,
        sourcePageUrl: options.sourcePageUrl,
        reduced,
      });
      const activeRequest = client.get(currentUrl, { headers: scopedHeaders }, (response) => {
        if (response.statusCode === 403 && !reduced && !retryState.reducedTried && options.reduceHeadersOn403 !== false
          && hasReducibleHeaders(headers, options.sourcePageUrl)) {
          // Some CDNs refuse a request whose Origin/Referer differs from what
          // they expect. Retry once with fewer page headers; a second 403 stands.
          retryState.reducedTried = true;
          response.resume();
          headerPolicy.set(currentUrl.host, 'reduced');
          run(currentUrl, redirectsRemaining, true);
          return;
        }
        if ([429, 503].includes(response.statusCode) && retryState.waits < 2 && options.honorRetryAfter !== false) {
          const retryAfter = parseRetryAfter(response.headers['retry-after']);
          const waitMs = retryAfter ?? (response.statusCode === 429 ? 1000 : null);
          if (waitMs !== null && waitMs <= maxRetryAfterMs) {
            retryState.waits += 1;
            response.resume();
            retryTimer = setTimeout(() => run(currentUrl, redirectsRemaining, true), waitMs);
            return;
          }
        }
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirectsRemaining <= 0) { finish(new Error('Too many redirects.')); return; }
          let nextUrl;
          try {
            nextUrl = mediaUrl(response.headers.location, currentUrl);
            if (currentUrl.protocol === 'https:' && nextUrl.protocol === 'http:') {
              const error = new Error('The media server redirected a secure request to insecure HTTP.');
              error.code = 'INSECURE_REDIRECT';
              throw error;
            }
          } catch (error) { finish(error); return; }
          run(nextUrl, redirectsRemaining - 1);
          return;
        }
        try {
          Promise.resolve(onResponse(response, currentUrl.href, activeRequest))
            .then((value) => finish(null, value), (error) => { response.destroy(); finish(error); });
        } catch (error) {
          response.destroy();
          finish(error);
        }
      });
      currentRequest = activeRequest;
      activeRequest.on('error', (error) => finish(error));
      if (timeoutMs) {
        activeRequest.setTimeout(timeoutMs, () => {
          const error = new Error(`Media request timed out after ${timeoutMs} ms.`);
          error.code = 'ETIMEDOUT';
          activeRequest.destroy(error);
        });
      }
    };
    run(initial, maxRedirects);
  });
}

// FFmpeg applies -headers to every child HLS request. This short-lived loopback
// relay keeps all credentials in Node, where each redirect, key and segment can
// be scoped independently. Only resources registered from a playlist are served.
async function startScopedMediaProxy({ rootUrl, headers = {}, sourcePageUrl, credentialOrigin, onResourceEvent, onTransferStart, onLocalResource, localResourceUrls = [], pieceSpool, requiredPlaylistUrls = [], playlistSnapshots = {}, headerPolicy = new Map() } = {}) {
  const root = mediaUrl(rootUrl);
  const token = crypto.randomBytes(24).toString('hex');
  const resources = new Map();
  const ids = new Map();
  const controllers = new Set();
  const sockets = new Set();
  let baseUrl = '';
  let lastError = null;
  let closed = false;
  let closingPromise;
  let requestSequence = 0;
  let spool = null;
  let fatalError = null;
  let resolveFailure;
  const failure = new Promise(resolve => { resolveFailure = resolve; });
  const requiredTracks = new Set(requiredPlaylistUrls.map(url => mediaUrl(url).href));
  const observedTracks = new Set();
  const requiredPieces = new Map();
  const deliveredRanges = new Map();
  const spooledUrls = new Set(pieceSpool?.segments || []);
  const reportFatal = (error) => {
    if (closed || fatalError) return;
    fatalError = error;
    lastError = error;
    resolveFailure(error);
  };
  const notify = (event) => {
    if (typeof onResourceEvent !== 'function') return;
    try { onResourceEvent(event); } catch { /* Observers must not interrupt delivery. */ }
  };
  const recordDelivered = (url, { completeResource, range, totalBytes }) => {
    const record = deliveredRanges.get(url) || { full: false, ranges: [], totalBytes: null };
    record.full ||= completeResource === true;
    if (Number.isSafeInteger(totalBytes) && totalBytes > 0) record.totalBytes = totalBytes;
    if (range) {
      record.ranges.push({ start: range.start, end: range.end });
      record.ranges.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const item of record.ranges) {
        const previous = merged[merged.length - 1];
        if (previous && item.start <= previous.end + 1) previous.end = Math.max(previous.end, item.end);
        else merged.push(item);
      }
      record.ranges = merged;
    }
    if (record.totalBytes && record.ranges.some(item => item.start === 0 && item.end + 1 >= record.totalBytes)) record.full = true;
    deliveredRanges.set(url, record);
    return record;
  };
  const mapUrl = (remoteUrl) => {
    const resolved = mediaUrl(remoteUrl, root).href;
    let id = ids.get(resolved);
    if (!id) {
      id = String(ids.size + 1);
      ids.set(resolved, id);
      resources.set(id, resolved);
    }
    // Keep the extension for FFmpeg's HLS demuxer and content-type fallback.
    const extension = new URL(resolved).pathname.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || '.bin';
    return `${baseUrl}/${token}/${id}${extension}`;
  };
  // Byte-range pieces of single-file renditions (arte.tv CMAF) are exposed to
  // FFmpeg as separate resources. FFmpeg 9 otherwise opens one request from a
  // piece to the end of a multi-gigabyte file and a bounded job never ends.
  const pieceOf = new Map();
  const mapPieceUrl = (remoteUrl, range) => {
    const resolved = mediaUrl(remoteUrl, root).href;
    const key = `${range.start}-${range.end} ${resolved}`;
    let id = ids.get(key);
    if (!id) {
      id = String(ids.size + 1);
      ids.set(key, id);
      resources.set(id, resolved);
      pieceOf.set(id, { start: range.start, end: range.end });
    }
    const extension = new URL(resolved).pathname.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || '.bin';
    return `${baseUrl}/${token}/${id}${extension}`;
  };
  const rewriteManifest = (text, finalUrl, requestedUrl) => {
    const info = require('./HlsNativeDownload').inspectHlsPlaylist(text, finalUrl);
    if (info.unsupportedReason) {
      const error = new Error(info.unsupportedReason);
      error.code = info.errorCode;
      throw error;
    }
    const described = describeSegments(info, text, finalUrl);
    const rangeByIndex = [];
    if (described && info.hasByteRange) for (const items of described.values()) for (const item of items) rangeByIndex[item.index] = item.range;
    const splitPieces = described && info.hasByteRange;
    if (requiredTracks.has(requestedUrl)) {
      observedTracks.add(requestedUrl);
      // A selected rendition must supply every media URI/range. Initialization
      // and encryption-key requests are still validated by FFmpeg itself.
      const pieces = described ? [...described.values()].flat()
        : info.segments.map(url => ({ url, range: null }));
      requiredPieces.set(requestedUrl, pieces);
    }
    let segmentIndex = -1;
    return text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!trimmed.startsWith('#')) {
        segmentIndex += 1;
        const url = mediaUrl(trimmed, finalUrl).href;
        return splitPieces && rangeByIndex[segmentIndex] ? mapPieceUrl(url, rangeByIndex[segmentIndex]) : mapUrl(url);
      }
      if (splitPieces && /^#EXT-X-BYTERANGE:/i.test(trimmed)) return null;
      if (splitPieces && /^#EXT-X-MAP:/i.test(trimmed)) {
        const range = trimmed.match(/\bBYTERANGE="(\d+)@(\d+)"/i);
        if (range && Number(range[1]) > 0) {
          const start = Number(range[2]);
          return line.replace(/,?\s*BYTERANGE="[^"]*"/i, '')
            .replace(/\bURI="([^"]+)"/, (_match, uri) => `URI="${mapPieceUrl(mediaUrl(uri, finalUrl).href, { start, end: start + Number(range[1]) - 1 })}"`);
        }
      }
      return line.replace(/\bURI="([^"]+)"/g, (_match, uri) => `URI="${mapUrl(mediaUrl(uri, finalUrl).href)}"`);
    }).filter((line) => line !== null).join('\n');
  };
  // One declared byte range of a larger resource, served as a whole file.
  const servePiece = async (request, response, controller, remoteUrl, piece, consumer) => {
    const length = piece.end - piece.start + 1;
    const requested = String(request.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
    const relativeStart = requested ? Number(requested[1]) : 0;
    const relativeEnd = requested && requested[2] ? Math.min(Number(requested[2]), length - 1) : length - 1;
    if (relativeStart > relativeEnd) {
      response.writeHead(416, { 'Content-Range': `bytes */${length}` }).end();
      controllers.delete(controller);
      return;
    }
    const upstreamStart = piece.start + relativeStart;
    const upstreamEnd = piece.start + relativeEnd;
    const expected = upstreamEnd - upstreamStart + 1;
    const event = { requestId: String(++requestSequence), consumer, url: remoteUrl, finalUrl: remoteUrl, statusCode: null,
      bytesTransferred: 0, contentLength: expected, totalBytes: null, range: { start: upstreamStart, end: upstreamEnd, total: null },
      requestedRange: request.headers.range || null, completeResource: false };
    let endTransfer;
    try {
      await requestMediaWithRedirects(remoteUrl, { ...headers, Range: `bytes=${upstreamStart}-${upstreamEnd}` }, async (upstream, finalUrl) => {
        event.finalUrl = finalUrl;
        event.statusCode = upstream.statusCode;
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) throw await upstreamError(upstream);
        // A server that ignores Range sends the whole resource: skip to the piece.
        const answered = String(upstream.headers['content-range'] || '').match(/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/i);
        let skip = upstream.statusCode === 206 && answered ? upstreamStart - Number(answered[1]) : upstream.statusCode === 200 ? upstreamStart : -1;
        if (skip < 0) {
          const error = new Error('The media server returned a different part of the video.');
          error.code = 'INCOMPLETE_MEDIA_RESPONSE';
          throw error;
        }
        if (consumer === 'download') endTransfer = onTransferStart?.();
        response.writeHead(requested ? 206 : 200, {
          'Content-Type': upstream.headers['content-type'] || 'application/octet-stream', 'Content-Length': expected,
          'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
          ...(requested ? { 'Content-Range': `bytes ${relativeStart}-${relativeEnd}/${length}` } : {}),
        });
        notify({ ...event, type: 'start', bytesDelta: 0 });
        for await (let chunk of upstream) {
          if (skip) {
            const dropped = Math.min(skip, chunk.length);
            skip -= dropped;
            chunk = chunk.subarray(dropped);
          }
          const part = chunk.subarray(0, expected - event.bytesTransferred);
          if (part.length) {
            if (response.destroyed) throw Object.assign(new Error('Media client disconnected.'), { code: 'ECONNRESET' });
            if (!response.write(part)) await new Promise((resolve) => response.once('drain', resolve));
            event.bytesTransferred += part.length;
            notify({ ...event, type: 'progress', bytesDelta: part.length });
          }
          if (event.bytesTransferred >= expected) { upstream.destroy(); break; }
        }
        if (event.bytesTransferred !== expected) {
          const error = new Error('Media response ended before the requested resource was complete.');
          error.code = 'INCOMPLETE_MEDIA_RESPONSE';
          throw error;
        }
        await new Promise((resolve) => response.end(resolve));
        if (consumer === 'download') recordDelivered(remoteUrl, { completeResource: false, range: event.range });
        notify({ ...event, type: 'complete', bytesDelta: 0 });
      }, { credentialOrigin: credentialOrigin || root.origin, sourcePageUrl, timeoutMs: 30_000, signal: controller.signal, headerPolicy });
    } catch (error) {
      notify({ ...event, type: 'error', bytesDelta: 0, code: error.code || 'MEDIA_REQUEST_FAILED' });
      if (!['ABORT_ERR', 'EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes(error.code)) lastError = error;
      if (!response.headersSent && !response.destroyed) response.writeHead(502, { 'Content-Type': 'text/plain' }).end('The media request failed.');
      else if (!response.destroyed) response.destroy();
    } finally {
      endTransfer?.();
      controllers.delete(controller);
    }
  };
  const server = http.createServer(async (request, response) => {
    const match = String(request.url || '').match(new RegExp(`^/${token}/(\\d+)(?:\\.[a-zA-Z0-9]{1,8})?$`));
    const remoteUrl = match && resources.get(match[1]);
    if (closed || request.method !== 'GET' || !remoteUrl) {
      response.writeHead(404).end();
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    response.on('close', () => { if (!response.writableFinished) controller.abort(); });
    const consumer = request.headers['user-agent'] === 'SnagThis-Thumbnail/1.0' ? 'preview' : 'download';
    const piece = pieceOf.get(match[1]);
    if (piece) {
      await servePiece(request, response, controller, remoteUrl, piece, consumer);
      return;
    }
    const snapshot = Object.hasOwn(playlistSnapshots, remoteUrl) ? playlistSnapshots[remoteUrl] : null;
    if (snapshot) {
      // A playlist the page received from a POST or blob cannot be fetched
      // again; serve the text the page itself played, resolved to its URL.
      try {
        const rewritten = Buffer.from(rewriteManifest(snapshot, remoteUrl, remoteUrl));
        response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': rewritten.length, 'Cache-Control': 'no-store' });
        response.end(rewritten);
      } catch (error) {
        lastError = error;
        if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain' }).end('The media playlist is unsupported.');
      } finally { controllers.delete(controller); }
      return;
    }
    if (spool && spooledUrls.has(remoteUrl) && consumer === 'download') {
      try {
        const piece = await spool.get(remoteUrl);
        if (response.destroyed) return;
        let start = 0;
        let end = piece.bytes - 1;
        const requestedRange = String(request.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
        if (request.headers.range && !requestedRange) {
          response.writeHead(416, { 'Content-Range': `bytes */${piece.bytes}` }).end();
          return;
        }
        if (requestedRange) {
          start = Number(requestedRange[1]);
          end = requestedRange[2] ? Math.min(Number(requestedRange[2]), end) : end;
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
          response.writeHead(416, { 'Content-Range': `bytes */${piece.bytes}` }).end();
          return;
        }
        const responseHeaders = {
          'Content-Type': piece.headers?.['content-type'] || 'application/octet-stream',
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        };
        if (requestedRange) responseHeaders['Content-Range'] = `bytes ${start}-${end}/${piece.bytes}`;
        response.writeHead(requestedRange ? 206 : 200, responseHeaders);
        await pipeline(fs.createReadStream(piece.filePath, { start, end }), response);
        const completeResource = start === 0 && end + 1 === piece.bytes;
        const delivered = recordDelivered(remoteUrl, { completeResource, range: { start, end }, totalBytes: piece.bytes });
        if (delivered.full) await spool.release(remoteUrl);
      } catch (error) {
        if (!response.headersSent && !response.destroyed) response.writeHead(502).end('The media piece could not be downloaded.');
        else if (!response.destroyed) response.destroy();
        if (!controller.signal.aborted) lastError = error;
      } finally { controllers.delete(controller); }
      return;
    }
    const resourceEvent = {
      requestId: String(++requestSequence),
      consumer,
      url: remoteUrl,
      finalUrl: remoteUrl,
      statusCode: null,
      bytesTransferred: 0,
      contentLength: null,
      totalBytes: null,
      range: null,
      requestedRange: request.headers.range || null,
      completeResource: false,
    };
    const emitResourceEvent = (type, extra = {}) => {
      notify({ ...resourceEvent, type, bytesDelta: 0, ...extra });
    };
    const forwardedHeaders = { ...headers };
    let endTransfer;
    let localChunks = consumer === 'download' && localResourceUrls.includes(remoteUrl) && onLocalResource ? [] : null;
    let localBytes = 0;
    // FFmpeg may request a byte range for an initialization section or segment.
    if (request.headers.range) forwardedHeaders.Range = request.headers.range;
    try {
      await requestMediaWithRedirects(remoteUrl, forwardedHeaders, async (upstream, finalUrl) => {
        if (resourceEvent) {
          resourceEvent.finalUrl = finalUrl;
          resourceEvent.statusCode = upstream.statusCode;
        }
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) throw await upstreamError(upstream);
        const maxManifestBytes = 5 * 1024 * 1024;
        const iterator = upstream[Symbol.asyncIterator]();
        const headChunks = [];
        let headLength = 0;
        for (let part = await iterator.next(); !part.done; part = await iterator.next()) {
          headChunks.push(Buffer.from(part.value));
          headLength += part.value.length;
          if (headLength >= 256) break;
        }
        const head = Buffer.concat(headChunks);
        const contentType = String(upstream.headers['content-type'] || '');
        const isManifest = /mpegurl/i.test(contentType)
          || /\.m3u8$/i.test(new URL(finalUrl).pathname)
          || /^\uFEFF?\s*#EXTM3U/.test(head.subarray(0, 256).toString('utf8'));
        if (isManifest) {
          const chunks = [head];
          let size = head.length;
          if (size > maxManifestBytes) throw new Error('The media playlist is too large.');
          for (let part = await iterator.next(); !part.done; part = await iterator.next()) {
            size += part.value.length;
            if (size > maxManifestBytes) { upstream.destroy(); throw new Error('The media playlist is too large.'); }
            chunks.push(Buffer.from(part.value));
          }
          const rewritten = Buffer.from(rewriteManifest(Buffer.concat(chunks).toString('utf8'), finalUrl, remoteUrl));
          response.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Length': rewritten.length,
            'Cache-Control': 'no-store',
          });
          response.end(rewritten);
          return;
        }
        const responseHeaders = { 'Cache-Control': 'no-store' };
        if (consumer === 'download' && !spool) endTransfer = onTransferStart?.();
        if (consumer === 'download' && requiredTracks.has(remoteUrl)) {
          observedTracks.add(remoteUrl);
          requiredPieces.set(remoteUrl, [{ url: remoteUrl, range: null }]);
        }
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          if (upstream.headers[name]) responseHeaders[name] = upstream.headers[name];
        }
        if (resourceEvent) {
          const lengthHeader = String(upstream.headers['content-length'] || '');
          const contentLength = /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
          resourceEvent.contentLength = Number.isSafeInteger(contentLength) ? contentLength : null;
          const rangeMatch = String(upstream.headers['content-range'] || '').match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
          if (upstream.statusCode === 206 && rangeMatch) {
            const start = Number(rangeMatch[1]);
            const end = Number(rangeMatch[2]);
            const total = rangeMatch[3] === '*' ? null : Number(rangeMatch[3]);
            if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start
              && (total === null || (Number.isSafeInteger(total) && total > end))) {
              resourceEvent.range = { start, end, total };
              resourceEvent.totalBytes = total;
            }
          } else if (upstream.statusCode === 200) {
            resourceEvent.totalBytes = resourceEvent.contentLength;
          }
          emitResourceEvent('start');
        }
        response.writeHead(upstream.statusCode, responseHeaders);
        const writeChunk = (chunk) => new Promise((resolve, reject) => {
          if (response.destroyed) { reject(new Error('Media client disconnected.')); return; }
          if (localChunks) {
            localBytes += chunk.length;
            if (localBytes <= 2 * 1024 * 1024) localChunks.push(Buffer.from(chunk));
            else localChunks = null;
          }
          response.write(chunk, (error) => {
            if (error) { reject(error); return; }
            if (resourceEvent) {
              resourceEvent.bytesTransferred += chunk.length;
              emitResourceEvent('progress', { bytesDelta: chunk.length });
            }
            resolve();
          });
        });
        if (head.length) await writeChunk(head);
        for (let part = await iterator.next(); !part.done; part = await iterator.next()) {
          await writeChunk(part.value);
        }
        if (resourceEvent) {
          // EOF alone is insufficient: FFmpeg can abandon a request while its
          // final bytes are still being written. Only count a finished response.
          await new Promise((resolve, reject) => {
            const finish = (error) => {
              response.removeListener('finish', onFinish);
              response.removeListener('close', onClose);
              response.removeListener('error', onError);
              if (error) reject(error); else resolve();
            };
            const onFinish = () => finish();
            const onClose = () => {
              if (response.writableFinished) { finish(); return; }
              const error = new Error('Media client disconnected before the resource finished.');
              error.code = 'ECONNRESET';
              finish(error);
            };
            const onError = (error) => finish(error);
            response.once('finish', onFinish);
            response.once('close', onClose);
            response.once('error', onError);
            if (response.destroyed) onClose(); else response.end();
          });
          const { range, bytesTransferred, contentLength, statusCode } = resourceEvent;
          const expectedBytes = range ? range.end - range.start + 1 : contentLength;
          if (expectedBytes !== null && bytesTransferred !== expectedBytes) {
            const error = new Error('Media response ended before the requested resource was complete.');
            error.code = 'INCOMPLETE_MEDIA_RESPONSE';
            throw error;
          }
          resourceEvent.completeResource = statusCode === 200
            || (range !== null && range.start === 0 && range.total !== null && range.end + 1 === range.total);
          if (consumer === 'download') recordDelivered(remoteUrl, resourceEvent);
          emitResourceEvent('complete');
          if (localChunks && resourceEvent.completeResource) {
            try { await onLocalResource(remoteUrl, Buffer.concat(localChunks)); } catch { /* Local preview is optional. */ }
          }
        } else response.end();
      }, {
        credentialOrigin: credentialOrigin || root.origin,
        sourcePageUrl,
        timeoutMs: 30_000,
        signal: controller.signal,
        headerPolicy,
      });
    } catch (error) {
      emitResourceEvent('error', { code: error.code || 'MEDIA_REQUEST_FAILED' });
      // FFmpeg closes surplus inputs when probing or stopping. A downstream
      // disconnect must not hide its actual demuxing/selection error.
      if (!['ABORT_ERR', 'EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes(error.code)) lastError = error;
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(502, { 'Content-Type': 'text/plain' }).end('The media request failed.');
      } else if (!response.destroyed) response.destroy();
    } finally {
      endTransfer?.();
      controllers.delete(controller);
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (pieceSpool && spooledUrls.size) {
    try {
      spool = await createNativePieceSpool({
        ...pieceSpool,
        onState(index, state) {
          if (state.status === 'cancelled') {
            notify({ type: 'cancelled', consumer: 'download', url: pieceSpool.segments[index] });
            return;
          }
          if (state.status === 'ready') {
            notify({ type: 'complete', consumer: 'download', requestId: `spool:${index}:${state.attempt}`,
              url: pieceSpool.segments[index], bytesTransferred: state.bytes, totalBytes: state.bytes,
              completeResource: true });
            return;
          }
          if (state.status !== 'retrying' && state.status !== 'failed') return;
          const url = pieceSpool.segments[index];
          notify({ type: state.status === 'failed' ? 'failed' : 'error', consumer: 'download',
            requestId: `spool:${index}:${state.attempt}`, url, attempt: state.attempt, code: state.code });
          if (state.status === 'failed') {
            const status = Number(state.statusCode) > 0 ? ` (status ${state.statusCode})` : '';
            const error = new Error(state.code === 'PIECE_UNAVAILABLE'
              ? `Video piece ${index + 1} is unavailable from the source${status}.`
              : `Video piece ${index + 1} could not be downloaded after ${state.attempt} attempt${state.attempt === 1 ? '' : 's'}${status}.`);
            error.code = state.code || 'INCOMPLETE_HLS_DOWNLOAD';
            if (Number(state.statusCode) > 0) error.statusCode = Number(state.statusCode);
            error.pieceIndex = index;
            reportFatal(error);
          }
        },
        request: async (url, filePath, { signal, onBytes, onContentLength }) => {
          const endTransfer = onTransferStart?.();
          try {
          const event = { requestId: `fetch:${++requestSequence}`, consumer: 'download', url,
            finalUrl: url, statusCode: null, bytesTransferred: 0, contentLength: null,
            totalBytes: null, range: null, completeResource: false };
          notify({ ...event, type: 'start' });
          const pieceHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => !['range', 'if-range'].includes(key.toLowerCase())));
          let savedHeaders = {};
          await requestMediaWithRedirects(url, pieceHeaders, async (upstream, finalUrl) => {
            event.finalUrl = finalUrl;
            event.statusCode = upstream.statusCode;
            if (upstream.statusCode < 200 || upstream.statusCode >= 300) throw await upstreamError(upstream);
            const rawLength = String(upstream.headers['content-length'] || '');
            const contentLength = /^\d+$/.test(rawLength) ? Number(rawLength) : null;
            event.contentLength = Number.isSafeInteger(contentLength) ? contentLength : null;
            event.totalBytes = event.contentLength;
            if (upstream.statusCode === 206) {
              const range = String(upstream.headers['content-range'] || '').match(/^bytes 0-(\d+)\/(\d+)$/);
              if (!range || Number(range[1]) + 1 !== Number(range[2])) {
                upstream.destroy();
                const error = new Error('The media server returned only part of a video piece.');
                error.code = 'INCOMPLETE_MEDIA_RESPONSE';
                throw error;
              }
            }
            if (event.contentLength !== null) onContentLength(event.contentLength);
            savedHeaders = { 'content-type': upstream.headers['content-type'] || 'application/octet-stream' };
            await pipeline(upstream, async function* (source) {
              for await (const chunk of source) {
                await onBytes(chunk.length);
                event.bytesTransferred += chunk.length;
                notify({ ...event, type: 'progress', bytesDelta: chunk.length });
                yield chunk;
              }
            }, fs.createWriteStream(filePath, { flags: 'wx' }), { signal });
            if (event.contentLength !== null && event.bytesTransferred !== event.contentLength) {
              const error = new Error('The media response ended before the video piece was complete.');
              error.code = 'INCOMPLETE_MEDIA_RESPONSE';
              throw error;
            }
          }, { credentialOrigin: credentialOrigin || root.origin, sourcePageUrl, timeoutMs: 30_000, signal, headerPolicy });
          return { headers: savedHeaders, statusCode: 200, bytes: event.bytesTransferred };
          } finally { endTransfer?.(); }
        },
      });
    } catch (error) {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      throw error;
    }
  }
  return {
    url: mapUrl(root.href),
    mapUrl,
    get lastError() { return lastError; },
    get fatalError() { return fatalError; },
    failure,
    assertComplete() {
      if (fatalError) throw fatalError;
      let missing = 0;
      for (const track of requiredTracks) {
        if (!observedTracks.has(track)) { missing += 1; continue; }
        for (const piece of requiredPieces.get(track) || []) {
          const delivered = deliveredRanges.get(piece.url);
          if (!delivered?.full && !(piece.range && delivered?.ranges.some(range => range.start <= piece.range.start && range.end >= piece.range.end))) missing += 1;
        }
      }
      if (missing) {
        const error = new Error(`The video is incomplete: ${missing} required media piece${missing === 1 ? '' : 's'} could not be delivered. Try refreshing the source and retrying.`);
        error.code = 'INCOMPLETE_HLS_DOWNLOAD';
        throw error;
      }
    },
    close: () => {
      if (closingPromise) return closingPromise;
      closed = true;
      resolveFailure(null);
      for (const controller of controllers) controller.abort();
      for (const socket of sockets) socket.destroy();
      closingPromise = (async () => {
        if (spool) await spool.close();
        await new Promise((resolve) => server.close(resolve));
      })();
      return closingPromise;
    },
  };
}

module.exports = { scopeMediaHeaders, requestMediaWithRedirects, startScopedMediaProxy, parseRetryAfter };
