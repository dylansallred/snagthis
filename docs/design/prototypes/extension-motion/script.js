(() => {
  const progress = document.getElementById('progress');
  const state = document.getElementById('state');
  const output = document.getElementById('progress-value');
  const simulate = document.getElementById('simulate');
  const motion = document.getElementById('motion');
  const frames = [...document.querySelectorAll('iframe')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let effects = !reduced.matches;
  let timer;
  function update() {
    const value = state.value === 'saved' ? 100 : Number(progress.value);
    output.value = `${value}%`;
    progress.disabled = state.value === 'saved';
    motion.textContent = effects ? 'Effects on' : 'Effects off';
    motion.setAttribute('aria-pressed', String(effects));
    const message = { type: 'vidsnag-design-state', progress: value, state: state.value, motion: effects };
    frames.forEach(frame => frame.contentWindow.postMessage(message, location.origin));
  }
  function stop() {
    clearInterval(timer); timer = null;
    simulate.textContent = 'Animate progress';
    simulate.setAttribute('aria-pressed', 'false');
  }
  progress.addEventListener('input', () => { stop(); update(); });
  state.addEventListener('change', () => { stop(); update(); });
  motion.addEventListener('click', () => { effects = !effects; update(); });
  reduced.addEventListener('change', () => { effects = !reduced.matches; update(); });
  simulate.addEventListener('click', () => {
    if (timer) { stop(); return; }
    state.value = 'downloading';
    if (Number(progress.value) >= 100) progress.value = '0';
    simulate.textContent = 'Stop progress';
    simulate.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => {
      progress.value = String(Math.min(100, Number(progress.value) + 1));
      if (Number(progress.value) === 100) { state.value = 'saved'; stop(); }
      update();
    }, 250);
    update();
  });
  frames.forEach(frame => frame.addEventListener('load', update));
  addEventListener('pagehide', stop);
  update();
})();
