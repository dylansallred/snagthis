const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('engine log files omit signed URL tokens and credentials, and rotate by size', () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-engine-logs-'));
  try {
    const resultPath = path.join(logDir, 'transports.json');
    const loggerPath = path.resolve(__dirname, '../packages/downloader-engine/src/utils/logger.js');
    const script = `
      const logger = require(${JSON.stringify(loggerPath)});
      logger.info('Direct job started', { url: 'https://user:pass@cdn.example/v/clip.mp4?token=signed-secret&expires=1', headers: { Cookie: 'session=private' } });
      logger.error('HLS job failed', { error: 'GET https://cdn.example/seg-4.ts?sig=segment-secret returned 403' });
      const files = logger.transports.filter(transport => transport.filename)
        .map(transport => ({ filename: transport.filename, maxsize: transport.maxsize, maxFiles: transport.maxFiles }));
      logger.on('finish', () => require('node:fs').writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(files)));
      logger.end();
    `;
    const environment = { ...process.env, LOG_DIR: logDir, NODE_ENV: 'production', LOG_LEVEL: 'info' };
    delete environment.DISABLE_FILE_LOGS;
    const result = spawnSync(process.execPath, ['-e', script], { env: environment, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const transports = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.deepEqual(transports.map(entry => path.basename(entry.filename)).sort(), ['combined.log', 'error.log']);
    for (const entry of transports) {
      assert.ok(entry.maxsize > 0 && entry.maxsize <= 10 * 1024 * 1024, 'each log file is size-capped');
      assert.ok(entry.maxFiles > 0 && entry.maxFiles <= 5, 'rotation keeps a bounded number of files');
    }
    const combined = fs.readFileSync(path.join(logDir, 'combined.log'), 'utf8');
    assert.match(combined, /https:\/\/cdn\.example\/v\/clip\.mp4/);
    assert.match(combined, /https:\/\/cdn\.example\/seg-4\.ts/);
    for (const secret of ['signed-secret', 'segment-secret', 'session=private', 'pass@', 'expires=1']) {
      assert.equal(combined.includes(secret), false, `${secret} must not be written to disk`);
    }
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});
