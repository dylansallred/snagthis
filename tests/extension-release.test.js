const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateTag, assertNewRelease, releaseMetadata } = require('../scripts/extension-release.cjs');

test('extension release identity is independent of desktop versions and refuses reused or older tags', () => {
  assert.equal(validateTag('extension-v1.2.3', '1.2.3', '1.2.3'), '1.2.3');
  for (const tag of ['v1.2.3', 'extension-v01.2.3', 'extension-v1.2.3-beta', 'extension-v65536.0.0', 'extension-v0.0.0']) assert.throws(() => validateTag(tag, tag.slice(11), tag.slice(11)), /stable extension/);
  assert.throws(() => validateTag('extension-v1.2.3', '1.2.4', '1.2.3'), /must match/);
  assert.doesNotThrow(() => assertNewRelease('extension-v1.2.3', [{ tag_name: 'v99.0.0' }, { tag_name: 'extension-v1.2.2', prerelease: true }]));
  assert.throws(() => assertNewRelease('extension-v1.2.3', [{ tag_name: 'extension-v1.2.3', draft: true }]), /already has a release/);
  assert.throws(() => assertNewRelease('extension-v1.2.3', [{ tag_name: 'extension-v1.3.0', prerelease: true }]), /must be newer/);
});

test('extension metadata binds the ZIP checksum to exact public-at-launch source identity', () => {
  const bytes = Buffer.from('isolated package fixture');
  const input = { tag: 'extension-v1.2.3', version: '1.2.3', sourceCommit: 'a'.repeat(40), repository: 'dylansallred/vidsnag', bytes };
  const report = releaseMetadata(input);
  assert.equal(report.sourceArchive, `https://github.com/dylansallred/vidsnag/archive/${input.sourceCommit}.zip`);
  assert.equal(report.sourceCommit, input.sourceCommit);
  assert.equal(report.artifact.name, 'vidsnag-extension.zip');
  assert.equal(report.artifact.size, bytes.length);
  assert.equal(report.artifact.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.throws(() => releaseMetadata({ ...input, sourceCommit: 'main' }), /exact Git commit/);
  assert.throws(() => releaseMetadata({ ...input, repository: 'https://example.com/repo' }), /repository is required/);
});
