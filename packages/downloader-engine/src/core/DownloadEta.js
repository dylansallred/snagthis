// Each transfer owns its estimate; no history survives a retry or track change.
function createDownloadEta({ now = Date.now } = {}) {
  let previousTime = null;
  let averageRate = null;

  function reset() {
    previousTime = null;
    averageRate = null;
  }

  function update(remaining, rate) {
    if (!Number.isFinite(remaining) || remaining <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
    const time = now();
    if (previousTime === null || time < previousTime) averageRate = rate;
    else {
      // A time-based average behaves the same with frequent or sparse progress
      // messages. Brief bursts have little weight; lasting changes still win.
      const weight = 1 - Math.exp(-(time - previousTime) / 15000);
      averageRate += weight * (rate - averageRate);
    }
    previousTime = time;
    return Math.ceil(remaining / averageRate);
  }

  return { update, reset };
}

module.exports = { createDownloadEta };
