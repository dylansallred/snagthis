const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');

test('job creation bounds retries, keeps media extensions, refuses to open programs, and rate-limits clearly', { timeout: 20000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-job-safety-'));
  const downloadDir = path.join(dataDir, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });
  // A completed row whose file carries a program extension, as an older build
  // could have saved from a hostile URL.
  const program = path.join(downloadDir, 'installer.exe');
  fs.writeFileSync(program, 'not media');
  fs.writeFileSync(path.join(downloadDir, 'queue.json'), JSON.stringify({ queue: [{
    id: 'legacy-program', title: 'Legacy', status: 'completed', queueStatus: 'completed', filePath: program, completedAt: Date.now(),
  }], settings: { autoStart: false, maxConcurrent: 1 } }));
  const opened = [];
  const api = createApiServer({ dataDir, downloadDir, port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true,
    initialQueueSettings: { autoStart: false }, onOpenFile: async (filePath) => { opened.push(filePath); } });
  const address = await api.start();
  t.after(async () => { await api.stop(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }); });
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (route, body, headers = {}) => {
    const response = await fetch(`${base}${route}`, { method: 'POST', headers: {
      Authorization: `Bearer ${api.getAuthToken()}`, 'Content-Type': 'application/json', ...headers,
    }, body: JSON.stringify(body) });
    return { status: response.status, type: response.headers.get('content-type') || '', body: await response.json().catch(() => null) };
  };
  const extension = { 'X-Client': 'snagthis-extension', 'X-Protocol-Version': '1' };

  const malformedName = await request('/api/jobs', { queue: { url: 'https://example.org/a.mp4', name: 123 }, settings: { fileNaming: 'resource' } });
  assert.equal(malformedName.status, 400, 'a malformed name is a validation error, not a server failure');
  const opening = await request('/v1/jobs/legacy-program/open', {}, extension);
  assert.equal(opening.status, 415);
  assert.deepEqual(opened, [], 'a non-media file is never handed to the OS');

  const direct = await request('/v1/jobs', { mediaUrl: 'https://example.org/download/setup.exe?token=1', title: 'Setup', mediaType: 'file' }, extension);
  assert.equal(direct.status, 200, JSON.stringify(direct.body));
  const hls = await request('/api/jobs', { queue: { url: 'https://example.org/live/index.m3u8', title: 'clip.exe', mediaType: 'hls' } });
  assert.equal(hls.status, 200, JSON.stringify(hls.body));
  const queue = api.getState().queue;
  const directJob = queue.find(job => job.id === direct.body.jobId);
  const hlsJob = queue.find(job => job.id === (hls.body.jobId || hls.body.id));
  // Queue persistence is asynchronous; wait for both new rows to be written.
  let saved = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'queue.json'), 'utf8')).queue; } catch { saved = []; }
    if ([directJob.id, hlsJob.id].every(id => saved.some(job => job.id === id))) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const savedDirect = saved.find(job => job.id === directJob.id);
  const savedHls = saved.find(job => job.id === hlsJob.id);
  assert.equal(savedDirect.maxSegmentAttempts, 30, 'omitted retry limits are finite');
  assert.equal(savedHls.maxSegmentAttempts, 30);
  assert.equal(path.extname(savedDirect.filePath), '.mp4', 'an executable URL extension becomes .mp4');
  assert.equal(path.extname(savedHls.downloadNameMp4), '.mp4');
  assert.equal(path.extname(savedHls.filePath), '.ts');

  // The extension keeps its per-minute cap; the desktop can add a long pasted list.
  let limited;
  for (let index = 0; index < 20 && !limited; index += 1) {
    const result = await request('/v1/jobs', { mediaUrl: `https://example.org/extension-${index}.mp4`, mediaType: 'file' }, extension);
    if (result.status === 429) limited = result;
  }
  assert.ok(limited, 'extension job creation remains rate limited');
  assert.match(limited.type, /application\/json/);
  assert.equal(limited.body.code, 'RATE_LIMITED');
  assert.match(limited.body.error, /Wait a minute/);
  for (let index = 0; index < 25; index += 1) {
    const result = await request('/api/jobs', { queue: { url: `https://example.org/pasted-${index}.mp4`, mediaType: 'file' } });
    assert.equal(result.status, 200, `desktop link ${index + 1}: ${JSON.stringify(result.body)}`);
  }
});
