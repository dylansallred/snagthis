const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startFixtureServer } = require('./fixtures/server');
const { downloadMedia } = require('./fixtures/engine');

process.env.LOG_LEVEL = 'error';
process.env.DISABLE_FILE_LOGS = '1';

test('real media: delivery techniques produce playable MP4, unsupported sources decline', { timeout: 240_000 }, async (t) => {
  const fixture = await startFixtureServer();
  t.after(() => fixture.close());
  const cases = [
    { name: 'direct MP4 with byte ranges', resource: '/media/direct.mp4', mediaType: 'file' },
    { name: 'direct MP4 without byte ranges', resource: '/cases/no-range/direct.mp4', mediaType: 'file' },
    { name: 'transport-stream HLS', resource: '/media/ts/index.m3u8' },
    { name: 'fragmented MP4 HLS with init', resource: '/media/fmp4/index.m3u8' },
    { name: 'tiny extensionless manifest', resource: '/cases/tiny/manifest' },
    { name: 'redirect and relative segments', resource: '/redirect.m3u8' },
    { name: 'disguised segment extensions', resource: '/cases/disguised/index.m3u8' },
    { name: 'AES-128 encrypted HLS', resource: '/media/aes/index.m3u8' },
    { name: 'request context on every request', resource: '/cases/gated/index.m3u8', headers: fixture.headers },
    { name: 'transient segment failures recover', resource: '/cases/retry/index.m3u8' },
    { name: 'selected 480p with separate English audio and subtitles', resource: '/media/master.m3u8', selection: { height: 480, audioLang: 'en', subtitleLang: 'en' }, height: 480, subtitles: true },
    { name: 'audio-only rendition is a real audio file', resource: '/media/master.m3u8', selection: { audioOnly: true, audioLang: 'en' }, height: 0 },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const result = await downloadMedia({ ...entry, url: fixture.baseUrl + entry.resource, directory: path.join(fixture.directory, 'outputs') });
      assert.match(result.metadata.format, /mp4/);
      assert.ok(Math.abs(result.metadata.durationSeconds - 10) <= 1, `duration was ${result.metadata.durationSeconds}`);
      assert.equal(result.metadata.height, entry.height ?? 1080);
      assert.equal(result.metadata.hasAudio, true, 'audio must survive the download');
      if (entry.subtitles) assert.equal(result.metadata.hasSubtitles, true, 'selected subtitles must survive the download');
    });
  }
  await t.test('bounded probe finalizes a short playable file', async () => {
    const result = await downloadMedia({ url: `${fixture.baseUrl}/media/fmp4/index.m3u8`, directory: path.join(fixture.directory, 'outputs'), probe: { seconds: 3 } });
    assert.match(result.metadata.format, /mp4/);
    assert.ok(result.metadata.durationSeconds >= 2 && result.metadata.durationSeconds <= 4);
    assert.equal(result.metadata.hasAudio, true);
  });
  for (const [name, resource, pattern] of [
    ['DRM', '/cases/drm/index.m3u8', /DRM|protected|unsupported|can't be downloaded/i],
    ['live stream', '/cases/live/index.m3u8', /live|unsupported|can't be downloaded/i],
    ['missing required request context', '/cases/gated/index.m3u8', /403|expired|forbidden/i],
  ]) {
    await t.test(`${name} is rejected cleanly`, async () => {
      await assert.rejects(downloadMedia({ url: fixture.baseUrl + resource, directory: path.join(fixture.directory, 'outputs') }), pattern);
    });
  }
  await t.test('expiry and retry fixtures expose deterministic failure stages', async () => {
    fixture.expireAfter(-1);
    assert.equal((await fetch(`${fixture.baseUrl}/cases/expired/index.m3u8`)).status, 403);
    assert.equal((await fetch(`${fixture.baseUrl}/cases/broken/segment-04.ts`)).status, 404);
    const retry = `${fixture.baseUrl}/cases/retry/segment-06.ts`;
    assert.equal((await fetch(retry)).status, 200, 'real download already exhausted the two temporary failures');
    assert.equal((await fetch(`${fixture.baseUrl}/media/direct.mp4`, { headers: { Range: 'bytes=10-99' } })).status, 206);
    assert.equal((await fetch(`${fixture.baseUrl}/cases/no-range/direct.mp4`, { headers: { Range: 'bytes=10-99' } })).status, 200);
  });
});
