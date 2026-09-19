const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { packagedSmoke } = require('./packaged-smoke.cjs');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'apps/desktop/dist-electron');
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180_000, ...extra });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.error?.message || result.stderr || result.stdout}`);
  return String(result.stdout || '').trim();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function topLevel(extension) { return fs.readdirSync(dist).filter(name => name.endsWith(extension)).map(name => path.join(dist, name)); }

async function verifyRelease() {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Run installer verification on macOS or Windows');
  const artifacts = topLevel(process.platform === 'darwin' ? '.dmg' : '.exe');
  if (artifacts.length !== 1) throw new Error(`Expected one installer for this architecture, found ${artifacts.length}`);
  const artifact = artifacts[0];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-installer-'));
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
      run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', installed]);
      run('xcrun', ['stapler', 'validate', installed]);
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', installed]);
      run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', installed]);
      executable = path.join(installed, 'Contents/MacOS/VidSnag');
      resources = path.join(installed, 'Contents/Resources');
    } else {
      const quote = value => "'" + value.replace(/'/g, "''") + "'";
      run('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath ${quote(artifact)}; if ($s.Status -ne 'Valid') { throw ('Invalid installer signature: ' + $s.Status) }`]);
      const installed = path.join(temporary, 'app');
      run(artifact, ['/S', `/D=${installed}`]);
      executable = path.join(installed, 'VidSnag.exe');
      resources = path.join(installed, 'resources');
      run('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath ${quote(executable)}; if ($s.Status -ne 'Valid') { throw ('Invalid app signature: ' + $s.Status) }`]);
    }
    const smoke = await packagedSmoke(executable, resources);
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
    const report = {
      platform: process.platform, arch: process.arch, checkedAt: new Date().toISOString(), smoke,
      installer: { name: path.basename(artifact), sha256: sha256(artifact), signature: 'verified' },
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
