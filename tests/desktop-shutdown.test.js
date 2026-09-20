const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

if (process.versions.electron) {
  const { app } = require('electron');
  const profile = process.env.VIDSNAG_SHUTDOWN_TEST_PROFILE;
  const scenario = process.env.VIDSNAG_SHUTDOWN_TEST_SCENARIO;
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  fs.mkdirSync(path.join(profile, 'crashes'), { recursive: true });
  app.setPath('crashDumps', path.join(profile, 'crashes'));
  const record = (event, details = {}) => fs.appendFileSync(path.join(profile, 'events.jsonl'), JSON.stringify({ event, ...details }) + '\n');
  const sourcePath = path.resolve(__dirname, '../apps/desktop/electron/main.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('let apiShutdownPromise = null;');
  const end = source.lastIndexOf('\nbootstrap();');
  if (start < 0 || end < start) throw new Error('Could not isolate actual shutdown handler');
  const sandbox = {
    app, updaterInstallRequested: scenario === 'update', updaterTimer: null, clearInterval,
    clearUpdaterInstallTimer() {}, clearUpdaterReminderTimer() {}, clearUpdaterCheckTimeout() {},
    autoUpdater: { quitAndInstall() { record('unexpected-install'); } },
    apiServer: { async stop() {
      record('stop-started');
      await new Promise(resolve => setTimeout(resolve, scenario === 'update' ? 1000 : 100));
      if (scenario === 'reject') { record('stop-rejected'); throw new Error('Expected shutdown failure'); }
      record('stop-completed');
    } },
  };
  // Execute the real application's handler using Electron's native lifecycle.
  // App bootstrap, network services, real profiles, and update installation are
  // deliberately absent from this isolated regression.
  vm.runInNewContext(source.slice(start, end), sandbox, { filename: sourcePath });
  app.on('before-quit', event => record('before-quit', { prevented: event.defaultPrevented }));
  app.on('quit', () => record('quit'));
  app.whenReady().then(() => {
    app.quit();
    if (scenario === 'repeat') {
      setTimeout(() => app.quit(), 20);
      setTimeout(() => app.quit(), 40);
    }
  });
} else {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const electron = require('electron');
  test('Electron waits for normal shutdown once, tolerates stop failure, and preserves direct update quit', async () => {
    for (const scenario of ['delayed', 'repeat', 'reject', 'update']) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vidsnag-shutdown-test-'));
      try {
        const environment = { ...process.env, VIDSNAG_SHUTDOWN_TEST_PROFILE: profile, VIDSNAG_SHUTDOWN_TEST_SCENARIO: scenario };
        delete environment.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
          const child = spawn(electron, [__filename, `--user-data-dir=${profile}`], {
            env: environment, stdio: ['ignore', 'ignore', 'pipe'],
          });
          let stderr = '';
          child.stderr.on('data', chunk => { stderr += chunk.toString(); });
          const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
          child.on('error', error => { clearTimeout(timeout); reject(error); });
          child.on('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stderr }); });
        });
        assert.equal(result.code, 0, `${scenario}: ${result.stderr}`);
        const events = fs.readFileSync(path.join(profile, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        const matching = event => events.filter(entry => entry.event === event);
        assert.equal(matching('stop-started').length, 1, `${scenario}: one shared shutdown attempt`);
        assert.equal(matching('quit').length, 1, `${scenario}: one completed quit`);
        assert.equal(matching('unexpected-install').length, 0, `${scenario}: handler never invokes the installer`);
        assert.equal(events.at(-1).event, 'quit', `${scenario}: quit is final`);
        if (scenario === 'update') {
          assert.equal(matching('before-quit').length, 1, 'update quit is not recursively restarted');
          assert.equal(matching('before-quit')[0].prevented, false, 'update quit remains direct');
          assert.equal(matching('stop-completed').length, 0, 'update quit is not held for the normal-quit guard');
        } else {
          assert.equal(matching(scenario === 'reject' ? 'stop-rejected' : 'stop-completed').length, 1, `${scenario}: stop settles before exit`);
          const quits = matching('before-quit');
          assert.equal(quits.at(-1).prevented, false, `${scenario}: completed cleanup permits final quit`);
          assert.ok(quits.slice(0, -1).every(event => event.prevented), `${scenario}: earlier quits wait for cleanup`);
          if (scenario === 'repeat') assert.ok(quits.length >= 4, 'repeated quits were received while cleanup was pending');
        }
      } finally {
        fs.rmSync(profile, { recursive: true, force: true });
      }
    }
  });
}
