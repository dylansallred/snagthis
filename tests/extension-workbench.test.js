const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../apps/extension/popup/model');
const detection = require('../apps/extension/js/detection');
const hls = require('../packages/contracts/src/hls');
const rows = require('../packages/contracts/src/rows');

const manifestUrl = 'https://media.example/movie/master';
const manifest = hls.parseHlsManifest(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="en",LANGUAGE="en",NAME="English",URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="es",NAME="Spanish",URI="subtitles.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="en",SUBTITLES="subs"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720,AUDIO="en",SUBTITLES="subs"
720.m3u8
`, manifestUrl, { durationSeconds: 60 });
const item = { id: 'master', url: manifestUrl, type: 'hls', sourcePageTitle: 'A short film', sourcePageUrl: 'https://example.com/watch', manifest, durationSeconds: 60, requestHeadersOrigin: 'https://media.example', requestHeaders: { authorization: 'Bearer media-only' } };

test('popup chooses discovered preferred quality and sends that selection to the downloader', () => {
  const group = hls.collapseDetections([item])[0];
  const selected = model.selectMedia(group, { preferredQuality: '720p', subtitleLanguage: 'es' });
  const payload = model.buildDownloadPayload(selected, 'My exact title');
  assert.equal(payload.mediaUrl, manifestUrl);
  assert.deepEqual(payload.selection, { variantUrl: 'https://media.example/movie/720.m3u8', height: 720, subtitleLang: 'es' });
  assert.equal(payload.title, 'My exact title');
  assert.equal(payload.headers.authorization, 'Bearer media-only');
  assert.equal(payload.settings, undefined, 'popup must not override desktop download settings');
  assert.equal(payload.fallbackMediaUrl, undefined, 'popup must not invent fallback assets');
});

test('popup does not invent quality, audio-only, subtitle tracks or transfer-size estimates', () => {
  const selected = model.selectMedia({ id: 'single', type: 'hls', url: manifestUrl, contentLength: 230 }, { preferredQuality: '1080p', subtitleLanguage: 'en' }, { audioOnly: true });
  assert.equal(selected.height, null);
  assert.equal(selected.sizeBytes, null, 'playlist bytes are not movie size');
  assert.deepEqual(selected.selection, { subtitleLang: 'none' });
});

test('unavailable preferred quality falls back to an actual highest rendition', () => {
  const group = hls.collapseDetections([item])[0];
  assert.equal(model.selectMedia(group, { preferredQuality: '480p' }).selection.height, 1080);
});

test('master and explicitly referenced variant share one row and retain an existing job mapping', () => {
  const variant = { id: 'variant', url: 'https://media.example/movie/1080.m3u8', type: 'hls', sourcePageUrl: item.sourcePageUrl };
  const groups = hls.collapseDetections([variant, item]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].url, manifestUrl);
  assert.equal(model.mappingFor(groups[0], { variant: 'running-job' }), 'running-job');
  assert.equal(rows.toRowModel({ ...groups[0], id: 'running-job', queueStatus: 'paused', progress: 34 }, { surface: 'popup' }).statusLine, 'Paused at 34%');
});

test('nearby filenames or detection times alone never merge unrelated videos or add fallbacks', () => {
  const files = [{ ...item, manifest: undefined, url: 'https://media.example/movie-1/master.m3u8', durationSeconds: null }, { id: 'other', url: 'https://media.example/movie-2.mp4', type: 'file', sourcePageUrl: item.sourcePageUrl, detectedAt: 1 }];
  const groups = hls.collapseDetections(files);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(group => !group.fallbackUrl));
});

test('tiny and extensionless playlists are detected from MIME or body; segments are excluded', () => {
  assert.equal(detection.mediaType('https://media.example/play?id=1', 'application/vnd.apple.mpegurl'), 'hls');
  assert.equal(detection.mediaType('https://media.example/play', 'text/plain', '#EXTM3U\n#EXTINF:1\na.ts\n'), 'hls');
  assert.equal(detection.mediaType('https://media.example/a.ts', 'video/mp2t'), null);
  assert.equal(detection.httpUrl('', 'https://example.com/watch'), '');
  assert.equal(detection.httpUrl('movie.m3u8', 'https://example.com/watch/'), 'https://example.com/watch/movie.m3u8');
});

test('media credentials remain scoped and control headers are not forwarded', () => {
  assert.deepEqual(detection.sanitizeHeaders({ Cookie: 'session=media', Authorization: 'Bearer media', Range: 'bytes=0-2', Host: 'wrong.example', 'X-Bad': 'one\r\ntwo' }), { cookie: 'session=media', authorization: 'Bearer media' });
  const payload = model.buildDownloadPayload({ ...item, url: 'https://other.example/video.mp4' });
  assert.deepEqual(payload.headers, {});
});

test('popup checks compatibility and restricts development API destinations to loopback', () => {
  assert.equal(model.compatible({ supportedProtocolVersions: { min: 1, max: 1 }, minExtensionVersion: '1.0.0' }), true);
  assert.equal(model.compatible({ supportedProtocolVersions: { min: 2, max: 3 } }), false);
  assert.equal(model.compatible({ minExtensionVersion: '1.1.0' }), false);
  assert.equal(model.localApiBase('http://127.0.0.1:51234'), 'http://127.0.0.1:51234');
  assert.equal(model.localApiBase('http://127.0.0.1.attacker.example:51234'), null);
  assert.equal(model.localApiBase('https://attacker.example'), null);
});

test('captured frame data stays bounded and disallows active document content', () => {
  assert.equal(detection.thumbnailUrl('data:image/svg+xml,<svg></svg>'), '');
  assert.equal(detection.thumbnailUrl('data:image/jpeg;base64,' + 'A'.repeat(22000)), '');
  assert.equal(detection.thumbnailUrl('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
});

test('audio pieces listed by a playlist never become independent qualities', () => {
  const audioUrl = 'https://media.example/movie/audio.m3u8';
  const audio = { id: 'audio', url: audioUrl, type: 'hls', manifest: hls.parseHlsManifest('#EXTM3U\n#EXTINF:3,\nsegment-00.aac\n#EXT-X-ENDLIST\n', audioUrl) };
  const piece = { id: 'piece', url: 'https://media.example/movie/segment-00.aac', contentType: 'audio/aac' };
  const standalone = { id: 'song', url: 'https://media.example/song.aac', contentType: 'audio/aac' };
  assert.deepEqual(detection.withoutManifestSegments([item, audio, piece, standalone]).map(value => value.id), ['master', 'audio', 'song']);
});

test('an explicitly observed direct-file alternative is submitted as a file, not an HLS rendition', () => {
  const direct = { id: 'direct', url: 'https://files.example/film.mp4', type: 'file', requestHeadersOrigin: 'https://files.example', requestHeaders: { cookie: 'file-session=1' } };
  const payload = model.buildDownloadPayload({ ...item, detectedStreams: [item, direct], selection: { variantUrl: direct.url, height: 720 } });
  assert.equal(payload.mediaUrl, direct.url);
  assert.equal(payload.mediaType, 'file');
  assert.deepEqual(payload.headers, { cookie: 'file-session=1' });
  assert.deepEqual(payload.selection, { subtitleLang: 'none' });
});
