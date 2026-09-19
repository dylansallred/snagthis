const http = require('http');
const https = require('https');
const crypto = require('crypto');

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
            .then((value) => finish(null, value), (error) => finish(error));
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
async function startScopedMediaProxy({ rootUrl, headers = {}, sourcePageUrl, credentialOrigin } = {}) {
  const root = mediaUrl(rootUrl);
  const token = crypto.randomBytes(24).toString('hex');
  const resources = new Map();
  const ids = new Map();
  const controllers = new Set();
  const sockets = new Set();
  let baseUrl = '';
  let lastError = null;
  let closed = false;
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
  const rewriteManifest = (text, finalUrl) => {
    const info = require('./HlsNativeDownload').inspectHlsPlaylist(text, finalUrl);
    if (info.unsupportedReason) {
      const error = new Error(info.unsupportedReason);
      error.code = info.errorCode;
      throw error;
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
    const forwardedHeaders = { ...headers };
    // FFmpeg may request a byte range for an initialization section or segment.
    if (request.headers.range) forwardedHeaders.Range = request.headers.range;
    try {
      await requestMediaWithRedirects(remoteUrl, forwardedHeaders, async (upstream, finalUrl) => {
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
          const rewritten = Buffer.from(rewriteManifest(Buffer.concat(chunks).toString('utf8'), finalUrl));
          response.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Length': rewritten.length,
            'Cache-Control': 'no-store',
          });
          response.end(rewritten);
          return;
        }
        const responseHeaders = { 'Cache-Control': 'no-store' };
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          if (upstream.headers[name]) responseHeaders[name] = upstream.headers[name];
        }
        response.writeHead(upstream.statusCode, responseHeaders);
        const writeChunk = (chunk) => new Promise((resolve, reject) => {
          if (response.destroyed) { reject(new Error('Media client disconnected.')); return; }
          response.write(chunk, (error) => error ? reject(error) : resolve());
        });
        if (head.length) await writeChunk(head);
        for (let part = await iterator.next(); !part.done; part = await iterator.next()) {
          await writeChunk(part.value);
        }
        response.end();
      }, {
        credentialOrigin: credentialOrigin || root.origin,
        sourcePageUrl,
        timeoutMs: 30_000,
        signal: controller.signal,
      });
    } catch (error) {
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
  return {
    url: mapUrl(root.href),
    mapUrl,
    get lastError() { return lastError; },
    close: async () => {
      if (closed) return;
      closed = true;
      for (const controller of controllers) controller.abort();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { scopeMediaHeaders, requestMediaWithRedirects, startScopedMediaProxy };
