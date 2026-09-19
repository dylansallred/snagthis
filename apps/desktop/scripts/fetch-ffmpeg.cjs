const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const outputDir = path.resolve(__dirname, '../bin');
const isWindows = process.platform === 'win32';
const releaseBuild = process.env.VIDSNAG_RELEASE === '1';

function resolveDownloads() {
  const explicit = [process.env.FFMPEG_DOWNLOAD_URL, process.env.FFPROBE_DOWNLOAD_URL];
  if (explicit.some(Boolean)) {
    if (!explicit.every(Boolean) || !process.env.FFMPEG_SOURCE_URL) throw new Error('Custom tools require FFMPEG_DOWNLOAD_URL, FFPROBE_DOWNLOAD_URL and FFMPEG_SOURCE_URL');
    return { urls: explicit, sourceUrl: process.env.FFMPEG_SOURCE_URL, buildSourceUrl: process.env.FFMPEG_BUILD_SOURCE_URL || process.env.FFMPEG_SOURCE_URL };
  }
  if (!['x64', 'arm64'].includes(process.arch)) throw new Error(`Unsupported architecture: ${process.arch}. Supply explicit portable binaries and source URL.`);
  if (process.platform === 'darwin') {
    // These pinned macOS releases enable GPLv3 without the nonfree build flag.
    // Checksums are the publisher's per-archive .sha256 values, verified 2026-09-19.
    const arm64 = process.arch === 'arm64';
    const release = arm64
      ? 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1787073674_9.0.1'
      : 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1787081194_9.0.1';
    return {
      urls: [`${release}/ffmpeg.zip`, `${release}/ffprobe.zip`],
      sha256: arm64
        ? ['8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe', '102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a']
        : ['5bdead62ff504ab9b447cc72b212c4fb481e3f7de5877d427a51bee8136dda40', '34511bbcf1988ad2886023bf5ace4f44cf62e6defeb3d194d6f7619e5b061f7f'],
      sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
      buildSourceUrl: 'https://git.martin-riedl.de/ffmpeg/build-script/src/commit/f63b8aab8f5ce1a067da86ba69e34a36a7e217e5',
      versionsUrl: `${release}/versions.txt`,
      licenseUrl: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n9.0.1/COPYING.GPLv3',
    };
  }
  if (!['linux', 'win32'].includes(process.platform)) throw new Error(`No portable FFmpeg build configured for ${process.platform}`);
  const release = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-19-13-11';
  const arch = process.platform === 'linux' ? (process.arch === 'arm64' ? 'linuxarm64' : 'linux64') : (process.arch === 'arm64' ? 'winarm64' : 'win64');
  const file = `ffmpeg-n9.0.2-${arch}-gpl-9.0.${isWindows ? 'zip' : 'tar.xz'}`;
  return {
    urls: [`${release}/${file}`, `${release}/${file}`], checksumUrl: `${release}/checksums.sha256`,
    sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
    buildSourceUrl: 'https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-09-19-13-11',
  };
}

function download(url, destination, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (new URL(url).protocol !== 'https:') return reject(new Error('Tool downloads must use HTTPS'));
    const req = https.get(url, { headers: { 'User-Agent': 'VidSnag-Build/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        download(new URL(res.headers.location, url).href, destination, redirects - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Download returned HTTP ${res.statusCode}: ${url}`)); return; }
      const out = fs.createWriteStream(destination);
      out.on('error', reject);
      res.on('error', reject);
      out.on('finish', () => out.close(resolve));
      res.pipe(out);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('Tool download timed out')));
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesIn(path.join(directory, entry.name)) : entry.isFile() ? [path.join(directory, entry.name)] : []);
}

