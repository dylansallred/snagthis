const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const contracts = require('../packages/contracts');
const { describeAudioTracks, audioRenditionKeys, findAudioRendition, languageName, parseDashAudio, selectionAudioLabel, parseHlsManifest, validateSelection } = contracts;
const model = require('../apps/extension/popup/model');
const { runTool } = require('./fixtures/server');
const { downloadMedia } = require('./fixtures/engine');
const { resolveHlsSelection } = require('../packages/downloader-engine/src/core/MediaSelection');

process.env.LOG_LEVEL = 'error';
process.env.DISABLE_FILE_LOGS = '1';

// cinejoy.pk sends exactly this: four nameless renditions, no LANGUAGE or CHANNELS.
const CINEJOY = ['#EXTM3U',
  ...[1, 2, 3, 4].map(n => `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Track ${n}",DEFAULT=${n === 1 ? 'YES' : 'NO'},AUTOSELECT=YES,URI="audio_${n}.m3u8"`),
  '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,AUDIO="audio"', 'video.m3u8', ''].join('\n');

test('language names are human, and codes that name nothing are unknown', () => {
  assert.equal(languageName('hin'), 'Hindi');
  assert.equal(languageName('es-419'), 'Spanish (Latin America)');
  assert.equal(languageName('en'), 'English');
  for (const code of ['und', 'mul', 'zxx', 'qaa', 'qtz', 'mis', 'xx', 'xx-YY', 'english', '', null]) assert.equal(languageName(code), null, String(code));
});

test('cinejoy tracks: Track N, unknown language, Default on the DEFAULT rendition only', () => {
  const parsed = parseHlsManifest(CINEJOY, 'https://cdn.example/master.m3u8');
  const tracks = describeAudioTracks(parsed.audio);
  assert.deepEqual(tracks.map(track => [track.title, track.detail, track.shortLabel, track.isDefault]), [
    ['Track 1', 'Unknown language · Default', 'Track 1', true],
    ['Track 2', 'Unknown language', 'Track 2', false],
    ['Track 3', 'Unknown language', 'Track 3', false],
    ['Track 4', 'Unknown language', 'Track 4', false],
  ]);
  assert.equal(tracks[1].ariaLabel, 'Track 2, unknown language');
  assert.equal(tracks[2].url, 'https://cdn.example/audio_3.m3u8');
  assert.equal(contracts.defaultAudioTrack(tracks), tracks[0]);
});

test('plain-language labels: names only when they add meaning, tags only when tracks differ, duplicates collapse across groups', () => {
  const manifest = ['#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="en",DEFAULT=YES,CHANNELS="2",URI="a/en.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ec3",NAME="English",LANGUAGE="en",CHANNELS="6",URI="e/en.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English AD",LANGUAGE="en",CHANNELS="2",CHARACTERISTICS="public.accessibility.describes-video",URI="a/ad.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Español (Latinoamérica)",LANGUAGE="es-419",CHANNELS="2",URI="a/es.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="hin",LANGUAGE="hin",CHANNELS="2",URI="a/hi.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Director commentary",LANGUAGE="en",CHANNELS="2",URI="a/cm.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ec3",NAME="Español (Latinoamérica)",LANGUAGE="es-419",CHANNELS="2",URI="e/es.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="ec3",NAME="English",LANGUAGE="en",CHANNELS="16/JOC",URI="e/atmos.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="aac"', 'v.m3u8', ''].join('\n');
  const parsed = parseHlsManifest(manifest, 'https://cdn.example/master.m3u8');
  assert.equal(parsed.audio[2].characteristics, 'public.accessibility.describes-video');
  const tracks = describeAudioTracks(parsed.audio);
  assert.deepEqual(tracks.map(track => [track.title, track.tags.join(' '), track.detail]), [
    ['English', '', 'Stereo · Default'],
    ['English', '5.1', ''],
    ['English', 'AD', 'Stereo'],
    ['Spanish (Latin America)', '', 'Stereo'],
    ['Hindi', '', 'Stereo'],
    ['English', '', 'Commentary · Stereo'],
    ['English', 'Atmos', ''],
  ]);
  // The Spanish rendition repeated in the ec3 group is one track with both renditions.
  assert.equal(tracks[3].renditions.length, 2);
  assert.equal(tracks[2].ariaLabel, 'English, Stereo, audio description');
  // Same channels everywhere: no channel tags at all.
  const same = describeAudioTracks([{ language: 'en', name: 'English', channels: '2', default: true }, { language: 'fr', name: 'French', channels: '2' }]);
  assert.deepEqual(same.map(track => [track.title, track.tags, track.detail]), [['English', [], 'Default'], ['French', [], '']]);
  // A useful NAME with an unknown language becomes the title.
  const named = describeAudioTracks([{ language: 'und', name: 'Audio', default: true }, { language: 'und', name: 'Audio' }, { name: 'Original mix' }]);
  assert.deepEqual(named.map(track => track.title), ['Track 1', 'Track 2', 'Original mix']);
  // Labels that still match after collapsing get a counter.
  assert.deepEqual(describeAudioTracks([{ groupId: 'a', language: 'en', name: 'English', url: '1' }, { groupId: 'b', language: 'en', name: 'English', url: '2', characteristics: 'x' }]).map(track => track.title), ['English · 1', 'English · 2']);
  assert.notEqual(named[0].key, named[1].key, 'identical nameless renditions in one group stay distinct choices');
});

