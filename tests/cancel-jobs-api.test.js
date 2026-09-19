const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');
const { toRowModel } = require('../packages/contracts/src/rows');

test('cancelling failed and waiting jobs hides and persists them, supports Undo, and preserves saved files', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidsnag-cancel-'));
  const downloadDir = path.join(dataDir, 'downloads');
  await fs.mkdir(downloadDir);
  const savedPath = path.join(downloadDir, 'saved-video.mp4');
  await fs.writeFile(savedPath, 'saved video fixture');
  const seed = [
    { id: 'failed-video', queueStatus: 'failed', status: 'error', error: 'Network connection lost', downloadMode: 'native-hls', segmentProgressAvailable: false },
    { id: 'paused-video', queueStatus: 'paused', status: 'paused', pauseRequested: true, resumeRequested: true },
    { id: 'waiting-video', queueStatus: 'queued', status: 'pending' },
    { id: 'saved-video', queueStatus: 'completed', status: 'completed', filePath: savedPath },
  ].map((job) => ({ url: 'https://example.org/video.mp4', mediaType: 'file', title: job.id, completedAt: Date.now(), ...job }));
  await fs.writeFile(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: seed, settings: { autoStart: false, maxConcurrent: 1 } }));
  const api = createApiServer({ dataDir, downloadDir, port: 0, ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true });
  const address = await api.start();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${api.getAuthToken()}` };
  const request = (route, method = 'GET') => fetch(`${base}${route}`, { method, headers });
  try {
    const detail = await (await request('/api/jobs/failed-video?full=1')).json();
    assert.equal(detail.downloadMode, 'native-hls');
    assert.equal(detail.segmentProgressAvailable, false);
    for (const jobId of ['failed-video', 'paused-video', 'waiting-video']) {
      assert.equal((await request(`/api/jobs/${jobId}/cancel`, 'POST')).status, 200);
      const current = api.getState().queue.find((job) => job.id === jobId);
      assert.equal(current.queueStatus, 'cancelled');
      assert.equal(current.status, 'cancelled');
      assert.equal(toRowModel(current), null, 'cancelled jobs leave the visible list');
      const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'queue.json'), 'utf8')).queue.find((job) => job.id === jobId);
      assert.equal(stored.queueStatus, 'cancelled');
      assert.equal(stored.pauseRequested, false);
      assert.equal(stored.resumeRequested, false);
    }
    assert.equal((await request('/api/jobs/saved-video/cancel', 'POST')).status, 409);
    assert.equal(api.getState().queue.find((job) => job.id === 'saved-video').queueStatus, 'completed');
    assert.equal(await fs.readFile(savedPath, 'utf8'), 'saved video fixture');
    const undo = await request('/api/jobs/failed-video/retry', 'POST');
    assert.equal(undo.status, 200);
    const retried = await undo.json();
    assert.equal(retried.retryOf, 'failed-video');
    assert.notEqual(retried.jobId, 'failed-video');
    const restored = api.getState().queue.find((job) => job.id === retried.jobId);
    assert.equal(restored.queueStatus, 'queued');
    assert.ok(toRowModel(restored));
    // Retry acknowledges enqueueing before its atomic queue write finishes.
    // Wait for that required write before removing this isolated profile.
    let persistedRetry;
    const persistDeadline = Date.now() + 2_000;
    do {
      const storedQueue = JSON.parse(await fs.readFile(path.join(dataDir, 'queue.json'), 'utf8')).queue;
      persistedRetry = storedQueue.find((job) => job.id === retried.jobId);
      if (persistedRetry || Date.now() >= persistDeadline) break;
      await delay(10);
    } while (true);
    assert.equal(persistedRetry?.queueStatus, 'queued', 'Undo must be persisted before shutdown');
  } finally {
    await api.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
