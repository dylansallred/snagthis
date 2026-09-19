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
