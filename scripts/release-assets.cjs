const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const base = path.resolve(process.argv[2] || 'release-assets');
require('./verify-corresponding-source.cjs').verifyCorrespondingSource(base, process.env.GITHUB_REF_NAME);
const output = path.join(base, 'publish');
fs.mkdirSync(output, { recursive: true });
const metadata = new Map();
for (const directory of fs.readdirSync(base, { withFileTypes: true })) {
  if (!directory.isDirectory() || !directory.name.startsWith('release-')) continue;
  for (const name of fs.readdirSync(path.join(base, directory.name))) {
    const source = path.join(base, directory.name, name);
    if (!fs.statSync(source).isFile()) continue;
    if (/^latest.*\.yml$/.test(name)) {
      const next = yaml.load(fs.readFileSync(source, 'utf8'));
      const existing = metadata.get(name);
      if (existing && existing.version !== next.version) throw new Error(`Conflicting release versions in ${name}`);
      if (existing) {
        const urls = new Set(existing.files.map(file => file.url));
        existing.files.push(...next.files.filter(file => !urls.has(file.url)));
      } else metadata.set(name, next);
      continue;
    }
    const destination = path.join(output, name);
    if (fs.existsSync(destination) && !fs.readFileSync(source).equals(fs.readFileSync(destination))) throw new Error(`Conflicting release artifact: ${name}`);
    fs.copyFileSync(source, destination);
  }
}
for (const [name, value] of metadata) {
  // DMG stapling changes bytes after electron-builder wrote the metadata.
  for (const file of value.files) {
    const target = path.join(output, path.basename(decodeURIComponent(file.url)));
    if (!fs.existsSync(target)) throw new Error(`Update metadata references an absent artifact: ${file.url}`);
    const bytes = fs.readFileSync(target);
    file.sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
    file.size = bytes.length;
  }
  const legacy = value.files.find(file => file.url === value.path);
  if (legacy) value.sha512 = legacy.sha512;
  fs.writeFileSync(path.join(output, name), yaml.dump(value));
}
const files = fs.readdirSync(output);
if (!files.some(name => name.endsWith('.dmg')) || !files.some(name => name.endsWith('.exe')) || !files.includes('vidsnag-extension.zip')) throw new Error('Release requires macOS, Windows and extension artifacts');
const checksums = files.sort().map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')}  ${name}`).join('\n');
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), checksums + '\n');
