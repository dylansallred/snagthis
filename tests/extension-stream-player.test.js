const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadStreamPlayerHelpers() {
  const playerPath = path.join(__dirname, '..', 'apps', 'extension', 'player.js');
  const source = fs.readFileSync(playerPath, 'utf8');
  const helperStart = source.indexOf('const BLOCKED_HEADER_NAMES = new Set([');
  const helperEnd = source.indexOf('async function tryPlay(');

  if (helperStart < 0 || helperEnd <= helperStart) {
    throw new Error('Failed to locate stream player request helpers');
  }

  const script = [
    'let primaryUrl = "";',
    'let requestHeaders = {};',
    source.slice(helperStart, helperEnd),
    'globalThis.__streamPlayerHelpers = {',
    '  setContext: (headers, mediaUrl) => { requestHeaders = headers || {}; primaryUrl = mediaUrl || ""; },',
    '  normalizeRequestHeaders,',
    '  buildFetchOptions,',
    '};',
  ].join('\n');

  const context = { URL, Headers, globalThis: {} };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context.globalThis.__streamPlayerHelpers;
}

const mediaUrl = 'https://media.example/movie/master.m3u8';
const capturedHeaders = {
  Authorization: 'Bearer media-session',
  Referer: 'https://video.example/watch/123',
  Origin: 'https://video.example',
  Cookie: 'session=secret',
  'X-Custom-Token': 'token-value',
  Accept: 'application/vnd.apple.mpegurl',
  Range: 'bytes=0-99',
};

test('stream preview preserves same-origin custom headers while blocking forbidden and malformed headers', () => {
  const helpers = loadStreamPlayerHelpers();
  helpers.setContext(capturedHeaders, mediaUrl);
  const headers = helpers.normalizeRequestHeaders({
    ...capturedHeaders,
    'Content-Length': '123',
    'Sec-Fetch-Site': 'same-origin',
    'Proxy-Authorization': 'secret',
    ':authority': 'media.example',
    'Invalid Name': 'value',
    'X-Injected': 'one\r\ntwo',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(headers)), {
    Authorization: 'Bearer media-session',
    'X-Custom-Token': 'token-value',
    Accept: 'application/vnd.apple.mpegurl',
    Range: 'bytes=0-99',
  });

  const options = helpers.buildFetchOptions('https://media.example/movie/segment.ts', {
    method: 'GET', headers: { Range: 'bytes=100-199' },
  });
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'include');
  assert.equal(options.headers.get('authorization'), 'Bearer media-session');
  assert.equal(options.headers.get('x-custom-token'), 'token-value');
  assert.equal(options.headers.get('range'), 'bytes=100-199', 'the fragment range overrides the captured request range');
  for (const name of ['referer', 'origin', 'cookie', 'content-length']) assert.equal(options.headers.has(name), false);
  assert.equal(options.redirect, 'error');
  assert.equal(options.referrer, '');
  assert.equal(options.referrerPolicy, 'no-referrer');
});

test('stream preview strips captured and loader-provided credentials on every different origin', () => {
  const helpers = loadStreamPlayerHelpers();
  helpers.setContext(capturedHeaders, mediaUrl);
  for (const target of [
    'https://other.example/segment.ts',
    'https://media.example:444/segment.ts',
    'http://media.example/segment.ts',
  ]) {
    const options = helpers.buildFetchOptions(target, {
      headers: { Authorization: 'Bearer loader-secret', 'X-Api-Key': 'loader-secret', Cookie: 'loader-session=1', Range: 'bytes=200-299' },
      credentials: 'include', redirect: 'follow', referrer: 'https://video.example/private', referrerPolicy: 'unsafe-url',
    });
    assert.deepEqual(Object.fromEntries(options.headers), {
      accept: 'application/vnd.apple.mpegurl', range: 'bytes=200-299',
    });
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error', 'loader options cannot allow redirect credential forwarding');
    assert.equal(options.referrer, '');
    assert.equal(options.referrerPolicy, 'no-referrer');
  }
});

test('stream preview rejects non-web targets and URLs with embedded credentials', () => {
  const helpers = loadStreamPlayerHelpers();
  helpers.setContext(capturedHeaders, mediaUrl);
  for (const target of ['file:///private/video.ts', 'data:video/mp4;base64,AAAA', 'https://user:password@media.example/segment.ts']) {
    assert.throws(() => helpers.buildFetchOptions(target), /Only HTTP and HTTPS preview sources are supported/);
  }
});
