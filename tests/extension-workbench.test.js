const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../apps/extension/popup/model');
const detection = require('../apps/extension/js/detection');
const hls = require('../packages/contracts/src/hls');
const rows = require('../packages/contracts/src/rows');
const sourcePreview = require('../apps/extension/popup/source-preview');

const manifestUrl = 'https://media.example/movie/master';
const manifest = hls.parseHlsManifest(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="en",LANGUAGE="en",NAME="English",URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="es",NAME="Spanish",URI="subtitles.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="en",SUBTITLES="subs"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720,AUDIO="en",SUBTITLES="subs"
720.m3u8
`, manifestUrl, { durationSeconds: 60 });
const item = { id: 'master', url: manifestUrl, type: 'hls', sourcePageTitle: 'A short film', sourcePageUrl: 'https://example.com/watch', manifest, durationSeconds: 60, requestHeadersOrigin: 'https://media.example', requestHeaders: { authorization: 'Bearer media-only' }, networkObserved: true };

test('compatibility guidance identifies the product that needs updating', () => {
  const health = { protocolVersion: 1, supportedProtocolVersions: { min: 1, max: 1 }, minExtensionVersion: '1.0.0' };
  assert.equal(model.compatibilityIssue(health, '1.0.0'), null);
  assert.equal(model.compatible(health, '1.0.0'), true);
  assert.equal(model.compatibilityIssue({ ...health, minExtensionVersion: '1.1.0' }, '1.0.0'), 'extension');
  assert.equal(model.compatibilityIssue({ ...health, supportedProtocolVersions: { min: 2, max: 2 } }, '1.0.0'), 'extension');
  assert.equal(model.compatibilityIssue({ ...health, supportedProtocolVersions: { min: 0, max: 0 } }, '1.0.0'), 'desktop');
  assert.equal(model.compatibilityIssue({ protocolVersion: '2' }, '1.0.0'), 'extension');
  assert.equal(model.compatibilityIssue({ ...health, minExtensionVersion: '1.0.1' }, '1.0.10'), null);
  assert.equal(model.compatible({ ...health, minExtensionVersion: '1.1.0' }, '1.0.0'), false);
});

test('Chrome download rows keep browser actions and never route native errors to desktop controls', () => {
  const toRow = changes => {
    const job = { id: 'browser:42', backend: 'browser', queueStatus: 'downloading', progress: 34, totalBytes: 1000, ...changes };
    return model.browserRow(rows.toRowModel(job, { surface: 'popup' }), job);
  };
  assert.equal(toRow({}).action.id, 'pause');
  assert.equal(toRow({ totalBytes: null }).statusLine, 'Downloading in Chrome');
  assert.equal(toRow({ queueStatus: 'paused', canResume: true }).action.id, 'resume');
  const saved = toRow({ queueStatus: 'completed', progress: 100, fileExists: true });
  assert.equal(saved.statusLine, 'Saved in Chrome');
  assert.equal(saved.action.id, 'show');
  assert.equal(toRow({ queueStatus: 'completed', fileExists: false }).action.id, 'chrome-details');
  assert.equal(toRow({ queueStatus: 'failed', error: 'NETWORK_FAILED', canResume: true }).action.id, 'resume');
  assert.equal(toRow({ queueStatus: 'failed', error: 'NETWORK_FAILED', canResume: false }).action.id, 'retry');
  assert.equal(toRow({ queueStatus: 'failed', status: 'blocked', canResume: true }).action.id, 'chrome-details');
  assert.equal(toRow({ queueStatus: 'failed', status: 'invalid-media' }).action.id, 'chrome-details');
  const desktop = rows.toRowModel({ queueStatus: 'completed' }, { surface: 'popup' });
  assert.equal(model.browserRow(desktop, { backend: 'desktop' }), desktop);
});

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

test('grouped mirrors use the selected variant owner and retain the working download', () => {
  const mirrorUrl = 'https://mirror.example/master.m3u8';
  const mirror = { ...item, id: 'mirror', url: mirrorUrl, requestHeadersOrigin: 'https://mirror.example', requestHeaders: { authorization: 'Bearer mirror-only' },
    manifest: hls.parseHlsManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\nvideo.m3u8\n', mirrorUrl) };
  const group = hls.collapseDetections([item, mirror])[0];
  const selected = model.selectMedia(group, {}, { variantUrl: 'https://mirror.example/video.m3u8' });
  const payload = model.buildDownloadPayload(selected);
  assert.equal(payload.mediaUrl, mirrorUrl);
  assert.deepEqual(payload.headers, { authorization: 'Bearer mirror-only' });
  assert.equal(payload.selection.variantUrl, 'https://mirror.example/video.m3u8');
  const failed = { id: 'old-attempt', queueStatus: 'failed', status: 'error' };
  const working = { id: 'working-copy', queueStatus: 'downloading', status: 'downloading' };
  assert.equal(model.jobFor(group, { master: failed.id, mirror: working.id }, [failed, working]), working);
});

test('cancelled or removed mappings keep the detection downloadable and do not hide a valid grouped job', () => {
  const group = { ...item, detectedStreams: [{ id: 'variant' }] };
  const cancelled = { id: 'old-job', queueStatus: 'cancelled', status: 'cancelled', progress: 48 };
  const saved = { id: 'saved-job', queueStatus: 'completed', progress: 100 };
  const mappings = { master: cancelled.id, variant: saved.id };
  assert.equal(model.jobFor(group, mappings, [cancelled, saved]), saved);
  assert.equal(model.jobFor(group, mappings, [cancelled]), null);
  assert.equal(model.jobFor(group, mappings, []), null);
  const detected = rows.toRowModel({ ...model.selectMedia(group), ...model.jobFor(group, mappings, [cancelled]) }, { surface: 'popup' });
  assert.equal(detected.state, 'detected');
  assert.equal(detected.action.id, 'download');
  assert.equal(model.jobFor(item, { master: saved.id }, [saved]), saved);
  assert.equal(model.jobFor(group, mappings, [{ ...saved, id: 'unrelated', sourcePageUrl: item.sourcePageUrl, title: item.sourcePageTitle }]), null, 'same page or title must never create a mapping');
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

test('transport failures become plain-language messages', () => {
  assert.equal(detection.friendlyError(new TypeError('Failed to fetch')), "SnagThis desktop isn't running. Open it, then try again.");
  assert.equal(detection.friendlyError(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })), 'The connection to SnagThis timed out. Try again.');
  assert.equal(detection.friendlyError('The operation was aborted due to timeout'), 'The connection to SnagThis timed out. Try again.');
  assert.equal(detection.friendlyError(new Error('Choose an available quality.')), 'Choose an available quality.');
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

test('YouTube site sounds never become downloads or override the canonical watch video', () => {
  const sourcePageUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
  const sound = { id: 'sound', url: 'https://www.youtube.com/s/search/audio/no_input.mp3', type: 'file', mediaKind: 'video', contentType: 'audio/mpeg', sourcePageUrl, sourcePageTitle: 'A real video - YouTube', youtubeMetadata: { videoId: 'abcdefghijk', title: 'A real video' }, requestHeaders: { cookie: 'asset-cookie' }, requestHeadersOrigin: 'https://www.youtube.com' };
  const video = { ...sound, id: 'youtube', url: sourcePageUrl, mediaKind: 'youtube-page', contentType: 'video/youtube' };
  assert.equal(detection.isYoutubeAuxiliaryResource(sound.url, sourcePageUrl, sound.mediaKind), true);
  assert.equal(detection.isYoutubeAuxiliaryResource('https://cdn.googlevideo.com/videoplayback', sourcePageUrl, 'video'), true);
  assert.equal(detection.isYoutubeAuxiliaryResource(video.url, sourcePageUrl, video.mediaKind), false);
  assert.deepEqual(detection.withoutManifestSegments([sound, video]).map(value => value.id), ['youtube']);
  const payload = model.buildDownloadPayload({ ...sound, detectedStreams: [sound, video], selection: { variantUrl: sound.url, height: 1080 } });
  assert.equal(payload.mediaUrl, sourcePageUrl, 'stale detections are safe even before the worker reloads');
  assert.equal(payload.title, 'A real video');
  assert.equal(payload.resourceName, 'A real video');
  assert.deepEqual(payload.headers, {});
  assert.deepEqual(payload.selection, { subtitleLang: 'none' });
  assert.equal(detection.isYoutubeAuxiliaryResource('https://media.example.test/sound.mp3', 'https://example.test/watch', 'video'), false, 'ordinary direct downloads remain available');
});

test('thumbnail clips accept only signed preview assets from the connected local app', () => {
  const base = 'http://127.0.0.1:49732';
  const asset = `/downloads/__previews/owned-file.mp4?expires=9999999999999&signature=${'a'.repeat(64)}`;
  assert.equal(model.previewClipUrl(asset, base), base + asset);
  assert.equal(model.previewClipUrl(base + asset, base), base + asset);
  for (const candidate of [asset.split('?')[0], '/downloads/entire-movie.mp4' + asset.slice(asset.indexOf('?')), `https://external.example${asset}`, `http://127.0.0.1:9999${asset}`, `http://user:secret@127.0.0.1:49732${asset}`, 'blob:fake-video']) {
    assert.equal(model.previewClipUrl(candidate, base), '', candidate);
  }
});

