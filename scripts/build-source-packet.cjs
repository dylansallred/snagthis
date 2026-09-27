#!/usr/bin/env node
// Builds the corresponding-source packet for the FFmpeg/ffprobe and yt-dlp
// executables bundled by apps/desktop/scripts/fetch-*.cjs, plus the exact
// SnagThis source. Output (gitignored):
//   work/source-packet/release-source/snagthis-corresponding-source.tar.xz
//   work/source-packet/release-source/corresponding-source.json
// See docs/release-guide.md, "Prepare the corresponding-source packet".
//
// Usage:
//   node scripts/build-source-packet.cjs --tag vX.Y.Z [--ref <git-ref>] \
//     [--reports DIR] [--platforms darwin-arm64,darwin-x64,win32-x64] [--out DIR]
//
// PINS must describe the exact builds fetch-ffmpeg.cjs/fetch-yt-dlp.cjs download.
// When a pin changes there, update it here; the script refuses to run when the
// fetch scripts no longer contain the pinned identifiers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64'];

const PINS = {
  mac: {
    // https://ffmpeg.martin-riedl.de builds, made by the provider's published build script.
    buildScriptRepo: 'https://git.martin-riedl.de/ffmpeg/build-script.git',
    buildScriptCommit: 'f63b8aab8f5ce1a067da86ba69e34a36a7e217e5',
    ffmpegVersion: '9.0.1',
    builds: {
      arm64: {
        release: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1787073674_9.0.1',
        sha256: ['8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe', '102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a'],
      },
      x64: {
        release: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1787081194_9.0.1',
        sha256: ['5bdead62ff504ab9b447cc72b212c4fb481e3f7de5877d427a51bee8136dda40', '34511bbcf1988ad2886023bf5ace4f44cf62e6defeb3d194d6f7619e5b061f7f'],
      },
    },
    // The build script downloads x264 "master" without recording a revision, and
    // the binaries report no x264 revision. x264 master has been at this commit
    // since 2025-09-10, before both builds (2026-08-18), so it is the source used.
    x264Commit: '0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee',
    // Bitbucket's generated 4.2 tarball; its top directory names this commit.
    x265Commit: 'e444744c0397',
    versionLines: {
      ffmpeg: 'ffmpeg version 9.0.1-https://www.martin-riedl.de Copyright (c) 2000-2026 the FFmpeg developers',
      ffprobe: 'ffprobe version 9.0.1-https://www.martin-riedl.de Copyright (c) 2007-2026 the FFmpeg developers',
    },
  },
  win: {
    repo: 'https://github.com/BtbN/FFmpeg-Builds.git',
    tag: 'autobuild-2026-09-19-13-11',
    commit: '3e6685eda92f9288c15ac320139622dcedca09a4',
    target: 'win64', variant: 'gpl', addin: '9.0',
    zip: 'ffmpeg-n9.0.2-win64-gpl-9.0.zip',
    ffmpegTag: 'n9.0.2',
    ffmpegVersion: '9.0.2',
    // Only used to run BtbN's own source-download commands (git, cargo vendor).
    baseImage: 'ghcr.io/btbn/ffmpeg-builds/base@sha256:4536b0bd39a109b7c0f142feef8977c47de7e392e6c23f779ca6cbfa3da4657f',
    versionLines: {
      ffmpeg: 'ffmpeg version n9.0.2-20260919 Copyright (c) 2000-2026 the FFmpeg developers',
      ffprobe: 'ffprobe version n9.0.2-20260919 Copyright (c) 2007-2026 the FFmpeg developers',
    },
  },
  ytdlp: {
    version: '2026.08.19',
    commit: '3a08beaf031ab68f966401ead017ac81fe8486cf',
    pyinstallerBuildsTag: '2026.08.19.215425',
    // Requirement files used by yt-dlp's macOS and Windows x64 release jobs.
    requirementFiles: ['default.txt', 'curl-cffi.txt', 'macos.txt', 'macos-curl_cffi.txt', 'pyinstaller.txt', 'win-x64-pyinstaller.txt'],
  },
};

// Libraries the macOS build script compiles and links (build tools such as nasm,
// cmake, ninja and pkg-config are not linked and are documented instead).
// {v} is the version from the build script's version/<versionFile>.
const MAC_LIBRARIES = [
  ['aom', 'https://storage.googleapis.com/aom-releases/libaom-{v}.tar.gz'],
  ['dav1d', 'https://code.videolan.org/videolan/dav1d/-/archive/{v}/dav1d-{v}.tar.gz'],
  ['fontconfig', 'https://gitlab.freedesktop.org/api/v4/projects/890/packages/generic/fontconfig/{v}/fontconfig-{v}.tar.xz'],
  ['freetype', 'https://download.savannah.gnu.org/releases/freetype/freetype-{v}.tar.gz', { fallback: 'https://sourceforge.net/projects/freetype/files/freetype2/{v}/freetype-{v}.tar.gz/download' }],
  ['fribidi', 'https://github.com/fribidi/fribidi/releases/download/v{v}/fribidi-{v}.tar.xz'],
  ['harfbuzz', 'https://github.com/harfbuzz/harfbuzz/releases/download/{v}/harfbuzz-{v}.tar.xz'],
  ['lame', 'https://sourceforge.net/projects/lame/files/lame/{v}/lame-{v}.tar.gz/download'],
  ['libass', 'https://github.com/libass/libass/releases/download/{v}/libass-{v}.tar.gz'],
  ['libbluray', 'https://download.videolan.org/pub/videolan/libbluray/{v}/libbluray-{v}.tar.xz'],
  ['libklvanc', 'https://github.com/stoth68000/libklvanc/archive/refs/tags/vid.obe.{v}.tar.gz'],
  ['libogg', 'https://ftp.osuosl.org/pub/xiph/releases/ogg/libogg-{v}.tar.gz'],
  ['libtheora', 'https://downloads.xiph.org/releases/theora/libtheora-{v}.tar.gz'],
  ['libvmaf', 'https://github.com/Netflix/vmaf/archive/refs/tags/v{v}.tar.gz'],
  ['libvorbis', 'https://ftp.osuosl.org/pub/xiph/releases/vorbis/libvorbis-{v}.tar.gz'],
  ['libwebp', 'https://github.com/webmproject/libwebp/archive/refs/tags/v{v}.tar.gz'],
  ['libxml2', 'https://download.gnome.org/sources/libxml2/{mm}/libxml2-{v}.tar.xz'],
  ['openh264', 'https://github.com/cisco/openh264/archive/v{v}.tar.gz'],
  ['openjpeg', 'https://github.com/uclouvain/openjpeg/archive/refs/tags/v{v}.tar.gz'],
  ['openssl', 'https://github.com/openssl/openssl/releases/download/openssl-{v}/openssl-{v}.tar.gz', { checksumUrl: 'https://github.com/openssl/openssl/releases/download/openssl-{v}/openssl-{v}.tar.gz.sha256' }],
  ['opus', 'https://downloads.xiph.org/releases/opus/opus-{v}.tar.gz'],
  ['rav1e', 'https://github.com/xiph/rav1e/archive/refs/tags/v{v}.tar.gz'],
  ['sdl', 'https://www.libsdl.org/release/SDL2-{v}.tar.gz'],
  ['snappy', 'https://github.com/google/snappy/archive/refs/tags/{v}.tar.gz'],
  ['srt', 'https://github.com/Haivision/srt/archive/refs/tags/v{v}.tar.gz'],
  ['svt-av1', 'https://gitlab.com/AOMediaCodec/SVT-AV1/-/archive/v{v}/SVT-AV1-v{v}.tar.gz'],
  ['vpx', 'https://github.com/webmproject/libvpx/archive/v{v}.tar.gz'],
  ['vvenc', 'https://github.com/fraunhoferhhi/vvenc/archive/refs/tags/v{v}.tar.gz'],
  ['x264', `https://code.videolan.org/videolan/x264/-/archive/${PINS.mac.x264Commit}/x264-${PINS.mac.x264Commit}.tar.gz`, { version: PINS.mac.x264Commit }],
  ['x265', 'https://bitbucket.org/multicoreware/x265_git/get/{v}.tar.gz', { topDirIncludes: PINS.mac.x265Commit }],
  ['zimg', 'https://github.com/sekrit-twc/zimg/archive/refs/tags/release-{v}.tar.gz'],
  ['zlib', 'https://www.zlib.net/fossils/zlib-{v}.tar.gz'],
  ['zvbi', 'https://sourceforge.net/projects/zapping/files/zvbi/{v}/zvbi-{v}.tar.bz2/download'],
];

