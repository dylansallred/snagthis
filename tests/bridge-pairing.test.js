const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.DISABLE_FILE_LOGS = '1';
const { createApiServer } = require('../packages/downloader-api/src');

const ORIGIN_A = `chrome-extension://${'a'.repeat(32)}`;
const ORIGIN_B = `chrome-extension://${'b'.repeat(32)}`;
const secret = () => crypto.randomBytes(32).toString('hex');

async function startBridge(t, { dataDir, before } = {}) {
  const directory = dataDir || await fs.mkdtemp(path.join(os.tmpdir(), 'snagthis-pairing-'));
  if (before) await before(directory);
  const api = createApiServer({
    dataDir: directory, downloadDir: path.join(directory, 'downloads'), port: 0,
    ffmpegPath: process.execPath, ffprobePath: process.execPath, ytDlpPath: process.execPath, trustBinaryPaths: true,
    initialQueueSettings: { autoStart: false },
  });
  const address = await api.start();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.stop(); if (!dataDir) await fs.rm(directory, { recursive: true, force: true }); });
  const call = async (route, { method = 'GET', origin, token, body, headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json', 'X-Client': 'snagthis-extension', 'X-Protocol-Version': '1',
        ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const ask = (origin, requestSecret = secret()) => call('/v1/pair/request', { method: 'POST', origin, body: { secret: requestSecret } })
    .then((result) => ({ ...result, secret: requestSecret }));
  const status = (origin, requestId, requestSecret) => call('/v1/pair/status', { method: 'POST', origin, body: { requestId, secret: requestSecret } });
  return { api, base, call, ask, status, dataDir: directory, port: address.port };
}

test('one-click request accepts only chrome-extension origins behind the Host allowlist', async (t) => {
  const bridge = await startBridge(t);
  for (const origin of [undefined, 'null', 'http://127.0.0.1:5173', 'https://example.com', 'chrome-extension://not-an-id', 'moz-extension://abc']) {
    const result = await bridge.ask(origin);
    assert.equal(result.status, 403, `origin ${origin} is refused`);
    assert.equal(result.body.matchCode, undefined);
  }
  // A DNS-rebinding page reaches the port under its own host name.
  const rebinding = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: bridge.port, path: '/v1/pair/request', method: 'POST',
      headers: { Host: `evil.example:${bridge.port}`, Origin: ORIGIN_A, 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(JSON.stringify({ secret: secret() }));
  });
  assert.equal(rebinding, 403);
  assert.equal((await bridge.call('/v1/pair/request', { method: 'POST', origin: ORIGIN_A, body: { secret: 'short' } })).status, 400);
  assert.equal(bridge.api.getPendingPairing(), null, 'refused requests never reach the desktop');

  const accepted = await bridge.ask(ORIGIN_A);
  assert.equal(accepted.status, 201);
  assert.match(accepted.body.matchCode, /^\d{4}$/);
  assert.match(accepted.body.requestId, /^[0-9a-f]{32}$/);
  assert.equal(accepted.body.token, undefined);
  const pending = bridge.api.getPendingPairing();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.matchCode, accepted.body.matchCode, 'the desktop shows the same digits');
  assert.equal(pending.extensionId, 'a'.repeat(32));
  assert.equal(pending.identity, 'unrecognized');
  assert.equal(JSON.stringify(pending).includes(accepted.secret), false, 'the desktop never sees the request secret');
  // Status routes refuse null, web and native origins too.
  for (const origin of [undefined, 'null', 'http://localhost:5173']) {
    assert.equal((await bridge.status(origin, accepted.body.requestId, accepted.secret)).status, 403);
  }
});

