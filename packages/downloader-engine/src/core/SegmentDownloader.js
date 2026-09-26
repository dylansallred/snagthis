const { requestWithRedirects } = require('./PlaylistUtils');
const { pipeline } = require('node:stream/promises');

function isLocalWriteError(error) {
  return ['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'EMFILE', 'ENFILE', 'ENOTDIR', 'ENOENT'].includes(error?.code);
}

// Signed segment URLs answer these once their token lapses. Retrying them
// cannot succeed, so the job stops and asks for a refreshed page instead.
const SOURCE_EXPIRED_STATUSES = new Set([401, 403, 404, 410]);

function isSourceExpiredSegmentError(error) {
  return SOURCE_EXPIRED_STATUSES.has(Number(error?.statusCode));
}

function getRetryBackoffMs(attempt) {
  const baseMs = 500;
  const maxMs = 8000;
  const factor = Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(maxMs, baseMs * factor);
}

async function downloadSegment(segmentUrl, headers, stream, job) {
  const endTransfer = job?._transferMetrics?.begin();
  const writeAbort = new AbortController();
  const signal = job?._downloadAbort?.signal
    ? AbortSignal.any([job._downloadAbort.signal, writeAbort.signal]) : writeAbort.signal;
  let writeError;
  const onWriteError = error => { writeError = error; writeAbort.abort(error); };
  // A file can fail to open before the response arrives. Observe it before
  // starting HTTP, and preserve the filesystem error instead of reporting an
  // abort caused by that error as a retryable network problem.
  stream.on('error', onWriteError);
  try {
    if (job?.cancelled) writeAbort.abort();
    return await requestWithRedirects(segmentUrl, headers, async (res, _finalUrl, req) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          throw Object.assign(new Error(`Segment failed with status ${res.statusCode}`), { statusCode: res.statusCode });
        }
        res.on('data', (chunk) => {
          if (job && job.cancelled) {
            req.destroy(new Error('Job cancelled'));
            return;
          }
          job.bytesDownloaded += chunk.length;
          job._transferMetrics?.recordBytes(chunk.length);
        });
        // Completion includes the writable's finish/close lifecycle. Waiting
        // only for response end can miss an already-emitted disk error.
        await pipeline(res, stream, { signal });
    }, { timeoutMs: 10_000, credentialOrigin: job && (job.credentialOrigin || job.url), sourcePageUrl: job && job.sourcePageUrl, signal });
  } catch (error) {
    throw writeError || error;
  } finally {
    stream.removeListener('error', onWriteError);
    if (!stream.destroyed) stream.destroy();
    endTransfer?.();
  }
}

module.exports = {
  getRetryBackoffMs,
  downloadSegment,
  isLocalWriteError,
  isSourceExpiredSegmentError,
};
