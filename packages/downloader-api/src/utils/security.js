const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { redact, redactUrl } = require('@m3u8/downloader-engine/src/utils/redact');

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const AUTH_PROTOCOL_PREFIX = 'snagthis-auth.';
const ASSET_PATH = /^\/(?:downloads\/|api\/(?:history\/(?:file|stream)\/|jobs\/[^/]+\/(?:file|stream)$))/;
const PAIRING_SECRET = /^[0-9a-f]{64}$/;
const PAIRING_REQUEST_ID = /^[0-9a-f]{32}$/;
// One-click pairing limits (docs/design/prototypes/pairing option 2).
const REQUEST_LIFETIME_MS = 2 * 60_000;
const REQUEST_WINDOW_MS = 5 * 60_000;
// Counted per requesting extension, so one noisy extension cannot lock out another;
// the global ceiling only bounds the total prompts the desktop can be shown.
const REQUESTS_PER_WINDOW = 3;
const GLOBAL_REQUESTS_PER_WINDOW = 30;
const DENY_BLOCK_MS = 60 * 60_000;
// Finished requests stay long enough for the requester's next poll to read the outcome.
const FINISHED_RETENTION_MS = 5 * 60_000;
const LAST_SEEN_SAVE_MS = 60_000;
// Web Store item IDs, recorded once the store item exists (docs/extension-release.md,
// "Establish the store identity"). Any other ID is shown to the user as unrecognised.
const STORE_EXTENSION_IDS = Object.freeze(['dempkhcipnakfiidcnlckkjfbieggcbp']);

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
const extensionIdOf = (origin) => String(origin || '').slice('chrome-extension://'.length);

/**
 * Bridge credentials. The desktop renderer holds the installation token; every paired
 * extension holds its own token, bound to its chrome-extension:// origin and stored only
 * as a hash, so one browser can be disconnected without affecting the others.
 */