test('approve hands the token once, only to the requesting extension holding its secret', async (t) => {
  const bridge = await startBridge(t);
  const first = await bridge.ask(ORIGIN_A);
  const { requestId } = first.body;
  assert.equal((await bridge.status(ORIGIN_A, requestId, first.secret)).body.status, 'pending');
  assert.equal(bridge.api.decidePairing('f'.repeat(32), true).ok, false, 'only the pending request can be approved');

  assert.deepEqual(bridge.api.decidePairing(requestId, true), { ok: true, status: 'approved' });
  // Another extension cannot collect it, even with the secret; the right one needs the secret.
  assert.equal((await bridge.status(ORIGIN_B, requestId, first.secret)).status, 404);
  assert.equal((await bridge.status(ORIGIN_A, requestId, secret())).status, 404);
  const collected = await bridge.status(ORIGIN_A, requestId, first.secret);
  assert.equal(collected.status, 200);
  assert.equal(collected.body.status, 'approved');
  assert.match(collected.body.token, /^[0-9a-f]{64}$/);
  assert.notEqual(collected.body.token, bridge.api.getAuthToken());
  const again = await bridge.status(ORIGIN_A, requestId, first.secret);
  assert.equal(again.body.status, 'approved');
  assert.equal(again.body.token, undefined, 'a token is handed out once');

  const token = collected.body.token;
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token })).status, 200);
  assert.equal((await bridge.call('/v1/queue', { token })).status, 200, 'Chrome may omit Origin on extension GETs');
  assert.equal((await bridge.call('/api/history', { token, headers: { 'X-Client': 'snagthis-desktop' } })).status, 403, 'extension tokens never reach desktop routes');
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_B, token })).status, 403, 'an unapproved origin is refused');
  assert.equal(bridge.api.getConnectionState().extensionConnected, true);
  const [entry] = bridge.api.listExtensions();
  assert.equal(entry.extensionId, 'a'.repeat(32));
  assert.ok(entry.lastSeenAt);

  // The stored credential is a hash; the raw token and request secret stay out of the file.
  const stored = await fs.readFile(path.join(bridge.dataDir, 'bridge-auth.json'), 'utf8');
  assert.equal(stored.includes(token), false);
  assert.equal(stored.includes(first.secret), false);
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(bridge.dataDir, 'bridge-auth.json'))).mode & 0o777, 0o600);
});

test('deny blocks that extension for an hour; cancel and expiry leave nothing approved', async (t) => {
  const bridge = await startBridge(t);
  const denied = await bridge.ask(ORIGIN_A);
  assert.deepEqual(bridge.api.decidePairing(denied.body.requestId, false), { ok: true, status: 'denied' });
  assert.equal((await bridge.status(ORIGIN_A, denied.body.requestId, denied.secret)).body.status, 'denied');
  const blocked = await bridge.ask(ORIGIN_A);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PAIRING_BLOCKED');
  assert.equal(bridge.api.listExtensions().length, 0);

  const cancelled = await bridge.ask(ORIGIN_B);
  assert.equal((await bridge.call('/v1/pair/cancel', { method: 'POST', origin: ORIGIN_A, body: { requestId: cancelled.body.requestId, secret: cancelled.secret } })).status, 404, 'only the requester can cancel');
  assert.equal((await bridge.call('/v1/pair/cancel', { method: 'POST', origin: ORIGIN_B, body: { requestId: cancelled.body.requestId, secret: cancelled.secret } })).body.status, 'cancelled');
  assert.equal(bridge.api.decidePairing(cancelled.body.requestId, true).ok, false, 'a cancelled request cannot be approved');

  // Expiry uses the bridge clock: two minutes without Allow.
  const realNow = Date.now;
  const expiring = await bridge.ask(ORIGIN_B);
  try {
    Date.now = () => realNow() + 121_000;
    assert.equal(bridge.api.decidePairing(expiring.body.requestId, true).ok, false);
    assert.equal((await bridge.status(ORIGIN_B, expiring.body.requestId, expiring.secret)).body.status, 'expired');
    Date.now = () => realNow() + 61 * 60_000;
    assert.equal((await bridge.ask(ORIGIN_A)).status, 201, 'the deny block lifts after an hour');
  } finally { Date.now = realNow; }
  assert.equal(bridge.api.listExtensions().length, 0);
});

test('two requests at once cancel both, and requests are limited to 3 per 5 minutes', async (t) => {
  const bridge = await startBridge(t);
  const first = await bridge.ask(ORIGIN_A);
  const second = await bridge.ask(ORIGIN_B);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'PAIRING_CONFLICT');
  assert.equal(second.body.matchCode, undefined);
  assert.equal((await bridge.status(ORIGIN_A, first.body.requestId, first.secret)).body.status, 'conflict');
  assert.equal(bridge.api.getPendingPairing().status, 'conflict', 'the desktop explains the clash');
  assert.equal(bridge.api.decidePairing(first.body.requestId, true).ok, false, 'neither request can be approved');
  const third = await bridge.ask(ORIGIN_A);
  assert.equal(third.status, 201);
  assert.equal((await bridge.call('/v1/pair/cancel', { method: 'POST', origin: ORIGIN_A, body: { requestId: third.body.requestId, secret: third.secret } })).status, 200);
  const fourth = await bridge.ask(ORIGIN_A);
  assert.equal(fourth.status, 201);
  assert.equal((await bridge.call('/v1/pair/cancel', { method: 'POST', origin: ORIGIN_A, body: { requestId: fourth.body.requestId, secret: fourth.secret } })).status, 200);
  const limited = await bridge.ask(ORIGIN_A);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
  // The limit belongs to the requesting extension: one noisy extension cannot lock out another.
  const other = await bridge.ask(ORIGIN_B);
  assert.equal(other.status, 201, 'another extension can still ask');
  assert.equal(bridge.api.listExtensions().length, 0);
});

