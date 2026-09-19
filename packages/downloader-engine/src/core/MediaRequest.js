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
    try { http.validateHeaderValue(key, value); } catch { continue; }
    scoped[key] = value;
  }
  if (context.sourcePageUrl) {
    try {
      const source = mediaUrl(context.sourcePageUrl);
      if (!scoped.referer) scoped.referer = source.href;
      if (!scoped.origin) scoped.origin = source.origin;
    } catch { /* Ignore invalid page metadata. */ }
  }
  // Node does not transparently decompress response bodies. Request plain media.
  scoped['accept-encoding'] = 'identity';
  return scoped;
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
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
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
    const run = (currentUrl, redirectsRemaining) => {
      if (settled) return;
      if (visited.has(currentUrl.href)) { finish(new Error('Redirect loop detected.')); return; }
      visited.add(currentUrl.href);
      const client = currentUrl.protocol === 'https:' ? https : http;
      const scopedHeaders = scopeMediaHeaders(headers, currentUrl.href, {
        credentialOrigin,
        sourcePageUrl: options.sourcePageUrl,
      });
      const activeRequest = client.get(currentUrl, { headers: scopedHeaders }, (response) => {
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
async function startScopedMediaProxy({ rootUrl, headers = {}, sourcePageUrl, credentialOrigin, onResourceEvent, pieceSpool, requiredPlaylistUrls = [] } = {}) {
  const root = mediaUrl(rootUrl);
  const token = crypto.randomBytes(24).toString('hex');
  const resources = new Map();
  const ids = new Map();
  const controllers = new Set();
  const sockets = new Set();
  let baseUrl = '';
  let lastError = null;
  let closed = false;
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
  const rewriteManifest = (text, finalUrl, requestedUrl) => {
    const info = require('./HlsNativeDownload').inspectHlsPlaylist(text, finalUrl);
    if (info.unsupportedReason) {
      const error = new Error(info.unsupportedReason);
      error.code = info.errorCode;
      throw error;
    }
    if (requiredTracks.has(requestedUrl)) {
      observedTracks.add(requestedUrl);
      // A selected rendition must supply every media URI/range. Initialization
      // and encryption-key requests are still validated by FFmpeg itself.
      const described = describeSegments(info, text, finalUrl);
      const pieces = described ? [...described.values()].flat()
        : info.segments.map(url => ({ url, range: null }));
      requiredPieces.set(requestedUrl, pieces);
    }
    return text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (!trimmed.startsWith('#')) return mapUrl(mediaUrl(trimmed, finalUrl).href);
      return line.replace(/\bURI="([^"]+)"/g, (_match, uri) => `URI="${mapUrl(mediaUrl(uri, finalUrl).href)}"`);
    }).join('\n');
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
    const consumer = request.headers['user-agent'] === 'VidSnag-Thumbnail/1.0' ? 'preview' : 'download';
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
    // FFmpeg may request a byte range for an initialization section or segment.
    if (request.headers.range) forwardedHeaders.Range = request.headers.range;
    try {
      await requestMediaWithRedirects(remoteUrl, forwardedHeaders, async (upstream, finalUrl) => {
        if (resourceEvent) {
          resourceEvent.finalUrl = finalUrl;
          resourceEvent.statusCode = upstream.statusCode;
        }
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
          const error = new Error(`Media request failed with status ${upstream.statusCode}.`);
          error.statusCode = upstream.statusCode;
          error.code = [401, 403, 410].includes(upstream.statusCode) ? 'LINK_EXPIRED' : 'MEDIA_REQUEST_FAILED';
          upstream.resume();
          throw error;
        }
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
        } else response.end();
      }, {
        credentialOrigin: credentialOrigin || root.origin,
        sourcePageUrl,
        timeoutMs: 30_000,
        signal: controller.signal,
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
            const error = new Error(`Video piece ${index + 1} could not be downloaded after ${state.attempt} attempt${state.attempt === 1 ? '' : 's'}.`);
            error.code = state.code || 'INCOMPLETE_HLS_DOWNLOAD';
            reportFatal(error);
          }
        },
        request: async (url, filePath, { signal, onBytes, onContentLength }) => {
          const event = { requestId: `fetch:${++requestSequence}`, consumer: 'download', url,
            finalUrl: url, statusCode: null, bytesTransferred: 0, contentLength: null,
            totalBytes: null, range: null, completeResource: false };
          notify({ ...event, type: 'start' });
          const pieceHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => !['range', 'if-range'].includes(key.toLowerCase())));
          let savedHeaders = {};
          await requestMediaWithRedirects(url, pieceHeaders, async (upstream, finalUrl) => {
            event.finalUrl = finalUrl;
            event.statusCode = upstream.statusCode;
            if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
              const error = new Error(`Media request failed with status ${upstream.statusCode}.`);
              error.statusCode = upstream.statusCode;
              error.code = [401, 403, 410].includes(upstream.statusCode) ? 'LINK_EXPIRED' : 'MEDIA_REQUEST_FAILED';
              upstream.resume();
              throw error;
            }
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
                onBytes(chunk.length);
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
          }, { credentialOrigin: credentialOrigin || root.origin, sourcePageUrl, timeoutMs: 30_000, signal });
          return { headers: savedHeaders, statusCode: 200, bytes: event.bytesTransferred };
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
    close: async () => {
      if (closed) return;
      closed = true;
      resolveFailure(null);
      for (const controller of controllers) controller.abort();
      for (const socket of sockets) socket.destroy();
      if (spool) await spool.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { scopeMediaHeaders, requestMediaWithRedirects, startScopedMediaProxy };
