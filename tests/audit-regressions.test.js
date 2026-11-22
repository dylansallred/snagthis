const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { isPublicAddress } = require('../packages/downloader-api/src/utils/publicAddress');
const { buildDownloadAssetUrl, resolveDownloadPath } = require('../packages/downloader-api/src/utils/downloadPaths');
const { HistoryIndexService } = require('../packages/downloader-api/src/services/historyIndex');
const { createApiServer } = require('../packages/downloader-api/src/createApiServer');
const { recordSegmentDiagnostic, writeSegmentDiagnosticsReport } = require('../packages/downloader-engine/src/core/HlsSegmentDiagnostics');
const QueueManager = require('../packages/downloader-engine/src/core/QueueManager');
const { parseHlsManifest } = require('../packages/contracts/src/hls');

test('renaming a paused download preserves its working path and uses the requested filename', () => {
  const job = { id: 'rename1-direct', title: 'Original', mediaType: 'file', queueStatus: 'paused', filePath: path.join(os.tmpdir(), 'Original.webm') };
  const workingPath = job.filePath;
  const queue = Object.assign(Object.create(QueueManager.prototype), { queue: [job], saveQueue() {} });
  assert.equal(queue.renameJob(job.id, 'Trip.2024'), true);
  assert.equal(job.filePath, workingPath);
  assert.equal(job.downloadName, 'Trip.2024.webm');
  assert.equal(job.downloadNameMp4, 'Trip.2024.webm');
});

test('Saved forces one rescan for a newly completed job whose file cannot be indexed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'snagthis-hist-scan-'));
  const jobs = new Map();
  const history = new HistoryIndexService({ downloadDir: path.join(dir, 'downloads'), indexDir: dir, fsPromises: fsp, jobs });
  try {
    await history.init();
    let scans = 0;
    const walk = history.walkMediaFiles.bind(history);
    history.walkMediaFiles = (...args) => { scans += 1; return walk(...args); };
    t.mock.timers.tick(1);
    const job = { id: 'missing1-complete', queueStatus: 'completed', completedAt: Date.now() };
    jobs.set(job.id, job);
    await history.list();
    await history.list();
    assert.equal(scans, 1);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('isPublicAddress blocks IPv6 NAT64, 6to4, site-local, IPv4-compatible, and hex IPv4-mapped private addresses', () => {
  for (const blocked of [
    '64:ff9b::7f00:1',
    '64:ff9b::127.0.0.1',
    '64:ff9b::a00:1',
    '64:ff9b::c0a8:101',
    '64:ff9b:1::1',
    '::ffff:7f00:1',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '::7f00:1',
    '::127.0.0.1',
    '2002:7f00:1::1',
    '2001:0::1',
    'fec0::1',
  ]) {
    assert.equal(isPublicAddress(blocked), false, `${blocked} must be blocked`);
  }

  for (const allowed of [
    '93.184.215.14',
    '1.1.1.1',
    '2606:2800:220:1:248:1893:25c8:1946',
    '::ffff:93.184.215.14',
    '64:ff9b::93.184.215.14',
  ]) {
    assert.equal(isPublicAddress(allowed), true, `${allowed} must be allowed`);
  }
});

test('download asset URLs percent-encode # and % segments and decode back cleanly', () => {
  const root = path.join(os.tmpdir(), 'snagthis-encode-root');
  const file = path.join(root, 'Clip #1 100%', 'poster #1%.jpg');
  const url = buildDownloadAssetUrl(root, file);
  assert.equal(url, '/downloads/Clip%20%231%20100%25/poster%20%231%25.jpg');
  const resolved = resolveDownloadPath(root, url.slice('/downloads/'.length));
  assert.equal(resolved, path.resolve(file));
});

test('HistoryIndexService refuses basename fallback on stale encoded IDs and never treats year prefixes as job IDs', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'snagthis-hist-reg-'));
  const downloadDir = path.join(dir, 'downloads');
  try {
    await fsp.mkdir(path.join(downloadDir, 'TripA'), { recursive: true });
    await fsp.mkdir(path.join(downloadDir, 'TripB'), { recursive: true });
    await fsp.writeFile(path.join(downloadDir, 'TripB', 'clip.mp4'), 'video-b');
    await fsp.writeFile(path.join(downloadDir, '2024-beach.mp4'), 'beach-video');
    await fsp.writeFile(path.join(downloadDir, '2024-taxes.pdf'), 'tax-doc');

    const history = new HistoryIndexService({ downloadDir, indexDir: dir, fsPromises: fsp, jobs: new Map() });
    await history.init();

    const staleTripAId = Buffer.from('TripA/clip.mp4', 'utf8').toString('base64url');
    assert.equal(history.findById(staleTripAId), null, 'stale encoded path ID must fail closed instead of matching TripB/clip.mp4');

    const beach = history.items.find((item) => item.fileName === '2024-beach.mp4');
    assert.ok(beach);
    assert.equal(beach.jobId, null, 'year-prefixed filename must not be treated as a job ID');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('HLS manifest parser deduplicates repeated segment URLs', () => {
  const text = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:4',
    '#EXTINF:4.0,',
    'seg0.ts',
    '#EXTINF:4.0,',
    'seg0.ts',
    '#EXTINF:4.0,',
    'seg1.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const parsed = parseHlsManifest(text, 'https://cdn.example/video/index.m3u8');
  assert.deepEqual(parsed.segmentUrls, [
    'https://cdn.example/video/seg0.ts',
    'https://cdn.example/video/seg1.ts',
  ]);
});

test('HlsSegmentDiagnostics redacts signed query tokens, stores basenames only, and restricts file mode', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'snagthis-diag-reg-'));
  try {
    const job = {
      id: 'diagtest1-abcd',
      title: 'Test',
      url: 'https://cdn.example/stream/master.m3u8?token=supersecret123',
    };
    recordSegmentDiagnostic(job, {
      index: 0,
      url: 'https://cdn.example/stream/seg0.ts?sig=anothersecret456',
      path: path.join(dir, 'secret-folder', 'seg-0.ts'),
      issues: [{ code: 'duration-mismatch', severity: 'warn', message: 'mismatch' }],
    });
    const reportPath = await writeSegmentDiagnosticsReport(job, dir);
    assert.ok(reportPath);
    const raw = await fsp.readFile(reportPath, 'utf8');
    assert.doesNotMatch(raw, /supersecret123|anothersecret456|secret-folder/);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.segmentsWithIssues[0].path, 'seg-0.ts');
    if (process.platform !== 'win32') {
      const stat = await fsp.stat(reportPath);
      assert.equal(stat.mode & 0o777, 0o600);
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('media-detector structural ISO BMFF scanner avoids text false positives and detects real encrypted boxes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../apps/extension/js/media-detector.js'), 'utf8');
  const posted = [];
  const fetchListeners = [];
  const win = {
    postMessage: (msg) => posted.push(msg),
    addEventListener() {},
    fetch: async (url) => fetchListeners.shift()(url),
  };
  const sandbox = {
    URL,
    Uint8Array,
    DataView,
    ArrayBuffer,
    TextDecoder,
    Blob,
    Response,
    document: { baseURI: 'https://video.example/watch' },
    location: { href: 'https://video.example/watch' },
    history: { pushState() {}, replaceState() {} },
    navigator: {},
    XMLHttpRequest: function XMLHttpRequest() {},
    fetch: win.fetch,
    window: win,
  };
  sandbox.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(source, sandbox, { filename: 'media-detector.js' });

  const box = (type, payload) => {
    const out = new Uint8Array(8 + payload.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, out.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(payload, 8);
    return out;
  };

  // Plain bytes containing the words "sentence" and "latency" must NOT trigger DRM detection.
  const falsePositiveBytes = new TextEncoder().encode('This sentence mentions latency and pssh in prose.');
  fetchListeners.push(() => ({
    ok: true,
    url: 'https://cdn.example/init.mp4',
    headers: new Headers({ 'content-type': 'video/mp4', 'content-length': String(falsePositiveBytes.byteLength) }),
    clone() { return { arrayBuffer: async () => falsePositiveBytes.buffer }; },
  }));

  // Valid ISO BMFF moov -> pssh box MUST trigger DRM detection.
  const validPssh = box('moov', box('pssh', new Uint8Array(24)));
  fetchListeners.push(() => ({
    ok: true,
    url: 'https://cdn.example/real-init.mp4',
    headers: new Headers({ 'content-type': 'video/mp4', 'content-length': String(validPssh.byteLength) }),
    clone() { return { arrayBuffer: async () => validPssh.buffer }; },
  }));

  return Promise.all([
    sandbox.window.fetch('https://cdn.example/init.mp4'),
    sandbox.window.fetch('https://cdn.example/real-init.mp4'),
  ]).then(() => new Promise((resolve) => setTimeout(resolve, 25))).then(() => {
    const drmEvents = posted.filter((msg) => msg && msg.protection && msg.protection.signal === 'init');
    assert.equal(drmEvents.length, 1, 'only the valid ISO BMFF pssh box should report encrypted init');
  });
});