test('per-extension tokens: revoke one browser, the other keeps working; self-disconnect', async (t) => {
  const bridge = await startBridge(t);
  const pair = async (origin) => {
    const asked = await bridge.ask(origin);
    bridge.api.decidePairing(asked.body.requestId, true);
    return (await bridge.status(origin, asked.body.requestId, asked.secret)).body.token;
  };
  const tokenA = await pair(ORIGIN_A);
  const code = bridge.api.getPairingInfo().code;
  const viaCode = await bridge.call('/v1/pair/complete', { method: 'POST', origin: ORIGIN_B, body: { code } });
  assert.equal(viaCode.status, 200);
  const tokenB = viaCode.body.token;
  assert.notEqual(tokenA, tokenB);
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token: tokenB })).status, 401, 'a token is bound to its own extension');
  assert.equal(bridge.api.listExtensions().length, 2);

  const entryA = bridge.api.listExtensions().find((entry) => entry.extensionId === 'a'.repeat(32));
  assert.equal(bridge.api.revokeExtension(entryA.id), true);
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token: tokenA })).status, 403, 'a revoked origin is no longer approved');
  assert.equal((await bridge.call('/v1/queue', { token: tokenA })).status, 401, 'a revoked token is dead');
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_B, token: tokenB })).status, 200, 'other browsers keep working');
  assert.equal((await bridge.call('/v1/queue', { token: bridge.api.getAuthToken(), headers: { 'X-Client': 'snagthis-desktop' } })).status, 200, 'the desktop keeps working');

  assert.equal((await bridge.call('/v1/pair/disconnect', { method: 'POST', token: bridge.api.getAuthToken(), body: {} })).status, 400, 'the desktop token is not an extension');
  assert.equal((await bridge.call('/v1/pair/disconnect', { method: 'POST', origin: ORIGIN_B, token: tokenB, body: {} })).status, 200);
  assert.equal((await bridge.call('/v1/queue', { token: tokenB })).status, 401);
  assert.equal(bridge.api.listExtensions().length, 0);
  assert.equal(bridge.api.getConnectionState().extensionConnected, false);

  // Re-pair after disconnecting issues a fresh token.
  const again = await pair(ORIGIN_B);
  assert.notEqual(again, tokenB);
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_B, token: again })).status, 200);
});

test('migration keeps an already-paired extension working, then retires the shared token', async (t) => {
  const legacy = crypto.randomBytes(32).toString('hex');
  const bridge = await startBridge(t, { before: (directory) => fs.writeFile(path.join(directory, 'bridge-auth.json'),
    JSON.stringify({ token: legacy, approvedOrigins: [ORIGIN_A, 'https://not-an-extension.example'], extensionConnected: true }), { mode: 0o600 }) });
  assert.notEqual(bridge.api.getAuthToken(), legacy, 'the desktop gets a credential no extension holds');
  const [entry] = bridge.api.listExtensions();
  assert.equal(bridge.api.listExtensions().length, 1);
  assert.equal(entry.legacy, true);
  assert.equal(bridge.api.getConnectionState().extensionConnected, true);

  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token: legacy })).status, 200, 'the paired extension keeps working');
  assert.equal((await bridge.call('/v1/queue', { token: legacy })).status, 200, 'including GETs without Origin');
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_B, token: legacy })).status, 403);
  assert.equal((await bridge.call('/api/history', { token: legacy, headers: { 'X-Client': 'snagthis-desktop' } })).status, 403, 'the old shared token no longer opens desktop routes');
  assert.equal((await bridge.call('/api/history', { token: bridge.api.getAuthToken(), headers: { 'X-Client': 'snagthis-desktop' } })).status, 200);
  assert.equal((await bridge.call('/v1/pair/upgrade', { method: 'POST', token: legacy, body: {} })).status, 409, 'an upgrade needs the extension origin');

  const upgraded = await bridge.call('/v1/pair/upgrade', { method: 'POST', origin: ORIGIN_A, token: legacy, body: {} });
  assert.equal(upgraded.status, 200);
  assert.match(upgraded.body.token, /^[0-9a-f]{64}$/);
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token: upgraded.body.token })).status, 200);
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token: legacy })).status, 401, 'the shared token is retired');
  assert.equal((await bridge.call('/v1/queue', { token: legacy })).status, 401);
  assert.equal((await bridge.call('/v1/pair/upgrade', { method: 'POST', origin: ORIGIN_A, token: upgraded.body.token, body: {} })).status, 409);
  const stored = JSON.parse(await fs.readFile(path.join(bridge.dataDir, 'bridge-auth.json'), 'utf8'));
  assert.equal(stored.version, 2);
  assert.equal(stored.legacyToken, null);
  assert.equal(JSON.stringify(stored).includes(legacy), false);
  assert.equal(JSON.stringify(stored).includes(upgraded.body.token), false);
});