function createBridgeSecurity({ dataDir, authToken, allowedOrigins = [], onExtensionConnected, onPairingChange, onCredentialsRevoked, storeExtensionIds = STORE_EXTENSION_IDS }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'bridge-auth.json');
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* First installation. */ }
  const validToken = (value) => typeof value === 'string' && value.length >= 32;
  const migrating = stored.version !== 2;
  const now = () => Date.now();
  // Before per-extension tokens, every paired extension held the desktop token. Migration
  // keeps that value only as a legacy credential for those same origins, and gives the
  // desktop a fresh token so no extension holds the renderer's credential any more.
  let legacyToken = migrating
    ? (validToken(stored.token) && Array.isArray(stored.approvedOrigins) && stored.approvedOrigins.some((origin) => EXTENSION_ORIGIN.test(origin)) ? stored.token : null)
    : (validToken(stored.legacyToken) ? stored.legacyToken : null);
  let token = authToken || (!migrating && validToken(stored.token) ? stored.token : randomHex(32));
  if (legacyToken && sameSecret(legacyToken, token)) token = randomHex(32);
  let extensions = migrating
    ? (legacyToken ? [...new Set(stored.approvedOrigins.filter((origin) => EXTENSION_ORIGIN.test(origin)))].map((origin) => ({
      id: randomHex(8), origin, tokenHash: null, legacy: true, createdAt: now(), lastSeenAt: stored.extensionConnected ? now() : null,
    })) : [])
    : (Array.isArray(stored.extensions) ? stored.extensions : []).filter((entry) => entry && EXTENSION_ORIGIN.test(entry.origin)
      && typeof entry.id === 'string' && (entry.legacy === true ? Boolean(legacyToken) : /^[0-9a-f]{64}$/.test(entry.tokenHash)))
      .map((entry) => ({ id: entry.id, origin: entry.origin, tokenHash: entry.legacy ? null : entry.tokenHash, legacy: entry.legacy === true,
        createdAt: Number(entry.createdAt) || now(), lastSeenAt: Number(entry.lastSeenAt) || null }));
  if (!extensions.some((entry) => entry.legacy)) legacyToken = null;
  const trustedOrigins = new Set(allowedOrigins);
  const knownStoreIds = new Set(storeExtensionIds);
  let pairing = null;
  const save = () => {
    const tempPath = `${statePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ version: 2, token, legacyToken, extensions }), { mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, statePath);
  };
  save();

  const extensionConnected = () => extensions.some((entry) => entry.lastSeenAt);
  const approvedOrigin = (origin) => extensions.some((entry) => entry.origin === origin);
  const notify = () => { if (typeof onExtensionConnected === 'function') onExtensionConnected(); };
  // Live connections (WebSockets) authenticated earlier re-check isCurrent() here.
  const revoked = () => { if (typeof onCredentialsRevoked === 'function') onCredentialsRevoked(); };

  function originAllowed(origin, { pairingRequest = false } = {}) {
    if (!origin) return true; // Native clients still must possess a token.
    if (trustedOrigins.has(origin) || approvedOrigin(origin)) return true;
    return pairingRequest && EXTENSION_ORIGIN.test(origin);
  }

  function presentedToken(req) {
    const authorization = String(req.headers.authorization || '');
    if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '');
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map((item) => item.trim());
    const protocol = protocols.find((item) => item.startsWith(AUTH_PROTOCOL_PREFIX));
    return protocol ? protocol.slice(AUTH_PROTOCOL_PREFIX.length) : '';
  }

  /** The authenticated client: { kind: 'desktop' }, { kind: 'extension', entry } or null. */
  function authenticate(req) {
    const presented = presentedToken(req);
    if (!presented) return null;
    const origin = String(req.headers.origin || '');
    if (sameSecret(presented, token)) {
      // The renderer's credential is never valid from an extension page.
      return EXTENSION_ORIGIN.test(origin) ? null : { kind: 'desktop' };
    }
    if (legacyToken && sameSecret(presented, legacyToken)) {
      // Chrome can omit Origin on a privileged extension GET; a pre-upgrade
      // extension is then accepted without being attributed to one origin.
      if (!origin) return { kind: 'extension', entry: null, legacy: true };
      const entry = extensions.find((candidate) => candidate.legacy && candidate.origin === origin);
      return entry ? { kind: 'extension', entry, legacy: true } : null;
    }
    const hash = sha256(presented);
    const entry = extensions.find((candidate) => candidate.tokenHash && sameSecret(candidate.tokenHash, hash));
    if (!entry) return null;
    // An extension token only works from its own origin (or with Origin omitted, as above).
    if (origin && origin !== entry.origin) return null;
    return { kind: 'extension', entry };
  }

  /** Whether a client authenticated earlier still holds a live credential. */
  function isCurrent(client) {
    if (!client) return false;
    if (client.kind === 'desktop') return true;
    if (client.kind !== 'extension') return false;
    // Revoke and re-pair replace entry objects; retiring the shared token clears it.
    if (client.legacy && !legacyToken) return false;
    return client.entry ? extensions.includes(client.entry) : client.legacy === true;
  }

  function markConnected(req, client = authenticate(req)) {
    if (!client || client.kind !== 'extension') return;
    const entry = client.entry || (extensions.filter((candidate) => candidate.legacy).length === 1 ? extensions.find((candidate) => candidate.legacy) : null);
    if (!entry) return;
    const wasConnected = extensionConnected();
    const previous = entry.lastSeenAt;
    entry.lastSeenAt = now();
    if (!previous || entry.lastSeenAt - previous >= LAST_SEEN_SAVE_MS) save();
    if (!wasConnected || !previous) notify();
  }

  function issueExtensionToken(origin) {
    const issued = randomHex(32);
    const existing = extensions.find((entry) => entry.origin === origin);
    // Re-pairing the same extension replaces its previous token.
    extensions = extensions.filter((entry) => entry.origin !== origin);
    extensions.push({ id: randomHex(8), origin, tokenHash: sha256(issued), legacy: false, createdAt: existing?.createdAt || now(), lastSeenAt: null });
    if (!extensions.some((entry) => entry.legacy)) legacyToken = null;
    // Connecting deliberately (for example with a code after a Deny) lifts that extension's block.
    blockedUntil.delete(origin);
    save();
    notify();
    if (existing) revoked();
    return issued;
  }

  // ── Six-digit code, shown only in the desktop's Settings after an explicit click. ──
  let codePairing = null;
  function getPairingInfo() {
    if (!codePairing || codePairing.expiresAt <= now()) {
      codePairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: now() + 5 * 60_000 };
    }
    return { ...codePairing };
  }

  function completePairing(req) {
    const origin = String(req.headers.origin || '');
    if (!EXTENSION_ORIGIN.test(origin) || !codePairing || codePairing.expiresAt <= now() || !sameSecret(req.body && req.body.code, codePairing.code)) return null;
    codePairing = null;
    // A code connection also settles a one-click request that is still waiting.
    if (pairing && pairing.status === 'pending') finish(pairing, 'cancelled');
    return { token: issueExtensionToken(origin), paired: true };
  }

  // ── One-click approve: the extension asks, the desktop shows four digits, the user allows. ──
  const matchKey = crypto.randomBytes(32);
  const finished = new Map();
  const requestTimes = new Map();
  const blockedUntil = new Map();
  let expiryTimer = null;
  const classify = (origin) => {
    const id = extensionIdOf(origin);
    if (knownStoreIds.has(id)) return 'store';
    if (approvedOrigin(origin)) return 'connected-before';
    return 'unrecognized';
  };
  const publicRequest = (request) => request && ({
    requestId: request.requestId, status: request.status, matchCode: request.matchCode, expiresAt: request.expiresAt,
    extensionId: extensionIdOf(request.origin), extensionVersion: request.extensionVersion, identity: request.identity,
  });
  const changed = () => { if (typeof onPairingChange === 'function') onPairingChange(getPendingPairing()); };
  function prune() {
    const time = now();
    if (pairing && pairing.status === 'pending' && pairing.expiresAt <= time) finish(pairing, 'expired');
    for (const [id, request] of finished) if (request.finishedAt + FINISHED_RETENTION_MS <= time) finished.delete(id);
    for (const [origin, until] of blockedUntil) if (until <= time) blockedUntil.delete(origin);
    for (const [origin, times] of requestTimes) {
      const recent = times.filter((at) => at + REQUEST_WINDOW_MS > time);
      if (recent.length) requestTimes.set(origin, recent); else requestTimes.delete(origin);
    }
  }
  function finish(request, status) {
    request.status = status;
    request.finishedAt = now();
    finished.set(request.requestId, request);
    if (pairing === request) pairing = null;
    clearTimeout(expiryTimer);
    changed();
  }
  function scheduleExpiry(request) {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => { if (pairing === request) prune(); }, Math.max(0, request.expiresAt - now()) + 50);
    expiryTimer.unref?.();
  }

  function requestPairing({ origin, secret, extensionVersion }) {
    prune();
    if (!EXTENSION_ORIGIN.test(origin)) return { status: 403, body: { error: 'Origin not allowed' } };
    if (typeof secret !== 'string' || !PAIRING_SECRET.test(secret)) return { status: 400, body: { error: 'Invalid pairing request' } };
    const blocked = blockedUntil.get(origin);
    if (blocked) return { status: 403, body: { error: 'SnagThis denied this extension recently', code: 'PAIRING_BLOCKED', retryAfterMs: blocked - now() } };
    const originTimes = requestTimes.get(origin) || [];
    const total = [...requestTimes.values()].reduce((sum, times) => sum + times.length, 0);
    if (originTimes.length >= REQUESTS_PER_WINDOW || total >= GLOBAL_REQUESTS_PER_WINDOW) {
      return { status: 429, body: { error: 'Too many connection requests', code: 'RATE_LIMITED' } };
    }
    requestTimes.set(origin, [...originTimes, now()]);
    const requestId = randomHex(16);
    const secretHash = sha256(secret);
    // The server alone chooses the digits: an HMAC of its own random key and the request.
    const digest = crypto.createHmac('sha256', matchKey).update(`${requestId}:${secretHash}`).digest();
    const request = {
      requestId, origin, secretHash, status: 'pending', createdAt: now(), expiresAt: now() + REQUEST_LIFETIME_MS,
      matchCode: String(digest.readUInt32BE(0) % 10_000).padStart(4, '0'),
      extensionVersion: /^\d+(?:\.\d+){0,3}$/.test(String(extensionVersion || '')) ? String(extensionVersion) : '',
      identity: classify(origin),
    };
    if (pairing && pairing.status === 'pending') {
      // Two requests at once: cancel both rather than guess which one the user started.
      request.status = 'conflict';
      request.finishedAt = now();
      finished.set(requestId, request);
      finish(pairing, 'conflict');
      return { status: 409, body: { requestId, status: 'conflict', code: 'PAIRING_CONFLICT', error: 'Another connection request arrived at the same time' } };
    }
    pairing = request;
    scheduleExpiry(request);
    changed();
    return { status: 201, body: { requestId, matchCode: request.matchCode, expiresInMs: REQUEST_LIFETIME_MS, status: 'pending' } };
  }

  function ownedRequest({ origin, requestId, secret }) {
    if (!EXTENSION_ORIGIN.test(origin) || typeof requestId !== 'string' || !PAIRING_REQUEST_ID.test(requestId) || typeof secret !== 'string') return null;
    const request = (pairing && pairing.requestId === requestId ? pairing : null) || finished.get(requestId);
    // Only the requesting extension, holding the request's secret, can read or cancel it.
    if (!request || request.origin !== origin || !sameSecret(sha256(secret), request.secretHash)) return null;
    return request;
  }

  function pairingStatus(input) {
    prune();
    const request = ownedRequest(input);
    if (!request) return { status: 404, body: { status: 'unknown' } };
    if (request.status === 'approved' && request.issuedToken) {
      const issued = request.issuedToken;
      request.issuedToken = null; // Collected once.
      request.status = 'collected';
      return { status: 200, body: { status: 'approved', token: issued } };
    }
    const body = { status: request.status === 'collected' ? 'approved' : request.status };
    if (request.status === 'pending') body.expiresInMs = Math.max(0, request.expiresAt - now());
    return { status: 200, body };
  }

  function cancelPairing(input) {
    prune();
    const request = ownedRequest(input);
    if (!request) return { status: 404, body: { status: 'unknown' } };
    if (request.status === 'pending') finish(request, 'cancelled');
    return { status: 200, body: { status: request.status } };
  }

  /** Trusted desktop UI only (Electron IPC); never exposed over HTTP. */
  function getPendingPairing() {
    prune();
    if (pairing && pairing.status === 'pending') return publicRequest(pairing);
    const latest = [...finished.values()].sort((a, b) => b.finishedAt - a.finishedAt)[0];
    return latest && latest.finishedAt + 10_000 > now() ? publicRequest(latest) : null;
  }

  function decidePairing(requestId, allow) {
    prune();
    const request = pairing;
    if (!request || request.status !== 'pending' || request.requestId !== requestId) return { ok: false, status: getPendingPairing()?.status || 'expired' };
    if (!allow) {
      blockedUntil.set(request.origin, now() + DENY_BLOCK_MS);
      finish(request, 'denied');
      return { ok: true, status: 'denied' };
    }
    request.issuedToken = issueExtensionToken(request.origin);
    finish(request, 'approved');
    // An uncollected token is dropped with the request after the retention window.
    setTimeout(() => { request.issuedToken = null; }, FINISHED_RETENTION_MS).unref?.();
    return { ok: true, status: 'approved' };
  }

  function listExtensions() {
    return extensions.map((entry) => ({
      id: entry.id, extensionId: extensionIdOf(entry.origin), createdAt: entry.createdAt, lastSeenAt: entry.lastSeenAt,
      legacy: entry.legacy, identity: knownStoreIds.has(extensionIdOf(entry.origin)) ? 'store' : 'unrecognized',
    }));
  }

  function revokeExtension(id) {
    const entry = extensions.find((candidate) => candidate.id === id);
    if (!entry) return false;
    extensions = extensions.filter((candidate) => candidate !== entry);
    // The shared pre-upgrade credential cannot be revoked for one origin alone
    // (Chrome may omit Origin), so revoking any legacy entry retires it for all.
    if (entry.legacy) extensions = extensions.filter((candidate) => !candidate.legacy);
    if (!extensions.some((candidate) => candidate.legacy)) legacyToken = null;
    save();
    notify();
    revoked();
    return true;
  }

  /** Swaps a pre-upgrade extension's shared credential for its own token. */
  function upgradeLegacy(client) {
    if (!client || client.kind !== 'extension' || !client.legacy || !client.entry) return null;
    return issueExtensionToken(client.entry.origin);
  }

  function signAsset(value) {
    if (typeof value !== 'string' || !ASSET_PATH.test(value)) return value;
    const parsed = new URL(value, 'http://localhost');
    const expires = Math.floor(now() / 60_000) * 60_000 + 10 * 60_000;
    const signature = crypto.createHmac('sha256', token).update(`${parsed.pathname}:${expires}`).digest('hex');
    return `${parsed.pathname}?expires=${expires}&signature=${signature}`;
  }

  function verifyAsset(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (!ASSET_PATH.test(req.path)) return false;
    const expires = Number(req.query.expires);
    if (!Number.isFinite(expires) || expires < now() || expires > now() + 11 * 60_000) return false;
    const expected = crypto.createHmac('sha256', token).update(`${req.path}:${expires}`).digest('hex');
    return sameSecret(req.query.signature, expected);
  }

  function publicPayload(value, key = '') {
    if (/^(?:headers|cookies|authorization|requestHeaders|authToken)$/i.test(key)) return undefined;
    if (typeof value === 'string') {
      if (ASSET_PATH.test(value)) return signAsset(value);
      if (/error|message/i.test(key)) return redact(value);
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => publicPayload(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([name]) => !/^(?:headers|cookies|authorization|requestHeaders|authToken)$/i.test(name))
      .map(([name, item]) => [name, publicPayload(item, name)]));
    return value;
  }

  return {
    get token() { return token; },
    originAllowed, authenticate, isCurrent, getPairingInfo, completePairing, markConnected, signAsset, verifyAsset, publicPayload,
    requestPairing, pairingStatus, cancelPairing, getPendingPairing, decidePairing, listExtensions, revokeExtension, upgradeLegacy,
    getConnectionState: () => ({ extensionConnected: extensionConnected(), pairedExtensions: extensions.length }),
  };
}

module.exports = { createBridgeSecurity, redact, redactUrl, EXTENSION_ORIGIN };
