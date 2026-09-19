const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const ASSET_PATH = /^\/(?:downloads\/|api\/(?:history\/(?:file|stream)\/|jobs\/[^/]+\/(?:file|stream)$))/;
const SECRET_KEY = /(?:authorization|cookie|password|secret|token|headers|signature|api.?key)/i;

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return value; }
}

function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    return value.replace(/https?:\/\/[^\s"'<>]+/g, redactUrl)
      .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name)]));
  }
  return value;
}

function createBridgeSecurity({ dataDir, authToken, allowedOrigins = [], onExtensionConnected }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'bridge-auth.json');
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* First installation. */ }
  const token = authToken || (typeof stored.token === 'string' && stored.token.length >= 32 ? stored.token : crypto.randomBytes(32).toString('hex'));
  const approvedOrigins = new Set((stored.approvedOrigins || []).filter((origin) => EXTENSION_ORIGIN.test(origin)));
  const trustedOrigins = new Set(allowedOrigins);
  let extensionConnected = Boolean(stored.extensionConnected);
  let pairing = null;
  const save = () => {
    const tempPath = `${statePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ token, approvedOrigins: [...approvedOrigins], extensionConnected }), { mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, statePath);
  };
  save();

  function originAllowed(origin, { pairingRequest = false } = {}) {
    if (!origin) return true; // Native clients still must possess the token.
    if (trustedOrigins.has(origin) || approvedOrigins.has(origin)) return true;
    return pairingRequest && EXTENSION_ORIGIN.test(origin);
  }

  function authenticate(req) {
    const authorization = String(req.headers.authorization || '');
    if (sameSecret(authorization.replace(/^Bearer\s+/i, ''), token) && /^Bearer\s+/i.test(authorization)) return true;
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map((item) => item.trim());
    return protocols.some((protocol) => protocol.startsWith('vidsnag-auth.') && sameSecret(protocol.slice(13), token));
  }

  function markConnected(req) {
    const origin = String(req.headers.origin || '');
    const knownOrigin = EXTENSION_ORIGIN.test(origin) && approvedOrigins.has(origin);
    // Chrome can omit Origin on a privileged extension GET, although its pairing
    // POST includes it. The already authenticated client header identifies these
    // follow-up reads; this flag never grants an origin or a client access.
    const pairedExtensionRead = !origin && approvedOrigins.size > 0
      && req.headers['x-client'] === 'vidsnag-extension';
    if ((!knownOrigin && !pairedExtensionRead) || extensionConnected) return;
    extensionConnected = true;
    save();
    if (typeof onExtensionConnected === 'function') onExtensionConnected();
  }

  function getPairingInfo() {
    if (!pairing || pairing.expiresAt <= Date.now()) {
      pairing = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), expiresAt: Date.now() + 5 * 60_000 };
    }
    return { ...pairing };
  }

  function completePairing(req) {
    const origin = String(req.headers.origin || '');
    if (!EXTENSION_ORIGIN.test(origin) || !pairing || pairing.expiresAt <= Date.now() || !sameSecret(req.body && req.body.code, pairing.code)) return null;
    approvedOrigins.add(origin);
    pairing = null;
    save();
    return { token, paired: true };
  }

  function signAsset(value) {
    if (typeof value !== 'string' || !ASSET_PATH.test(value)) return value;
    const parsed = new URL(value, 'http://localhost');
    const expires = Math.floor(Date.now() / 60_000) * 60_000 + 10 * 60_000;
    const signature = crypto.createHmac('sha256', token).update(`${parsed.pathname}:${expires}`).digest('hex');
    return `${parsed.pathname}?expires=${expires}&signature=${signature}`;
  }

  function verifyAsset(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (!ASSET_PATH.test(req.path)) return false;
    const expires = Number(req.query.expires);
    if (!Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 11 * 60_000) return false;
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

  return { token, originAllowed, authenticate, getPairingInfo, completePairing, markConnected, signAsset, verifyAsset, publicPayload, getConnectionState: () => ({ extensionConnected, pairedExtensions: approvedOrigins.size }) };
}

module.exports = { createBridgeSecurity, redact, redactUrl };
