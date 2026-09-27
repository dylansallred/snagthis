(() => {
  const $ = selector => document.querySelector(selector);
  const hub = $('#hub');
  const choices = {
    loading: [
      ['today', 'Original · still stripes', 'The previous placeholder, without motion.'],
      ['shimmer', 'Shimmer', 'A soft highlight passes across the frame.'],
      ['breathe', 'Breathe', 'The whole placeholder slowly brightens.'],
      ['filmstrip', 'Filmstrip', 'Quiet film frames drift sideways.'],
      ['dots', 'Three dots', 'A small, familiar loading rhythm.'],
      ['orbit', 'Soft orbit', 'A fine ring circles a video symbol.'],
    ],
    layout: [
      ['today', 'Original · inset', '128 × 72 in the popup, with space around it.'],
      ['flush', 'Flush full height', 'Touches the left edge, top, and bottom.'],
      ['wide', 'Wider preview', 'A larger 160 × 90 frame; more image, less text.'],
      ['compact', 'Compact', 'A smaller 16:9 preview makes room for text.'],
      ['square', 'Square crop', 'A taller 88 × 88 tile with an intentional crop.'],
    ],
  };
  const baseline = { loading: 'today', layout: 'today', image: 'placeholder', paused: 'false', reduced: 'false' };
  const selected = { loading: 'dots', layout: 'flush' };
  const params = new URLSearchParams(location.search);
  const state = { ...baseline, ...selected };
  for (const [key, options] of Object.entries(choices)) if (options.some(([id]) => id === params.get(key))) state[key] = params.get(key);
  if (['placeholder', 'loaded'].includes(params.get('image'))) state.image = params.get('image');
  for (const key of ['paused', 'reduced']) if (['true', 'false'].includes(params.get(key))) state[key] = params.get(key);
  const systemReduced = matchMedia('(prefers-reduced-motion: reduce)');
  const film = '<svg class="loading-glyph icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>';
  const arrow = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></svg>';
  function loadingArt(style) { return `<span class="loading-art motion-${style}" aria-hidden="true">${film}<i></i><i></i><i></i></span>`; }
  const samples = [
    { title: 'A feature film — the complete movie', duration: '1:39:44', tier: 'FHD', quality: '1080p', size: 'N/A', poster: 'sintel' },
    { title: 'Behind the scenes — the making of the movie', duration: '12:14', tier: 'HD', quality: '720p', size: '655 MB', poster: 'tears-of-steel' },
  ];
  const dot = '<span class="meta-dot" aria-hidden="true">·</span>';
  function rows() {
    return samples.map(sample => `<div class="thumbnail-row"><div class="preview-thumb"${state.image === 'placeholder' ? ' role="img" aria-label="Thumbnail loading"' : ''}>${state.image === 'loaded' ? `<img src="../../../../apps/extension/popup/media/${sample.poster}.jpg" alt="Sample video thumbnail">` : loadingArt(state.loading)}</div><div class="thumbnail-copy"><div class="thumbnail-heading"><span class="thumbnail-title">${sample.title}</span><span class="duration">${sample.duration}</span></div><div class="thumbnail-meta"><span class="thumbnail-quality" aria-label="${sample.tier === 'FHD' ? 'Full HD' : 'HD'}, ${sample.quality}"><b aria-hidden="true">${sample.tier}</b>${sample.quality}</span>${dot}<span>${sample.size}</span><span class="meta-dot duration-dot" aria-hidden="true">·</span><span class="popup-duration">${sample.duration}</span></div></div><span class="preview-download" aria-label="Download, preview only" role="img">${arrow}</span></div>`).join('');
  }
  function render() {
    hub.dataset.loading = state.loading;
    hub.dataset.layout = state.layout;
    hub.dataset.paused = state.paused;
    hub.dataset.reduced = state.reduced;
    hub.dataset.image = state.image;
    for (const [key] of Object.entries(choices)) $(`#${key}`).querySelectorAll('.study-picker button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.key === state[key])));
    $('#sample-image').value = state.image;
    $('#pause').setAttribute('aria-pressed', state.paused);
    $('#pause').textContent = state.paused === 'true' ? 'Resume motion' : 'Pause motion';
    $('#reduced-motion').checked = state.reduced === 'true';
    $('#popup-rows').innerHTML = rows();
    $('#desktop-rows').innerHTML = rows();
    $('#selection').textContent = `Placeholder: ${choices.loading.find(([key]) => key === state.loading)[1]} · Layout: ${choices.layout.find(([key]) => key === state.layout)[1]}`;
    const notes = {
      today: 'Original layout: the popup uses a 128 × 72 thumbnail with 12px above and below; desktop uses 112 × 63. The original 16:9 frame is preserved.',
      flush: 'Flush full height: removes the empty space above, below, and to the left of the thumbnail. The image fills the row height, so its sides crop more than the original layout.',
      wide: 'Wider preview: a 160 × 90 thumbnail on both surfaces preserves 16:9. Rows grow taller and the popup title has less room.',
      compact: 'Compact: 96 × 54 in the popup and 88 × 49.5 on desktop. The full 16:9 composition stays visible, with more room for the title.',
      square: 'Square crop: the 88 × 88 frame keeps the central part of the image. Compare the loaded-image state to see what is cropped.',
    };
    $('#layout-note').textContent = notes[state.layout];
    $('#motion-note').textContent = systemReduced.matches ? 'Your system requests reduced motion. All placeholder animations are still.' : state.reduced === 'true' ? 'Reduced motion preview: all placeholder treatments are still.' : state.paused === 'true' ? 'Motion is paused in the option samples and both previews.' : state.image === 'loaded' ? 'Loaded images stay unobscured. Placeholder motion remains visible in the option samples above.' : 'Loading effects stay inside the empty thumbnail. Duration and quality remain beside the image.';
  }
  function remember() {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(state)) url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  }
  function pick(key, value) { state[key] = value; render(); remember(); }
  let hovered = null;
  for (const [key, options] of Object.entries(choices)) {
    const section = $(`#${key}`);
    const picker = section.querySelector('.study-picker');
    picker.innerHTML = options.map(([id, name, description], index) => `<button type="button" data-key="${id}" aria-pressed="false"><span>${index + 1} · ${name}</span><small>${description}</small>${key === 'loading' ? `<span class="option-thumb">${loadingArt(id)}</span>` : `<span class="layout-sketch sketch-${id}" aria-hidden="true"><i></i><b></b></span>`}</button>`).join('');
    picker.addEventListener('click', event => { const button = event.target.closest('button'); if (button) pick(key, button.dataset.key); });
    section.addEventListener('pointerenter', () => { hovered = key; });
    section.addEventListener('pointerleave', () => { if (hovered === key) hovered = null; });
  }
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    const section = event.target.closest('.study')?.id || hovered;
    const option = choices[section]?.[Number(event.key) - 1];
    if (option) { event.preventDefault(); pick(section, option[0]); }
  });
  $('#sample-image').addEventListener('change', event => pick('image', event.target.value));
  $('#pause').addEventListener('click', () => pick('paused', String(state.paused !== 'true')));
  $('#reduced-motion').addEventListener('change', event => pick('reduced', String(event.target.checked)));
  $('#reset').addEventListener('click', () => { Object.assign(state, baseline); render(); remember(); });
  systemReduced.addEventListener('change', render);
  render();
})();
