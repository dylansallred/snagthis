(() => {
  const $ = selector => document.querySelector(selector);
  const preview = $('#transfer-preview');
  const total = 873;
  const defaults = { fill: '#fa5d0e', fillOpacity: 85, line: '#ff7566', lineOpacity: 100, pendingOpacity: 25, downloadingOpacity: 100, retryingOpacity: 75 };
  const fields = {
    fill: ['fill-color', 'colour'], fillOpacity: ['fill-opacity', 5],
    line: ['line-color', 'colour'], lineOpacity: ['line-opacity', 10],
    pendingOpacity: ['pending-opacity', 5], downloadingOpacity: ['downloading-opacity', 5], retryingOpacity: ['retrying-opacity', 5],
  };
  const params = new URLSearchParams(location.search);
  const state = { ...defaults, width: params.get('width') === '640' ? '640' : '820', completed: 275, running: false, tick: 0 };
  for (const [key, [, type]] of Object.entries(fields)) {
    const value = params.get(key);
    if (type === 'colour') {
      if (/^#[0-9a-f]{6}$/i.test(value || '')) state[key] = value.toLowerCase();
    } else if (value !== null && Number.isInteger(Number(value)) && Number(value) >= type && Number(value) <= 100) state[key] = Number(value);
  }
  const requestedProgress = Number(params.get('progress'));
  if (params.has('progress') && Number.isInteger(requestedProgress) && requestedProgress >= 0 && requestedProgress <= total) state.completed = requestedProgress;
  let timer = null;

  function counts() {
    const downloading = Math.min(16, total - state.completed);
    const retrying = Math.min(12, total - state.completed - downloading);
    return { completed: state.completed, downloading, retrying, pending: total - state.completed - downloading - retrying };
  }
  function remember() {
    const url = new URL(location.href);
    for (const key of ['graph', 'palette', 'marks']) url.searchParams.delete(key);
    for (const key of Object.keys(fields)) url.searchParams.set(key, String(state[key]));
    url.searchParams.set('width', state.width);
    url.searchParams.set('progress', state.completed);
    history.replaceState(null, '', url);
  }
  function chart() {
    // Shared sample: sustained transfers, sharp drops, and recovery peaks.
    const trace = [4, 4, 5, 14, 18, 23, 23.8, 24, 23.5, 23.8, 22, 21, .4, 0, 0, 8, 16, 24, 29, 28, 23, 24, 24, 25, 18, 8, 0, 0, .4, 13, 21, 24, 23.8, 23.8, 27, 31, 30, 17, .3, 0, 12, 19, 25, 23, 23.8, 23.8, 23.8, 23.8, 23.8];
    const points = trace.map((_, index) => {
      const value = trace[(index + state.tick) % trace.length];
      return [index / (trace.length - 1) * 740, 112 - value / 34 * 98];
    });
    const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    $('#chart-line').setAttribute('d', line);
    $('#chart-area').setAttribute('d', `${line} L740,116 L0,116 Z`);
    $('#chart-dot').setAttribute('cx', '740');
    $('#chart-dot').setAttribute('cy', String(points[points.length - 1][1]));
    const speed = state.completed === total ? 0 : trace[(trace.length - 1 + state.tick) % trace.length];
    $('#speed-value').textContent = speed.toFixed(2);
  }
  function renderData() {
    const tally = counts();
    const labels = { completed: 'Completed', downloading: 'Downloading', retrying: 'Retrying', pending: 'Pending' };
    const cellStates = Object.entries(tally).flatMap(([key, count]) => Array(count).fill(key));
    $('#segment-map').innerHTML = cellStates.map((key, index) => `<i class="segment-cell" data-state="${key}" title="Segment ${index + 1} · ${labels[key]}" aria-hidden="true"></i>`).join('');
    $('#segment-map').setAttribute('aria-label', `${total} segments: ${tally.completed} completed, ${tally.downloading} downloading, ${tally.retrying} retrying, ${tally.pending} pending`);
    $('#segment-legend').innerHTML = Object.entries(tally).map(([key, count]) => `<span><i class="legend-cell" data-state="${key}" aria-hidden="true"></i>${labels[key]} <b>${count}</b></span>`).join('');
    $('#segment-summary').textContent = `${tally.completed} of ${total} · ${tally.retrying} retrying`;
    $('#connection-dots').innerHTML = Array.from({ length: 16 }, (_, index) => `<i${index < tally.downloading ? ' class="on"' : ''}></i>`).join('');
    $('#connections').textContent = `${tally.downloading} of 16 active`;
    $('#progress').value = state.completed;
    $('#progress-value').textContent = `${(state.completed / total * 100).toFixed(1)}%`;
    $('#downloaded-size').textContent = `${(Math.floor(state.completed / total * 78) / 10).toFixed(1)} GB`;
    $('#row-status').textContent = state.completed === total ? 'Download complete' : `${Math.floor(state.completed / total * 100)}% · 4 minutes left`;
    const cells = Math.floor(state.completed / total * 40);
    $('#row-lane').innerHTML = Array.from({ length: 40 }, (_, index) => `<i${index < cells ? ' class="done"' : index === cells ? ' class="current"' : ''}></i>`).join('');
    preview.dataset.running = String(state.running);
    $('#simulate').setAttribute('aria-pressed', String(state.running));
    $('#simulate').textContent = state.running ? 'Pause simulation' : 'Simulate transfer';
    chart();
  }
  function renderChoices() {
    preview.dataset.palette = 'today';
    preview.dataset.marks = 'outline';
    preview.dataset.width = state.width;
    $('#sample-width').value = state.width;
    for (const [key, [id, type]] of Object.entries(fields)) {
      $(`#${id}`).value = state[key];
      $(`#${id}-value`).textContent = type === 'colour' ? state[key].toUpperCase() : `${state[key]}%`;
      if (type !== 'colour') $(`#${id}`).setAttribute('aria-valuetext', `${state[key]} percent`);
    }
    for (const key of ['fill', 'line']) {
      preview.style.setProperty(`--${key}-color`, state[key]);
      $(`#${key}-swatches`).querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.colour === state[key])));
    }
    $('#fill-top').setAttribute('stop-opacity', String(state.fillOpacity / 100));
    for (const key of ['line', 'pending', 'downloading', 'retrying']) preview.style.setProperty(`--${key}-opacity`, String(state[`${key}Opacity`] / 100));
    $('#selection').textContent = `Fill ${state.fill.toUpperCase()} / ${state.fillOpacity}% · Line ${state.line.toUpperCase()} / ${state.lineOpacity}%`;
    $('#combination-note').textContent = `Pending ${state.pendingOpacity}% · Downloading ${state.downloadingOpacity}% · Retrying ${state.retryingOpacity}% · Completed 100%. The legend stays fully visible so each state remains easy to identify.`;
  }
  function stop() { clearInterval(timer); timer = null; state.running = false; }
  function tune() { renderChoices(); remember(); }
  for (const [key, [id, type]] of Object.entries(fields)) {
    $(`#${id}`).addEventListener('input', event => { state[key] = type === 'colour' ? event.target.value : Number(event.target.value); tune(); });
  }
  for (const key of ['fill', 'line']) {
    const colours = [['Orange', defaults[key]], ['Amber', '#dca35c'], ['Ice', '#82b9d9'], ['Steel', '#9ba7b7'], ['Rose', '#c48b91']];
    $(`#${key}-swatches`).innerHTML = colours.map(([name, colour]) => `<button type="button" data-colour="${colour}" aria-label="${name} ${key}" aria-pressed="false"><i style="--swatch:${colour}" aria-hidden="true"></i>${name}</button>`).join('');
    $(`#${key}-swatches`).addEventListener('click', event => {
      const button = event.target.closest('button');
      if (button) { state[key] = button.dataset.colour; tune(); }
    });
  }
  $('#sample-width').addEventListener('change', event => { state.width = event.target.value; tune(); });
  $('#progress').addEventListener('input', event => { stop(); state.completed = Number(event.target.value); state.tick = 0; renderData(); remember(); });
  $('#simulate').addEventListener('click', () => {
    if (state.running) stop();
    else {
      if (state.completed === total) { state.completed = 275; state.tick = 0; }
      state.running = true;
      timer = setInterval(() => {
        state.completed = Math.min(total, state.completed + 5); state.tick += 1;
        if (state.completed === total) stop();
        renderData(); remember();
      }, 1100);
    }
    renderData();
  });
  $('#reset').addEventListener('click', () => { stop(); Object.assign(state, { ...defaults, width: '820', completed: 275, tick: 0 }); renderChoices(); renderData(); remember(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.running) { stop(); renderData(); } });
  renderChoices(); renderData(); remember();
})();
