(() => {
  const $ = selector => document.querySelector(selector);
  const hub = $('#hub');
  const variants = {
    quality: [
      ['plain', 'Previous', 'Plain resolution, before the refresh.'],
      ['weight', 'More contrast', 'Brighter, bolder text as quality rises.'],
      ['outline', 'Outline badge', 'SD, HD, FHD or 4K beside the resolution.'],
      ['solid', 'Solid badge', 'A small silver tile with a dark label.'],
      ['split', 'Split capsule', 'Tier and resolution in one divided pill.'],
      ['screen', 'Screen icon', 'A tiny display holds the quality tier.'],
      ['tint', 'Colour coded', 'Subtle blue, cyan and violet tier badges.'],
    ],
    facts: [
      ['today', 'Previous', 'Quiet labels above three values.'],
      ['inline', 'Inline labels', 'Label and value share a compact line.'],
      ['reverse', 'Value first', 'The information leads; captions follow.'],
      ['divided', 'Fine dividers', 'Vertical rules organise the three facts.'],
      ['tiles', 'Inset tiles', 'Each fact gets its own subtle surface.'],
      ['grouped', 'Quality + size', 'The key facts together, source beneath.'],
    ],
    status: [
      ['today', 'Previous', 'Saved today · size · quality.'],
      ['quality-first', 'Quality first', 'Resolution leads; saved status comes last.'],
      ['ends', 'Separated ends', 'Saved at the left, quality and size at the right.'],
      ['dividers', 'Fine dividers', 'Slim rules instead of dot separators.'],
      ['sentence', 'In a sentence', 'Saved today in 1080p · 4.5 GB.'],
      ['stack', 'Two lines', 'Saved status above quality and size.'],
    ],
  };
  const qualities = {
    480: { resolution: '480p', tier: 'SD', name: 'Standard definition', tone: 'sd' },
    720: { resolution: '720p', tier: 'HD', name: 'HD', tone: 'hd' },
    1080: { resolution: '1080p', tier: 'FHD', name: 'Full HD', tone: 'fhd' },
    2160: { resolution: '2160p', tier: '4K', name: '4K', tone: 'uhd' },
    unknown: { resolution: 'Unknown', tier: '', name: 'Quality unknown', tone: 'unknown' },
  };
  const params = new URLSearchParams(location.search);
  const selected = { quality: 'solid', facts: 'tiles', status: 'quality-first' };
  const state = {};
  for (const [id, choices] of Object.entries(variants)) state[id] = choices.some(([key]) => key === params.get(id)) ? params.get(id) : selected[id];
  state.sample = Object.hasOwn(qualities, params.get('sample')) ? params.get('sample') : '1080';
  state.width = ['820', '640', '400'].includes(params.get('width')) ? params.get('width') : '820';
  const check = '<svg class="saved-check icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  const play = '<span class="preview-play" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg></span>';
  const dot = '<span class="meta-dot" aria-hidden="true">·</span>';

  function quality(value, style = state.quality) {
    const q = qualities[value];
    if (!q.tier) return '<span class="quality-mark is-unknown">Quality unknown</span>';
    const exact = `<span class="resolution">${q.resolution}</span>`;
    const badge = `<span class="tier-badge" aria-hidden="true">${q.tier}</span>`;
    return `<span class="quality-mark q-${style} tone-${q.tone}" aria-label="${q.name}, ${q.resolution}">${['plain', 'weight'].includes(style) ? exact : badge + exact}</span>`;
  }
  function status(value, size, date = 'today') {
    const saved = `<span class="saved-copy">${check}Saved ${date}</span>`;
    const file = `<span class="file-size">${size}</span>`;
    const q = quality(value);
    let content;
    switch (state.status) {
      case 'quality-first': content = `${q}${dot}${file}${dot}${saved}`; break;
      case 'ends': content = `${saved}<span class="status-tail">${q}${dot}${file}</span>`; break;
      case 'dividers': content = `${saved}<i class="meta-divider" aria-hidden="true"></i>${q}<i class="meta-divider" aria-hidden="true"></i>${file}`; break;
      case 'sentence': content = `${saved}${value === 'unknown' ? dot : '<span>in</span>'}${q}${dot}${file}`; break;
      case 'stack': content = `${saved}<span class="status-tail">${q}${dot}${file}</span>`; break;
      default: content = `${saved}${dot}${file}${dot}${q}`;
    }
    return `<div class="saved-meta layout-${state.status}">${content}</div>`;
  }
  function render() {
    for (const [id, choices] of Object.entries(variants)) {
      const section = $(`#${id}`);
      section.dataset.variant = state[id];
      section.querySelectorAll('.study-picker button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === state[id])));
    }
    hub.style.setProperty('--preview-width', `${state.width}px`);
    hub.dataset.width = state.width;
    $('#sample-quality').value = state.sample;
    $('#sample-width').value = state.width;
    document.querySelectorAll('.width-label').forEach(label => { label.textContent = `${state.width}px`; });
    $('#tier-strip').innerHTML = Object.entries(qualities).map(([key, q]) => `<div class="tier-sample${key === state.sample ? ' current' : ''}"><small>${q.name}</small>${quality(key)}</div>`).join('');
    $('#facts-stage').innerHTML = `<dl class="meta-facts facts-${state.facts}"><div class="fact quality-fact"><dt>Quality</dt><dd>${quality(state.sample)}</dd></div><div class="fact size-fact"><dt>Size</dt><dd><span class="size-number">4.5</span> <span class="size-unit">GB</span></dd></div><div class="fact source-fact"><dt>From</dt><dd>www.movy.sx</dd></div></dl>`;
    $('#status-stage').innerHTML = [
      ['sintel', 'Sintel — an open movie', '14:48', state.sample, '4.5 GB', 'today'],
      ['big-buck-bunny', 'Big Buck Bunny', '9:56', '720', '655 MB', 'today'],
      ['tears-of-steel', 'Tears of Steel', '12:14', '2160', '8.2 GB', 'yesterday'],
    ].map(([media, title, duration, q, size, date]) => `<div class="sample-row"><img class="sample-poster" src="../../../../apps/extension/popup/media/${media}.jpg" alt=""><div class="sample-copy"><div class="sample-heading"><span class="sample-title">${title}</span><span class="sample-duration">${duration}</span></div>${status(q, size, date)}</div>${play}</div>`).join('');
    $('#selection').textContent = Object.entries(variants).map(([id, choices]) => `${id === 'quality' ? 'Quality' : id === 'facts' ? 'Details' : 'Saved line'}: ${choices.find(([key]) => key === state[id])[1]}`).join('  ·  ');
  }
  function remember() {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(state)) url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  }
  function pick(id, key) { state[id] = key; render(); remember(); }
  let hovered = null;
  for (const [id, choices] of Object.entries(variants)) {
    const section = $(`#${id}`);
    const picker = section.querySelector('.study-picker');
    picker.innerHTML = choices.map(([key, name, description], index) => `<button type="button" data-key="${key}" aria-pressed="false"><span>${index + 1} · ${name}</span><small>${description}</small>${id === 'quality' ? `<span class="option-sample">${quality('1080', key)}</span>` : ''}</button>`).join('');
    picker.addEventListener('click', event => { const button = event.target.closest('button'); if (button) pick(id, button.dataset.key); });
    section.addEventListener('pointerenter', () => { hovered = id; });
    section.addEventListener('pointerleave', () => { if (hovered === id) hovered = null; });
  }
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    const section = event.target.closest('.study')?.id || hovered;
    const choice = variants[section]?.[Number(event.key) - 1];
    if (choice) { event.preventDefault(); pick(section, choice[0]); }
  });
  $('#sample-quality').addEventListener('change', event => pick('sample', event.target.value));
  $('#sample-width').addEventListener('change', event => pick('width', event.target.value));
  $('#reset').addEventListener('click', () => { Object.assign(state, selected, { sample: '1080', width: '820' }); render(); remember(); });
  render();
})();