test('revoking a not-yet-upgraded extension retires the shared token immediately', async (t) => {
  const legacy = crypto.randomBytes(32).toString('hex');
  const bridge = await startBridge(t, { before: (directory) => fs.writeFile(path.join(directory, 'bridge-auth.json'),
    JSON.stringify({ token: legacy, approvedOrigins: [ORIGIN_A], extensionConnected: true }), { mode: 0o600 }) });
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token: legacy })).status, 200);
  assert.equal(bridge.api.revokeExtension(bridge.api.listExtensions()[0].id), true);
  assert.equal((await bridge.call('/v1/queue', { token: legacy })).status, 401);
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A, token: legacy })).status, 403);
});

test('pairing never writes tokens, secrets or match codes to logs or diagnostics', async (t) => {
  const written = [];
  const capture = (stream) => { const original = stream.write.bind(stream); stream.write = (chunk, ...rest) => { written.push(String(chunk)); return original(chunk, ...rest); }; return () => { stream.write = original; }; };
  const restoreOut = capture(process.stdout);
  const restoreErr = capture(process.stderr);
  let values;
  let bridge;
  try {
    bridge = await startBridge(t);
    const asked = await bridge.ask(ORIGIN_A);
    bridge.api.decidePairing(asked.body.requestId, true);
    const token = (await bridge.status(ORIGIN_A, asked.body.requestId, asked.secret)).body.token;
    await bridge.call('/v1/queue', { origin: ORIGIN_A, token });
    values = { token, secret: asked.secret, matchCode: `"${asked.body.matchCode}"` };
    const diagnostics = await bridge.call('/api/diagnostics', { token: bridge.api.getAuthToken(), headers: { 'X-Client': 'snagthis-desktop' } });
    assert.equal(diagnostics.status, 200);
    const text = JSON.stringify(diagnostics.body);
    assert.equal(text.includes(token), false, 'diagnostics omit the token');
    assert.equal(text.includes(asked.secret), false, 'diagnostics omit the request secret');
    assert.equal(/matchCode|pairing-secret/.test(text), false);
  } finally { restoreOut(); restoreErr(); }
  const logged = written.join('');
  for (const [name, value] of Object.entries(values)) assert.equal(logged.includes(value), false, `logs omit the ${name}`);
});

test('connecting with a code after Deny lifts that extension\'s block', async (t) => {
  const bridge = await startBridge(t);
  const denied = await bridge.ask(ORIGIN_A);
  bridge.api.decidePairing(denied.body.requestId, false);
  assert.equal((await bridge.ask(ORIGIN_A)).status, 403);
  const viaCode = await bridge.call('/v1/pair/complete', { method: 'POST', origin: ORIGIN_A, body: { code: bridge.api.getPairingInfo().code } });
  assert.equal(viaCode.status, 200);
  const again = await bridge.ask(ORIGIN_A);
  assert.equal(again.status, 201);
  assert.equal(bridge.api.getPendingPairing().identity, 'connected-before');
});

