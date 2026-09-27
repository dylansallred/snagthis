const fs = require('fs');
const http = require('http');
const https = require('https');
const { isHttpUrl } = require('./urls');

// Saves a poster or thumbnail next to a download. Never throws: every failure
// (bad URL, bad redirect, network, disk) resolves false. A malformed Location
// header used to throw inside the response callback and crash the server.
function downloadRemoteImage(url, destinationPath, redirectBudget = 3) {
  return new Promise((resolve) => {
    if (!isHttpUrl(url)) {
      resolve(false);
      return;
    }

    const client = new URL(url).protocol === 'https:' ? https : http;
    const tempPath = `${destinationPath}.tmp`;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const discard = () => fs.promises.unlink(tempPath).catch(() => {});

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
            redirected = new URL(String(res.headers.location), url).toString();
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

        const out = fs.createWriteStream(tempPath);
        out.on('error', () => { discard().then(() => settle(false)); });
        res.on('error', () => { out.destroy(); discard().then(() => settle(false)); });
        out.on('finish', () => {
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
    req.on('error', () => settle(false));
  });
}

module.exports = { downloadRemoteImage };
