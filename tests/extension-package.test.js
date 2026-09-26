const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { inflateRawSync, crc32 } = require('node:zlib');
const { packageExtension, RUNTIME_FILES } = require('../scripts/package-extension.cjs');
const repo = path.resolve(__dirname, '..');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-extension-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of [...RUNTIME_FILES, 'package.json']) {
    const target = path.join(root, 'apps/extension', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (name === 'popup.css') fs.writeFileSync(target, '@font-face{font-family:Inter;src:url(fonts/inter-latin.woff2)}');
    else fs.copyFileSync(path.join(repo, 'apps/extension', name), target);
  }
  for (const name of ['strings.js', 'rows.js', 'hls.js', 'selection.js', 'audioTracks.js', 'accents.js']) {
    const target = path.join(root, 'packages/contracts/src', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repo, 'packages/contracts/src', name), target);
    fs.copyFileSync(target, path.join(root, 'apps/extension/shared', name));
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(repo, name), path.join(root, name));
  return root;
}

function unpack(archive) {
  const footer = archive.length - 22;
  assert.equal(archive.readUInt32LE(footer), 0x06054b50);
  const count = archive.readUInt16LE(footer + 10);
  let cursor = archive.readUInt32LE(footer + 16);
  assert.equal(cursor + archive.readUInt32LE(footer + 12), footer);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    assert.equal(archive.readUInt16LE(cursor + 10), 8);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const local = archive.readUInt32LE(cursor + 42);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = inflateRawSync(archive.subarray(start, start + compressedSize));
    assert.equal(data.length, size);
    assert.equal(crc32(data), archive.readUInt32LE(cursor + 16));
    assert.equal(archive.readUInt32LE(cursor + 38) >>> 16, 0o100644);
    entries.set(name, data);
    cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  assert.equal(cursor, footer);
  return entries;
}

test('extension ZIP is deterministic, complete and excludes development or accidental local files', t => {
  const root = fixture(t);
  const extension = path.join(root, 'apps/extension');
  for (const [name, content] of [['.env', 'fixture-secret'], ['package.json.bak', '{}'], ['debug.log', 'fixture-log'], ['popup/media/demo.mp4', 'fixture-video']]) {
    fs.mkdirSync(path.dirname(path.join(extension, name)), { recursive: true });
    fs.writeFileSync(path.join(extension, name), content);
  }
  const sourceHtml = fs.readFileSync(path.join(extension, 'popup.html'));
  const first = packageExtension({ root });
  const original = fs.readFileSync(first.output);
  const entries = unpack(original);
  assert.deepEqual([...entries.keys()], [...RUNTIME_FILES, 'LICENSE', 'THIRD_PARTY_NOTICES.md'].sort());
  const manifest = JSON.parse(entries.get('manifest.json'));
  assert.equal(manifest.version, require('../apps/extension/manifest.json').version);
  const references = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap(script => script.js)];
  for (const name of ['popup.html', 'player.html']) {
    for (const match of entries.get(name).toString().matchAll(/(?:src|href)="([^"#]+)"/g)) references.push(match[1]);
  }
  for (const reference of references) assert.ok(entries.has(reference), `Bundled runtime reference ${reference} exists`);
  assert.ok(!entries.get('popup.html').toString().includes('popup/demo.js'));
  // The ZIP is the store build: YouTube downloads are off there, and only there.
  const flags = source => { const context = {}; vm.runInNewContext(source, context); return context.SnagThisBuild; };
  assert.deepEqual({ ...flags(entries.get('js/build-config.js').toString()) }, { storeBuild: true });
  assert.deepEqual({ ...flags(fs.readFileSync(path.join(extension, 'js/build-config.js'), 'utf8')) }, { storeBuild: false }, 'packaging never edits the development flags');
  assert.ok(entries.get('popup.html').toString().includes('js/build-config.js'), 'the popup reads the build flags');
  assert.match(entries.get('service-worker.js').toString(), /importScripts\('js\/build-config\.js'/, 'the worker enforces the build flags');
  assert.ok(!manifest.permissions.includes('tabs'), 'tab URLs come from host access; the tabs permission is not requested');
  assert.deepEqual(fs.readFileSync(path.join(extension, 'popup.html')), sourceHtml, 'packaging never edits the development popup');
  for (const [name, data] of entries) if (name.endsWith('.js')) assert.doesNotThrow(() => new vm.Script(data.toString(), { filename: name }));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.deepEqual(entries.get(name), fs.readFileSync(path.join(root, name)));
  for (const name of RUNTIME_FILES) fs.utimesSync(path.join(extension, name), new Date('2020-01-01'), new Date('2030-01-01'));
  packageExtension({ root });
  assert.deepEqual(fs.readFileSync(first.output), original, 'checkout timestamps do not affect release bytes');
  t.diagnostic(`Release allowlist contains ${entries.size} files; ZIP reads back successfully and is byte-identical after timestamp changes.`);
});

test('extension packaging refuses stale contracts, missing runtime inputs and mismatched versions', t => {
  const root = fixture(t);
  const extension = path.join(root, 'apps/extension');
  const shared = path.join(extension, 'shared/hls.js');
  const original = fs.readFileSync(shared);
  fs.appendFileSync(shared, '\n// stale fixture');
  assert.throws(() => packageExtension({ root }), /Stale shared\/hls.js/);
  fs.writeFileSync(shared, original);
  const modelPath = path.join(extension, 'popup/model.js');
  const model = fs.readFileSync(modelPath);
  fs.unlinkSync(modelPath);
  assert.throws(() => packageExtension({ root }), /ENOENT/);
  fs.writeFileSync(modelPath, model);
  const configPath = path.join(extension, 'js/build-config.js');
  const config = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(configPath, config.replace('storeBuild: false', 'storeBuild: true'));
  assert.throws(() => packageExtension({ root }), /development flags/, 'an unexpected flag file never ships unchecked');
  fs.writeFileSync(configPath, config);
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.version = '1.0.99';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => packageExtension({ root }), /versions must match/);
});
