const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');

test('Chrome sign-in recovery is an explicit desktop-only retry of the existing YouTube job', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-youtube-auth-'));
  const downloadDir = path.join(dataDir, 'downloads');
  const authError = 'Sign in to confirm your age. This video may be inappropriate for some users.';
  const seed = [
    { id: 'auth-video', url: 'https://www.youtube.com/watch?v=fixture', error: authError, queueStatus: 'failed' },
    { id: 'other-site', url: 'https://www.youtube.com.evil.example/watch?v=fixture', error: authError, queueStatus: 'failed' },
    { id: 'network-error', url: 'https://www.youtube.com/watch?v=network', error: 'Network connection lost', queueStatus: 'failed' },
    { id: 'already-saved', url: 'https://www.youtube.com/watch?v=saved', error: authError, queueStatus: 'completed' },
  ].map((job) => ({ ...job, status: job.queueStatus === 'completed' ? 'completed' : 'error', completedAt: Date.now(), filePath: path.join(downloadDir, `${job.id}.mp4`), title: job.id, mediaType: 'file' }));
  await fs.writeFile(path.join(dataDir, 'queue.json'), JSON.stringify({ queue: seed, settings: { autoStart: false, maxConcurrent: 1 } }));
  const api = createApiServer({
    dataDir, downloadDir, port: 0, trustBinaryPaths: true,
    // Node rejects yt-dlp's arguments; this fixture cannot read browser cookies.
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath,
  });
  const address = await api.start();
  const base = `http://127.0.0.1:${address.port}`;
  const authorization = `Bearer ${api.getAuthToken()}`;
  const retry = (id, options = {}) => fetch(`${base}/${options.bridge || 'api/queue'}/${id}/use-chrome-session`, {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(options.body || {}),
  });
  try {
    assert.equal((await retry('auth-video', { headers: { Authorization: '' } })).status, 401);
    assert.equal((await retry('auth-video', { headers: { 'X-Client': 'snagthis-extension' } })).status, 403);
    assert.equal((await retry('auth-video', { bridge: 'v1/queue' })).status, 404);
    assert.equal((await retry('other-site', { body: { url: 'https://www.youtube.com/watch?v=fixture' } })).status, 409, 'the stored source determines eligibility');
    assert.equal((await retry('network-error')).status, 409);
    assert.equal((await retry('already-saved')).status, 409);
    const response = await retry('auth-video');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).jobId, 'auth-video');
    assert.equal(api.getState().queue.length, seed.length, 'retry reuses the job instead of adding a duplicate');

    // Wait for the fake executable's attempt to settle before cleaning up.
    for (let attempt = 0; api.getState().queue.find((job) => job.id === 'auth-video').queueStatus === 'downloading' && attempt < 100; attempt += 1) await delay(50);
    assert.equal(api.getState().queue.find((job) => job.id === 'auth-video').queueStatus, 'failed');
    assert.equal(JSON.stringify(api.getState()).includes('youtubeBrowserSession'), false);
    assert.equal((await fs.readFile(path.join(dataDir, 'queue.json'), 'utf8')).includes('youtubeBrowserSession'), false);
  } finally {
    await api.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
