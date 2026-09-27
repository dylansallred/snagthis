const { createDownloadEta } = require('./DownloadEta');

function createTransferMetrics(job, { maxConnections = 1, available = true, now = Date.now } = {}) {
  const maximum = Number(maxConnections);
  let active = 0;
  let measuringBytes = false;
  let transferredBytes = 0;
  let samples = [];
  const eta = createDownloadEta({ now });
  job.maxConnections = Number.isFinite(maximum) ? Math.max(1, Math.floor(maximum)) : 1;
  job.connectionCountAvailable = Boolean(available);
  job.activeConnections = available ? 0 : null;

  function resetRates() {
    samples = [{ time: now(), bytes: transferredBytes }];
    eta.reset();
    if (measuringBytes) { job.speedBps = 0; job.etaSeconds = null; }
  }

  function recordBytes(bytes) {
    if (!available || !Number.isFinite(bytes) || bytes <= 0) return;
    if (!samples.length) resetRates();
    if (!measuringBytes) { measuringBytes = true; job.speedBps = 0; }
    transferredBytes += bytes;
    const time = now();
    samples.push({ time, bytes: transferredBytes });
    while (samples.length > 2 && samples[1].time < time - 5000) samples.shift();
    const elapsed = (time - samples[0].time) / 1000;
    if (elapsed > 0) job.speedBps = Math.max(0, (transferredBytes - samples[0].bytes) / elapsed);
    const remaining = Number(job.totalBytes) > 0 ? Math.max(0, job.totalBytes - (Number(job.bytesDownloaded) || 0)) : null;
    job.etaSeconds = eta.update(remaining, job.speedBps);
    job.updatedAt = time;
  }

  function begin() {
    if (!available) return () => {};
    if (!active) resetRates();
    active += 1;
    job.activeConnections = active;
    job.updatedAt = now();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      active -= 1;
      job.activeConnections = active;
      if (!active) resetRates();
      job.updatedAt = now();
    };
  }

  function finish() {
    resetRates();
    if (measuringBytes && job.status === 'completed') job.etaSeconds = 0;
  }

  return { begin, recordBytes, finish };
}

module.exports = { createTransferMetrics };
