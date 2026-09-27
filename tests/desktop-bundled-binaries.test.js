const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { findBundledExecutable } = require('../apps/desktop/electron/bundledBinaries');

const source = fs.readFileSync(path.resolve(__dirname, '../apps/desktop/electron/main.js'), 'utf8');

test('main resolves bundled yt-dlp, FFmpeg and FFprobe through the shared chmod-tolerant lookup', () => {
  for (const name of ['getBundledYtDlpPath', 'getBundledBinaryPath']) {
    const body = source.slice(source.indexOf(`function ${name}(`), source.indexOf('\n}\n', source.indexOf(`function ${name}(`)));
    assert.match(body, /return findBundledExecutable\(candidates\);/, `${name} uses findBundledExecutable`);
    assert.doesNotMatch(body, /chmodSync/, `${name} does not chmod on its own`);
  }
});

test('an already executable bundled tool is used when chmod is refused (EPERM/EROFS)', { skip: process.platform === 'win32' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-bundled-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tool = path.join(directory, 'yt-dlp');
  fs.writeFileSync(tool, '#!/bin/sh\necho bundled-tool\n', { mode: 0o755 });
  const chmodCalls = [];
  const readOnly = { ...fs, chmodSync: (file) => { chmodCalls.push(file); throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' }); } };

  const chosen = findBundledExecutable([path.join(directory, 'missing'), tool], { fsModule: readOnly });
  assert.equal(chosen, tool);
  assert.deepEqual(chmodCalls, [], 'an executable binary is not chmod-ed');
  assert.equal(spawnSync(chosen, [], { encoding: 'utf8' }).stdout.trim(), 'bundled-tool', 'the chosen path really runs');
});

test('a non-executable bundled tool is chmod-ed once, and kept as a last resort if that fails', { skip: process.platform === 'win32' }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-bundled-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const plain = path.join(directory, 'ffmpeg');
  fs.writeFileSync(plain, '#!/bin/sh\necho fixed\n', { mode: 0o644 });
  assert.equal(findBundledExecutable([plain]), plain);
  assert.equal(fs.statSync(plain).mode & 0o111, 0o111, 'the missing execute bit was added');
  assert.equal(spawnSync(plain, [], { encoding: 'utf8' }).stdout.trim(), 'fixed');

  const stuck = path.join(directory, 'ffprobe');
  fs.writeFileSync(stuck, '#!/bin/sh\n', { mode: 0o644 });
  const denied = { ...fs, chmodSync: () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); } };
  assert.equal(findBundledExecutable([stuck], { fsModule: denied }), stuck, 'a failed chmod does not drop the candidate');
  const later = path.join(directory, 'ffprobe-2');
  fs.writeFileSync(later, '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(findBundledExecutable([stuck, later], { fsModule: denied }), later, 'a later runnable candidate is preferred');
  assert.equal(findBundledExecutable([path.join(directory, 'none')]), '');
});
