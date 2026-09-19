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
    // This upstream fork actually publishes both native executables. No Homebrew fallback.
    const release = 'https://github.com/descriptinc/ffmpeg-ffprobe-static/releases/download/b6.1.2-rc.1';
    return {
      urls: [`${release}/ffmpeg-darwin-${process.arch}`, `${release}/ffprobe-darwin-${process.arch}`],
      sourceUrl: `https://ffmpeg.org/releases/ffmpeg-${process.arch === 'arm64' ? '6.1.1' : '7.1'}.tar.xz`,
      buildSourceUrl: 'https://github.com/descriptinc/ffmpeg-ffprobe-static/tree/b6.1.2-rc.1/build',
      licenseUrl: `${release}/darwin-${process.arch}.LICENSE`,
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
      const explicitHash = process.env[index === 0 ? 'FFMPEG_SHA256' : 'FFPROBE_SHA256'];
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
    fs.writeFileSync(path.join(outputDir, 'ffmpeg-build.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Portable FFmpeg and ffprobe recorded in ${path.join(outputDir, 'ffmpeg-build.json')}`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(`[fetch-ffmpeg] ${error.message}`); process.exitCode = 1; });