test('code attempts are limited per extension, so one extension cannot lock out another', async (t) => {
  const bridge = await startBridge(t);
  const code = bridge.api.getPairingInfo().code;
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await bridge.call('/v1/pair/complete', { method: 'POST', origin: ORIGIN_B, body: { code: wrong } })).status, 403);
  }
  assert.equal((await bridge.call('/v1/pair/complete', { method: 'POST', origin: ORIGIN_B, body: { code } })).status, 429, 'the guessing extension is limited');
  const viaCode = await bridge.call('/v1/pair/complete', { method: 'POST', origin: ORIGIN_A, body: { code } });
  assert.equal(viaCode.status, 200, 'the user\'s extension still connects');
  assert.match(viaCode.body.token, /^[0-9a-f]{64}$/);
});

const WebSocket = require('ws');
async function openSocket(bridge, { origin, token }) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, ['snagthis', `snagthis-auth.${token}`], origin ? { origin } : {});
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const messages = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw)));
  const closed = new Promise((resolve) => socket.once('close', resolve));
  socket.send(JSON.stringify({ type: 'subscribe', channel: 'queue' }));
  const deadline = Date.now() + 2000;
  while (!messages.some((message) => message.type === 'queue:update') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(messages.some((message) => message.type === 'queue:update'), 'the socket receives queue updates while connected');
  return { socket, messages, closed };
}
const closedWithin = (socket, closed, ms = 2000) => Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(socket.readyState === WebSocket.CLOSED), ms))]);

test('disconnect, revoke and re-pair close that extension\'s live WebSocket', async (t) => {
  const bridge = await startBridge(t);
  const pair = async (origin) => {
    const asked = await bridge.ask(origin);
    bridge.api.decidePairing(asked.body.requestId, true);
    return (await bridge.status(origin, asked.body.requestId, asked.secret)).body.token;
  };
  const tokenA = await pair(ORIGIN_A);
  const tokenB = (await bridge.call('/v1/pair/complete', { method: 'POST', origin: ORIGIN_B, body: { code: bridge.api.getPairingInfo().code } })).body.token;
  const a = await openSocket(bridge, { origin: ORIGIN_A, token: tokenA });
  const b = await openSocket(bridge, { origin: ORIGIN_B, token: tokenB });
  const desktop = await openSocket(bridge, { token: bridge.api.getAuthToken() });

  // Popup "Disconnect": the extension's socket stops receiving queue updates.
  assert.equal((await bridge.call('/v1/pair/disconnect', { method: 'POST', origin: ORIGIN_A, token: tokenA, body: {} })).status, 200);
  assert.equal(await closedWithin(a.socket, a.closed), true, 'the disconnected extension\'s socket is closed');
  const received = a.messages.length;
  await bridge.call('/v1/jobs', { method: 'POST', origin: ORIGIN_B, token: tokenB, body: { mediaUrl: 'https://example.org/after-disconnect.mp4', mediaType: 'file' } });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(a.messages.length, received, 'no queue:update reaches a disconnected extension');
  assert.equal(b.socket.readyState, WebSocket.OPEN, 'other browsers stay connected');
  assert.equal(desktop.socket.readyState, WebSocket.OPEN, 'the desktop stays connected');

  // Re-pairing B replaces its token; the socket opened with the old one closes.
  const reissued = await pair(ORIGIN_B);
  assert.notEqual(reissued, tokenB);
  assert.equal(await closedWithin(b.socket, b.closed), true, 'a replaced token\'s socket is closed');
  // Settings "Disconnect" (desktop IPC) closes the new one too.
  const c = await openSocket(bridge, { origin: ORIGIN_B, token: reissued });
  assert.equal(bridge.api.revokeExtension(bridge.api.listExtensions().find((entry) => entry.extensionId === 'b'.repeat(32)).id), true);
  assert.equal(await closedWithin(c.socket, c.closed), true, 'a revoked extension\'s socket is closed');
  assert.equal(desktop.socket.readyState, WebSocket.OPEN);
  desktop.socket.close();
});

test('retiring the shared pre-upgrade token closes sockets opened with it', async (t) => {
  const legacy = crypto.randomBytes(32).toString('hex');
  const bridge = await startBridge(t, { before: (directory) => fs.writeFile(path.join(directory, 'bridge-auth.json'),
    JSON.stringify({ token: legacy, approvedOrigins: [ORIGIN_A], extensionConnected: true }), { mode: 0o600 }) });
  const withOrigin = await openSocket(bridge, { origin: ORIGIN_A, token: legacy });
  const withoutOrigin = await openSocket(bridge, { token: legacy });
  const upgraded = await bridge.call('/v1/pair/upgrade', { method: 'POST', origin: ORIGIN_A, token: legacy, body: {} });
  assert.equal(upgraded.status, 200);
  assert.equal(await closedWithin(withOrigin.socket, withOrigin.closed), true);
  assert.equal(await closedWithin(withoutOrigin.socket, withoutOrigin.closed), true);
  const current = await openSocket(bridge, { origin: ORIGIN_A, token: upgraded.body.token });
  assert.equal(current.socket.readyState, WebSocket.OPEN, 'the upgraded token connects normally');
  current.socket.close();
});

