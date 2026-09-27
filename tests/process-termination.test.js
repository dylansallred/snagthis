const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { createProcessStopper, processTreeSpawnOptions } = require('../packages/downloader-engine/src/core/ProcessTermination');

test('process stopper escalates an ignored SIGTERM and waits for actual close', {
  timeout: 5000,
  skip: process.platform === 'win32' ? 'Windows forcibly terminates Node children on SIGTERM.' : false,
}, async (t) => {
  const child = spawn(process.execPath, ['-e',
    "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);",
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  let stopCalls = 0;
  let observedClose = false;
  const stopper = createProcessStopper(child, { graceMs: 150, onStop: () => { stopCalls += 1; } });
  t.after(() => {
    stopper.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  child.once('close', () => { observedClose = true; });
  await once(child.stdout, 'data');
  const completion = stopper.stop();
  assert.equal(stopper.stop(), completion, 'repeated stop must share the same completion');
  await wait(20);
  assert.equal(child.killed, true, 'SIGTERM was sent');
  assert.equal(observedClose, false, 'sending SIGTERM must not release the queue slot');
  const result = await completion;
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(observedClose, true);
  assert.equal(stopCalls, 1);
});

test('process stopper accepts graceful termination and clears escalation', { timeout: 5000 }, async (t) => {
  const child = spawn(process.execPath, ['-e',
    "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);",
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  const stopper = createProcessStopper(child, { graceMs: 1500 });
  t.after(() => {
    stopper.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  await once(child.stdout, 'data');
  const result = await stopper.stop();
  assert.notEqual(result.signal, 'SIGKILL');
  if (process.platform !== 'win32') assert.equal(result.code, 0);
  assert.equal(stopper.stop(), stopper.stop());
});

test('process stopper records spawn errors but settles only after close', { timeout: 5000 }, async () => {
  const child = spawn(`${process.execPath}.snagthis-missing-executable`, [], { stdio: 'ignore' });
  let signalCalls = 0;
  const kill = child.kill.bind(child);
  child.kill = (...args) => { signalCalls += 1; return kill(...args); };
  const stopper = createProcessStopper(child, { graceMs: 50 });
  let observedClose = false;
  child.once('close', () => { observedClose = true; });
  const result = await stopper.stop();
  assert.equal(result.error?.code, 'ENOENT');
  assert.equal(signalCalls, 0, 'a failed spawn must never receive a process signal');
  assert.equal(observedClose, true);
  stopper.dispose();
});

test('process-tree stopper also stops a grandchild such as the ffmpeg yt-dlp starts', {
  timeout: 5000,
  skip: process.platform === 'win32' ? 'Windows uses taskkill /T, covered separately.' : false,
}, async (t) => {
  // The child ignores SIGTERM like a busy downloader; its grandchild would be
  // orphaned by a plain child.kill().
  const child = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: 'ignore' });
    process.on('SIGTERM', () => {});
    process.stdout.write(grandchild.pid + '\\n');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'ignore'], ...processTreeSpawnOptions() });
  const [chunk] = await once(child.stdout, 'data');
  const grandchildPid = Number(String(chunk).trim());
  t.after(() => { try { process.kill(grandchildPid, 'SIGKILL'); } catch { /* Already stopped. */ } });
  const stopper = createProcessStopper(child, { graceMs: 150, processTree: true });
  const result = await stopper.stop();
  assert.equal(result.signal, 'SIGKILL');
  let alive = true;
  for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
    try { process.kill(grandchildPid, 0); await wait(25); } catch { alive = false; }
  }
  assert.equal(alive, false, 'the grandchild must not outlive a stopped download');
});

test('process-tree stopper uses taskkill /T on Windows', () => {
  const calls = [];
  const fakeChild = { pid: 4321, on() {}, once() {}, removeListener() {}, kill() { throw new Error('Windows tree stop must not use child.kill'); } };
  const spawnImpl = (command, args) => { calls.push([command, ...args]); return { on() {} }; };
  const stopper = createProcessStopper(fakeChild, { processTree: true, platform: 'win32', spawnImpl, graceMs: 10_000 });
  void stopper.stop();
  stopper.dispose();
  assert.deepEqual(calls, [['taskkill', '/PID', '4321', '/T', '/F']]);
  assert.deepEqual(processTreeSpawnOptions('win32'), {}, 'Windows children are not detached into a console');
  assert.deepEqual(processTreeSpawnOptions('darwin'), { detached: true });
});

test('children still running at exit are killed, including a detached yt-dlp tree', {
  timeout: 5000,
  skip: process.platform === 'win32' ? 'Windows uses taskkill /T, covered separately.' : false,
}, async (t) => {
  const { killTrackedChildProcesses, trackChildProcess } = require('../packages/downloader-engine/src/core/ProcessTermination');
  const tree = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: 'ignore' });
    process.on('SIGTERM', () => {});
    process.stdout.write(grandchild.pid + '\\n');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'ignore'], ...processTreeSpawnOptions() });
  const [chunk] = await once(tree.stdout, 'data');
  const grandchildPid = Number(String(chunk).trim());
  const converter = trackChildProcess(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' }));
  t.after(() => {
    for (const pid of [grandchildPid, tree.pid, converter.pid]) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
  });
  const stopper = createProcessStopper(tree, { processTree: true });
  t.after(() => stopper.dispose());

  assert.equal(killTrackedChildProcesses(), 2);
  await Promise.all([once(tree, 'close'), converter.exitCode === null ? once(converter, 'close') : null]);
  let alive = true;
  for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
    try { process.kill(grandchildPid, 0); await wait(25); } catch { alive = false; }
  }
  assert.equal(alive, false, 'the grandchild does not outlive the app');
  assert.equal(killTrackedChildProcesses(), 0, 'nothing is left to kill');
});
