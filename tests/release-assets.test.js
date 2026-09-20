const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { assembleRelease } = require('../scripts/release-assets.cjs');
const { sourceRepository, verifyUpdateConfig } = require('../scripts/verify-update-config.cjs');

const digest = (value, algorithm = 'sha256', encoding = 'hex') => crypto.createHash(algorithm).update(value).digest(encoding);
const releaseTag = 'v2.0.45';
const sourceCommit = 'a'.repeat(40);
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-release-'));
  const write = (directory, name, contents) => {
    const destination = path.join(base, directory, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, contents);
  };
  const sourceDirectory = path.join(base, 'source-content');
  fs.mkdirSync(sourceDirectory);
  for (const name of ['source.c', 'LICENSE', 'BUILD.md']) fs.writeFileSync(path.join(sourceDirectory, name), name);
  fs.mkdirSync(path.join(base, 'release-source'));
  const archive = path.join(base, 'release-source/vidsnag-corresponding-source.tar.xz');
  const components = ['vidsnag', 'ffmpeg', 'yt-dlp'].map(id => ({ id, version: id === 'vidsnag' ? '2.0.45' : 'fixture', path: '.', licenseFile: 'LICENSE', buildInstructions: 'BUILD.md' }));
  // The source verifier deliberately requires real files inside each named directory.
  for (const component of components) component.path = 'sources';
  fs.mkdirSync(path.join(sourceDirectory, 'sources'));
  fs.writeFileSync(path.join(sourceDirectory, 'sources/source.c'), 'fixture source');
  const archived = spawnSync('tar', ['-cJf', 'release-source/vidsnag-corresponding-source.tar.xz', '-C', 'source-content', '.'], { cwd: base, encoding: 'utf8' });
  assert.equal(archived.status, 0, archived.stderr);
  const builds = [];
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
    const directory = `release-${platform === 'darwin' ? 'mac' : 'win'}-${arch}`;
    const installer = `VidSnag-2.0.45${arch === 'arm64' ? '-arm64' : ''}.${platform === 'darwin' ? 'dmg' : 'exe'}`;
    const zip = `VidSnag-2.0.45${arch === 'arm64' ? '-arm64' : ''}-mac.zip`;
    const smoke = { passed: true, version: '2.0.45' };
    const toolVersion = 'ffmpeg fixture';
    const report = { platform, arch, releaseTag, sourceCommit, smoke, updateRepository: sourceRepository,
      ffmpeg: { tools: { ffmpeg: { version: toolVersion }, ffprobe: { version: toolVersion } } }, ytdlp: { version: 'fixture' } };
    const files = [];
    for (const name of platform === 'darwin' ? [installer, zip] : [installer]) {
      const bytes = Buffer.from(`verified ${name}`);
      write(directory, name, bytes);
      const proof = { name, sha256: digest(bytes), signature: 'verified' };
      if (!name.endsWith('.dmg')) {
        const blockmap = Buffer.from(`blockmap ${name}`);
        proof.blockmapSha256 = digest(blockmap);
        write(directory, `${name}.blockmap`, blockmap);
      }
      if (name === installer) report.installer = proof;
      else report.updateArchive = { ...proof, smoke, updateRepository: sourceRepository };
      files.push({ url: name, sha512: name.endsWith('.dmg') ? 'before-stapling' : digest(bytes, 'sha512', 'base64'), size: bytes.length });
    }
    write(directory, `release-verification-${platform}-${arch}.json`, JSON.stringify(report));
    write(directory, platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml', yaml.dump({ version: '2.0.45', files, path: files[0].url, sha512: files[0].sha512 }));
    write(directory, 'builder-effective-config.yaml', 'not public');
    builds.push({ platform, arch, tools: { ffmpeg: { version: toolVersion, components: ['ffmpeg'] }, ffprobe: { version: toolVersion, components: ['ffmpeg'] }, 'yt-dlp': { version: 'fixture', components: ['yt-dlp'] } } });
  }
  write('release-source', 'corresponding-source.json', JSON.stringify({ releaseTag, sourceCommit, archiveSha256: digest(fs.readFileSync(archive)), components, builds }));
  write('release-extension', 'vidsnag-extension.zip', 'extension fixture');
  write('publish', 'stale-debug.yml', 'must disappear');
  return { base, write };
}

