const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const fetchYtDlp = require('../apps/desktop/scripts/fetch-yt-dlp.cjs');

test('the bundled yt-dlp is one pinned release with a SHA-256 for every platform asset', () => {
  const pin = fetchYtDlp.readPin();
  assert.match(pin.version, /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/);
  assert.equal(pin.sourceUrl, `https://github.com/yt-dlp/yt-dlp/tree/${pin.version}`);
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64'], ['linux', 'arm64']]) {
    const resolved = fetchYtDlp.resolveDownload({ platform, arch, env: {} });
    assert.equal(resolved.version, pin.version);
    assert.doesNotMatch(resolved.url, /\/latest\//, `${platform}/${arch} never follows "latest"`);
    assert.equal(resolved.url, `https://github.com/yt-dlp/yt-dlp/releases/download/${pin.version}/${fetchYtDlp.assetFor(platform, arch)}`);
    assert.match(resolved.sha256, /^[0-9a-f]{64}$/);
  }
  assert.throws(() => fetchYtDlp.resolveDownload({ platform: 'darwin', arch: 'arm64', env: { YTDLP_DOWNLOAD_URL: 'https://example.com/yt-dlp' } }), /requires its YTDLP_SHA256/);
  assert.throws(() => fetchYtDlp.resolveDownload({ platform: 'darwin', arch: 'arm64', env: {}, pin: { version: pin.version, assets: {} } }), /No pinned SHA-256/);
});

test('a download that does not match the pinned SHA-256 is refused and never installed', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snagthis-ytdlp-pin-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'yt-dlp');
  fs.writeFileSync(destination, 'previous verified build');
  const tampered = path.join(directory, 'yt-dlp.download');
  fs.writeFileSync(tampered, 'unexpected bytes');
  const expected = crypto.createHash('sha256').update('the published build').digest('hex');
  assert.throws(() => fetchYtDlp.installVerified(tampered, destination, expected), /did not match its pinned SHA-256/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'previous verified build');
  assert.equal(fs.existsSync(tampered), false);

  fs.writeFileSync(tampered, 'the published build');
  assert.equal(fetchYtDlp.installVerified(tampered, destination, expected), expected);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'the published build');
});

test('release verification rejects a packaged yt-dlp other than the pinned one', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/verify-release.cjs'), 'utf8');
  assert.match(source, /require\('\.\.\/apps\/desktop\/scripts\/yt-dlp-release\.json'\)/);
  assert.match(source, /ytdlpVersion !== pinnedYtDlp\.version/);
});
