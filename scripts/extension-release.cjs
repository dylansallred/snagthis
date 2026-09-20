#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { packageExtension } = require('./package-extension.cjs');
const TAG = /^extension-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;

function validateTag(tag, manifestVersion, workspaceVersion) {
  const match = TAG.exec(tag || '');
  if (!match || match[1].split('.').some(value => Number(value) > 65535) || match[1] === '0.0.0') throw new Error('Extension releases require a stable extension-vX.Y.Z tag with valid Chrome version components');
  if (match[1] !== manifestVersion || match[1] !== workspaceVersion) throw new Error('Extension tag must match both extension manifest and workspace versions');
  return match[1];
}

function assertNewRelease(tag, releases) {
  const version = TAG.exec(tag || '')?.[1];
  if (!version) throw new Error('Invalid extension release tag');
  const next = version.split('.').map(Number);
  for (const release of releases) {
    if (release.tag_name === tag) throw new Error('This extension release tag already has a release; inspect it manually instead of overwriting assets');
    const previous = TAG.exec(release.tag_name || '')?.[1];
    if (!previous || release.draft) continue;
    const parts = previous.split('.').map(Number);
    if ((next.map((value, index) => value - parts[index]).find(value => value !== 0) || 0) <= 0) throw new Error(`Extension ${tag} must be newer than published ${release.tag_name}`);
  }
}

function releaseMetadata({ tag, version, sourceCommit, repository, bytes }) {
  validateTag(tag, version, version);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit || '')) throw new Error('The extension release requires the exact Git commit');
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository || '')) throw new Error('The source GitHub repository is required');
  return { tag, version, sourceCommit, sourceArchive: `https://github.com/${repository}/archive/${sourceCommit}.zip`,
    artifact: { name: 'vidsnag-extension.zip', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..'); const tag = process.env.GITHUB_REF_NAME;
    const version = validateTag(tag, require('../apps/extension/manifest.json').version, require('../apps/extension/package.json').version);
    if (process.argv.includes('--check')) console.log('Extension tag and both extension versions match.');
    else {
      const output = path.join(root, 'release-assets/extension-only');
      const archive = packageExtension({ root, output: path.join(output, 'vidsnag-extension.zip') });
      const report = releaseMetadata({ tag, version, sourceCommit: process.env.RELEASE_SOURCE_COMMIT,
        repository: process.env.GITHUB_REPOSITORY, bytes: fs.readFileSync(archive.output) });
      fs.writeFileSync(path.join(output, 'extension-release.json'), JSON.stringify(report, null, 2) + '\n');
      fs.writeFileSync(path.join(output, 'SHA256SUMS'), `${report.artifact.sha256}  ${report.artifact.name}\n`);
      console.log(`Prepared ${tag} runtime ZIP, source identity and checksum for manual review.`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateTag, assertNewRelease, releaseMetadata };
