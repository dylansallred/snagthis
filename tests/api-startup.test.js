const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('an occupied API port rejects startup without an unhandled WebSocket error', async () => {
  const existingServer = http.createServer();
  await new Promise((resolve) => existingServer.listen(0, '127.0.0.1', resolve));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-startup-'));

  try {
    // A real child process must catch the rejection and exit naturally. The
    // former unhandled ws error crashes it before the startup catch can run.
    const child = spawnSync(process.execPath, ['-e', `
      const { createApiServer } = require(${JSON.stringify(path.resolve(__dirname, '../packages/downloader-api/src'))});
      const api = createApiServer({
        dataDir: ${JSON.stringify(dataDir)},
        host: '127.0.0.1', port: ${existingServer.address().port},
        ffmpegPath: process.execPath, ffprobePath: process.execPath,
        ytDlpPath: process.execPath, trustBinaryPaths: true,
        initialQueueSettings: { autoStart: false },
      });
      (async () => {
        let rejected = false;
        try {
          await api.start();
        } catch (error) {
          if (error.code !== 'EADDRINUSE') throw error;
          rejected = true;
          process.stdout.write('caught EADDRINUSE');
        } finally {
          await api.stop();
        }
        if (!rejected) throw new Error('Startup unexpectedly acquired the occupied port');
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `], {
      encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, NODE_ENV: 'test', DISABLE_FILE_LOGS: '1', LOG_LEVEL: 'error' },
    });

    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, 'caught EADDRINUSE');
    assert.equal(existingServer.listening, true, 'the existing server remains untouched');
  } finally {
    await new Promise((resolve, reject) => existingServer.close((error) => error ? reject(error) : resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