async function main() {
  const config = resolveDownloads();
  fs.mkdirSync(outputDir, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(outputDir, '.download-'));
  const manifest = { platform: process.platform, arch: process.arch, sourceUrl: config.sourceUrl, buildSourceUrl: config.buildSourceUrl, tools: {} };
  try {
    let checksums = '';
    if (config.checksumUrl) {
      const file = path.join(temporary, 'checksums.sha256');
      await download(config.checksumUrl, file);
      checksums = fs.readFileSync(file, 'utf8');
    }
    for (let index = 0; index < 2; index += 1) {
      const name = index === 0 ? 'ffmpeg' : 'ffprobe';
      const executable = name + (isWindows ? '.exe' : '');
      const url = config.urls[index];
      const reuseArchive = index === 1 && url === config.urls[0];
      const downloaded = path.join(temporary, reuseArchive ? 'download-0' : `download-${index}`);
      if (!reuseArchive) await download(url, downloaded);
      const archiveHash = sha256(downloaded);
      if (checksums) {
        const filename = new URL(url).pathname.split('/').pop();
        const expected = checksums.split(/\r?\n/).find(line => line.trim().split(/\s+/).pop()?.replace(/^\*/, '') === filename)?.split(/\s+/)[0];
        if (!expected || expected.toLowerCase() !== archiveHash) throw new Error(`Checksum mismatch for ${filename}`);
      }
      const explicitHash = process.env[index === 0 ? 'FFMPEG_SHA256' : 'FFPROBE_SHA256'] || config.sha256?.[index];
      if (explicitHash && explicitHash.toLowerCase() !== archiveHash) throw new Error(`${name} did not match its configured SHA256`);
      const destination = path.join(outputDir, executable);
      if (/\.(zip|tar\.xz|tgz|tar\.gz)(?:\?|$)/.test(url)) {
        const extracted = path.join(temporary, 'extracted');
        if (!reuseArchive) { fs.mkdirSync(extracted, { recursive: true }); run('tar', ['-xf', downloaded, '-C', extracted]); }
        const files = filesIn(extracted);
        const binary = files.find(file => path.basename(file) === executable);
        if (!binary) throw new Error(`Archive does not contain ${executable}`);
        fs.copyFileSync(binary, destination);
        const license = files.find(file => /^license(?:\.txt|\.md)?$/i.test(path.basename(file)));
        if (license) fs.copyFileSync(license, path.join(outputDir, 'FFMPEG-LICENSE.txt'));
      } else fs.copyFileSync(downloaded, destination);
      if (!isWindows) fs.chmodSync(destination, 0o755);
      const version = run(destination, ['-version']);
      const configuration = run(destination, ['-buildconf']);
      const license = run(destination, ['-L']);
      if (/--enable-nonfree|nonfree and unredistributable/i.test(configuration + license)) throw new Error(`${name} is a nonfree build and cannot be distributed with VidSnag`);
      if (releaseBuild && !/GNU (?:General|Lesser General) Public License/i.test(license)) throw new Error(`${name} did not report a recognized redistributable license`);
      if (process.platform === 'darwin') {
        const libraries = run('otool', ['-L', destination]).split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(Boolean);
        if (libraries.some(library => !library.startsWith('/usr/lib/') && !library.startsWith('/System/Library/'))) throw new Error(`${name} depends on external libraries and is not portable: ${libraries.join(', ')}`);
      }
      manifest.tools[name] = { downloadUrl: url, downloadSha256: archiveHash, sha256: sha256(destination), version, configuration, license };
    }
    if (config.licenseUrl) await download(config.licenseUrl, path.join(outputDir, 'FFMPEG-LICENSE.txt'));
    if (config.versionsUrl) {
      const versionsPath = path.join(outputDir, 'ffmpeg-upstream-versions.txt');
      await download(config.versionsUrl, versionsPath);
      manifest.upstreamVersionsUrl = config.versionsUrl;
      manifest.upstreamVersions = fs.readFileSync(versionsPath, 'utf8');
    }
    fs.writeFileSync(path.join(outputDir, 'ffmpeg-build.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Portable FFmpeg and ffprobe recorded in ${path.join(outputDir, 'ffmpeg-build.json')}`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(`[fetch-ffmpeg] ${error.message}`); process.exitCode = 1; });
