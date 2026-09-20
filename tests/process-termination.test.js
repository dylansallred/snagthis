const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { createProcessStopper } = require('../packages/downloader-engine/src/core/ProcessTermination');

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
  const child = spawn(`${process.execPath}.vidsnag-missing-executable`, [], { stdio: 'ignore' });
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
