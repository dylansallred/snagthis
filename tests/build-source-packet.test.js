const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PINS, parseArgs, parseRequirementPins, pickLicenseEntries, checkFetchScriptPins, readReports, buildManifest } = require('../scripts/build-source-packet.cjs');

const fetchFfmpeg = fs.readFileSync(path.join(__dirname, '../apps/desktop/scripts/fetch-ffmpeg.cjs'), 'utf8');
const ytdlpPinned = `const url = 'https://github.com/yt-dlp/yt-dlp/releases/download/${PINS.ytdlp.version}/yt-dlp_macos';`;

test('source-packet pins describe the FFmpeg builds the desktop fetch script downloads', () => {
  const { problems } = checkFetchScriptPins(fetchFfmpeg, ytdlpPinned);
  assert.deepEqual(problems, []);
  const changed = fetchFfmpeg.replace(PINS.mac.builds.arm64.sha256[0], 'f'.repeat(64));
  assert.match(checkFetchScriptPins(changed, ytdlpPinned).problems.join('\n'), /macOS arm64 checksum/);
  assert.match(checkFetchScriptPins(fetchFfmpeg.replace(PINS.win.tag, 'autobuild-2099-01-01-00-00'), ytdlpPinned).problems.join('\n'), /BtbN release/);
});

test('the yt-dlp version pinned in yt-dlp-release.json must match the packet', () => {
  const script = "const pin = require('./yt-dlp-release.json');";
  assert.deepEqual(checkFetchScriptPins(fetchFfmpeg, script, PINS, { version: PINS.ytdlp.version }).problems, []);
  assert.match(checkFetchScriptPins(fetchFfmpeg, script, PINS, { version: '2020.01.01' }).problems.join('\n'), /yt-dlp-release\.json pins yt-dlp 2020\.01\.01/);
});

test('yt-dlp pins must match; an unpinned latest download only warns', () => {
  assert.match(checkFetchScriptPins(fetchFfmpeg, ytdlpPinned.replace(PINS.ytdlp.version, '2020.01.01')).problems.join('\n'), /pins yt-dlp 2020\.01\.01/);
  const latest = checkFetchScriptPins(fetchFfmpeg, "'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'");
  assert.deepEqual(latest.problems, []);
  assert.match(latest.warnings[0], /latest yt-dlp/);
  assert.match(checkFetchScriptPins(fetchFfmpeg, 'process.env.URL').problems[0], /Cannot determine/);
});

test('pip-compile requirement pins keep versions, hashes and direct URLs', () => {
  const pins = parseRequirementPins([
    '# comment',
    "brotli==1.2.0 ; implementation_name == 'cpython' \\",
    `    --hash=sha256:${'a'.repeat(64)} \\`,
    `    --hash=sha256:${'b'.repeat(64)}`,
    '    # via yt-dlp',
    'mutagen==1.48.1 \\',
    `    --hash=sha256:${'c'.repeat(64)}`,
    'pyinstaller @ https://github.com/yt-dlp/Pyinstaller-Builds/releases/download/x/pyinstaller-6.22.0-py3-none-win_amd64.whl \\',
    `    --hash=sha256:${'d'.repeat(64)}`,
  ].join('\n'));
  assert.deepEqual(pins.map(pin => [pin.name, pin.version || pin.url, pin.hashes.length]), [
    ['brotli', '1.2.0', 2],
    ['mutagen', '1.48.1', 1],
    ['pyinstaller', 'https://github.com/yt-dlp/Pyinstaller-Builds/releases/download/x/pyinstaller-6.22.0-py3-none-win_amd64.whl', 1],
  ]);
});

test('licence detection prefers top-level licence files of an archive', () => {
  assert.deepEqual(pickLicenseEntries(['ffmpeg-9.0.1/', 'ffmpeg-9.0.1/COPYING.GPLv3', 'ffmpeg-9.0.1/LICENSE.md', 'ffmpeg-9.0.1/tests/x/COPYING', 'ffmpeg-9.0.1/README']), ['ffmpeg-9.0.1/COPYING.GPLv3', 'ffmpeg-9.0.1/LICENSE.md']);
  assert.deepEqual(pickLicenseEntries(['./', './COPYING', './src/main.c', './vendor/a/LICENSE-MIT']), ['COPYING']);
  assert.deepEqual(pickLicenseEntries(['x/README', 'x/src/licensed.c']), []);
  assert.deepEqual(pickLicenseEntries(['libklvanc/README.md', 'libklvanc/lgpl-2.1.txt']), ['libklvanc/lgpl-2.1.txt']);
});

test('manifest covers each requested platform with version lines from the verified reports', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-packet-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const report = (platform, arch, tools, ytdlp = PINS.ytdlp.version) => fs.writeFileSync(path.join(base, `release-verification-${platform}-${arch}.json`), JSON.stringify({ platform, arch, ffmpeg: { tools }, ytdlp: { version: ytdlp } }));
  const mac = PINS.mac.builds.arm64;
  report('darwin', 'arm64', {
    ffmpeg: { downloadSha256: mac.sha256[0], version: 'ffmpeg version A\nbuilt with clang' },
    ffprobe: { downloadSha256: mac.sha256[1], version: 'ffprobe version A\nx' },
  });
  const reports = readReports(base);
  const manifest = buildManifest({ tag: 'v2.0.45', commit: 'a'.repeat(40), archiveSha256: 'b'.repeat(64), components: [], platforms: ['darwin-arm64', 'win32-x64'], macComponentIds: ['ffmpeg-mac'], winComponentIds: ['ffmpeg-win'], ytdlpComponentIds: ['yt-dlp'], reports });
  assert.equal(manifest.builds[0].tools.ffmpeg.version, 'ffmpeg version A');
  assert.deepEqual(manifest.builds[0].tools.ffprobe.components, ['ffmpeg-mac']);
  assert.equal(manifest.builds[1].tools.ffmpeg.version, PINS.win.versionLines.ffmpeg);
  assert.deepEqual(manifest.builds[1].tools['yt-dlp'], { version: PINS.ytdlp.version, components: ['yt-dlp'] });

  report('darwin', 'arm64', { ffmpeg: { downloadSha256: 'f'.repeat(64), version: 'x' }, ffprobe: { downloadSha256: mac.sha256[1], version: 'x' } });
  assert.throws(() => readReports(base), /pinned macOS arm64 FFmpeg build/);
  report('darwin', 'arm64', { ffmpeg: { downloadSha256: mac.sha256[0], version: 'x' }, ffprobe: { downloadSha256: mac.sha256[1], version: 'x' } }, '2020.01.01');
  assert.throws(() => readReports(base), /bundles yt-dlp 2020\.01\.01/);
});

test('command-line options require a release tag and known platforms', () => {
  assert.throws(() => parseArgs([]), /--tag/);
  assert.throws(() => parseArgs(['--tag', 'v1.2.3', '--platforms', 'linux-x64']), /subset/);
  assert.deepEqual(parseArgs(['--tag', 'v1.2.3', '--platforms', 'darwin-arm64']).platforms, ['darwin-arm64']);
});