test('media inspection is desktop-only and never fetches this computer or the local network', async (t) => {
  const bridge = await startBridge(t);
  const code = bridge.api.getPairingInfo().code;
  const token = (await bridge.call('/v1/pair/complete', { method: 'POST', origin: ORIGIN_A, body: { code } })).body.token;
  const target = `http://127.0.0.1:${bridge.port}/v1/health`;
  const fromExtension = await bridge.call('/v1/media/inspect', { method: 'POST', origin: ORIGIN_A, token, body: { mediaUrl: target } });
  assert.equal(fromExtension.status, 404, 'the extension bridge has no server-side fetcher');
  assert.equal((await bridge.call('/api/media/inspect', { method: 'POST', origin: ORIGIN_A, token, body: { mediaUrl: target } })).status, 403);
  const desktop = { token: bridge.api.getAuthToken(), headers: { 'X-Client': 'snagthis-desktop' } };
  for (const mediaUrl of [target, 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/a.mp4', 'http://[fd00::1]/a.mp4']) {
    const refused = await bridge.call('/api/media/inspect', { method: 'POST', ...desktop, body: { mediaUrl } });
    assert.equal(refused.status, 400, mediaUrl);
    assert.match(refused.body.error, /public websites/);
  }
});

test('the Chrome Web Store build pairs as the store extension, any other ID as unrecognised', async (t) => {
  const bridge = await startBridge(t);
  const store = await bridge.ask('chrome-extension://dempkhcipnakfiidcnlckkjfbieggcbp');
  assert.equal(store.status, 201);
  assert.equal(bridge.api.getPendingPairing().identity, 'store');
});

test('"Waiting for Chrome…": health shows only a listening flag and session, and auth is unchanged', async (t) => {
  const bridge = await startBridge(t);
  const health = () => bridge.call('/v1/health', { origin: ORIGIN_A }).then((result) => result.body.pairing);
  assert.deepEqual(await health(), { listening: false });
  const first = bridge.api.setPairingListening(true);
  assert.equal(first.listening, true);
  assert.match(first.session, /^[0-9a-f]{16}$/);
  assert.deepEqual(await health(), first, 'the public flag carries a random session and nothing else');
  // Renewing keeps the same session, so an extension asks at most once per listening card.
  assert.equal(bridge.api.setPairingListening(true).session, first.session);
  // Listening never authenticates anything and never approves a request.
  assert.equal((await bridge.call('/v1/queue', { origin: ORIGIN_A })).status, 403, 'an unpaired extension origin is still refused');
  const asked = await bridge.ask(ORIGIN_A);
  assert.equal(asked.status, 201);
  assert.equal(bridge.api.getPendingPairing().status, 'pending', 'still waits for Allow in SnagThis');
  assert.equal((await bridge.status(ORIGIN_A, asked.body.requestId, asked.secret)).body.status, 'pending');
  // Allow ends listening: the next browser has to be asked for again.
  assert.equal(bridge.api.decidePairing(asked.body.requestId, true).ok, true);
  assert.deepEqual(await health(), { listening: false });
  // Deny blocks and rate limits are not relaxed while listening.
  bridge.api.setPairingListening(true);
  const denied = await bridge.ask(ORIGIN_B);
  bridge.api.decidePairing(denied.body.requestId, false);
  assert.equal((await bridge.ask(ORIGIN_B)).body.code, 'PAIRING_BLOCKED');
  const previous = bridge.api.setPairingListening(true).session;
  bridge.api.setPairingListening(false);
  assert.deepEqual(await health(), { listening: false });
  assert.notEqual(bridge.api.setPairingListening(true).session, previous, 'a new card is a new session');
});

test('listening lapses on its own when the desktop stops renewing it', async (t) => {
  const bridge = await startBridge(t);
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  bridge.api.setPairingListening(true);
  Date.now = () => realNow() + 91_000;
  assert.deepEqual((await bridge.call('/v1/health')).body.pairing, { listening: false });
});
