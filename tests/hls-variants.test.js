const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHlsManifest, collapseDetections, estimateSizeBytes, validateSelection } = require('../packages/contracts');

const masterUrl = 'https://media.example.test/film/master.m3u8?token=signed';
const masterText = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English, original",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="../captions/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AVERAGE-BANDWIDTH=600000,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="audio",SUBTITLES="subs"
480/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720,AUDIO="audio",SUBTITLES="subs"
/film/720/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080,AUDIO="audio",SUBTITLES="subs"
https://cdn.example.test/film/1080.m3u8`;

test('master discovery retains real variants, resolves relative URLs, languages and size estimates', () => {
  const manifest = parseHlsManifest(masterText, masterUrl, { durationSeconds: 10 });
  assert.equal(manifest.isMaster, true);
  assert.equal(manifest.isLive, null);
  assert.equal(manifest.isDrm, false);
  assert.deepEqual(manifest.variants.map(variant => variant.height), [1080, 720, 480]);
  assert.equal(manifest.variants[2].url, 'https://media.example.test/film/480/video.m3u8');
  assert.equal(manifest.variants[1].url, 'https://media.example.test/film/720/video.m3u8');
  assert.equal(manifest.variants[2].sizeBytes, 750000);
  assert.equal(manifest.variants[2].codecs, 'avc1.4d401e,mp4a.40.2');
  assert.equal(manifest.audio[0].name, 'English, original');
  assert.equal(manifest.audio[0].language, 'en');
  assert.equal(manifest.audio[0].default, true);
  assert.equal(manifest.subtitles[0].url, 'https://media.example.test/captions/en.m3u8');
  assert.equal(manifest.referencedUrls.length, 5);
  assert.equal(estimateSizeBytes(800000, 10), 1000000);
  assert.equal(estimateSizeBytes(800000, null), null);
  assert.equal(parseHlsManifest(masterText, masterUrl).variants[0].sizeBytes, null);
});

test('media playlists expose duration, live state and DRM without treating ordinary AES-128 as DRM', () => {
  const media = '#EXTM3U\n#EXTINF:4.5,\nsegments/1.ts\n#EXTINF:5.5,\nsegments/2.ts\n';
  const live = parseHlsManifest(media, masterUrl);
  assert.equal(live.isLive, true);
  assert.equal(live.durationSeconds, 10);
  assert.equal(live.segmentUrls[0], 'https://media.example.test/film/segments/1.ts');
  const vod = parseHlsManifest(media + '#EXT-X-ENDLIST', masterUrl);
  assert.equal(vod.isLive, false);
  const aes = parseHlsManifest('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"\n#EXT-X-ENDLIST', masterUrl);
  assert.equal(aes.isDrm, false);
  assert.equal(aes.encryption[0].url, 'https://media.example.test/film/keys/key.bin');
  const drm = parseHlsManifest('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",URI="skd://key"\n#EXT-X-ENDLIST', masterUrl);
  assert.equal(drm.isDrm, true);
  assert.throws(() => parseHlsManifest('<html>not video</html>', masterUrl), TypeError);
});

test('collapse uses explicit master references or exact known duration and page, never similar filenames', () => {
  const manifest = parseHlsManifest(masterText, masterUrl);
  const master = { id: 'master', url: masterUrl, pageUrl: 'https://example.test/watch', manifest };
  const variant = { id: 'variant', url: manifest.variants[1].url, pageUrl: master.pageUrl };
  const unrelated = { id: 'unrelated', url: 'https://other.test/video.m3u8', pageUrl: master.pageUrl };
  const rows = collapseDetections([variant, master, unrelated]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'master');
  assert.equal(rows[0].variants.length, 3);
  assert.equal(rows[0].collapsedCount, 2);
  assert.equal(rows[0].detectedStreams.length, 2);
  const durationItems = [
    { id: 'hls', url: 'https://a.test/video.m3u8', durationSeconds: 90, pageUrl: 'https://example.test/watch' },
    { id: 'mp4', url: 'https://a.test/video.mp4', durationSeconds: 90, pageUrl: 'https://example.test/watch' },
    { id: 'other-page', url: 'https://a.test/other.mp4', durationSeconds: 90, pageUrl: 'https://example.test/other' },
    { id: 'unknown', url: 'https://a.test/unknown.mp4', pageUrl: 'https://example.test/watch' },
  ];
  const durationRows = collapseDetections(durationItems);
  assert.equal(durationRows.length, 3);
  assert.equal(durationRows[0].variants.length, 2);
  assert.equal(collapseDetections([{ url: 'https://a.test/1.mp4', durationSeconds: 0, pageUrl: 'same' }, { url: 'https://a.test/2.mp4', durationSeconds: 0, pageUrl: 'same' }]).length, 2);
});

