const http = require('http');
const https = require('https');
const { URL } = require('url');
const logger = require('../utils/logger');

function getClient(url) {
  return url.startsWith('https') ? https : http;
}

function isRedirectResponse(res) {
  const status = Number(res && res.statusCode || 0);
  return status >= 300 && status < 400 && !!(res && res.headers && res.headers.location);
}

function resolveRedirectUrl(location, currentUrl) {
  return new URL(String(location || ''), currentUrl).toString();
}

function detectNetworkBlockRedirect(nextUrl) {
  try {
    const parsed = new URL(String(nextUrl || ''));
    const host = String(parsed.hostname || '').toLowerCase();
    const path = String(parsed.pathname || '');
    if (
      host.includes('hosted.cujo.io')
      || host.includes('cujo.io')
      || path === '/warn.html'
    ) {
      return {
        blocked: true,
        host,
      };
    }
  } catch {
    return { blocked: false, host: '' };
  }

  return { blocked: false, host: '' };
}

function shouldRetryAsHttp(error, currentUrl) {
  if (!String(currentUrl || '').toLowerCase().startsWith('https://')) return false;
  const code = String(error && error.code || '').trim().toUpperCase();
  const message = String(error && error.message || '');
  return code === 'EPROTO' || /WRONG_VERSION_NUMBER/i.test(message);
}

function downgradeToHttp(currentUrl) {
  const parsed = new URL(currentUrl);
  parsed.protocol = 'http:';
  return parsed.toString();
}

async function requestWithRedirects(url, headers, onResponse, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0);
  const maxRedirects = Number.isFinite(Number(options.maxRedirects))
    ? Math.max(0, Math.floor(Number(options.maxRedirects)))
    : 5;
  const visited = new Set();
  const allowHttpDowngradeFallback = options.allowHttpDowngradeFallback !== false;

  return new Promise((resolve, reject) => {
    let settled = false;

    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const run = (currentUrl, redirectsRemaining, downgradeAttempted = false) => {
      if (visited.has(currentUrl)) {
        settleReject(new Error('Redirect loop detected'));
        return;
      }
      visited.add(currentUrl);

      const client = getClient(currentUrl);
      const req = client.get(currentUrl, { headers }, (res) => {
        if (isRedirectResponse(res)) {
          if (redirectsRemaining <= 0) {
            res.resume();
            settleReject(new Error('Too many redirects'));
            return;
          }

          let nextUrl = '';
          try {
            nextUrl = resolveRedirectUrl(res.headers.location, currentUrl);
          } catch (err) {
            res.resume();
            settleReject(err);
            return;
          }

          const networkBlock = detectNetworkBlockRedirect(nextUrl);
          if (networkBlock.blocked) {
            res.resume();
            settleReject(new Error(
              `Network security filter blocked media request via redirect to ${networkBlock.host}. Disable the filter, whitelist the host, or use a different network/VPN.`
            ));
            return;
          }

          res.resume();
          run(nextUrl, redirectsRemaining - 1);
          return;
        }

        Promise.resolve(onResponse(res, currentUrl, req)).then(settleResolve, settleReject);
      });

      req.on('error', (error) => {
        if (
          allowHttpDowngradeFallback
          && !downgradeAttempted
          && shouldRetryAsHttp(error, currentUrl)
        ) {
          let downgradedUrl = '';
          try {
            downgradedUrl = downgradeToHttp(currentUrl);
          } catch {
            settleReject(error);
            return;
          }

          if (!visited.has(downgradedUrl)) {
            logger.warn('HTTPS request failed with TLS protocol error; retrying as HTTP', {
              fromUrl: currentUrl,
              toUrl: downgradedUrl,
              error: String(error && error.message || error || ''),
            });
            run(downgradedUrl, redirectsRemaining, true);
            return;
          }
        }

        settleReject(error);
      });
      if (timeoutMs > 0) {
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Request timeout after ${timeoutMs} ms`));
        });
      }
    };

    run(url, maxRedirects);
  });
}

async function fetchText(url, headers) {
  return requestWithRedirects(url, headers, (res, finalUrl) => {
    return new Promise((resolve, reject) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`Request failed with status ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve({ text: data, finalUrl }));
      res.on('error', reject);
    });
  }, { timeoutMs: 30_000 });
}

function parseM3U8(playlistText, playlistUrl) {
  const lines = playlistText.split(/\r?\n/);
  const urls = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const u = new URL(trimmed, playlistUrl);
      urls.push(u.toString());
    } catch {
      // ignore malformed lines
    }
  }
  return urls;
}

module.exports = {
  getClient,
  requestWithRedirects,
  fetchText,
  parseM3U8,
};