// ---------------------------------------------------------------- pure helpers

function parseArgs(argv) {
  const options = { platforms: PLATFORMS.slice(), out: path.join(root, 'work/source-packet') };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => { const next = argv[++index]; if (!next || next.startsWith('--')) throw new Error(`${flag} needs a value`); return next; };
    if (flag === '--tag') options.tag = value();
    else if (flag === '--ref') options.ref = value();
    else if (flag === '--reports') options.reports = path.resolve(value());
    else if (flag === '--out') options.out = path.resolve(value());
    else if (flag === '--platforms') options.platforms = value().split(',').map(item => item.trim()).filter(Boolean);
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(options.tag || '')) throw new Error('--tag vX.Y.Z is required');
  const unknown = options.platforms.filter(item => !PLATFORMS.includes(item));
  if (unknown.length || !options.platforms.length) throw new Error(`--platforms must be a subset of ${PLATFORMS.join(',')}`);
  return options;
}

// Returns [{ name, version, hashes }] from a pip-compile requirements file.
// Direct URL requirements ("name @ https://...") are returned with a url.
function parseRequirementPins(text) {
  const pins = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const pinned = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;\\]+)/.exec(line);
    const direct = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*@\s*(https:\/\/\S+)/.exec(line);
    if (pinned) pins.push(current = { name: pinned[1], version: pinned[2], hashes: [] });
    else if (direct) pins.push(current = { name: direct[1], url: direct[2], hashes: [] });
    else if (current && /^--hash=sha256:[a-f0-9]{64}/.test(line)) current.hashes.push(line.slice('--hash=sha256:'.length, '--hash=sha256:'.length + 64));
    else if (!line.startsWith('#') && !line.startsWith('--hash')) current = null;
  }
  return pins;
}

