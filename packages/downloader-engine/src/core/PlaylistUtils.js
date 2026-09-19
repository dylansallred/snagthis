const http = require('http');
const https = require('https');
const { URL } = require('url');

function getClient(url) {
  return url.startsWith('https') ? https : http;
}

// Media requests preserve browser context without forwarding credentials to another origin.
const { requestMediaWithRedirects } = require('./MediaRequest');
const requestWithRedirects = requestMediaWithRedirects;

async function fetchText(url, headers, options = {}) {
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
        if (data.length > 5 * 1024 * 1024) {
          res.destroy(new Error('Playlist exceeds the supported size'));
        }
      });
      res.on('end', () => resolve({ text: data, finalUrl, contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
  }, { timeoutMs: 30_000, ...options });
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