test('release assembly merges both Mac architectures, checks verified update payloads, and fails closed on mismatches', async t => {
  const { base, write } = fixture();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const output = assembleRelease(base, releaseTag, sourceCommit);
  const mac = yaml.load(fs.readFileSync(path.join(output, 'latest-mac.yml'), 'utf8'));
  assert.equal(mac.files.length, 4);
  assert.equal(mac.path, 'VidSnag-2.0.45-mac.zip');
  assert.ok(mac.files.some(file => file.url.includes('arm64') && file.url.endsWith('.zip')));
  for (const file of mac.files) {
    const bytes = fs.readFileSync(path.join(output, file.url));
    assert.equal(file.sha512, digest(bytes, 'sha512', 'base64'));
    assert.equal(file.size, bytes.length);
  }
  const published = fs.readdirSync(output);
  assert.ok(!published.some(name => /builder|stale/.test(name)));
  const checksums = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8');
  for (const name of published.filter(name => name !== 'SHA256SUMS.txt')) assert.ok(checksums.includes(`${digest(fs.readFileSync(path.join(output, name)))}  ${name}\n`));

  const metadataPath = path.join(base, 'release-win-x64/latest.yml');
  const originalMetadata = fs.readFileSync(metadataPath);
  const metadata = yaml.load(originalMetadata.toString());
  metadata.files[0].sha512 = 'corrupt';
  fs.writeFileSync(metadataPath, yaml.dump(metadata));
  assert.throws(() => assembleRelease(base, releaseTag, sourceCommit), /checksum or size mismatch/);
  fs.writeFileSync(metadataPath, originalMetadata);

  const zipPath = path.join(base, 'release-mac-arm64/VidSnag-2.0.45-arm64-mac.zip');
  const originalZip = fs.readFileSync(zipPath);
  fs.appendFileSync(zipPath, 'changed after smoke');
  assert.throws(() => assembleRelease(base, releaseTag, sourceCommit), /changed after signature/);
  fs.writeFileSync(zipPath, originalZip);
  assert.throws(() => assembleRelease(base, releaseTag, 'b'.repeat(40)), /does not match this release/);
  assert.throws(() => assembleRelease(base, 'v2.0.46', sourceCommit), /exact release tag/);

  const reportPath = path.join(base, 'release-mac-x64/release-verification-darwin-x64.json');
  const report = JSON.parse(fs.readFileSync(reportPath));
  report.updateRepository = 'other/repository';
  write('release-mac-x64', path.basename(reportPath), JSON.stringify(report));
  assert.throws(() => assembleRelease(base, releaseTag, sourceCommit), /Installer update feed was not verified/);
  report.updateRepository = sourceRepository;
  report.updateArchive.updateRepository = 'other/repository';
  write('release-mac-x64', path.basename(reportPath), JSON.stringify(report));
  assert.throws(() => assembleRelease(base, releaseTag, sourceCommit), /Update ZIP feed was not verified/);
  report.updateArchive.updateRepository = sourceRepository;
  report.updateArchive.smoke.passed = false;
  write('release-mac-x64', path.basename(reportPath), JSON.stringify(report));
  assert.throws(() => assembleRelease(base, releaseTag, sourceCommit), /update ZIP was not smoke-tested/);
});

test('desktop update configuration stays on the intended repository without embedded authentication', () => {
  const config = require('../apps/desktop/package.json').build.publish[0];
  assert.equal(verifyUpdateConfig(config), sourceRepository);
  assert.throws(() => verifyUpdateConfig({ ...config, repo: 'different-repository' }), /must use GitHub repository/);
  assert.throws(() => verifyUpdateConfig(config, 'other/source'), /must use GitHub repository/);
  for (const change of [{ private: true }, { token: 'fixture-token' }, { requestHeaders: { Authorization: 'fixture' } }, { host: 'example.com' }, { protocol: 'http' }]) {
    assert.throws(() => verifyUpdateConfig({ ...config, ...change }), /public HTTPS without embedded credentials/);
  }
});