test('a generated job poster replaces page artwork and resolves against the local app', () => {
  const base = 'http://127.0.0.1:49732';
  const localPoster = `/downloads/job/video-frame.jpg?expires=9999999999999&signature=${'a'.repeat(64)}`;
  const row = rows.toRowModel({ id: 'active', queueStatus: 'downloading', progress: 34, thumbnailUrl: 'https://page.example/screenshot.jpg', thumbnailUrls: [localPoster] }, { surface: 'popup' });
  assert.equal(row.thumbnailUrl, localPoster);
  assert.equal(model.resolveThumbnailUrl(row.thumbnailUrl, base), base + localPoster);
  assert.equal(model.resolveThumbnailUrl('https://page.example/poster.jpg', base), 'https://page.example/poster.jpg');
  assert.equal(model.resolveThumbnailUrl('data:image/jpeg;base64,AAAA', base), 'data:image/jpeg;base64,AAAA');
  assert.equal(model.resolveThumbnailUrl('/downloads/unsigned.jpg', base), '');
});

test('standalone preview uses real low quality, scopes captured headers and rejects black poster frames', () => {
  const group = hls.collapseDetections([item])[0];
  const source = sourcePreview.sourceFor(group);
  assert.equal(source.url, 'https://media.example/movie/720.m3u8');
  const same = sourcePreview.fetchOptions(source, source.url, { Range: 'bytes=0-99' });
  assert.equal(same.redirect, 'error');
  assert.equal(same.credentials, 'include');
  assert.equal(same.headers.get('authorization'), 'Bearer media-only');
  const other = sourcePreview.fetchOptions(source, 'https://other.example/piece.ts', { Range: 'bytes=0-99', Authorization: 'never-forward' });
  assert.equal(other.credentials, 'omit');
  assert.equal(other.headers.get('authorization'), null);
  assert.equal(other.headers.get('range'), 'bytes=0-99');
  assert.equal(sourcePreview.sourceFor({ ...item, mediaKind: 'youtube-page' }), null);
  const hinted = sourcePreview.sourceFor(hls.collapseDetections([{ ...item, networkObserved: false }])[0]);
  assert.equal(hinted.trusted, false);
  assert.deepEqual(hinted.headers, {}, 'a page-reported URL never receives captured headers');
  assert.equal(sourcePreview.fetchOptions(hinted, hinted.url).credentials, 'omit');
  assert.equal(sourcePreview.nonblack(new Uint8ClampedArray(32 * 18 * 4)), false);
  const frame = new Uint8ClampedArray(32 * 18 * 4);
  for (let index = 0; index < frame.length; index += 4) { frame[index] = index % 255; frame[index + 1] = 90; frame[index + 2] = 120; frame[index + 3] = 255; }
  assert.equal(sourcePreview.nonblack(frame), true);
  assert.equal(sourcePreview.sceneStart(6000), 2100, 'long videos start at 35%, not a capped intro offset');
  assert.deepEqual(sourcePreview.sceneCandidates(40), [14, 20, 10, 26, 32]);
  assert.deepEqual(sourcePreview.sceneCandidates(8), [2.8, 4, 2, 5.2, 6.4], 'short videos select later scenes and shorten the excerpt');
});
