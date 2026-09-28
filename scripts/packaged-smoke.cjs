const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { startFixtureServer } = require('../tests/fixtures/server');
const { probeFile } = require('../tests/fixtures/engine');

async function packagedSmoke(executablePath, resourcesPath) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-package-smoke-'));
  const bin = path.join(resourcesPath, 'bin');
  const realBin = fs.realpathSync(bin);
  const binary = name => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
  for (const name of ['ffmpeg', 'ffprobe', 'yt-dlp']) assert.ok(fs.existsSync(binary(name)), `Packaged ${name} is missing`);
  let fixture;
  let application;
  try {
    fixture = await startFixtureServer({ ffmpegPath: binary('ffmpeg') });
    const env = { ...process.env, NODE_ENV: 'test', E2E_ALLOW_MULTI_INSTANCE: '1', E2E_USER_DATA_DIR: path.join(temporary, 'profile'), M3U8_API_HOST: '127.0.0.1', M3U8_API_PORT: '0' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    delete env.FFMPEG_PATH;
    delete env.FFPROBE_PATH;
    delete env.YTDLP_PATH;
    application = await electron.launch({ executablePath, args: [`--user-data-dir=${env.E2E_USER_DATA_DIR}`], env, timeout: 60_000 });
    const window = await application.firstWindow();
    // waitForFunction doesn't await an async predicate (a Promise is truthy), so poll instead:
    // a slow first launch after installing otherwise read the app info before the API was ready.
    const readyBy = Date.now() + 30_000;
    // The first window starts blank and then loads the app, so a check can land mid-navigation.
    const startupState = () => window.evaluate(async () => (await window.desktop?.getAppInfo())?.apiStartupState).catch(() => null);
    while ((await startupState()) !== 'ready') {
      if (Date.now() > readyBy) throw new Error('The packaged download service never became ready');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const info = await window.evaluate(() => window.desktop.getAppInfo());
    assert.equal(info.isPackaged, true);
    assert.ok(info.apiAuthToken, 'Packaged API did not supply an installation token');
    await window.evaluate(outputDirectory => window.desktop.saveSettings({ outputDirectory, notifyOnComplete: false, queueAutoStart: true }), path.join(temporary, 'saved'));
    const runtime = await application.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      protocolRegistered: app.isDefaultProtocolClient('snagthis'),
      ffmpeg: process.env.FFMPEG_PATH, ffprobe: process.env.FFPROBE_PATH, ytdlp: process.env.YTDLP_PATH,
    }));
    assert.equal(runtime.protocolRegistered, true, 'The installed app did not register snagthis://');
    for (const key of ['ffmpeg', 'ffprobe', 'ytdlp']) {
      // Electron resolves macOS /var aliases to /private/var when launching a temp-installed app.
      // Resolve symlinks on both sides so aliases pass while actual escapes still fail.
      assert.ok(runtime[key] && fs.realpathSync(runtime[key]).startsWith(realBin + path.sep), `${key} escaped the packaged resources`);
    }
    const headers = { Authorization: `Bearer ${info.apiAuthToken}`, 'Content-Type': 'application/json', 'X-Client': 'snagthis-extension', 'X-Protocol-Version': '1' };
    const response = await fetch(`${info.apiBaseUrl}/v1/jobs`, { method: 'POST', headers, body: JSON.stringify({ mediaUrl: `${fixture.baseUrl}/media/ts/index.m3u8`, mediaType: 'hls', title: 'SnagThis packaged fixture', settings: { threads: 2 } }) });
    assert.equal(response.ok, true, `Packaged job was rejected (${response.status})`);
    const { jobId } = await response.json();
    assert.ok(jobId);
    let output = null;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const queueResponse = await fetch(`${info.apiBaseUrl}/v1/queue`, { headers });
      assert.equal(queueResponse.ok, true);
      const { queue } = await queueResponse.json();
      const job = queue.find(item => item.id === jobId);
      if (job?.queueStatus === 'failed') throw new Error(`Packaged fixture failed: ${job.error}`);
      if (job?.queueStatus === 'completed') {
        const historyResponse = await fetch(`${info.apiBaseUrl}/api/history`, { headers: { ...headers, 'X-Client': 'snagthis-desktop' } });
        assert.equal(historyResponse.ok, true, `Desktop history was rejected (${historyResponse.status})`);
        const { items } = await historyResponse.json();
        output = items.find(item => item.jobId === jobId)?.absolutePath;
        if (output) break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(output && fs.existsSync(output), 'Packaged download never produced a saved file');
    const probe = await probeFile(output, binary('ffprobe'));
    assert.ok(probe.format.includes('mp4'), `Unexpected output container: ${probe.format}`);
    assert.ok(Math.abs(probe.durationSeconds - 10) <= 1, `Unexpected duration: ${probe.durationSeconds}`);
    assert.equal(probe.height, 1080);
    assert.equal(probe.hasAudio, true);
    return { passed: true, version: info.version, isPackaged: runtime.isPackaged, protocolRegistered: runtime.protocolRegistered, fixture: '10-second local HLS video + audio', durationSeconds: probe.durationSeconds, height: probe.height, hasAudio: probe.hasAudio };
  } finally {
    if (application) await application.close();
    if (fixture) await fixture.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
module.exports = { packagedSmoke };