test('bridge accepts >1MB manifestText on /v1/jobs and rejects refresh-source on completed jobs with 409', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'snagthis-api-reg-'));
  const downloadDir = path.join(dir, 'downloads');
  await fsp.mkdir(downloadDir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'queue.json'), JSON.stringify({
    settings: { maxConcurrent: 1, autoStart: false },
    queue: [{
      id: 'donejob1-abc123',
      title: 'Finished Video',
      url: 'https://cdn.example/done/index.m3u8',
      status: 'completed',
      queueStatus: 'completed',
      mediaType: 'hls',
      progress: 100,
      updatedAt: Date.now(),
    }],
  }));
  const api = createApiServer({
    dataDir: dir,
    downloadDir,
    port: 0,
    ffmpegPath: process.execPath,
    ffprobePath: process.execPath,
    ytDlpPath: process.execPath,
    trustBinaryPaths: true,
    initialQueueSettings: { autoStart: false },
  });
  const addr = await api.start();
  const base = `http://127.0.0.1:${addr.port}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${api.getAuthToken()}`,
  };
  try {
    // 1) >1MB manifestText on /v1/jobs should NOT fail with 413 Payload Too Large.
    const bigManifest = '#EXTM3U\n' + '#EXTINF:4.0,\nhttps://cdn.example/seg.ts\n'.repeat(30_000) + '#EXT-X-ENDLIST\n';
    assert.ok(Buffer.byteLength(bigManifest, 'utf8') > 1_100_000);
    const createRes = await fetch(`${base}/v1/jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mediaUrl: 'https://cdn.example/big/index.m3u8',
        mediaType: 'hls',
        title: 'Big Manifest',
        manifestText: bigManifest,
      }),
    });
    assert.equal(createRes.status, 200);

    // 2) Refreshing a completed job must return 409.
    const refreshRes = await fetch(`${base}/v1/jobs/donejob1-abc123/refresh-source`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mediaUrl: 'https://cdn.example/done/new.m3u8' }),
    });
    assert.equal(refreshRes.status, 409);
  } finally {
    await api.stop();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
