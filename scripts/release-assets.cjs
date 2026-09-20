const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { verifyCorrespondingSource } = require('./verify-corresponding-source.cjs');
const { sourceRepository } = require('./verify-update-config.cjs');

const targets = [
  { directory: 'release-mac-x64', platform: 'darwin', arch: 'x64', metadata: 'latest-mac.yml' },
  { directory: 'release-mac-arm64', platform: 'darwin', arch: 'arm64', metadata: 'latest-mac.yml' },
  { directory: 'release-win-x64', platform: 'win32', arch: 'x64', metadata: 'latest.yml' },
];
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(bytes).digest(encoding);
function artifactName(value) {
  if (typeof value !== 'string') throw new Error('Release artifact name is missing');
  const name = decodeURIComponent(value);
  if (!name || name === '.' || name === '..' || /[/\\\x00-\x1f?#:]/.test(name)) throw new Error(`Unsafe release artifact name: ${value}`);
  return name;
}

function assembleRelease(base, releaseTag, sourceCommit = process.env.GITHUB_SHA) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(releaseTag || '')) throw new Error('Release requires a stable vX.Y.Z tag');
  const version = releaseTag.slice(1);
  verifyCorrespondingSource(base, releaseTag);
  const payload = new Map();
  const metadata = new Map();
  function include(directory, name) {
    const source = path.join(base, directory, artifactName(name));
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) throw new Error(`Missing release artifact: ${directory}/${name}`);
    const bytes = fs.readFileSync(source);
    if (payload.has(name) && payload.get(name).sha256 !== hash(bytes)) throw new Error(`Conflicting release artifact: ${name}`);
    payload.set(name, { source, sha256: hash(bytes) });
    return bytes;
  }
  for (const target of targets) {
    const reportName = `release-verification-${target.platform}-${target.arch}.json`;
    const report = JSON.parse(include(target.directory, reportName));
    if (report.platform !== target.platform || report.arch !== target.arch || report.releaseTag !== releaseTag || report.smoke?.passed !== true || report.smoke.version !== version || (sourceCommit && report.sourceCommit !== sourceCommit)) {
      throw new Error(`Verification report does not match this release: ${target.directory}`);
    }
    if (report.updateRepository !== sourceRepository) throw new Error(`Installer update feed was not verified: ${target.directory}`);
    const expected = [report.installer];
    if (target.platform === 'darwin') {
      if (!report.updateArchive || report.updateArchive.smoke?.passed !== true || report.updateArchive.smoke.version !== version) throw new Error(`The macOS update ZIP was not smoke-tested: ${target.arch}`);
      if (report.updateArchive.updateRepository !== sourceRepository) throw new Error(`Update ZIP feed was not verified: ${target.arch}`);
      expected.push(report.updateArchive);
    }
    const verified = new Map();
    for (const artifact of expected) {
      const name = artifactName(artifact?.name);
      const extension = artifact === report.updateArchive ? '.zip' : target.platform === 'darwin' ? '.dmg' : '.exe';
      if (!name.endsWith(extension) || (target.platform === 'darwin' && name.includes('arm64') !== (target.arch === 'arm64'))) throw new Error(`Artifact type or architecture does not match ${target.directory}: ${name}`);
      const bytes = include(target.directory, name);
      if (artifact.signature !== 'verified' || hash(bytes) !== artifact.sha256) throw new Error(`Artifact changed after signature and smoke verification: ${name}`);
      verified.set(name, bytes);
      if (extension === '.zip' || extension === '.exe') {
        const blockmap = include(target.directory, `${name}.blockmap`);
        if (hash(blockmap) !== artifact.blockmapSha256) throw new Error(`Blockmap changed after verification: ${name}`);
      }
    }
    const update = yaml.load(fs.readFileSync(path.join(base, target.directory, target.metadata), 'utf8'));
    if (update?.version !== version || !Array.isArray(update.files) || update.files.length !== expected.length) throw new Error(`Invalid update metadata for ${target.directory}`);
    const seen = new Set();
    for (const file of update.files) {
      const name = artifactName(file.url);
      const bytes = verified.get(name);
      if (!bytes || seen.has(name)) throw new Error(`Update metadata references an unverified or duplicate artifact: ${file.url}`);
      seen.add(name);
      const sha512 = hash(bytes, 'sha512', 'base64');
      // Stapling the final DMG changes its bytes. ZIP/EXE update payloads must
      // still match the original builder checksum, never silently repair it.
      if (!name.endsWith('.dmg') && (file.sha512 !== sha512 || file.size !== bytes.length)) throw new Error(`Update payload checksum or size mismatch: ${name}`);
      file.sha512 = sha512;
      file.size = bytes.length;
    }
    const existing = metadata.get(target.metadata);
    if (existing) existing.files.push(...update.files);
    else metadata.set(target.metadata, update);
  }
  include('release-extension', 'vidsnag-extension.zip');
  include('release-source', 'vidsnag-corresponding-source.tar.xz');
  include('release-source', 'corresponding-source.json');
  for (const [name, update] of metadata) {
    // Modern clients choose the architecture from files. Keep the legacy path
    // deterministic and Intel-compatible instead of whichever runner won a race.
    const primary = update.files.find(file => file.url.endsWith(name === 'latest-mac.yml' ? '.zip' : '.exe') && !file.url.includes('arm64'));
    update.path = primary.url;
    update.sha512 = primary.sha512;
    const bytes = Buffer.from(yaml.dump(update));
    payload.set(name, { bytes, sha256: hash(bytes) });
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const source = path.resolve(__dirname, '..', name);
    payload.set(name, { source, sha256: hash(fs.readFileSync(source)) });
  }
  const output = path.join(base, 'publish');
  // A rerun must not attach stale files left by a previous assembly.
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const [name, entry] of payload) {
    if (entry.source) fs.copyFileSync(entry.source, path.join(output, name));
    else fs.writeFileSync(path.join(output, name), entry.bytes);
  }
  const checksums = [...payload].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => `${entry.sha256}  ${name}`).join('\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), checksums + '\n');
  return output;
}

if (require.main === module) {
  try { console.log(`Verified release payload: ${assembleRelease(path.resolve(process.argv[2] || 'release-assets'), process.env.GITHUB_REF_NAME)}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { assembleRelease };