// Picks the licence files of a source archive from its entry listing: files
// named COPYING*/LICENSE*/LICENCE*/COPYRIGHT*/[L]GPL-x.txt in the archive's top directory
// (or the one below it), falling back to one more level.
function pickLicenseEntries(entries) {
  const files = entries.map(entry => entry.replace(/^\.\//, '')).filter(entry => entry && !entry.endsWith('/'));
  const isLicense = entry => /^(copying|licen[cs]e|copyright|unlicense)([._-].*)?$|^(a|l)?gpl[-_.]?v?\d[\d.]*(\.txt|\.md)?$/i.test(path.posix.basename(entry));
  const depthOf = entry => entry.split('/').length;
  const candidates = files.filter(isLicense);
  if (!candidates.length) return [];
  const minimum = Math.min(...candidates.map(depthOf));
  const shallow = candidates.filter(entry => depthOf(entry) <= Math.max(minimum, 2));
  return shallow.sort();
}

// Verifies the pins above still describe what the fetch scripts download.
function checkFetchScriptPins(ffmpegScript, ytdlpScript, pins = PINS) {
  const problems = [];
  const warnings = [];
  const requireText = (text, needle, what) => { if (!text.includes(needle)) problems.push(`fetch-ffmpeg.cjs no longer pins ${what} (${needle})`); };
  for (const [arch, build] of Object.entries(pins.mac.builds)) {
    requireText(ffmpegScript, build.release, `the macOS ${arch} build`);
    for (const hash of build.sha256) requireText(ffmpegScript, hash, `the macOS ${arch} checksum`);
  }
  requireText(ffmpegScript, pins.mac.buildScriptCommit, 'the macOS build-script commit');
  requireText(ffmpegScript, `releases/download/${pins.win.tag}`, 'the BtbN release');
  requireText(ffmpegScript, `ffmpeg-${pins.win.ffmpegTag}-`, 'the BtbN FFmpeg revision');
  requireText(ffmpegScript, `-gpl-${pins.win.addin}.`, 'the BtbN GPL 9.0 variant');
  const pinned = [...ytdlpScript.matchAll(/yt-dlp\/releases\/download\/([0-9.]+)\//g)].map(match => match[1]);
  const versions = [...new Set([...pinned, ...[...ytdlpScript.matchAll(/['"`](\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)['"`]/g)].map(match => match[1])])];
  if (versions.length) {
    if (versions.some(version => version !== pins.ytdlp.version)) problems.push(`fetch-yt-dlp.cjs pins yt-dlp ${versions.join(', ')} but this packet pins ${pins.ytdlp.version}`);
  } else if (/releases\/latest\//.test(ytdlpScript)) {
    warnings.push(`fetch-yt-dlp.cjs downloads the latest yt-dlp; this packet covers ${pins.ytdlp.version}. Pin that version before releasing or update PINS.ytdlp.`);
  } else problems.push('Cannot determine which yt-dlp version fetch-yt-dlp.cjs downloads');
  return { problems, warnings };
}

// Reads release-verification-*.json reports (as downloaded from the release run)
// and checks that each describes the pinned builds. Returns version lines by platform.
function readReports(directory, pins = PINS) {
  const found = {};
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : /^release-verification-.*\.json$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
  for (const file of walk(directory)) {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = `${report.platform}-${report.arch}`;
    const tools = report.ffmpeg?.tools || {};
    if (report.platform === 'darwin') {
      const build = pins.mac.builds[report.arch];
      if (!build || tools.ffmpeg?.downloadSha256 !== build.sha256[0] || tools.ffprobe?.downloadSha256 !== build.sha256[1]) throw new Error(`${path.basename(file)} does not describe the pinned macOS ${report.arch} FFmpeg build`);
    } else if (report.platform === 'win32') {
      if (!String(tools.ffmpeg?.downloadUrl || '').endsWith(`/${pins.win.tag}/${pins.win.zip}`)) throw new Error(`${path.basename(file)} does not describe the pinned BtbN build`);
    }
    if (report.ytdlp?.version !== pins.ytdlp.version) throw new Error(`${path.basename(file)} bundles yt-dlp ${report.ytdlp?.version}, but PINS.ytdlp is ${pins.ytdlp.version}`);
    found[key] = { report, file, lines: { ffmpeg: tools.ffmpeg.version.split('\n')[0], ffprobe: tools.ffprobe.version.split('\n')[0], 'yt-dlp': report.ytdlp.version } };
  }
  return found;
}

function expectedVersionLines(platform, reports) {
  if (reports?.[platform]) return reports[platform].lines;
  const lines = platform.startsWith('darwin') ? PINS.mac.versionLines : PINS.win.versionLines;
  return { ffmpeg: lines.ffmpeg, ffprobe: lines.ffprobe, 'yt-dlp': PINS.ytdlp.version };
}

function buildManifest({ tag, commit, archiveSha256, components, platforms, macComponentIds, winComponentIds, ytdlpComponentIds, reports }) {
  const builds = platforms.map(platform => {
    const [os, arch] = platform.split('-');
    const lines = expectedVersionLines(platform, reports);
    const ffmpegComponents = os === 'darwin' ? macComponentIds : winComponentIds;
    return {
      platform: os, arch, tools: {
        ffmpeg: { version: lines.ffmpeg, components: ffmpegComponents },
        ffprobe: { version: lines.ffprobe, components: ffmpegComponents },
        'yt-dlp': { version: lines['yt-dlp'], components: ytdlpComponentIds },
      },
    };
  });
  return { releaseTag: tag, sourceCommit: commit, archiveSha256, components, builds };
}

// --------------------------------------------------------------- side effects

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return String(result.stdout || '');
}
function log(message) { console.log(`[source-packet] ${message}`); }
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(8 * 1024 * 1024);
  try { let read; while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read)); } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
// Downloads are kept in <out>/cache/files so reruns only re-copy them.
let downloadCache = null;
function download(url, destination) {
  const cached = downloadCache ? path.join(downloadCache, `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}-${path.basename(destination)}`) : destination;
  if (!fs.existsSync(cached) || fs.statSync(cached).size === 0) {
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    run('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '3', '--max-time', '1800', '-A', 'SnagThis-SourcePacket/1.0', '-o', `${cached}.part`, url]);
    fs.renameSync(`${cached}.part`, cached);
  }
  if (cached !== destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(cached, destination);
  }
  return destination;
}
function listArchive(file) { return run('tar', ['-tf', path.basename(file)], { cwd: path.dirname(file) }).split(/\r?\n/).filter(Boolean); }
// Sources whose licence is only stated in a file header.
const LICENSE_FALLBACKS = { '50-ffnvcodec': 'ffnvcodec/include/ffnvcodec/nvEncodeAPI.h' };
function extractLicenses(archive, destination, label) {
  const entries = listArchive(archive);
  let licenses = pickLicenseEntries(entries);
  if (!licenses.length && LICENSE_FALLBACKS[label]) licenses = [LICENSE_FALLBACKS[label]];
  if (!licenses.length) throw new Error(`No licence file found in ${label} (${path.basename(archive)}); add it manually`);
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.lic-'));
  try {
    const original = entries.filter(entry => licenses.includes(entry.replace(/^\.\//, '')));
    run('tar', ['-xf', archive, '-C', temporary, ...original]);
    fs.mkdirSync(destination, { recursive: true });
    const written = [];
    for (const entry of licenses) {
      const name = entry.split('/').join('__');
      let source = path.join(temporary, entry);
      if (fs.lstatSync(source).isSymbolicLink()) {
        // e.g. glib's COPYING -> LICENSES/LGPL-2.1-or-later.txt
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry), fs.readlinkSync(source)));
        const original = entries.find(item => item.replace(/^\.\//, '') === target);
        if (!original || target.startsWith('..')) throw new Error(`Licence ${entry} in ${label} links outside the archive`);
        run('tar', ['-xf', archive, '-C', temporary, original]);
        source = path.join(temporary, target);
      }
      fs.copyFileSync(source, path.join(destination, name));
      written.push(name);
    }
    return { entries, written };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
function gitCheckout(repo, commit, cacheDir) {
  if (!fs.existsSync(path.join(cacheDir, '.git')) && !fs.existsSync(path.join(cacheDir, 'HEAD'))) {
    fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
    run('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', repo, cacheDir]);
  }
  if (spawnSync('git', ['-C', cacheDir, 'cat-file', '-e', `${commit}^{commit}`]).status !== 0) run('git', ['-C', cacheDir, 'fetch', '--quiet', '--tags', 'origin']);
  run('git', ['-C', cacheDir, 'cat-file', '-e', `${commit}^{commit}`]);
  return cacheDir;
}
function gitArchiveInto(repoDir, commit, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const archive = `${destination}.tar`;
  run('git', ['-C', repoDir, 'archive', '--format=tar', '-o', archive, commit]);
  run('tar', ['-xf', archive, '-C', destination]);
  fs.rmSync(archive);
}
function relative(staging, file) { return path.relative(staging, file).split(path.sep).join('/'); }
function fileSize(bytes) { return bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`; }

// ------------------------------------------------------------------ builders

function addSnagThis(context) {
  const { staging, commit, tag } = context;
  log(`SnagThis source at ${commit}`);
  const destination = path.join(staging, 'snagthis');
  gitArchiveInto(root, commit, destination);
  if (!fs.existsSync(path.join(destination, 'LICENSE'))) throw new Error('SnagThis source has no LICENSE');
  return [{ id: 'snagthis', version: tag.slice(1), path: 'snagthis', licenseFile: 'snagthis/LICENSE', buildInstructions: 'BUILD-INSTRUCTIONS.md', commit }];
}

function addMacFfmpeg(context) {
  const { staging, cache } = context;
  const base = path.join(staging, 'ffmpeg-macos');
  const components = [];
  log(`macOS FFmpeg build script ${PINS.mac.buildScriptCommit}`);
  const repo = gitCheckout(PINS.mac.buildScriptRepo, PINS.mac.buildScriptCommit, path.join(cache, 'git/martin-riedl-build-script'));
  gitArchiveInto(repo, PINS.mac.buildScriptCommit, path.join(base, 'build-script'));
  const versionDir = path.join(base, 'build-script/version');
  const versionOf = name => fs.readFileSync(path.join(versionDir, name), 'utf8').trim();
  if (versionOf('ffmpeg') !== PINS.mac.ffmpegVersion) throw new Error(`Build script ${PINS.mac.buildScriptCommit} builds FFmpeg ${versionOf('ffmpeg')}, not ${PINS.mac.ffmpegVersion}`);

  // The provider's per-build versions.txt must match the script's version files.
  for (const [arch, build] of Object.entries(PINS.mac.builds)) {
    const upstream = fs.readFileSync(download(`${build.release}/versions.txt`, path.join(cache, `macos-${arch}-versions.txt`)), 'utf8');
    fs.copyFileSync(path.join(cache, `macos-${arch}-versions.txt`), path.join(base, `provider-versions-${arch}.txt`));
    for (const line of upstream.split(/\r?\n/)) {
      const match = /^([A-Za-z0-9-]+)\s+(\S+)$/.exec(line.trim());
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (!fs.existsSync(path.join(versionDir, name)) || name === 'x264') continue;
      if (versionOf(name) !== match[2]) throw new Error(`${arch} build used ${name} ${match[2]} but the build script pins ${versionOf(name)}`);
    }
  }

  const ffmpegArchive = download(`https://ffmpeg.org/releases/ffmpeg-${PINS.mac.ffmpegVersion}.tar.bz2`, path.join(base, `sources/ffmpeg/ffmpeg-${PINS.mac.ffmpegVersion}.tar.bz2`));
  download(`https://ffmpeg.org/releases/ffmpeg-${PINS.mac.ffmpegVersion}.tar.bz2.asc`, `${ffmpegArchive}.asc`);
  const ffmpegLicenses = extractLicenses(ffmpegArchive, path.join(base, 'sources/ffmpeg/LICENSES'), 'FFmpeg');
  fs.copyFileSync(path.join(base, 'sources/ffmpeg/LICENSES', ffmpegLicenses.written.find(name => name.endsWith('__COPYING.GPLv3'))), path.join(base, 'COPYING.GPLv3'));
  components.push({ id: 'ffmpeg-mac', version: `${PINS.mac.ffmpegVersion} (ffmpeg-${PINS.mac.ffmpegVersion}.tar.bz2; built by ffmpeg.martin-riedl.de build-script ${PINS.mac.buildScriptCommit})`, path: 'ffmpeg-macos', licenseFile: 'ffmpeg-macos/COPYING.GPLv3', buildInstructions: 'ffmpeg-macos/BUILD.md' });
  components.push({ id: 'ffmpeg-mac-build-script', version: PINS.mac.buildScriptCommit, path: 'ffmpeg-macos/build-script', licenseFile: 'ffmpeg-macos/build-script/LICENSE', buildInstructions: 'ffmpeg-macos/BUILD.md' });

  const libraries = [];
  for (const [name, template, extra = {}] of MAC_LIBRARIES) {
    const version = extra.version || versionOf(name);
    const url = template.replaceAll('{v}', version).replaceAll('{mm}', version.split('.').slice(0, 2).join('.'));
    const fileName = decodeURIComponent(new URL(url).pathname.replace(/\/download$/, '').split('/').pop());
    const local = /^v?\d/.test(fileName) || fileName === `${version}.tar.gz` ? `${name}-${fileName.replace(/^v/, '')}` : fileName;
    const directory = path.join(base, 'sources', name);
    log(`macOS ${name} ${version}`);
    let archive;
    try { archive = download(url, path.join(directory, local)); } catch (error) {
      if (!extra.fallback) throw error;
      archive = download(extra.fallback.replaceAll('{v}', version), path.join(directory, local));
    }
    let checksum = 'none published; SHA-256 recorded in SOURCES.sha256';
    if (extra.checksumUrl) {
      const expected = run('curl', ['--fail', '--silent', '--location', extra.checksumUrl.replaceAll('{v}', version)]).trim().split(/\s+/)[0];
      if (expected.toLowerCase() !== sha256File(archive)) throw new Error(`${name} does not match its published SHA-256`);
      checksum = `verified against ${extra.checksumUrl.replaceAll('{v}', version)}`;
    }
    const { entries, written } = extractLicenses(archive, path.join(directory, 'LICENSES'), name);
    if (extra.topDirIncludes && !entries[0].includes(extra.topDirIncludes)) throw new Error(`${name} archive top directory ${entries[0]} does not name commit ${extra.topDirIncludes}`);
    libraries.push({ name, version, url, file: relative(staging, archive), checksum });
    components.push({ id: `ffmpeg-mac-${name}`, version, path: relative(staging, directory), licenseFile: relative(staging, path.join(directory, 'LICENSES', written[0])), buildInstructions: 'ffmpeg-macos/BUILD.md', sourceUrl: url });
  }
  fs.writeFileSync(path.join(base, 'BUILD.md'), macBuildInstructions(libraries));
  return components;
}

// BtbN's stage archives keep the shallow .git of each checkout, over half of
// the packet's size. Only these stages' build steps use Git (tags, git am, or
// version detection from fetched history), so the others ship without it.
const BTBN_KEEP_GIT = new Set(['50-avisynth', '50-libaribb24', '50-aom', '50-davs2']);
function withoutGitMetadata(archive, cacheDir) {
  const output = path.join(cacheDir, path.basename(archive));
  if (fs.existsSync(output)) return output;
  fs.mkdirSync(cacheDir, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(cacheDir, '.repack-'));
  try {
    run('tar', ['-xf', archive, '-C', temporary]);
    run('find', [temporary, '-name', '.git', '-prune', '-exec', 'rm', '-rf', '{}', '+']);
    const packed = spawnSync('bash', ['-c', 'set -o pipefail; tar -C "$1" -cf - . | xz -T0 -6 > "$2"', 'pack', temporary, `${output}.tmp`], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
    if (packed.status !== 0) throw new Error(`Could not repack ${path.basename(archive)}`);
    fs.renameSync(`${output}.tmp`, output);
    return output;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function addWindowsFfmpeg(context) {
  const { staging, cache } = context;
  const base = path.join(staging, 'ffmpeg-windows');
  const components = [];
  log(`BtbN FFmpeg-Builds ${PINS.win.tag}`);
  const repo = gitCheckout(PINS.win.repo, PINS.win.commit, path.join(cache, 'git/btbn-ffmpeg-builds'));
  const tagged = run('git', ['-C', repo, 'rev-parse', `${PINS.win.tag}^{commit}`]).trim();
  if (tagged !== PINS.win.commit) throw new Error(`${PINS.win.tag} points to ${tagged}, not ${PINS.win.commit}`);
  gitArchiveInto(repo, PINS.win.commit, path.join(base, 'build-scripts'));
  components.push({ id: 'ffmpeg-win-build-scripts', version: `${PINS.win.tag} (${PINS.win.commit})`, path: 'ffmpeg-windows/build-scripts', licenseFile: 'ffmpeg-windows/build-scripts/LICENSE', buildInstructions: 'ffmpeg-windows/BUILD.md' });

  const ffmpegArchive = download(`https://ffmpeg.org/releases/ffmpeg-${PINS.win.ffmpegVersion}.tar.xz`, path.join(base, `sources/ffmpeg/ffmpeg-${PINS.win.ffmpegVersion}.tar.xz`));
  download(`https://ffmpeg.org/releases/ffmpeg-${PINS.win.ffmpegVersion}.tar.xz.asc`, `${ffmpegArchive}.asc`);
  const ffmpegLicenses = extractLicenses(ffmpegArchive, path.join(base, 'sources/ffmpeg/LICENSES'), 'FFmpeg');
  fs.copyFileSync(path.join(base, 'sources/ffmpeg/LICENSES', ffmpegLicenses.written.find(name => name.endsWith('__COPYING.GPLv3'))), path.join(base, 'COPYING.GPLv3'));
  components.push({ id: 'ffmpeg-win', version: `${PINS.win.ffmpegTag} (ffmpeg-${PINS.win.ffmpegVersion}.tar.xz; BtbN ${PINS.win.target}-${PINS.win.variant}-${PINS.win.addin})`, path: 'ffmpeg-windows', licenseFile: 'ffmpeg-windows/COPYING.GPLv3', buildInstructions: 'ffmpeg-windows/BUILD.md' });

  // Run BtbN's own source-download commands, but only for the stages the
  // win64/gpl/9.0 image uses. Archives get BtbN's cache names, so they can be
  // dropped into .cache/downloads for an offline rebuild.
  const work = path.join(cache, 'btbn-work');
  fs.rmSync(work, { recursive: true, force: true });
  gitArchiveInto(repo, PINS.win.commit, work);
  const dldir = path.join(cache, 'btbn-downloads');
  fs.mkdirSync(dldir, { recursive: true });
  const script = `set -e -o pipefail
./generate.sh ${PINS.win.target} ${PINS.win.variant} ${PINS.win.addin} >/dev/null
for SELF in $(grep -o 'ENV SELF="[^"]*"' Dockerfile | cut -d'"' -f2); do
  STAGENAME="$(basename "$SELF" .sh)"
  STG="$(source util/dl_functions.sh; source "$SELF"; ffbuild_dockerdl)"
  [[ -z "$STG" ]] && continue
  DLHASH="$(sha256sum <<<"$STG" | cut -d' ' -f1)"
  TGT="/dldir/\${STAGENAME}_\${DLHASH}.tar.xz"
  echo "$SELF $TGT" >> /dldir/stages.txt.tmp
  [[ -f "$TGT" ]] && continue
  WORKDIR="$(mktemp -d)"
  ( cd "$WORKDIR" && shopt -s dotglob && eval "set -e; $STG" ) >&2
  tar -C "$WORKDIR" -I "xz -T0" -cpf "$TGT.tmp" .
  mv "$TGT.tmp" "$TGT"
  rm -rf "$WORKDIR"
done
mv /dldir/stages.txt.tmp /dldir/stages.txt`;
  fs.rmSync(path.join(dldir, 'stages.txt.tmp'), { force: true });
  log('Downloading BtbN dependency sources in Docker (this takes a while)');
  const uid = typeof process.getuid === 'function' ? ['-u', `${process.getuid()}:${process.getgid()}`] : [];
  const shim = [];
  if (process.arch !== 'x64') {
    // GNU tar in the amd64 image cannot create directories or files when it
    // extracts under emulation on Apple Silicon (ENOSYS), which breaks stages
    // that unpack archives while downloading (libopus, libiconv/gettext).
    // Route extractions to the image's bsdtar; creation still uses GNU tar.
    const shimDir = path.join(cache, 'btbn-tar-shim');
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(path.join(shimDir, 'tar'), `#!/bin/bash
extract=0
[[ "$1" =~ ^-?[A-Za-z]*x[A-Za-z]*$ ]] && extract=1
for arg in "$@"; do [[ "$arg" == "-x" || "$arg" == "--extract" || "$arg" == "--get" ]] && extract=1; done
[[ $extract == 1 ]] && exec bsdtar "$@"
exec /usr/bin/tar "$@"
`, { mode: 0o755 });
    shim.push('-v', `${shimDir}:/shim:ro`, '-e', 'SNAGTHIS_TAR_SHIM=1');
  }
  const prelude = shim.length ? 'export PATH=/shim:$PATH\n' : '';
  run('docker', ['run', '--rm', '--platform', 'linux/amd64', ...uid, '-e', 'HOME=/tmp', ...shim, '-v', `${work}:/b`, '-v', `${dldir}:/dldir`, '-w', '/b', PINS.win.baseImage, 'bash', '-c', prelude + script], { stdio: ['ignore', 'inherit', 'inherit'] });
  const stages = fs.readFileSync(path.join(dldir, 'stages.txt'), 'utf8').trim().split('\n').map(line => line.split(' '));
  const stageDir = path.join(base, 'sources/stages');
  fs.mkdirSync(stageDir, { recursive: true });
  const stageRecords = [];
  for (const [self, target] of stages) {
    const name = path.basename(target);
    const stage = path.basename(self, '.sh');
    const archive = path.join(stageDir, name);
    if (BTBN_KEEP_GIT.has(stage)) fs.copyFileSync(path.join(dldir, name), archive);
    else fs.copyFileSync(withoutGitMetadata(path.join(dldir, name), path.join(cache, 'btbn-stripped')), archive);
    const stageScript = fs.readFileSync(path.join(work, self), 'utf8');
    const repoMatch = /^SCRIPT_REPO="([^"]+)"/m.exec(stageScript);
    const commitMatch = /^SCRIPT_COMMIT="([^"]+)"/m.exec(stageScript);
    const licenseDir = path.join(stageDir, `${stage}.LICENSES`);
    const licenseFile = relative(staging, path.join(licenseDir, extractLicenses(archive, licenseDir, stage).written[0]));
    stageRecords.push({ stage, self, archive: relative(staging, archive), repo: repoMatch?.[1], commit: commitMatch?.[1] });
    // Component paths are directory prefixes, so stages share the stages directory.
    components.push({ id: `ffmpeg-win-${stage}`, version: commitMatch?.[1] || PINS.win.commit, path: relative(staging, stageDir), archive: relative(staging, archive), licenseFile, buildInstructions: 'ffmpeg-windows/BUILD.md', ...(repoMatch ? { sourceUrl: repoMatch[1] } : {}) });
  }
  fs.writeFileSync(path.join(base, 'BUILD.md'), windowsBuildInstructions(stageRecords));
  return components;
}

function addYtDlp(context) {
  const { staging, cache } = context;
  const base = path.join(staging, 'yt-dlp');
  log(`yt-dlp ${PINS.ytdlp.version} (${PINS.ytdlp.commit})`);
  const archive = download(`https://codeload.github.com/yt-dlp/yt-dlp/tar.gz/${PINS.ytdlp.commit}`, path.join(base, `yt-dlp-${PINS.ytdlp.version}-${PINS.ytdlp.commit.slice(0, 12)}.tar.gz`));
  const entries = listArchive(archive);
  const top = entries[0].split('/')[0];
  const temporary = fs.mkdtempSync(path.join(cache, 'yt-dlp-'));
  try {
    const wanted = ['LICENSE', 'THIRD_PARTY_LICENSES.txt', 'yt_dlp/version.py', ...PINS.ytdlp.requirementFiles.map(name => `bundle/requirements/${name}`)].map(name => `${top}/${name}`);
    run('tar', ['-xf', archive, '-C', temporary, ...wanted]);
    const version = fs.readFileSync(path.join(temporary, top, 'yt_dlp/version.py'), 'utf8');
    if (!version.includes(`__version__ = '${PINS.ytdlp.version}'`)) throw new Error(`yt-dlp commit ${PINS.ytdlp.commit} is not version ${PINS.ytdlp.version}`);
    fs.copyFileSync(path.join(temporary, top, 'LICENSE'), path.join(base, 'LICENSE'));
    fs.copyFileSync(path.join(temporary, top, 'THIRD_PARTY_LICENSES.txt'), path.join(base, 'THIRD_PARTY_LICENSES.txt'));
    const pins = new Map();
    for (const name of PINS.ytdlp.requirementFiles) {
      for (const pin of parseRequirementPins(fs.readFileSync(path.join(temporary, top, 'bundle/requirements', name), 'utf8'))) {
        if (pin.version) pins.set(`${pin.name.toLowerCase()}==${pin.version}`, pin);
      }
    }
    const deps = path.join(base, 'python-deps');
    fs.mkdirSync(deps, { recursive: true });
    const records = [];
    for (const pin of [...pins.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const metadata = JSON.parse(run('curl', ['--fail', '--silent', '--location', `https://pypi.org/pypi/${pin.name}/${pin.version}/json`]));
      const sdist = metadata.urls.find(file => file.packagetype === 'sdist');
      if (!sdist) { records.push({ ...pin, missing: 'no sdist on PyPI' }); continue; }
      const file = download(sdist.url, path.join(deps, sdist.filename));
      const digest = sha256File(file);
      if (digest !== sdist.digests.sha256) throw new Error(`${sdist.filename} does not match PyPI's SHA-256`);
      records.push({ ...pin, file: sdist.filename, sha256: digest, checksum: pin.hashes.includes(digest) ? 'PyPI + yt-dlp pin' : 'PyPI' });
    }
    const pyinstaller = `https://github.com/yt-dlp/Pyinstaller-Builds/releases/download/${PINS.ytdlp.pyinstallerBuildsTag}/pyinstaller-6.22.0.tar.gz`;
    download(pyinstaller, path.join(deps, 'yt-dlp-Pyinstaller-Builds-pyinstaller-6.22.0.tar.gz'));
    records.push({ name: 'pyinstaller (yt-dlp/Pyinstaller-Builds Windows bootloader build)', version: '6.22.0', file: 'yt-dlp-Pyinstaller-Builds-pyinstaller-6.22.0.tar.gz', url: pyinstaller });
    fs.writeFileSync(path.join(base, 'BUILD.md'), ytdlpBuildInstructions(records, path.basename(archive)));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  return [
    { id: 'yt-dlp', version: `${PINS.ytdlp.version} (${PINS.ytdlp.commit})`, path: 'yt-dlp', licenseFile: 'yt-dlp/LICENSE', buildInstructions: 'yt-dlp/BUILD.md' },
    { id: 'yt-dlp-python-deps', version: `bundle/requirements at ${PINS.ytdlp.commit}`, path: 'yt-dlp/python-deps', licenseFile: 'yt-dlp/THIRD_PARTY_LICENSES.txt', buildInstructions: 'yt-dlp/BUILD.md' },
  ];
}

// ------------------------------------------------------------ documentation

function macBuildInstructions(libraries) {
  return `# FFmpeg / ffprobe for macOS (arm64 and x64)

SnagThis bundles the static builds published by https://ffmpeg.martin-riedl.de:

| Arch | Release | ffmpeg.zip / ffprobe.zip SHA-256 |
| --- | --- | --- |
${Object.entries(PINS.mac.builds).map(([arch, build]) => `| ${arch} | ${build.release} | ${build.sha256.join(' / ')} |`).join('\n')}

They are FFmpeg ${PINS.mac.ffmpegVersion} configured with \`--enable-gpl --enable-version3\` (GPLv3 as a whole; no \`--enable-nonfree\`), statically linking the libraries below. \`provider-versions-*.txt\` is the provider's own record of each build (compiler, configure line, library versions); this script checked that it matches \`build-script/version/*\`.

## Contents

- \`build-script/\`: the provider's build script at commit ${PINS.mac.buildScriptCommit} (${PINS.mac.buildScriptRepo}), the commit whose version pins match those builds.
- \`sources/ffmpeg/\`: the FFmpeg release tarball it downloads, with the upstream signature (\`.asc\`, key FCF986EA15E6E293A5644F10B4322F04D67658D8).
- \`sources/<library>/\`: each linked library's source exactly as the script downloads it, plus its licence files in \`LICENSES/\`.

x264: the script downloads \`x264-master.tar.gz\` without recording a revision, and the binaries report none. x264 master has been at ${PINS.mac.x264Commit} since 2025-09-10, before both builds (2026-08-18), so this packet contains that commit. x265: Bitbucket's \`4.2\` tarball (top directory names commit ${PINS.mac.x265Commit}); it contains a stale \`x265Version.txt\`, which is why the binary reports "4.0+1-6318f22".

| Library | Version | Upstream URL | Checksum |
| --- | --- | --- | --- |
${libraries.map(item => `| ${item.name} | ${item.version} | ${item.url} | ${item.checksum} |`).join('\n')}

## Rebuild

On macOS with Xcode command-line tools (the provider used Apple clang 14.0.0), Rust/cargo with cargo-c (rav1e) and Python 3 (meson for dav1d, harfbuzz and libvmaf):

1. Copy \`build-script/\` to a writable directory.
2. Make its downloads use this packet: in \`script/functions.sh\`, replace the body of \`download()\` so it copies the file named by its URL's last path segment from this packet's \`sources/<library>/\` directory. For x264, point \`script/build-x264.sh\` at \`sources/x264/\` and keep the unpacked directory name \`x264-master\`.
3. Run \`./build.sh -SKIP_TEST=YES -SKIP_BUNDLE=YES\` (see \`build-script/README.md\` for options). It builds the build tools (nasm, pkg-config, cmake, ninja) from upstream, then the libraries, then FFmpeg with the configure line recorded in \`provider-versions-*.txt\`.
4. The results are \`out/bin/ffmpeg\` and \`out/bin/ffprobe\`.
`;
}

function windowsBuildInstructions(stages) {
  return `# FFmpeg / ffprobe for Windows x64

SnagThis bundles \`${PINS.win.zip}\` from https://github.com/BtbN/FFmpeg-Builds/releases/tag/${PINS.win.tag} (verified against that release's \`checksums.sha256\` when fetched). It is FFmpeg ${PINS.win.ffmpegTag} (the \`release/9.0\` branch was at that tag when built), \`--enable-gpl --enable-version3\`, no nonfree components (\`--disable-libfdk-aac\`), statically linking the libraries listed below.

## Contents

- \`build-scripts/\`: BtbN/FFmpeg-Builds at ${PINS.win.commit} (${PINS.win.tag}). Every dependency stage in \`scripts.d/\` pins a source commit; \`images/base-win64/\` defines the toolchain (crosstool-ng: GCC 16.2.0, binutils 2.47, mingw-w64 v14.0.0; the GCC runtime is covered by the GCC Runtime Library Exception).
- \`sources/ffmpeg/\`: \`ffmpeg-${PINS.win.ffmpegVersion}.tar.xz\` (identical to tag ${PINS.win.ffmpegTag}) and its upstream signature.
- \`sources/stages/\`: the source of every stage used by the ${PINS.win.target}-${PINS.win.variant}-${PINS.win.addin} build, produced by BtbN's own download commands (\`util/dl_functions.sh\`, including vendored Rust crates where the stage vendors them). File names match BtbN's \`.cache/downloads\` names. To keep the packet under 2 GiB, Git metadata (\`.git\`) is removed from every stage except ${[...BTBN_KEEP_GIT].join(', ')}, whose build steps use Git; the source files are unchanged. Licence files are in \`<stage>.LICENSES/\`.

| Stage | Source repository | Commit |
| --- | --- | --- |
${stages.map(item => `| ${item.stage} | ${item.repo || '(see stage script)'} | ${item.commit || '(see stage script)'} |`).join('\n')}

## Rebuild

On Linux with Docker (BtbN builds on x86_64 Ubuntu in GitHub Actions):

1. Copy \`build-scripts/\` to a writable directory and \`mkdir -p .cache/downloads\`.
2. Copy every \`sources/stages/*.tar.xz\` into \`.cache/downloads/\` (the names already match what \`generate.sh\` expects, so no source is fetched again).
3. \`./makeimage.sh ${PINS.win.target} ${PINS.win.variant} ${PINS.win.addin}\` builds the toolchain and dependency images.
4. \`GIT_BRANCH_OVERRIDE=${PINS.win.ffmpegTag} ./build.sh ${PINS.win.target} ${PINS.win.variant} ${PINS.win.addin}\` builds FFmpeg (to build offline, set \`FFMPEG_REPO_OVERRIDE\` to a Git repository created from \`sources/ffmpeg/\` with tag ${PINS.win.ffmpegTag}).
5. The result is \`artifacts/${PINS.win.zip}\`. \`--extra-version\` is the build date, so the version line differs from the shipped \`n9.0.2-20260919\` unless the date is overridden.
`;
}

function ytdlpBuildInstructions(records, archiveName) {
  return `# yt-dlp ${PINS.ytdlp.version}

SnagThis bundles the official PyInstaller executables from https://github.com/yt-dlp/yt-dlp/releases/tag/${PINS.ytdlp.version}: \`yt-dlp_macos\` (universal2, macOS arm64 and x64) and \`yt-dlp.exe\` (Windows x64). yt-dlp itself is Unlicense; the executables also contain Python and the packages below under their own licences (all listed in \`THIRD_PARTY_LICENSES.txt\`; e.g. mutagen is GPL-2.0-or-later, certifi MPL-2.0, the PyInstaller bootloader GPL-2.0 with its bootloader exception).

## Contents

- \`${archiveName}\`: yt-dlp at tag ${PINS.ytdlp.version}, commit ${PINS.ytdlp.commit}. The build recipe is \`.github/workflows/build.yml\` (jobs \`macos\` and \`windows\`), \`bundle/pyinstaller.py\` and the hash-pinned \`bundle/requirements/*.txt\`.
- \`python-deps/\`: the source distribution of every package pinned by ${PINS.ytdlp.requirementFiles.map(name => `\`${name}\``).join(', ')}, each verified against PyPI's published SHA-256 (and yt-dlp's pinned hashes where they list the sdist), plus the PyInstaller source yt-dlp used for its Windows bootloader build.

| Package | Version | File | SHA-256 verified against |
| --- | --- | --- | --- |
${records.map(item => `| ${item.name} | ${item.version} | ${item.file || item.missing} | ${item.checksum || '-'} |`).join('\n')}

Python itself (PSF licence; macOS build reports CPython 3.14.6, Windows x64 uses CPython 3.10 from actions/setup-python) and the binary wheels' bundled libraries (curl-impersonate, BoringSSL, OpenSSL, libffi, zlib and similar, all permissively licensed) are identified in \`THIRD_PARTY_LICENSES.txt\` and available from their upstream projects.

## Rebuild

Follow \`.github/workflows/build.yml\` in the yt-dlp source: create a venv, \`pip install --require-hashes -r bundle/requirements/<file>\` (use \`pip install --no-binary :all:\` with \`python-deps/\` as \`--find-links\` to build from these sources), run \`python devscripts/update-version.py -c stable -r yt-dlp/yt-dlp ${PINS.ytdlp.version}\`, \`python devscripts/make_lazy_extractors.py\`, then \`python -m bundle.pyinstaller\` (macOS: \`--target-architecture universal2 --onedir\` as in the workflow).
`;
}

function topInstructions({ tag, commit, platforms, sections }) {
  return `# SnagThis ${tag} corresponding source

This archive is the complete corresponding source for SnagThis ${tag} (commit ${commit}) and the third-party executables it bundles on ${platforms.join(', ')}. It contains no signing material or user data.

| Directory | Contents |
| --- | --- |
| \`snagthis/\` | SnagThis source at ${commit} (GPL-3.0-only). Build: \`npm ci\`, \`npm run fetch:ffmpeg --workspace @m3u8/desktop\`, \`npm run fetch:yt-dlp --workspace @m3u8/desktop\`, then \`npm run dist --workspace @m3u8/desktop\` (see \`snagthis/docs/release-guide.md\`). |
${sections.join('\n')}

\`SOURCES.sha256\` lists the SHA-256 of every file in this archive.
`;
}

// ---------------------------------------------------------------------- main

function main() {
  const options = parseArgs(process.argv.slice(2));
  const ffmpegScript = fs.readFileSync(path.join(root, 'apps/desktop/scripts/fetch-ffmpeg.cjs'), 'utf8');
  const ytdlpScript = fs.readFileSync(path.join(root, 'apps/desktop/scripts/fetch-yt-dlp.cjs'), 'utf8');
  const { problems, warnings } = checkFetchScriptPins(ffmpegScript, ytdlpScript);
  if (problems.length) throw new Error(`Pins are out of date:\n- ${problems.join('\n- ')}`);
  for (const warning of warnings) console.warn(`[source-packet] WARNING: ${warning}`);

  const ref = options.ref || options.tag;
  const commit = run('git', ['-C', root, 'rev-parse', `${ref}^{commit}`]).trim();
  if (!options.ref) log(`Using tag ${options.tag} at ${commit}`);
  else console.warn(`[source-packet] WARNING: using ${ref} (${commit}) instead of tag ${options.tag}; publish only a packet built from the tag`);
  const version = JSON.parse(run('git', ['-C', root, 'show', `${commit}:apps/desktop/package.json`])).version;
  if (`v${version}` !== options.tag) throw new Error(`${ref} is desktop version ${version}, not ${options.tag}`);

  const reports = options.reports ? readReports(options.reports) : null;
  if (reports) for (const platform of options.platforms) if (!reports[platform]) throw new Error(`No release-verification report for ${platform} in ${options.reports}`);

  const staging = path.join(options.out, 'staging');
  const cache = path.join(options.out, 'cache');
  const output = path.join(options.out, 'release-source');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  downloadCache = path.join(cache, 'files');
  const context = { staging, cache, commit, tag: options.tag };

  const components = [...addSnagThis(context)];
  const sections = [];
  let macComponentIds = [];
  let winComponentIds = [];
  if (options.platforms.some(item => item.startsWith('darwin'))) {
    const mac = addMacFfmpeg(context);
    components.push(...mac);
    macComponentIds = mac.map(item => item.id);
    sections.push('| `ffmpeg-macos/` | FFmpeg/ffprobe for macOS arm64 and x64: provider build script, FFmpeg and every linked library. See `ffmpeg-macos/BUILD.md`. |');
  }
  if (options.platforms.includes('win32-x64')) {
    const win = addWindowsFfmpeg(context);
    components.push(...win);
    winComponentIds = win.map(item => item.id);
    sections.push('| `ffmpeg-windows/` | FFmpeg/ffprobe for Windows x64: BtbN build scripts, FFmpeg and every dependency stage. See `ffmpeg-windows/BUILD.md`. |');
  }
  const ytdlp = addYtDlp(context);
  components.push(...ytdlp);
  sections.push('| `yt-dlp/` | yt-dlp source, build recipe and bundled Python package sources. See `yt-dlp/BUILD.md`. |');
  fs.writeFileSync(path.join(staging, 'BUILD-INSTRUCTIONS.md'), topInstructions({ tag: options.tag, commit, platforms: options.platforms, sections }));

  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.isFile()) files.push(full); } };
  walk(staging);
  log(`Hashing ${files.length} files`);
  fs.writeFileSync(path.join(staging, 'SOURCES.sha256'), files.filter(file => !file.startsWith(path.join(staging, 'snagthis') + path.sep)).sort().map(file => `${sha256File(file)}  ${relative(staging, file)}`).join('\n') + '\n');

  const archive = path.join(output, 'snagthis-corresponding-source.tar.xz');
  log('Compressing archive');
  const tarArgs = process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs'] : ['--owner=0', '--group=0', '--numeric-owner', '--sort=name'];
  const packed = spawnSync('bash', ['-c', `set -o pipefail; tar ${tarArgs.join(' ')} -C "$1" -cf - . | xz -T0 -6 > "$2"`, 'pack', staging, archive], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  if (packed.status !== 0) throw new Error('Could not create the tar.xz archive');
  const archiveSha256 = sha256File(archive);
  const manifest = buildManifest({ tag: options.tag, commit, archiveSha256, components, platforms: options.platforms, macComponentIds, winComponentIds, ytdlpComponentIds: ytdlp.map(item => item.id), reports });
  const manifestPath = path.join(output, 'corresponding-source.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const { verifySourcePacket, verifyCorrespondingSource } = require('./verify-corresponding-source.cjs');
  verifySourcePacket(options.out, options.tag);
  if (reports) {
    for (const [platform, { file }] of Object.entries(reports)) {
      const directory = path.join(options.out, `release-${platform}`);
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(directory);
      fs.copyFileSync(file, path.join(directory, path.basename(file)));
    }
    verifyCorrespondingSource(options.out, options.tag);
    log('Verified the packet against the release-verification reports');
  } else log('Verified packet structure; rerun with --reports to check it against the release run\'s binaries');
  if (options.platforms.length < PLATFORMS.length) console.warn('[source-packet] WARNING: this packet does not cover every release platform');
  log(`${archive} ${fileSize(fs.statSync(archive).size)} sha256 ${archiveSha256}`);
  log(`${manifestPath} sha256 ${sha256File(manifestPath)}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`[source-packet] ${error.message}`); process.exitCode = 1; }
}
module.exports = { PINS, PLATFORMS, parseArgs, parseRequirementPins, pickLicenseEntries, checkFetchScriptPins, readReports, buildManifest };
