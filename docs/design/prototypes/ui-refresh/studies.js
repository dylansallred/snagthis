(() => {
  const MEDIA = '../../../../apps/extension/popup/media/';
  const PATHS = {
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>', down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  };
  const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const thumb = media => `<div class="thumb"><img src="${MEDIA}${media}.jpg" alt=""></div>`;

  const STUDIES = {
    progress: [['spark', 'Spark', 'Chosen. Built into both apps']],
    button: [['hsquare', 'Today', 'Rises from the bottom with a square edge'], ['hrise', 'Rise, rounded', 'Same rise, but always inside the rounded shape'], ['hfade', 'Fade', 'Orange simply fades in'], ['hburst', 'Centre burst', 'Circle grows out from the icon'],
      ['hiris', 'Pop', 'A rounded square springs out from the centre'], ['hsweep', 'Side sweep', 'Wipes in from the left'], ['hdiag', 'Diagonal', 'Wipes up from the bottom-left corner'], ['hliquid', 'Liquid', 'Fills like liquid with a wavy surface'], ['hglow', 'Bloom', 'No wipe: colour and glow bloom, arrow drops']],
    details: [['snow', 'Today', 'Big speed, connections underneath'], ['spair', 'Two readouts', 'Speed and connections as matching big numbers'], ['sfacts', 'As facts', 'Speed and Connections join the facts row; speed in orange'], ['sdots', 'Connection dots', 'One dot per connection; active ones lit'],
      ['schip', 'Chip', 'Connections as a small pill beside the speed'], ['sright', 'On the chart', 'Speed readout sits top-right, above the live edge'], ['ssentence', 'Sentence', '“Downloading at 4.8 MB/s over 6 connections”'], ['smeter', 'Meter', 'Thin bar shows how many connections are in use']],
  };
  let hovered = null;
  for (const [id, variants] of Object.entries(STUDIES)) {
    const section = document.getElementById(id);
    const picker = $('.study-picker', section);
    picker.innerHTML = variants.map(([key, name, note], i) => `<button type="button" data-key="${key}" aria-pressed="${i === 0}"><span>${i + 1} · ${name}</span><small>${note}</small></button>`).join('');
    section.pick = key => {
      section.dataset.variant = key;
      $$('button', picker).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === key)));
      section.dispatchEvent(new Event('variant'));
    };
    picker.addEventListener('click', event => { const button = event.target.closest('button'); if (button) section.pick(button.dataset.key); });
    section.addEventListener('pointerenter', () => { hovered = section; });
  }
  addEventListener('keydown', event => {
    if (!hovered || event.target.matches('input, select') || event.metaKey || event.ctrlKey || event.altKey) return;
    const variant = STUDIES[hovered.id][Number(event.key) - 1];
    if (variant) hovered.pick(variant[0]);
  });

  // ── 1 · Progress
  const progress = document.getElementById('progress');
  let p = 34; let auto = true; let lastDone = new WeakMap();
  function renderProgress() {
    const variant = progress.dataset.variant;
    const cells = true;
    const count = 40;
    const lane = cells ? `<div class="cells">${Array.from({ length: count }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>` : '<div class="bar"><div class="fill"></div></div>';
    $('#p-desk').innerHTML = `<div class="item"><div class="row">${thumb('sintel')}<div class="text"><div class="heading"><span class="title">Sintel</span><span class="dur">14:48</span></div><div class="status"><b data-pct></b><span>·</span><span data-eta></span></div></div><div class="actions"><button type="button" class="act" aria-label="Pause">${icon('pause')}</button></div><div class="lane-slot">${lane}</div></div></div>`;
    $('#p-pop').innerHTML = `<div class="prow">${thumb('tears-of-steel')}<div class="pbody"><div class="ptitle">Tears of Steel</div><div class="pmeta"><b data-pct></b><span class="dot">·</span><span data-eta></span></div></div><button type="button" class="act" aria-label="Pause">${icon('pause')}</button><div class="lane-slot">${lane}</div></div>`;
    lastDone = new WeakMap();
    paint();
  }
  function paint() {
    $$('[data-pct]', progress).forEach(el => { el.textContent = `${Math.min(99, Math.floor(p))}%`; });
    const seconds = (100 - p) / 100 * 2100 / 4.1;
    $$('[data-eta]', progress).forEach(el => { el.textContent = seconds < 60 ? 'under a minute left' : `${Math.round(seconds / 60)} min left`; });
    $$('.cells', progress).forEach(el => {
      const exact = p / 100 * el.children.length; const done = Math.floor(exact); const before = lastDone.get(el);
      const now = performance.now();
      [...el.children].forEach((cell, i) => {
        if (before !== undefined && i >= before && i < done && done - before < 4) cell.popUntil = now + 520;
        const head = done - 1 - i;
        cell.className = (i < done ? 'done' : i === done && p < 100 ? 'now' : '') + (cell.popUntil > now ? ' pop' : '') + (i < done && head < 6 ? ` h${head}` : '');
        cell.style.setProperty('--f', i === done ? String(exact - done) : '0');
      });
      lastDone.set(el, done);
    });
    $$('.bar', progress).forEach(el => el.style.setProperty('--p', `${p}%`));
    $('#p-out').value = `${Math.floor(p)}%`; $('#p-range').value = String(p);
  }
  progress.addEventListener('variant', renderProgress);
  $('#p-range').addEventListener('input', event => { setAuto(false); p = Number(event.target.value); paint(); });
  function setAuto(on) { auto = on; $('#p-auto').textContent = on ? 'Stop auto-play' : 'Auto-play'; $('#p-auto').setAttribute('aria-pressed', String(on)); }
  $('#p-auto').addEventListener('click', () => setAuto(!auto));
  let hold = 0;
  setInterval(() => { if (!auto) return; if (p >= 100) { if (++hold > 8) { hold = 0; p = 0; renderProgress(); } return; } p = Math.min(100, p + .45); paint(); }, 130);

  // ── 2 · Download button
  const dl = () => `<button type="button" class="dl" aria-label="Download" title="Download"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path class="tray" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><g class="arrow"><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></g></svg><span class="label">Download</span><span class="spin"></span><svg class="tick" viewBox="0 0 24 24" aria-hidden="true">${PATHS.check}</svg></button>`;
  const detected = (media, title, quality, size, dur) => `<div class="prow">${thumb(media)}<div class="pbody"><div class="ptitle">${title}</div><div class="pmeta"><button type="button" class="quality">${quality}${icon('down')}</button><span class="dot">·</span><span>${size}</span><span class="dot">·</span><span>${dur}</span></div></div>${dl()}</div>`;
  $('#b-pop').innerHTML = detected('sintel', 'Sintel: Open Movie by the Blender Foundation', '2160p', '21.0 GB', '14:48') + detected('big-buck-bunny', 'Big Buck Bunny', '720p', '182 MB', '9:56');
  $('#b-zoom').innerHTML = dl();
  document.getElementById('button').addEventListener('click', event => {
    const button = event.target.closest('.dl'); if (!button || button.classList.contains('busy') || button.classList.contains('done')) return;
    button.classList.add('busy');
    setTimeout(() => { button.classList.replace('busy', 'done'); setTimeout(() => button.classList.remove('done'), 1100); }, 850);
  });

  // ── 3 · Expanded section
  const details = document.getElementById('details');
  let dstate = 'downloading'; let dtab = 'Overview'; let pieceWord = 'Pieces';
  const map = () => `<div class="pieces"><div class="pieces-caption"><span>Pieces</span><span>95 of 280 · 2 retrying</span></div><div class="map">${Array.from({ length: 280 }, (_, i) => `<i class="${i < 95 ? 'done' : i < 103 ? (i === 97 || i === 100 ? 'retry' : 'now') : ''}"></i>`).join('')}</div></div>`;
  const iconActions = saved => `<div class="detail-actions"><button type="button" title="Copy link">${icon('link')}</button><button type="button" title="Open page">${icon('external')}</button><button type="button" class="danger" title="${saved ? 'Remove…' : 'Cancel download'}">${icon(saved ? 'trash' : 'x')}</button></div>`;
  const location = saved => `<button type="button" class="location">${icon('folder')}<span class="location-copy"><small>${saved ? 'Saved in' : 'Saving to'}</small><span>~/Movies/VidSnag/<strong>Sintel</strong></span></span>${icon('right', 'arrow')}</button>`;
  const pathlink = () => `<button type="button" class="pathlink">${icon('folder')}<span>~/Movies/VidSnag/<strong>Sintel</strong></span>${icon('right')}</button>`;
  function renderDetails() {
    const saved = dstate === 'saved'; const v = details.dataset.variant;
    const F = saved ? [['Quality', '1080p · English audio'], ['Size', '2.1 GB'], ['Length', '14:48'], ['From', 'durian.blender.org']]
      : [['Quality', '1080p · English audio'], ['Size', '714 MB / ~2.1 GB · 4.1 MB/s'], ['Connections', '6 of 16 active'], ['From', 'durian.blender.org']];
    const pieces = saved ? '' : map();
    let body;
    const facts = `<dl class="facts">${F.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>`;
    const F3 = F.filter(([k]) => k !== 'Connections').map(([k, x]) => [k, x.replace(' · 4.1 MB/s', '')]);
    const facts3 = `<dl class="facts three">${F3.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>`;
    const facts2 = `<dl class="facts two">${F.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>`;
    const textActions = `<button type="button" class="tbtn">${icon('link')}Copy link</button><button type="button" class="tbtn">${icon('external')}Open page</button><span class="grow"></span><button type="button" class="tbtn danger">${icon(saved ? 'trash' : 'x')}${saved ? 'Remove…' : 'Cancel download'}</button>`;
    const poster = `<div class="poster"><img src="${MEDIA}sintel.jpg" alt=""><video muted loop playsinline autoplay src="${MEDIA}sintel.mp4"></video></div>`;
    const TONES = { green: ['#80bfa6', '#80bfa6', '#9ad4bd', '#a9e6cd'], orange: ['#ff7a2a', '#ff7a2a', '#ff8a3d', '#ffb37a'], hot: ['#80bfa6', '#ffb060', '#9ad4bd', '#ffc37a'] };
    const chart = ({ tone = 'green', shape = 'linear', dense = false, wrap = '' } = {}) => { const [c0, c1, s0, s1] = TONES[tone]; const id = `${tone}${dense ? 'd' : ''}`;
      return `<div class="chart-wrap ${wrap} tone-${tone}"><svg class="live-chart" data-shape="${shape}" data-saved="${saved}" viewBox="0 0 600 100" preserveAspectRatio="none" aria-hidden="true"><defs>
        <linearGradient id="hf-${id}" gradientUnits="userSpaceOnUse" x1="0" x2="600" y1="0" y2="0"><stop offset=".55" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>
        <linearGradient id="hs-${id}" gradientUnits="userSpaceOnUse" x1="0" x2="600" y1="0" y2="0"><stop offset=".55" stop-color="${s0}"/><stop offset="1" stop-color="${s1}"/></linearGradient>
        <linearGradient id="vf-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${dense ? .95 : .6}"/><stop offset="1" stop-color="#fff" stop-opacity="${dense ? .35 : 0}"/></linearGradient>
        <mask id="vm-${id}"><rect width="600" height="100" fill="url(#vf-${id})"/></mask></defs>
        <path class="area" fill="url(#hf-${id})" mask="url(#vm-${id})"/><path class="line" fill="none" stroke="url(#hs-${id})" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>${saved ? '' : '<i class="live-dot"></i>'}</div>`; };
    const stat = saved ? `<div class="gstat"><strong>2.1 <small>GB</small></strong><span>took 8 min · averaged 4.3 MB/s · peak 6.2</span></div>` : `<div class="gstat"><strong><span data-speed>4.1</span> <small>MB/s</small></strong><span>peak <span data-peak>6.2</span> · 6 of 16 connections</span></div>`;
    const head = `<button type="button" class="icard-head">${icon('folder')}<span>${saved ? 'Saved in' : 'Saving to'} ~/Movies/VidSnag/<strong>Sintel</strong></span>${icon('right', 'arrow')}</button>`;
    const foot = `<div class="icard-foot">${textActions}</div>`;
    const card = inner => `<div class="details v-card"><div class="icard ${v}">${inner}</div></div>`;
    const och = chart({ tone: 'orange', wrap: 'ceil' });
    const sp = '<span data-speed>4.8</span>';
    const dots = `<span class="cdots">${Array.from({ length: 16 }, (_, i) => `<i class="${i < 6 ? 'on' : ''}"></i>`).join('')}</span>`;
    const STATS = {
      snow: `<div class="gstat"><strong>${sp} <small>MB/s</small></strong><span>6 of 16 connections</span></div>`,
      spair: `<div class="spair-box"><div><strong>${sp}</strong><span>MB/s</span></div><div><strong>6<small>/16</small></strong><span>connections</span></div></div>`,
      sdots: `<div class="gstat"><strong>${sp} <small>MB/s</small></strong>${dots}<span>6 of 16 connections</span></div>`,
      schip: `<div class="gstat inline"><strong>${sp} <small>MB/s</small></strong><em class="chip">6 / 16</em></div>`,
      smeter: `<div class="gstat"><strong>${sp} <small>MB/s</small></strong><span class="cmeter"><i style="width:37.5%"></i></span><span>6 of 16 connections</span></div>`,
    };
    const word = pieceWord; const piecesNamed = pieces.replace('<span>Pieces</span>', `<span>${word}</span>`);
    let top;
    if (saved) top = `<div class="gtop">${facts}</div>`.replace('gtop', 'gtop solo');
    else if (v === 'sfacts') top = `<dl class="facts five"><div class="hot"><dt>Speed</dt><dd>${sp} MB/s</dd></div><div><dt>Connections</dt><dd>6 of 16</dd></div>${F3.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>`;
    else if (v === 'sright') top = `<div class="gtop flip">${facts3}<div class="gstat right"><strong>${sp} <small>MB/s</small></strong><span>6 of 16 connections</span></div></div>`;
    else if (v === 'ssentence') top = `<p class="ssentence">Downloading at <b>${sp} MB/s</b> over <b>6</b> of 16 connections</p>${facts3}`;
    else top = `<div class="gtop">${STATS[v] || STATS.snow}${facts3}</div>`;
    body = card(`${head}<div class="icard-body has-chart lined read-oboth">${saved ? '' : och}<div class="over">${top}${piecesNamed}</div></div>${foot}`);
    const status = saved ? `<div class="status">${icon('check', 'ok')}Saved today · 2.1 GB · 1080p</div>` : '<div class="status"><b>34%</b><span>·</span><span>6 min left</span></div>';
    const lane = saved ? '' : `<div class="lane-slot"><div class="cells">${Array.from({ length: 40 }, (_, i) => `<i class="${i < 13 ? 'done' : i === 13 ? 'now' : ''}"></i>`).join('')}</div></div>`;
    const rows = `<div class="item${v === 'drawer' ? ' selected' : ''}"><div class="row">${thumb('sintel')}<div class="text"><div class="heading"><span class="title">Sintel</span><span class="dur">14:48</span></div>${status}</div><div class="actions"><button type="button" class="act">${icon(saved ? 'play' : 'pause')}</button></div>${lane}</div>${body}</div>
      <div class="item"><div class="row">${thumb('big-buck-bunny')}<div class="text"><div class="heading"><span class="title">Big Buck Bunny</span><span class="dur">9:56</span></div><div class="status">${icon('check', 'ok')}Saved today · 655 MB · 1080p</div></div><div class="actions"><button type="button" class="act">${icon('play')}</button></div></div></div>`;
    if (v === 'drawer') {
      const more = `<div class="item"><div class="row">${thumb('tears-of-steel')}<div class="text"><div class="heading"><span class="title">Tears of Steel</span><span class="dur">12:14</span></div><div class="status">${icon('check', 'ok')}Saved yesterday · 2.3 GB · 2160p</div></div><div class="actions"><button type="button" class="act">${icon('play')}</button></div></div></div>`;
      $('#d-desk').innerHTML = `<div class="with-drawer"><div class="drawer-list">${rows}${more}${more}</div><aside class="drawer"><div class="drawer-head"><span>Details</span><button type="button" class="icon-button">${icon('x')}</button></div><div class="poster"><img src="${MEDIA}sintel.jpg" alt=""><video muted loop playsinline autoplay src="${MEDIA}sintel.mp4"></video></div><div class="drawer-title">Sintel</div><dl class="kv">${F.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('')}</dl>${location(saved)}${pieces}<div class="drawer-actions"><button type="button" class="btn">${icon('link')}Copy link</button><button type="button" class="btn">${icon('external')}Open page</button><button type="button" class="btn danger">${icon(saved ? 'trash' : 'x')}${saved ? 'Remove…' : 'Cancel'}</button></div></aside></div>`;
    } else $('#d-desk').innerHTML = rows;
  }
  details.addEventListener('variant', renderDetails);
  details.addEventListener('click', event => {
    const wordButton = event.target.closest('[data-word]'); if (wordButton) { pieceWord = wordButton.dataset.word; $$('[data-word]').forEach(other => other.setAttribute('aria-pressed', String(other === wordButton))); renderDetails(); return; }
    const tab = event.target.closest('[data-dtab]'); if (tab) { dtab = tab.dataset.dtab; renderDetails(); return; }
    const button = event.target.closest('[data-dstate]'); if (!button) return;
    dstate = button.dataset.dstate; $$('[data-dstate]').forEach(other => other.setAttribute('aria-pressed', String(other === button))); renderDetails();
  });

  // Live speed chart: a random walk that scrolls smoothly; a fresh panel starts empty so the build-up is visible.
  const N = 60; const STEP = 650; let samples = []; let last = performance.now(); let speed = 0; let peak = 0;
  const HISTORY = [0.4, 1.8, 3.1, 3.9, 4.6, 5.2, 4.9, 6.2, 5.6, 5.0, 3.1, 2.2, 3.6, 4.4, 4.8, 4.5, 5.3, 4.7, 4.1, 4.4, 4.9, 5.1, 4.6, 3.9, 4.2, 4.5, 4.0, 3.2, 1.4, 0.3];
  function resetChart() { samples = Array(N + 2).fill(0); speed = 0; peak = 0; last = performance.now(); }
  function drawChart(svg, data, frac) {
    const n = data.length; const step = 600 / (n - 3); const shape = svg.dataset.shape;
    const P = data.map((s, i) => [600 + (i - (n - 2) + .5 - frac) * step, 100 - s / 7 * 88]);
    const f = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`; const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let d; let edgeY;
    if (shape === 'smooth') {
      d = `M${f(P[0])} L${f(mid(P[0], P[1]))}`; for (let i = 1; i < n - 1; i++) d += ` Q${f(P[i])} ${f(mid(P[i], P[i + 1]))}`;
      const a = mid(P[n - 3], P[n - 2]); const b = mid(P[n - 2], P[n - 1]); const t = frac; edgeY = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * P[n - 2][1] + t * t * b[1];
    } else if (shape === 'step') {
      d = `M${f(P[0])}`; for (let i = 1; i < n; i++) d += ` H${P[i][0].toFixed(1)} V${P[i][1].toFixed(1)}`;
      edgeY = frac < .5 ? P[n - 3][1] : P[n - 2][1];
    } else {
      d = `M${P.map(f).join(' L')}`;
      const u = frac + .5; edgeY = u <= 1 ? P[n - 3][1] + (P[n - 2][1] - P[n - 3][1]) * u : P[n - 2][1] + (P[n - 1][1] - P[n - 2][1]) * (u - 1);
    }
    $('.line', svg).setAttribute('d', d); $('.area', svg).setAttribute('d', `${d} L${P[n - 1][0].toFixed(1)},100 L${P[0][0].toFixed(1)},100 Z`);
    const dot = svg.parentElement.querySelector('.live-dot'); if (dot) dot.style.top = `${edgeY}%`;
  }
  function frame(now) {
    while (now - last >= STEP) { last += STEP; speed = Math.max(.6, Math.min(6.6, (speed || 1.5) + (Math.random() - .42) * 1.5)); peak = Math.max(peak, speed); samples.push(speed); samples.shift();
      const shown = samples[samples.length - 2]; $$('[data-speed]').forEach(el => { el.textContent = shown.toFixed(1); }); $$('[data-peak]').forEach(el => { el.textContent = peak.toFixed(1); }); }
    const frac = (now - last) / STEP;
    $$('.live-chart').forEach(svg => svg.dataset.saved === 'true' ? drawChart(svg, [0, ...HISTORY, 0, 0], 0) : drawChart(svg, samples, frac));
    requestAnimationFrame(frame);
  }
  details.addEventListener('variant', resetChart);
  $('#d-restart').addEventListener('click', () => { resetChart(); });
  resetChart(); requestAnimationFrame(frame);

  renderProgress(); renderDetails();
})();
