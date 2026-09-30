/*
 * Where a saved video came from, kept with the job and its saved item so Saved can offer
 * Open original page and Copy page link and name the site and channel. Plain text only:
 * request headers, cookies and media URLs never go in here.
 */
const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** `{ pageTitle, siteName, uploader }` from a request or an older record, or null when none is known. */
function sourceInfoOf(input) {
  const value = input && typeof input === 'object' ? input : {};
  const nested = value.sourceInfo && typeof value.sourceInfo === 'object' ? value.sourceInfo : {};
  const info = {
    pageTitle: clean(nested.pageTitle || value.sourcePageTitle || value.pageTitle, 255),
    siteName: clean(nested.siteName || value.siteName, 80),
    uploader: clean(nested.uploader || value.uploader || (value.youtubeMetadata && value.youtubeMetadata.channelName), 180),
  };
  return info.pageTitle || info.siteName || info.uploader ? info : null;
}

module.exports = { sourceInfoOf };
