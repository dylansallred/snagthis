// The bridge's one definition of an acceptable web URL: http(s) only, and no
// user:password part that could smuggle credentials to another host.
function httpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function isHttpUrl(value) {
  return httpUrl(value) !== null;
}

module.exports = { httpUrl, isHttpUrl };
