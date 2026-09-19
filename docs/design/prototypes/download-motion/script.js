/* Local design study. This page does not call the downloader or change app settings. */
(() => {
  const concepts = [
    { id: 'combined', letter: 'A+B', title: 'Leading edge + soft sweep', description: 'A gentle sweep inside the fill, with a small glint along the edge.' },
  ];
  const conceptTemplate = document.getElementById('concept-template');
  const rowTemplate = document.getElementById('row-template');
  const container = document.getElementById('concepts');
  const slider = document.getElementById('progress');
  const progressValue = document.getElementById('progress-value');
  const simulateButton = document.getElementById('simulate');
  const reduceMotion = document.getElementById('reduce-motion');
  const motionNote = document.getElementById('motion-note');
  const announcement = document.getElementById('announcement');
  const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const states = new Map();
  let simulationTimer = null;
  let progress = Number(slider.value);
  let activePreview = null;

  function announce(text) { announcement.textContent = text; }

  function stopPreview(button) {
    const video = button.querySelector('video');
    video.pause();
    button.classList.remove('playing');
    button.setAttribute('aria-pressed', 'false');
    button.dataset.pinned = 'false';
    if (activePreview === button) activePreview = null;
  }

  function startPreview(button, explicit = false) {
    if (reduceMotion.checked && !explicit) return;
    if (activePreview && activePreview !== button) stopPreview(activePreview);
    activePreview = button;
    const video = button.querySelector('video');
    if (!button.classList.contains('playing')) video.currentTime = 0;
    video.muted = true;
    const pending = video.play();
    if (pending) pending.then(() => {
      if (activePreview !== button) { video.pause(); return; }
      button.classList.add('playing');
      button.setAttribute('aria-pressed', 'true');
    }).catch(() => {
      button.classList.remove('playing');
    });
  }

  function connectPreview(button) {
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') startPreview(button); });
    button.addEventListener('pointerleave', () => { if (button.dataset.pinned !== 'true' && document.activeElement !== button) stopPreview(button); });
    button.addEventListener('focus', () => startPreview(button));
    button.addEventListener('blur', () => { if (button.dataset.pinned !== 'true' && !button.matches(':hover')) stopPreview(button); });
    button.addEventListener('click', () => {
      if (button.dataset.pinned === 'true') { stopPreview(button); return; }
      button.dataset.pinned = 'true';
      startPreview(button, true);
    });
  }

  function paintConcept(state) {
    state.rows.forEach(row => {
      const percent = state.paused ? state.pausedProgress : progress;
      row.style.setProperty('--progress', `${percent}%`);
      row.classList.toggle('paused', state.paused);
      const status = row.querySelector('.row-status');
      const text = state.paused ? `Paused at ${percent}%` : `${percent}% · ${percent > 80 ? 'under a minute left' : '5 min left'}`;
      status.textContent = text;
      status.setAttribute('aria-valuenow', String(percent));
      status.setAttribute('aria-valuetext', text);
      row.querySelector('.row-action').setAttribute('aria-label', state.paused ? 'Resume download' : 'Pause download');
    });
    state.element.querySelector('.footer-status').textContent = state.paused ? 'Download paused' : '1 downloading · 4.1 MB/s';
  }

  function paintProgress() {
    slider.value = String(progress);
    progressValue.textContent = `${progress}%`;
    states.forEach(paintConcept);
  }

  concepts.forEach(concept => {
    const fragment = conceptTemplate.content.cloneNode(true);
    const element = fragment.querySelector('.concept');
    element.classList.add(`motion-${concept.id}`, 'motion-edge', 'motion-sweep', 'selected');
    element.id = `concept-${concept.id}`;
    element.querySelector('.concept-letter').textContent = concept.letter;
    element.querySelector('h2').textContent = concept.title;
    element.querySelector('.concept-description').textContent = concept.description;
    const rows = [];
    const state = { element, rows, paused: false, pausedProgress: progress };
    element.querySelectorAll('.row-slot').forEach(slot => {
      const rowFragment = rowTemplate.content.cloneNode(true);
      const row = rowFragment.querySelector('.video-row');
      rows.push(row);
      connectPreview(row.querySelector('.preview-button'));
      row.querySelector('.row-action').addEventListener('click', () => {
        state.paused = !state.paused;
        if (state.paused) state.pausedProgress = progress;
        paintConcept(state);
        announce(`${concept.title}: download ${state.paused ? 'paused' : 'resumed'}.`);
      });
      slot.append(rowFragment);
    });
    states.set(concept.id, state);
    container.append(fragment);
  });

  function stopSimulation() {
    if (simulationTimer) window.clearInterval(simulationTimer);
    simulationTimer = null;
    simulateButton.textContent = 'Run progress demo';
    simulateButton.setAttribute('aria-pressed', 'false');
  }

  slider.addEventListener('input', () => { progress = Number(slider.value); paintProgress(); });
  simulateButton.addEventListener('click', () => {
    if (simulationTimer) { stopSimulation(); announce('Progress demo stopped.'); return; }
    if (progress >= 99) progress = 0;
    simulateButton.textContent = 'Stop progress demo';
    simulateButton.setAttribute('aria-pressed', 'true');
    simulationTimer = window.setInterval(() => {
      progress = Math.min(progress + 1, 99);
      paintProgress();
      if (progress === 99) { stopSimulation(); announce('Progress demo reached 99 percent.'); }
    }, 700);
    announce('Progress demo running.');
  });

  function applyMotionPreference() {
    document.body.classList.toggle('reduced-motion', reduceMotion.checked);
    motionNote.textContent = reduceMotion.checked ? 'Motion reduced. Click a thumbnail to play.' : 'Hover a thumbnail to play.';
    if (reduceMotion.checked && activePreview) stopPreview(activePreview);
  }
  reduceMotion.checked = systemMotion.matches;
  reduceMotion.addEventListener('change', applyMotionPreference);
  systemMotion.addEventListener('change', event => { reduceMotion.checked = event.matches; applyMotionPreference(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopSimulation(); if (activePreview) stopPreview(activePreview); } });
  window.addEventListener('pagehide', () => { stopSimulation(); if (activePreview) stopPreview(activePreview); });
  paintProgress();
  applyMotionPreference();
})();