test('selection validation preserves valid settings and rejects untrusted or malformed fields', () => {
  assert.deepEqual(validateSelection(undefined), { ok: true, value: undefined, errors: [] });
  const selection = { variantUrl: 'https://media.example.test/480.m3u8', height: 480, audioLang: 'en', subtitleLang: 'en', audioOnly: false };
  assert.deepEqual(validateSelection(selection), { ok: true, value: selection, errors: [] });
  for (const input of [null, [], '480p', { height: '480' }, { height: -1 }, { audioOnly: 'yes' }, { audioLang: '' }, { subtitleLang: 'en\n-map' }, { variantUrl: 'file:///etc/passwd' }, { variantUrl: 'https://user:pass@example.test/film' }, { unexpected: true }]) {
    const result = validateSelection(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.value, undefined);
    assert.ok(result.errors.length > 0);
  }
});

test('a master owns its quality menu while repeated HLS observations never invent another 1080p', () => {
  const pageUrl = 'https://example.test/watch/movie';
  const rootUrl = 'https://media.example.test/movie/master.m3u8';
  const masterText = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5692000,RESOLUTION=1920x1080\n1080.jpg\n#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720\n720.jpg\n';
  const parsed = parseHlsManifest(masterText, rootUrl, { durationSeconds: 7200 });
  const root = { id: 'master', url: rootUrl, type: 'hls', pageUrl, durationSeconds: 7200, manifest: parsed };
  const child = { id: 'child', url: parsed.variants[0].url, type: 'hls', contentType: 'image/jpeg', pageUrl, durationSeconds: 7200, height: 1080, manifest: parseHlsManifest('#EXTM3U\n#EXTINF:7200,\nsegment.jpg\n#EXT-X-ENDLIST\n', parsed.variants[0].url) };
  const observation = { id: 'observation', url: 'https://media.example.test/movie/observed.m3u8', type: 'hls', pageUrl, durationSeconds: 7200, height: 1080 };
  const collapsed = collapseDetections([root, child, observation]);
  assert.equal(collapsed.length, 1);
  assert.deepEqual(collapsed[0].variants.map(variant => variant.height), [1080, 720]);
  assert.ok(collapsed[0].variants.every(variant => variant.bandwidth > 0 && variant.sizeBytes > 0));
  assert.equal(collapsed[0].detectedStreams.length, 3, 'raw observations remain available through Show all');

  const another1080 = '#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080,CODECS="av01.0.08M.08"\n1080-av1.jpg\n';
  const alternateMaster = { ...root, manifest: parseHlsManifest(masterText + another1080, rootUrl, { durationSeconds: 7200 }) };
  const direct = { id: 'direct', url: 'https://files.example.test/movie.mp4', type: 'file', contentType: 'video/mp4', height: 1080, pageUrl, durationSeconds: 7200, contentLength: 1000000 };
  const alternatives = collapseDetections([alternateMaster, child, observation, direct])[0].variants;
  assert.equal(alternatives.filter(variant => variant.bandwidth && variant.height === 1080).length, 2, 'different declared renditions at the same height remain available');
  assert.equal(alternatives.length, 4, 'three declared renditions plus the actual direct file');
  assert.equal(alternatives.find(variant => variant.url === direct.url).sizeBytes, 1000000);
});

test('playlist init and media references exclude MP4-looking components while preserving direct alternatives', () => {
  const pageUrl = 'https://example.test/watch/42';
  const rootUrl = 'https://media.example.test/movie/master.m3u8';
  const master = parseHlsManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5692000,RESOLUTION=1920x1080\n1080.jpg\n#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720\n720.jpg\n', rootUrl);
  const child = parseHlsManifest('#EXTM3U\n#EXT-X-MAP:URI="pieces/init.jpg"\n#EXTINF:10,\npieces/1.jpg\n#EXT-X-ENDLIST\n', master.variants[0].url);
  assert.deepEqual(child.initializationUrls, ['https://media.example.test/movie/pieces/init.jpg']);
  const init = { id: 'init', url: child.initializationUrls[0], type: 'file', contentType: 'video/mp4', height: 1080, contentLength: 1393 };
  const segment = { id: 'segment', url: child.segmentUrls[0], type: 'file', contentType: 'video/mp4', height: 1080, contentLength: 6000000 };
  const root = { id: 'master', url: rootUrl, pageUrl, durationSeconds: 10, manifest: master };
  const media = { id: 'media', url: child.url, pageUrl, durationSeconds: 10, type: 'hls', contentType: 'image/jpeg', manifest: child };
  const direct = { id: 'direct', url: 'https://files.example.test/full-movie.mp4', pageUrl, durationSeconds: 10, type: 'file', contentType: 'video/mp4', height: 1080, contentLength: 1000000 };
  const collapsed = collapseDetections([init, segment, root, media, direct]);
  assert.equal(collapsed.length, 1, 'exact playlist references group components even without copied page/duration metadata');
  assert.equal(collapsed[0].id, 'master');
  assert.deepEqual(new Set(collapsed[0].variants.map(variant => variant.url)), new Set([...master.variants.map(variant => variant.url), direct.url]));
  assert.equal(collapsed[0].detectedStreams.length, 5, 'raw observations remain inspectable');
  const standalone = collapseDetections([init, segment, media]);
  assert.equal(standalone[0].id, 'media', 'a media playlist remains the source when no master was observed');
  assert.deepEqual(standalone[0].variants.map(variant => variant.url), [media.url]);
});
