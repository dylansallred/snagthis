const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { packagedSmoke } = require('./packaged-smoke.cjs');
const { verifyUpdateConfig } = require('./verify-update-config.cjs');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'apps/desktop/dist-electron');
const expectedVersion = require('../apps/desktop/package.json').version;
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180_000, ...extra });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return String(result.stdout || '').trim();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function topLevel(extension) { return fs.readdirSync(dist).filter(name => name.endsWith(extension)).map(name => path.join(dist, name)); }
function verifyUpdateFeed(resources) {
  return verifyUpdateConfig(yaml.load(fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8')));
}
function verifyMacApp(installed) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', installed]);
  run('xcrun', ['stapler', 'validate', installed]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', installed]);
  run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', installed]);
}

async function verifyRelease() {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Run installer verification on macOS or Windows');
  const artifacts = topLevel(process.platform === 'darwin' ? '.dmg' : '.exe');
  if (artifacts.length !== 1) throw new Error(`Expected one installer for this architecture, found ${artifacts.length}`);
  const artifact = artifacts[0];
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${expectedVersion}`) throw new Error('Release tag does not match the packaged version');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-installer-'));
  let mounted = false;
  const mount = path.join(temporary, 'mount');
  try {
    let executable;
    let resources;
    if (process.platform === 'darwin') {
      run('hdiutil', ['verify', artifact]);
      run('xcrun', ['stapler', 'validate', artifact]);
      run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', artifact]);
      fs.mkdirSync(mount);
      run('hdiutil', ['attach', artifact, '-readonly', '-nobrowse', '-mountpoint', mount]);
      mounted = true;
      const appName = fs.readdirSync(mount).find(name => name.endsWith('.app'));
      if (!appName) throw new Error('The DMG contains no application');
      const installed = path.join(temporary, appName);
      run('ditto', [path.join(mount, appName), installed]);
      verifyMacApp(installed);
      executable = path.join(installed, 'Contents/MacOS/SnagThis');
      resources = path.join(installed, 'Contents/Resources');
    } else {
      const quote = value => "'" + value.replace(/'/g, "''") + "'";
      run('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath ${quote(artifact)}; if ($s.Status -ne 'Valid') { throw ('Invalid installer signature: ' + $s.Status) }`]);
      const installed = path.join(temporary, 'app');
      run(artifact, ['/S', `/D=${installed}`]);
      executable = path.join(installed, 'SnagThis.exe');
      resources = path.join(installed, 'resources');
      run('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath ${quote(executable)}; if ($s.Status -ne 'Valid') { throw ('Invalid app signature: ' + $s.Status) }`]);
    }
    const updateRepository = verifyUpdateFeed(resources);
    const smoke = await packagedSmoke(executable, resources);
    if (smoke.version !== expectedVersion) throw new Error(`Installed version ${smoke.version} does not match ${expectedVersion}`);
    let updateArchive;
    if (process.platform === 'darwin') {
      const archives = topLevel('.zip');
      if (archives.length !== 1) throw new Error(`Expected one macOS update ZIP, found ${archives.length}`);
      const extracted = path.join(temporary, 'update-zip');
      fs.mkdirSync(extracted);
      run('ditto', ['-x', '-k', archives[0], extracted]);
      const appName = fs.readdirSync(extracted).find(name => name.endsWith('.app'));
      if (!appName) throw new Error('The update ZIP contains no application');
      const app = path.join(extracted, appName);
      verifyMacApp(app);
      const zipUpdateRepository = verifyUpdateFeed(path.join(app, 'Contents/Resources'));
      const zipSmoke = await packagedSmoke(path.join(app, 'Contents/MacOS/SnagThis'), path.join(app, 'Contents/Resources'));
      if (zipSmoke.version !== expectedVersion) throw new Error('The update ZIP contains a different app version');
      updateArchive = { name: path.basename(archives[0]), sha256: sha256(archives[0]), blockmapSha256: sha256(`${archives[0]}.blockmap`), signature: 'verified', updateRepository: zipUpdateRepository, smoke: zipSmoke };
    }
    const bin = path.join(resources, 'bin');
    const metadataFile = path.join(bin, 'ffmpeg-build.json');
    if (!fs.existsSync(metadataFile)) throw new Error('Packaged FFmpeg build and source metadata is missing');
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    for (const name of ['ffmpeg', 'ffprobe']) {
      const binary = path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
      // Signing may change the executable hash, so retain both pre-signing and shipped hashes.
      metadata.tools[name].shippedSha256 = sha256(binary);
      if (/nonfree/i.test(metadata.tools[name].configuration)) throw new Error('A nonfree FFmpeg build cannot be released');
    }
    const ytdlp = path.join(bin, 'yt-dlp' + (process.platform === 'win32' ? '.exe' : ''));
    const ytdlpVersion = run(ytdlp, ['--version']);
    // Releases ship only the pinned, checksum-verified yt-dlp (apps/desktop/scripts/yt-dlp-release.json).
    const pinnedYtDlp = require('../apps/desktop/scripts/yt-dlp-release.json');
    if (ytdlpVersion !== pinnedYtDlp.version) throw new Error(`Packaged yt-dlp ${ytdlpVersion} is not the pinned ${pinnedYtDlp.version}`);
    const report = {
      platform: process.platform, arch: process.arch, checkedAt: new Date().toISOString(), smoke, updateRepository,
      releaseTag: process.env.GITHUB_REF_NAME || `v${expectedVersion}`, sourceCommit: process.env.GITHUB_SHA || null,
      installer: { name: path.basename(artifact), sha256: sha256(artifact), signature: 'verified', ...(process.platform === 'win32' ? { blockmapSha256: sha256(`${artifact}.blockmap`) } : {}) },
      ...(updateArchive ? { updateArchive } : {}),
      ffmpeg: metadata,
      ytdlp: { version: ytdlpVersion, sha256: sha256(ytdlp), sourceUrl: `https://github.com/yt-dlp/yt-dlp/tree/${ytdlpVersion}`, licenseNotice: 'THIRD_PARTY_NOTICES.md' },
    };
    fs.writeFileSync(path.join(dist, `release-verification-${process.platform}-${process.arch}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(`Verified signed installer and packaged HLS download: ${path.basename(artifact)}`);
  } finally {
    if (mounted) run('hdiutil', ['detach', mount]);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module) verifyRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verifyRelease };