test('track keys resolve the rendition within the chosen video group and survive URL rotation', () => {
  const audio = [
    { groupId: 'aac', language: 'en', name: 'English', channels: '2', url: 'https://a/1' },
    { groupId: 'ec3', language: 'en', name: 'English', channels: '2', url: 'https://e/1' },
    { groupId: 'aac', language: null, name: 'Track 2', url: 'https://a/2' },
  ];
  const [english, second] = describeAudioTracks(audio);
  assert.equal(findAudioRendition(audio, 'ec3', english.key).url, 'https://e/1');
  assert.equal(findAudioRendition(audio, 'aac', english.key).url, 'https://a/1');
  const rotated = audio.map(item => ({ ...item, url: `${item.url}?token=${Math.random()}` }));
  assert.match(findAudioRendition(rotated, 'aac', second.key).url, /^https:\/\/a\/2\?/);
  assert.equal(findAudioRendition(audio, 'aac', 'nope'), null);
  assert.deepEqual(audioRenditionKeys([{ groupId: 'a', name: 'Audio' }, { groupId: 'a', name: 'Audio' }]), ['|Audio||', '|Audio||#2']);
});

test('selection carries a chosen track only when it differs from the default, and validates it', () => {
  const item = { id: 'film', url: 'https://cdn.example/master.m3u8', type: 'hls', variants: [{ url: 'https://cdn.example/video.m3u8', height: 360 }], audio: parseHlsManifest(CINEJOY, 'https://cdn.example/master.m3u8').audio };
  const initial = model.selectMedia(item, {}, {});
  assert.equal(initial.selection.audioTrack, undefined, 'the DEFAULT rendition is what the engine picks unaided');
  assert.equal(initial.audioTrack.title, 'Track 1');
  const third = initial.audioTracks[2];
  const chosen = model.selectMedia(item, {}, { audioTrack: third.key });
  assert.equal(chosen.selection.audioTrack, third.key);
  assert.equal(chosen.audioTrack.shortLabel, 'Track 3');
  assert.equal(model.buildDownloadPayload(chosen).selection.audioTrack, third.key);
  assert.equal(model.selectMedia(item, {}, { audioOnly: true }).selection.audioLang, undefined, 'audio-only no longer guesses the first language');
  assert.deepEqual(validateSelection({ audioTrack: third.key }), { ok: true, value: { audioTrack: third.key }, errors: [] });
  for (const bad of ['', 'x'.repeat(513), 'a\nb', 7]) assert.equal(validateSelection({ audioTrack: bad }).ok, false);
});

test('saved selections name their audio in plain language', () => {
  assert.equal(selectionAudioLabel({ audioLang: 'hin' }), 'Hindi');
  assert.equal(selectionAudioLabel({ audioLang: 'xx' }), 'xx');
  assert.equal(selectionAudioLabel({ audioTrack: '|Track 3||' }), 'Track 3');
  assert.equal(selectionAudioLabel({ audioTrack: 'en|English AD|2|public.accessibility.describes-video' }), 'English (AD)');
  assert.equal(selectionAudioLabel({ audioTrack: 'es-419|Español|2|#2' }), 'Spanish (Latin America)');
  assert.equal(selectionAudioLabel({}), null);
});

