const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');

// The one place the bundled yt-dlp is chosen: version and the publisher's
// SHA2-256SUMS values for each asset. Release verification and the
// corresponding-source packet read the same file.
const PIN_FILE = path.join(__dirname, 'yt-dlp-release.json');
const outputDir = path.resolve(__dirname, '../bin');

function readPin() {
  return JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
}

function assetFor(platform, arch) {
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp';
  throw new Error(`Unsupported platform for bundled yt-dlp: ${platform}`);
}

function resolveDownload({ platform = process.platform, arch = process.arch, env = process.env, pin = readPin() } = {}) {
  const explicitUrl = String(env.YTDLP_DOWNLOAD_URL || '').trim();
  if (explicitUrl) {
    const sha256 = String(env.YTDLP_SHA256 || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('A custom YTDLP_DOWNLOAD_URL requires its YTDLP_SHA256');
    return { url: explicitUrl, sha256, version: null };
  }
  const asset = assetFor(platform, arch);
  const sha256 = String(pin.assets?.[asset] || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`No pinned SHA-256 for ${asset} in ${path.basename(PIN_FILE)}`);
  return {
    url: `https://github.com/yt-dlp/yt-dlp/releases/download/${encodeURIComponent(pin.version)}/${asset}`,
    sha256,
    version: pin.version,
  };
}

function download(url, destination, redirects = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error(`Invalid download URL: ${url}`)); return; }
    if (parsed.protocol !== 'https:') { reject(new Error('Tool downloads must use HTTPS')); return; }
    const req = https.get(url, { headers: { 'User-Agent': 'SnagThis-Build/1.0' } }, (res) => {
      const status = Number(res.statusCode || 0);
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        let next;
        try { next = new URL(String(res.headers.location), url).href; } catch { reject(new Error('Invalid redirect while downloading yt-dlp')); return; }
        download(next, destination, redirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { res.resume(); reject(new Error(`Download returned HTTP ${status}: ${url}`)); return; }
      const out = fs.createWriteStream(destination);
      out.on('error', reject);
      res.on('error', reject);
      out.on('finish', () => out.close(resolve));
      res.pipe(out);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('Timed out downloading yt-dlp')));
  });
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Moves a verified download into place; a mismatch never replaces the binary.
function installVerified(downloaded, destination, expectedSha256) {
  const actual = sha256File(downloaded);
  if (actual !== expectedSha256) {
    fs.rmSync(downloaded, { force: true });
    throw new Error(`yt-dlp did not match its pinned SHA-256 (expected ${expectedSha256}, got ${actual})`);
  }
  if (process.platform !== 'win32') fs.chmodSync(downloaded, 0o755);
  fs.renameSync(downloaded, destination);
  return actual;
}

async function main() {
  const { url, sha256, version } = resolveDownload();
  const outputName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const destination = path.join(outputDir, outputName);
  fs.mkdirSync(outputDir, { recursive: true });
  const temporary = `${destination}.download`;
  console.log(`[fetch-yt-dlp] Downloading ${version ? `yt-dlp ${version}` : 'custom yt-dlp'} from ${url}`);
  try {
    await download(url, temporary);
    installVerified(temporary, destination, sha256);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  console.log(`[fetch-yt-dlp] Verified SHA-256 ${sha256} and saved ${destination}`);
}

module.exports = { PIN_FILE, readPin, assetFor, resolveDownload, installVerified };

if (require.main === module) {
  main().catch((error) => {
    console.error(`[fetch-yt-dlp] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
