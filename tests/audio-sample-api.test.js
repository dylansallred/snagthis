const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { startFixtureServer } = require('./fixtures/server');
const { probeFile } = require('./fixtures/engine');

const TOKEN = 'audio-sample-test-token-0123456789abcdef';

async function sampleDirectories() {
  return (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(`snagthis-audio-samples-${process.pid}-`));
}

test('desktop audio sample endpoint produces short scoped audio-only samples', { timeout: 120_000 }, async (t) => {
  const fixture = await startFixtureServer();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-audio-sample-'));
  const api = createApiServer({
    dataDir, downloadDir: path.join(dataDir, 'downloads'), port: 0, authToken: TOKEN,
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg', ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    initialQueueSettings: { autoStart: false },
  });
  const address = await api.start();
  const base = `http://127.0.0.1:${address.port}`;
  let stopped = false;
  t.after(async () => {
    if (!stopped) await api.stop();
    await fixture.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const sample = (body, { auth = true, headers = {} } = {}) => fetch(`${base}/api/media/audio-sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
  const audioRendition = `${fixture.baseUrl}/media/audio/index.m3u8`;
  const master = `${fixture.baseUrl}/media/master.m3u8`;
  const verifySample = async (response, label) => {
    assert.equal(response.status, 200, label);
    assert.equal(response.headers.get('content-type'), 'audio/mp4', label);
    assert.match(response.headers.get('cache-control') || '', /no-store/, label);
    const bytes = Buffer.from(await response.arrayBuffer());
    const file = path.join(dataDir, `${label.replace(/\W+/g, '-')}.m4a`);
    await fs.writeFile(file, bytes);
    const probe = await probeFile(file);
    assert.equal(probe.hasAudio, true, label);
    assert.equal(probe.streams.some((stream) => stream.codec_type === 'video'), false, `${label} is audio only`);
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
    assert.equal(audio.codec_name, 'aac', label);
    assert.equal(audio.channels, 2, label);
    return { bytes, probe };
  };

  const health = await (await fetch(`${base}/v1/health`)).json();
  assert.deepEqual(health.features, ['audio-track', 'audio-sample']);

  assert.equal((await sample({ mediaUrl: master, renditionUrl: audioRendition }, { auth: false })).status, 401);
  assert.equal((await sample({ mediaUrl: master, renditionUrl: audioRendition }, { headers: { 'X-Client': 'snagthis-extension' } })).status, 403);
  assert.equal((await sample({ mediaUrl: master, renditionUrl: audioRendition }, { auth: false, headers: { Origin: `chrome-extension://${'a'.repeat(32)}` } })).status, 403);
  for (const invalid of [
    { mediaUrl: 'file:///etc/passwd' },
    { mediaUrl: master, renditionUrl: 'ftp://example.com/a.m3u8' },
    { mediaUrl: 'http://user:pass@127.0.0.1/a.m3u8' },
    { mediaUrl: master, streamIndex: 64 },
    { mediaUrl: master, streamIndex: 1.5 },
    { mediaUrl: master, durationSeconds: -1 },
  ]) {
    const response = await sample(invalid);
    assert.equal(response.status, 400, JSON.stringify(invalid));
    assert.ok((await response.json()).error);
  }

  // The 10 s fixture starts at 2.5 s (25%), so only 7.5 s of audio remain.
  const started = Date.now();
  const first = await verifySample(await sample({ mediaUrl: master, renditionUrl: audioRendition }), 'hls rendition');
  const firstMs = Date.now() - started;
  assert.ok(first.probe.durationSeconds > 6 && first.probe.durationSeconds < 8.2, `duration ${first.probe.durationSeconds}`);

  const segmentRequests = fixture.requests.filter((item) => item.pathname.startsWith('/media/audio/segment-')).length;
  assert.ok(segmentRequests > 0);
  const cachedStart = Date.now();
  const second = await verifySample(await sample({ mediaUrl: master, renditionUrl: audioRendition }), 'hls cached');
  assert.ok(second.bytes.equals(first.bytes), 'a repeated hover is served from cache');
  assert.equal(fixture.requests.filter((item) => item.pathname.startsWith('/media/audio/segment-')).length, segmentRequests, 'cache hit fetches no media');
  assert.ok(Date.now() - cachedStart <= Math.max(firstMs, 500));

  // Muxed/DASH-style input: select the first audio stream directly from the file.
  const direct = await verifySample(await sample({ mediaUrl: `${fixture.baseUrl}/media/direct.mp4`, streamIndex: 0, durationSeconds: 10 }), 'direct stream');
  assert.ok(direct.probe.durationSeconds > 6 && direct.probe.durationSeconds < 8.2, `duration ${direct.probe.durationSeconds}`);
  assert.equal((await sample({ mediaUrl: `${fixture.baseUrl}/media/direct.mp4`, streamIndex: 5 })).status, 422, 'a missing audio stream is unavailable');

  // Gated media needs the saved Referer/Origin/Cookie, which reach only the
  // credential origin through the scoped proxy.
  const gated = `${fixture.baseUrl}/cases/gated/index.m3u8`;
  const denied = await sample({ mediaUrl: gated, renditionUrl: gated });
  assert.ok([422, 502].includes(denied.status));
  assert.deepEqual(await denied.json(), { error: 'Sample unavailable' });
  const allowed = await verifySample(await sample({ mediaUrl: gated, renditionUrl: gated, headers: fixture.headers }), 'gated rendition');
  assert.ok(allowed.probe.durationSeconds > 6 && allowed.probe.durationSeconds < 8.2);

  // A new hover supersedes a slow in-flight sample.
  const slow = sample({ mediaUrl: `${fixture.baseUrl}/cases/throttled/index.m3u8`, renditionUrl: `${fixture.baseUrl}/cases/throttled/index.m3u8` });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const replacement = sample({ mediaUrl: `${fixture.baseUrl}/media/direct.mp4`, streamIndex: 0 });
  assert.equal((await slow).status, 499);
  const replaced = await verifySample(await replacement, 'replacement');
  assert.ok(replaced.probe.durationSeconds > 9 && replaced.probe.durationSeconds < 10.5, 'unknown duration starts at 0');

  // A disconnected client stops generation without leaving partial files.
  const aborted = new AbortController();
  const pending = fetch(`${base}/api/media/audio-sample`, {
    method: 'POST', signal: aborted.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ mediaUrl: `${fixture.baseUrl}/cases/throttled/index.m3u8`, renditionUrl: `${fixture.baseUrl}/cases/throttled/index.m3u8` }),
  }).catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 300));
  aborted.abort();
  assert.equal((await pending).name, 'AbortError');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const [directory] = await sampleDirectories();
  assert.ok(directory);
  assert.deepEqual((await fs.readdir(path.join(os.tmpdir(), directory))).filter((name) => name.endsWith('.part')), []);

  await api.stop();
  stopped = true;
  assert.deepEqual(await sampleDirectories(), [], 'samples are removed when the bridge stops');
});