test('DASH audio adaptation sets expose lang, label, role and FFmpeg stream order', () => {
  const mpd = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>
    <AdaptationSet mimeType="video/mp4"><Representation id="v1"/><Representation id="v2"/></AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="en"><Role schemeIdUri="urn:mpeg:dash:role:2011" value="main"/><AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/><Representation id="a1"/><Representation id="a2"/></AdaptationSet>
    <AdaptationSet contentType="audio" lang="en" label="Described"><Role schemeIdUri="urn:mpeg:dash:role:2011" value="alternate"/><Accessibility schemeIdUri="urn:tva:metadata:cs:AudioPurposeCS:2007" value="1"/><Representation id="a3" mimeType="audio/mp4"/></AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="fr"><Role schemeIdUri="urn:mpeg:dash:role:2011" value="commentary"/><Label>Commentaire &amp; making-of</Label><AudioChannelConfiguration schemeIdUri="urn:mpeg:mpegB:cicp:ChannelConfiguration" value="6"/><Representation id="a4"/></AdaptationSet>
  </Period></MPD>`;
  const audio = parseDashAudio(mpd, 'https://cdn.example/manifest.mpd');
  assert.deepEqual(audio.map(item => [item.language, item.name, item.role, item.default, item.channels, item.streamIndex]), [
    ['en', '', 'main', true, '2', 0],
    ['en', 'Described', 'description', false, null, 2],
    ['fr', 'Commentaire & making-of', 'commentary', false, '6', 3],
  ]);
  const tracks = describeAudioTracks(audio);
  assert.deepEqual(tracks.map(track => [track.title, track.tags.join(' '), track.detail]), [
    ['English', '', 'Stereo · Default'], ['English', 'AD', ''], ['French', '5.1', 'Commentary'],
  ]);
  assert.deepEqual(parseDashAudio('#EXTM3U'), []);
});

function dominantFrequency(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-ss', '1', '-i', file, '-t', '2', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) { reject(new Error(`ffmpeg exited ${code}`)); return; }
      const pcm = Buffer.concat(chunks); const samples = pcm.length / 2;
      let crossings = 0; let previous = pcm.readInt16LE(0);
      for (let index = 1; index < samples; index++) { const value = pcm.readInt16LE(index * 2); if ((previous < 0) !== (value < 0)) crossings++; previous = value; }
      resolve(crossings / 2 / (samples / 16000));
    });
  });
}

test('real media: a chosen nameless track downloads that rendition, not the default', { timeout: 120_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-audio-tracks-'));
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const media = path.join(directory, 'media'); fs.mkdirSync(media);
  const ffmpeg = (...args) => runTool(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: media });
  await ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '12', '-pix_fmt', 'yuv420p',
    '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', 'video-%02d.ts', 'video.m3u8');
  // Each nameless track is genuinely different audio: a distinct tone.
  const tones = { 1: 220, 2: 330, 3: 660, 4: 990 };
  for (const [n, frequency] of Object.entries(tones)) {
    await ffmpeg('-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100`, '-t', '6', '-c:a', 'aac', '-b:a', '64k',
      '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', `audio_${n}-%02d.ts`, `audio_${n}.m3u8`);
  }
  fs.writeFileSync(path.join(media, 'master.m3u8'), CINEJOY);
  server = http.createServer((request, response) => {
    const file = path.join(media, path.basename(new URL(request.url, 'http://fixture.invalid').pathname));
    if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    const body = fs.readFileSync(file);
    response.writeHead(200, { 'Content-Type': file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Content-Length': body.length });
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/master.m3u8`;
  const tracks = describeAudioTracks(parseHlsManifest(CINEJOY, url).audio);

  const resolved = await resolveHlsSelection({ url, selection: { audioTrack: tracks[2].key } });
  assert.equal(resolved.audioUrl, new URL('audio_3.m3u8', url).href);
  assert.equal((await resolveHlsSelection({ url, selection: {} })).audioUrl, new URL('audio_1.m3u8', url).href, 'without a choice the DEFAULT rendition is used');
  await assert.rejects(resolveHlsSelection({ url, selection: { audioTrack: '|Track 9||' } }), { code: 'SELECTION_UNAVAILABLE' });

  const outputs = path.join(directory, 'outputs');
  const video = await downloadMedia({ url, directory: outputs, selection: { audioTrack: tracks[2].key } });
  assert.equal(video.metadata.height, 360);
  assert.equal(video.metadata.hasAudio, true);
  assert.ok(Math.abs(await dominantFrequency(video.filePath) - tones[3]) < 25, 'the saved video carries Track 3');
  const audioOnly = await downloadMedia({ url, directory: outputs, selection: { audioOnly: true, audioTrack: tracks[3].key } });
  assert.equal(audioOnly.metadata.height, 0);
  assert.ok(Math.abs(await dominantFrequency(audioOnly.filePath) - tones[4]) < 25, 'the saved audio is Track 4');
  const unchosen = await downloadMedia({ url, directory: outputs, selection: { audioOnly: true } });
  assert.ok(Math.abs(await dominantFrequency(unchosen.filePath) - tones[1]) < 25, 'the default is Track 1');
});
