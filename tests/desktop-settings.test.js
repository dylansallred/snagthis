const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preferences = require('../apps/desktop/electron/preferences');
const { redact, queueSummary } = require('../apps/desktop/electron/diagnostics');

function settingsFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-preferences-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'settings.json');
}

test('saving preferences preserves existing choices and keeps API credentials in a private file', (t) => {
  const file = settingsFile(t);
  preferences.write(file, { tmdbApiKey: 'private-tmdb-key', preferredQuality: '720', outputDirectory: path.dirname(file) });
  preferences.write(file, { notifyOnComplete: false, subtitleLanguage: 'pt-BR' });
  const restored = preferences.read(file);
  assert.equal(restored.tmdbApiKey, 'private-tmdb-key');
  assert.equal(restored.preferredQuality, '720');
  assert.equal(restored.notifyOnComplete, false);
  assert.equal(restored.subtitleLanguage, 'pt-BR');
  assert.equal(restored.outputDirectory, path.dirname(file));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('malformed settings cannot overwrite a valid settings file or introduce unknown capabilities', (t) => {
  const file = settingsFile(t);
  preferences.write(file, { preferredQuality: '1080', launchAtLogin: false });
  const before = fs.readFileSync(file, 'utf8');
  for (const patch of [
    { outputDirectory: '../outside' },
    { customFilename: '../outside/video' },
    { downloadThreads: 0 },
    { queueMaxConcurrent: 17 },
    { preferredQuality: '4k' },
    { notifyOnComplete: 'false' },
    { subtitleLanguage: 'en\nAuthorization: secret' },
    { allowRemoteCommands: true },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ]) {
    assert.throws(() => preferences.write(file, patch));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
  assert.equal({}.polluted, undefined);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('partly corrupted persisted preferences recover valid choices and safe defaults', (t) => {
  const file = settingsFile(t);
  fs.writeFileSync(file, JSON.stringify({ preferredQuality: '480', queueMaxConcurrent: -4, launchAtLogin: 'yes', arbitraryCommand: 'run' }));
  const recovered = preferences.read(file);
  assert.equal(recovered.preferredQuality, '480');
  assert.equal(recovered.queueMaxConcurrent, 1);
  assert.equal(recovered.launchAtLogin, false);
  assert.equal(Object.hasOwn(recovered, 'arbitraryCommand'), false);
  fs.writeFileSync(file, '{broken');
  assert.equal(preferences.read(file).preferredQuality, 'best');
  assert.equal(preferences.read(file).subtitleLanguage, 'none');
});

test('failed atomic settings replacement leaves no temporary credential file', (t) => {
  const file = settingsFile(t);
  fs.mkdirSync(file);
  assert.throws(() => preferences.write(file, { tmdbApiKey: 'must-not-leak' }));
  assert.equal(fs.statSync(file).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('support diagnostics redact nested credentials, signed URLs, personal paths and source titles', () => {
  const input = {
    apiAuthToken: 'bridge-token',
    settings: { tmdbApiKey: 'tmdb-private', outputDirectory: '/Users/alice/Movies', notifyOnComplete: true },
    job: { headers: { Cookie: 'session=cookie-private' }, title: 'Private video name', sourcePageUrl: 'https://private.example/watch?token=url-private' },
    errors: [
      { message: 'Download failed at https://media.example/file.mp4?signature=signed-private' },
      { message: 'Authorization: Bearer header-private' },
      { message: 'Unexpected configured value: tmdb-private' },
      { message: 'File not found: /Users/alice/Movies/private.mp4' },
    ],
    phase: 'failed',
  };
  const output = redact(input, ['bridge-token', 'tmdb-private']);
  const serialized = JSON.stringify(output);
  for (const secret of ['bridge-token', 'tmdb-private', 'cookie-private', 'url-private', 'signed-private', 'header-private', '/Users/alice', 'Private video name']) {
    assert.equal(serialized.includes(secret), false, `Export exposed ${secret}`);
  }
  assert.equal(output.phase, 'failed');
  assert.equal(output.settings.notifyOnComplete, true);
  assert.equal(input.apiAuthToken, 'bridge-token', 'Redaction must not mutate application data');
});

test('support queue summaries contain counts, never raw source data or custom status strings', () => {
  const summary = queueSummary([
    { status: 'downloading', title: 'Private movie', headers: { Cookie: 'private-cookie' } },
    { queueStatus: 'completed', sourcePageUrl: 'https://private.example/video' },
    { status: 'failed for user-private-token' },
  ]);
  assert.deepEqual(summary, { count: 3, states: { downloading: 1, completed: 1, other: 1 } });
  assert.equal(JSON.stringify(summary).includes('private'), false);
});

test('the shared accent is validated and the later change wins over an older one', (t) => {
  const file = settingsFile(t);
  assert.equal(preferences.read(file).accent, 'orange');
  assert.equal(preferences.read(file).accentChangedAt, 0);
  const chosen = preferences.write(file, { accent: 'cobalt' });
  assert.equal(chosen.accent, 'cobalt');
  assert.ok(chosen.accentChangedAt > 0, 'a desktop choice is stamped when it is saved');
  const later = preferences.write(file, { accent: 'mint', accentChangedAt: chosen.accentChangedAt + 5000 });
  assert.equal(later.accent, 'mint');
  const stale = preferences.write(file, { accent: 'violet', accentChangedAt: chosen.accentChangedAt - 1 });
  assert.equal(stale.accent, 'mint', 'an offline Chrome choice older than the saved one is ignored');
  assert.equal(stale.accentChangedAt, later.accentChangedAt);
  assert.equal(preferences.write(file, { accentChangedAt: Date.now() }).accentChangedAt, later.accentChangedAt, 'a time without a colour changes nothing');
  const again = preferences.write(file, { accent: 'magenta' });
  assert.ok(again.accentChangedAt > later.accentChangedAt, 'a new desktop choice is always later than the saved one');
  for (const patch of [{ accent: 'teal' }, { accent: 7 }, { accent: 'cobalt', accentChangedAt: -1 }, { accent: 'cobalt', accentChangedAt: 'now' }, { accent: 'cobalt', accentChangedAt: Date.now() + 3 * 86_400_000 }]) {
    assert.throws(() => preferences.write(file, patch));
  }
  fs.writeFileSync(file, JSON.stringify({ accent: 'plaid', accentChangedAt: 'yesterday' }));
  assert.equal(preferences.read(file).accent, 'orange');
  assert.equal(preferences.read(file).accentChangedAt, 0);
});
