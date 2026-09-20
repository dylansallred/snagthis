// ChildProcess.killed only means a signal was sent. It does not mean the child
// exited, so keep the escalation timer until the actual close event arrives.
function createProcessStopper(child, { graceMs = 1500, onStop } = {}) {
  const delay = Number.isFinite(Number(graceMs)) ? Math.max(0, Math.floor(Number(graceMs))) : 1500;
  let stopped = false;
  let closed = false;
  let timer;
  let processError;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });

  function dispose() {
    clearTimeout(timer);
    timer = undefined;
  }

  function onError(error) {
    // A failed spawn also emits close. Do not free the caller's queue slot
    // before that event has confirmed the process/stdio lifecycle is finished.
    processError = error;
  }

  function onClose(code, signal) {
    closed = true;
    dispose();
    child.removeListener('error', onError);
    resolveCompletion({ code, signal, ...(processError ? { error: processError } : {}) });
  }

  function sendSignal(signal) {
    // A failed spawn has no child PID. Never signal its uninitialized native
    // handle: on POSIX a zero PID can address the caller's process group.
    if (closed || !Number.isInteger(child.pid) || child.pid <= 0) return;
    try { child.kill(signal); } catch (error) { onError(error); }
  }

  child.on('error', onError);
  child.once('close', onClose);

  function stop() {
    if (stopped || closed) return completion;
    stopped = true;
    sendSignal('SIGTERM');
    if (typeof onStop === 'function') {
      try { Promise.resolve(onStop()).catch(() => {}); } catch { /* Escalation still stops the child. */ }
    }
    if (!closed) timer = setTimeout(() => sendSignal('SIGKILL'), delay);
    return completion;
  }

  return { stop, dispose };
}

module.exports = { createProcessStopper };
