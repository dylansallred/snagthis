const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete environment[key];
}
environment.VITE_DEV_SERVER_URL ||= 'http://localhost:5173';
environment.DEBUG_YTDLP_PROGRESS ||= '1';

const desktopDirectory = path.resolve(__dirname, '..');
const child = spawn(electron, [desktopDirectory, ...process.argv.slice(2)], {
  cwd: desktopDirectory,
  env: environment,
  stdio: 'inherit',
});

const forwardInterrupt = () => child.kill('SIGINT');
const forwardTerminate = () => child.kill('SIGTERM');
process.once('SIGINT', forwardInterrupt);
process.once('SIGTERM', forwardTerminate);

child.once('error', (error) => {
  console.error(`Could not start Electron: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.removeListener('SIGINT', forwardInterrupt);
  process.removeListener('SIGTERM', forwardTerminate);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
