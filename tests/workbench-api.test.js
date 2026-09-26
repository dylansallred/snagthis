const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { redact } = require('../packages/downloader-api/src/utils/security');

test('private bridge pairing, whole-library search, safe removal, missing-file locate and restart', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-bridge-'));
  const downloadDir = path.join(dataDir, 'downloads');
  const trashDir = path.join(dataDir, 'trash');
  await fs.mkdir(downloadDir);
  await fs.mkdir(trashDir);
  await Promise.all(Array.from({ length: 500 }, (_, index) => fs.writeFile(path.join(downloadDir, `sample-${String(index).padStart(3, '0')}.mp4`), `fixture ${index}`)));
  await fs.writeFile(path.join(downloadDir, 'poster.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await fs.writeFile(path.join(downloadDir, 'queue.json'), JSON.stringify({ queue: [{
    id: 'sample-complete', title: 'Stored fixture', status: 'completed', queueStatus: 'completed',
    filePath: path.join(downloadDir, 'sample-000.mp4'), thumbnailPath: path.join(downloadDir, 'poster.jpg'), completedAt: Date.now(),
  }], settings: { autoStart: false, maxConcurrent: 1 } }));
  const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
  let locatedPath = '';
  let settings = { outputDirectory: downloadDir, preferredQuality: 'best', subtitleLanguage: 'none', notifyOnComplete: true, launchAtLogin: false };
  const makeServer = () => createApiServer({
    dataDir, downloadDir, port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true,
    initialQueueSettings: { autoStart: false },
    onTrashFile: (file) => fs.rename(file, path.join(trashDir, path.basename(file))),
    onLocateFile: () => locatedPath,
    onGetSettings: () => settings,
    onSaveSettings: (patch) => { settings = { ...settings, ...patch }; },
  });
  let api = makeServer();
  let address = await api.start();
  let base = `http://127.0.0.1:${address.port}`;
  let token = api.getAuthToken();
  const request = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.auth === false ? {} : { Authorization: `Bearer ${token}` }), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const content = response.headers.get('content-type') || '';
    return { status: response.status, body: content.includes('application/json') ? await response.json() : await response.text() };
  };
  try {
    assert.equal((await request('/v1/health', { auth: false })).body.pairingRequired, true);
    assert.equal((await request('/v1/queue', { auth: false })).status, 401);
    assert.equal((await request('/api/history', { headers: { Origin: 'http://127.0.0.1.evil.example' } })).status, 403);
    assert.equal((await request('/v1/queue', { headers: { Origin: extensionOrigin } })).status, 403);
    assert.equal((await request('/downloads/queue.json')).status, 404);
    assert.equal((await request('/downloads/history-index.json')).status, 404);
    const signedPoster = (await request('/v1/queue')).body.queue[0].thumbnailUrls[0];
    assert.equal((await request(signedPoster, { auth: false })).status, 200);
    assert.equal((await request('/downloads/poster.jpg', { auth: false })).status, 401);
    assert.equal((await request(signedPoster.replace('poster.jpg', 'sample-000.mp4'), { auth: false })).status, 401, 'an asset signature cannot authorize another file');
    await assert.rejects(fs.access(path.join(downloadDir, 'queue.json')));
    // Windows uses filesystem ACLs; Node's POSIX mode bits do not report them.
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(path.join(dataDir, 'bridge-auth.json'))).mode & 0o777, 0o600);
    }

    const pairing = api.getPairingInfo();
    const paired = await request('/v1/pair/complete', { auth: false, method: 'POST', headers: { Origin: extensionOrigin }, body: { code: pairing.code } });
    assert.equal(paired.status, 200);
    const extensionToken = paired.body.token;
    assert.match(extensionToken, /^[0-9a-f]{64}$/);
    assert.notEqual(extensionToken, token, 'each extension gets its own token, never the desktop credential');
    const asExtension = (headers = {}) => ({ auth: false, headers: { Authorization: `Bearer ${extensionToken}`, ...headers } });
    assert.equal(api.getConnectionState().extensionConnected, false, 'pairing itself is not a successful authenticated request');
    assert.equal((await request('/v1/queue', asExtension({ 'X-Client': 'snagthis-extension' }))).status, 200);
    assert.equal(api.getConnectionState().extensionConnected, true, 'Chrome extension GET requests may omit Origin');
    assert.equal((await request('/v1/queue', asExtension({ Origin: extensionOrigin }))).status, 200);
    assert.equal((await request('/v1/queue', { headers: { Origin: extensionOrigin } })).status, 401, 'the desktop token is refused from an extension page');
    assert.equal((await request('/api/history', asExtension())).status, 403, 'an extension token never reaches desktop-only routes');
    assert.equal(api.getConnectionState().extensionConnected, true);
    assert.equal((await request('/v1/pair/complete', { auth: false, method: 'POST', headers: { Origin: extensionOrigin }, body: { code: pairing.code } })).status, 403, 'code is one use');

    const rejectedSocket = new WebSocket(`${base.replace('http:', 'ws:')}/ws`);
    await new Promise((resolve, reject) => {
      rejectedSocket.once('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 401); res.resume(); rejectedSocket.terminate(); resolve(); });
      rejectedSocket.once('open', () => reject(new Error('Unauthenticated WebSocket was accepted')));
      rejectedSocket.on('error', () => {});
    });
    const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws`, ['snagthis', `snagthis-auth.${extensionToken}`], { origin: extensionOrigin });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const messagePromise = new Promise((resolve) => socket.once('message', (message) => resolve(JSON.parse(message))));
    socket.send(JSON.stringify({ type: 'subscribe', channel: 'queue' }));
    assert.equal((await messagePromise).type, 'queue:update');
    socket.close();

    const invalidSelection = await request('/v1/jobs', { method: 'POST', body: { mediaUrl: 'https://example.org/media', selection: { variantUrl: 'file:///private/video.mp4' } } });
    assert.equal(invalidSelection.status, 400);
    const created = await request('/v1/jobs', { method: 'POST', body: {
      mediaUrl: 'https://example.org/media?token=private', mediaType: 'hls', title: 'Selected video',
      sourcePageUrl: 'https://example.org/watch?secret=private', headers: { Cookie: 'session=private', Authorization: 'Bearer private' },
      thumbnailUrl: 'data:image/jpeg;base64,/9j/2Q==', selection: { height: 480, audioLang: 'en' },
    } });
    assert.equal(created.status, 200);
    const queued = (await request('/v1/queue')).body.queue.find((job) => job.id === created.body.jobId);
    assert.equal(queued.mediaType, 'hls');
    assert.equal(queued.selection.height, 480);
    assert.equal(queued.headers, undefined);
    assert.equal(queued.thumbnailUrls[0], 'data:image/jpeg;base64,/9j/2Q==');
    assert.equal(JSON.stringify((await request('/api/diagnostics')).body).includes('private'), false);
    assert.equal((await request('/v1/settings', { method: 'POST', body: { launchAtLogin: true, preferredQuality: '480' } })).status, 200);
    assert.equal((await request('/v1/settings')).body.launchAtLogin, true);
    // The shared accent: validated, and only with a colour; this fixture desktop keeps no accent, so none is reported.
    for (const body of [{ accent: 'teal' }, { accentChangedAt: 1 }, { accent: 'cobalt', accentChangedAt: -5 }, { accent: 'cobalt', accentChangedAt: Date.now() + 3 * 86_400_000 }]) {
      assert.equal((await request('/v1/settings', { method: 'POST', body })).status, 400);
    }
    assert.equal((await request('/v1/settings', { method: 'POST', body: { accent: 'cobalt', accentChangedAt: 1234 } })).status, 200);
    assert.deepEqual([settings.accent, settings.accentChangedAt], ['cobalt', 1234]);
    assert.equal((await request('/v1/settings')).body.accent, 'cobalt');
    assert.equal((await request('/v1/queue')).body.appearance, undefined, 'no appearance without a desktop that keeps one');

    const page = (await request('/api/history?limit=20')).body;
    assert.equal(page.total, 500);
    assert.equal(page.items.length, 20);
    const found = (await request('/api/history?q=sample-450&limit=20')).body;
    assert.equal(found.items.length, 1, 'search covers entries beyond the first page');
    const removed = found.items[0];
    assert.equal((await request(`/api/history/${removed.id}?mode=list`, { method: 'DELETE' })).status, 200);
    await fs.access(removed.absolutePath);
    assert.equal((await request('/api/history?q=sample-450')).body.total, 0);
    assert.equal((await request('/api/history', { method: 'DELETE' })).status, 400);

    const trashed = (await request('/api/history?q=sample-451')).body.items[0];
    assert.equal((await request(`/api/history/${trashed.id}?mode=trash`, { method: 'DELETE' })).status, 200);
    await assert.rejects(fs.access(trashed.absolutePath));
    await fs.access(path.join(trashDir, trashed.fileName));
    const missing = (await request('/api/history?q=sample-452')).body.items[0];
    locatedPath = path.join(dataDir, 'relocated.mp4');
    await fs.rename(missing.absolutePath, locatedPath);
    await api.stop();
    api = makeServer();
    address = await api.start();
    base = `http://127.0.0.1:${address.port}`;
    assert.equal(api.getAuthToken(), token);
    assert.equal(api.getConnectionState().extensionConnected, true);
    assert.equal((await request('/api/history?q=sample-450')).body.total, 0, 'removed records stay hidden after restart');
    const missingRecord = (await request('/api/history?q=sample-452')).body.items[0];
    assert.equal(missingRecord.missing, true);
    const located = await request(`/api/history/${missingRecord.id}/locate`, { method: 'POST' });
    assert.equal(located.status, 200);
    assert.equal(located.body.item.missing, false);
    assert.equal(located.body.item.absolutePath, locatedPath);
    assert.equal(redact({ headers: { Cookie: 'private' }, url: 'https://user:pass@example.org/a?token=private#secret' }).url, 'https://example.org/a');
  } finally {
    await api.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
