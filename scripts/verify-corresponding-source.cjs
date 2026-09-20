const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function verifySourcePacket(base, releaseTag) {
  const directory = path.join(base, 'release-source');
  const archive = path.join(directory, 'vidsnag-corresponding-source.tar.xz');
  const manifestPath = path.join(directory, 'corresponding-source.json');
  if (!fs.existsSync(archive) || !fs.existsSync(manifestPath)) throw new Error('Publication requires the reviewed corresponding-source archive and manifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!/^v\d+\.\d+\.\d+$/.test(releaseTag || '') || manifest.releaseTag !== releaseTag) throw new Error('Corresponding source must identify this exact release tag');
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit || '')) throw new Error('Corresponding source must identify the exact VidSnag Git commit');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (manifest.archiveSha256 !== sha256) throw new Error('Corresponding-source archive SHA256 does not match its reviewed manifest');
  const listed = spawnSync('tar', ['-tJf', archive], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  if (listed.error || listed.status !== 0) throw new Error('Cannot read the corresponding-source tar.xz archive');
  const entries = new Set(listed.stdout.split(/\r?\n/).filter(Boolean).map(name => name.replace(/^\.\//, '')));
  if ([...entries].some(name => name.startsWith('/') || name.split('/').includes('..'))) throw new Error('Source archive contains unsafe paths');
  if (!Array.isArray(manifest.components) || !manifest.components.length || !Array.isArray(manifest.builds)) throw new Error('Source manifest must list components and platform builds');
  const components = new Map();
  for (const component of manifest.components) {
    if (!component.id || !component.version || !component.path || !component.licenseFile || !component.buildInstructions) throw new Error('Every source component needs an ID, exact version, directory, license and build instructions');
    if (components.has(component.id)) throw new Error(`Duplicate source component: ${component.id}`);
    const prefix = component.path.replace(/\/$/, '') + '/';
    if (![...entries].some(name => name.startsWith(prefix) && !name.endsWith('/')) || !entries.has(component.licenseFile) || !entries.has(component.buildInstructions)) throw new Error(`Source, license or build instructions are absent for ${component.id}`);
    components.set(component.id, component);
  }
  if (components.get('vidsnag')?.version !== releaseTag.slice(1)) throw new Error('The source archive must include VidSnag source for this release');
  return { archive, manifestPath, sha256, manifest, components };
}

function verifyCorrespondingSource(base, releaseTag) {
  const { archive, manifestPath, sha256, manifest, components } = verifySourcePacket(base, releaseTag);
  const verifiedPlatforms = new Set();
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('release-') || entry.name === 'release-source') continue;
    for (const file of fs.readdirSync(path.join(base, entry.name))) {
      if (!/^release-verification-.*\.json$/.test(file)) continue;
      const report = JSON.parse(fs.readFileSync(path.join(base, entry.name, file), 'utf8'));
      if (report.sourceCommit !== manifest.sourceCommit || report.releaseTag !== releaseTag) throw new Error('Corresponding source and verified binaries must use the same Git commit and release tag');
      const build = manifest.builds.find(item => item.platform === report.platform && item.arch === report.arch);
      if (!build || report.smoke?.passed !== true) throw new Error(`Missing source coverage or passed smoke for ${report.platform}/${report.arch}`);
      const versions = { ffmpeg: report.ffmpeg.tools.ffmpeg.version.split('\n')[0], ffprobe: report.ffmpeg.tools.ffprobe.version.split('\n')[0], 'yt-dlp': report.ytdlp.version };
      for (const [tool, version] of Object.entries(versions)) {
        const source = build.tools?.[tool];
        if (source?.version !== version || !Array.isArray(source.components) || !source.components.length || source.components.some(id => !components.has(id))) throw new Error(`Corresponding source does not cover the exact ${tool} build for ${report.platform}/${report.arch}`);
      }
      verifiedPlatforms.add(`${report.platform}/${report.arch}`);
    }
  }
  if (['darwin/arm64', 'darwin/x64', 'win32/x64'].some(platform => !verifiedPlatforms.has(platform))) throw new Error('Source coverage is required for macOS arm64, macOS x64 and Windows x64');
  // Archive contents cannot prove completeness of linked dependency sources;
  // the owner reviews that evidence before manually publishing the draft.
  return { archive, manifestPath, sha256 };
}
if (require.main === module) {
  try {
    const packetOnly = process.argv.includes('--packet-only');
    const verify = packetOnly ? verifySourcePacket : verifyCorrespondingSource;
    verify(path.resolve(process.argv[2] || 'release-assets'), process.env.GITHUB_REF_NAME);
    console.log(packetOnly ? 'Source packet structure and archive checksum verified; exact bundled-tool coverage is checked during release assembly' : 'Corresponding-source packet matches the release and every bundled tool version');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyCorrespondingSource, verifySourcePacket };
