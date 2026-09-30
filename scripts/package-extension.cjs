#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { crc32, deflateRawSync } = require('node:zlib');

// Deliberately enumerate release inputs: new local files never enter an artifact
// unless they are reviewed here. Development galleries stay in the repository.
const RUNTIME_FILES = Object.freeze([
  'manifest.json', 'popup.html', 'popup.css', 'popup.js', 'player.html', 'player.js',
  'service-worker.js', 'js/build-config.js',
  'js/content.js', 'js/detection.js', 'js/media-detector.js', 'js/preview-origin.js', 'js/browser-downloads.js', 'js/accent-icon.js',
  'popup/titles.js', 'popup/model.js', 'popup/source-preview.js', 'popup/page-preview.js', 'popup/accent.js', 'popup/pixel.js', 'popup/speed-trace.js',
  'shared/strings.js', 'shared/rows.js', 'shared/hls.js', 'shared/selection.js', 'shared/audioTracks.js', 'shared/accents.js',
  'vendor/hls.min.js', 'vendor/hls.LICENSE.txt', 'vendor/lucide.LICENSE.txt',
  'fonts/inter-latin.woff2', 'fonts/LICENSE', 'fonts/jersey15-latin.woff2', 'fonts/OFL-Jersey15.txt',
  'img/icon-16.png', 'img/icon-48.png', 'img/icon-128.png', 'img/snagthis-logo-title.svg',
]);
const SHARED_FILES = ['strings.js', 'rows.js', 'hls.js', 'selection.js', 'audioTracks.js', 'accents.js'];
const DEVELOPMENT_FLAGS = 'Object.freeze({ storeBuild: false })';

// The ZIP is the Chrome Web Store build. It turns off YouTube downloads while
// unpacked development copies keep them (docs/extension-release.md).
function storeBuildConfig(data) {
  const source = data.toString('utf8');
  if (source.split(DEVELOPMENT_FLAGS).length !== 2) throw new Error('js/build-config.js must declare the development flags exactly once');
  return Buffer.from(source.replace(DEVELOPMENT_FLAGS, 'Object.freeze({ storeBuild: true })'));
}

function readRegularFile(file) {
  if (!fs.lstatSync(file).isFile()) throw new Error(`Release input must be a regular file: ${file}`);
  return fs.readFileSync(file);
}

function releaseEntries(root) {
  const extension = path.join(root, 'apps/extension');
  const manifest = JSON.parse(readRegularFile(path.join(extension, 'manifest.json')));
  const workspace = JSON.parse(readRegularFile(path.join(extension, 'package.json')));
  const versionParts = String(manifest.version).split('.');
  if (manifest.manifest_version !== 3 || versionParts.length > 4 || !versionParts.some(part => Number(part) > 0)
    || versionParts.some(part => !/^(?:0|[1-9]\d*)$/.test(part) || Number(part) > 65535)) throw new Error('A valid Manifest V3 Chrome version is required');
  if (manifest.version !== workspace.version) throw new Error('Extension manifest and workspace versions must match');
  for (const name of SHARED_FILES) {
    if (!readRegularFile(path.join(extension, 'shared', name)).equals(readRegularFile(path.join(root, 'packages/contracts/src', name)))) {
      throw new Error(`Stale shared/${name}; run npm run build:extension:css before packaging`);
    }
  }
  const entries = RUNTIME_FILES.map(name => {
    let data = readRegularFile(path.join(extension, name));
    if (name === 'popup.html') data = Buffer.from(data.toString('utf8').replace(/^\s*<script src="popup\/demo\.js"><\/script>\r?\n/m, ''));
    if (name === 'js/build-config.js') data = storeBuildConfig(data);
    return { name, data };
  });
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) entries.push({ name, data: readRegularFile(path.join(root, name)) });
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function zipEntries(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // ZIP 2.0, UTF-8 filenames, deflate.
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x21, 12); // Fixed 1980-01-01 timestamp, independent of checkout.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x0314, 4); // Fixed Unix 0644 attributes on every host OS.
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function packageExtension({ root = path.resolve(__dirname, '..'), output = path.join(root, 'snagthis-extension.zip') } = {}) {
  const entries = releaseEntries(root);
  const archive = zipEntries(entries);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, archive);
  return { output, files: entries.map(entry => entry.name), bytes: archive.length };
}

if (require.main === module) {
  try {
    const result = packageExtension({ ...(process.argv[2] ? { output: path.resolve(process.argv[2]) } : {}) });
    console.log(`Packaged ${result.files.length} runtime/license files (${result.bytes} bytes): ${result.output}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { packageExtension, RUNTIME_FILES };
