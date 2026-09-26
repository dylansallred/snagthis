const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '../..');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startRenderer() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: path.join(root, 'apps/desktop'), env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log = (log + chunk).slice(-10_000); });
  child.stderr.on('data', (chunk) => { log = (log + chunk).slice(-10_000); });
  const close = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((resolve) => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 4000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  };
  const deadline = Date.now() + 25_000;
  do {
    try { if ((await fetch(baseUrl)).ok) return { baseUrl, close }; } catch { /* startup */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  await close();
  throw new Error(`Renderer did not start: ${log}`);
}

async function launchDesktop(rendererUrl, { userDataDirectory } = {}) {
  const pinned = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
  if (process.versions.node.split('.')[0] !== pinned.split('.')[0]) throw new Error(`Electron e2e requires Node ${pinned}; current ${process.versions.node}`);
  const profile = userDataDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-electron-e2e-'));
  const port = await freePort();
  const env = {
    ...process.env, NODE_ENV: 'test', E2E_ALLOW_MULTI_INSTANCE: '1', E2E_USER_DATA_DIR: profile,
    M3U8_API_HOST: '127.0.0.1', M3U8_API_PORT: String(port), VITE_DEV_SERVER_URL: rendererUrl,
    DISABLE_FILE_LOGS: '1', LOG_LEVEL: 'error',
  };
  // Some host coding apps set this; inheriting it turns Electron into a Node CLI.
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(root, 'apps/desktop'), `--user-data-dir=${profile}`], env, timeout: 30_000 });
  } catch (error) {
    if (!userDataDirectory) fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  }
  return {
    app, profile, baseUrl: `http://127.0.0.1:${port}`,
    close: async () => { try { if (app.process().exitCode === null) await app.close(); } finally { fs.rmSync(profile, { recursive: true, force: true }); } },
  };
}

module.exports = { root, freePort, startRenderer, launchDesktop };
