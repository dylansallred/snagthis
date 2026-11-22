const fs = require('fs');
const http = require('http');
const https = require('https');
const { isHttpUrl } = require('./urls');

const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;

// Saves a poster or thumbnail next to a download. Never throws: every failure
// (bad URL, bad redirect, network, disk) resolves false. A malformed Location
// header used to throw inside the response callback and crash the server.
function downloadRemoteImage(url, destinationPath, redirectBudget = 3) {
  return new Promise((resolve) => {
    if (!isHttpUrl(url)) {
      resolve(false);
      return;
    }

    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const tempPath = `${destinationPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}.tmp`;
    let settled = false;
    let out = null;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const discard = () => fs.promises.unlink(tempPath).catch(() => {});
    const fail = () => {
      if (out) { out.destroy(); out = null; }
      discard().then(() => settle(false));
    };

    let req;
    try {
      req = client.get(url, {
        timeout: 12_000,
        headers: { 'User-Agent': 'SnagThis' },
      }, (res) => {
        const status = Number(res.statusCode || 0);
        if (status >= 300 && status < 400 && res.headers.location && redirectBudget > 0) {
          res.resume();
          let redirected = '';
          try {
            const nextUrl = new URL(String(res.headers.location), url);
            if (parsed.protocol === 'https:' && nextUrl.protocol !== 'https:') {
              settle(false);
              return;
            }
            redirected = nextUrl.toString();
          } catch {
            settle(false);
            return;
          }
          downloadRemoteImage(redirected, destinationPath, redirectBudget - 1).then(settle, () => settle(false));
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          settle(false);
          return;
        }

        out = fs.createWriteStream(tempPath);
        let bytes = 0;
        out.on('error', fail);
        res.on('error', fail);
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_REMOTE_IMAGE_BYTES) {
            res.destroy(new Error('Image exceeded size limit'));
          }
        });
        out.on('finish', () => {
          if (settled) return;
          fs.promises.rename(tempPath, destinationPath).then(
            () => settle(true),
            () => discard().then(() => settle(false)),
          );
        });
        res.pipe(out);
      });
    } catch {
      settle(false);
      return;
    }

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
  });
}

module.exports = { downloadRemoteImage };
