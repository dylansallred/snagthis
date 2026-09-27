(() => {
  const hub = document.getElementById('hub');
  const target = document.getElementById('folder-target');
  const bars = [
    ['today', 'Original', 'Previous grey hover, underlined path, orange arrow.'],
    ['warm', 'Warm wash', 'A soft warm tint across the whole bar.'],
    ['rail', 'Leading edge', 'A fine warm line grows along the left edge.'],
    ['outline', 'Fine outline', 'An inset outline makes the whole target clear.'],
    ['path', 'Path focus', 'Highlight just the final folder name.'],
    ['sweep', 'Soft reveal', 'Your choice: a quiet highlight opens from the left.'],
  ];
  const motions = [
    ['still', 'Still · original', 'The previous open-folder icon, with no movement.'],
    ['alive', 'Alive', 'Matches the row icon: opens, turns yellow, lifts 1px.'],
    ['hinge', 'Hinge open', 'The front of the folder tilts forward to open.'],
    ['settle', 'Open + settle', 'Your choice: opens with a small bounce, then rests.'],
  ];
  const params = new URLSearchParams(location.search);
  const valid = (list, value, fallback) => list.some(([key]) => key === value) ? value : fallback;
  const state = { bar: valid(bars, params.get('bar'), 'sweep'), motion: valid(motions, params.get('motion'), 'settle'), width: params.get('width') === '640' ? '640' : '820', path: params.get('path') === 'long' ? 'long' : 'normal', hold: params.get('hold') === 'true', reduced: params.get('reduced') === 'true' };
  let copyName = 'Today';
  const folderArt = '<svg class="folder-closed" viewBox="0 0 24 24"><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/></svg><svg class="folder-open" viewBox="0 0 24 24"><path d="m6 14 1.5-3a2 2 0 0 1 1.8-1H20a2 2 0 0 1 1.9 2.6l-2.3 6a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1"/></svg><svg class="folder-hinge" viewBox="0 0 24 24"><path d="M3 19V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v10"/><path class="folder-face" d="M3 10h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
  for (const mark of document.querySelectorAll('.folder-mark')) mark.innerHTML = folderArt;
  const selection = () => { document.getElementById('selection').textContent = `${bars.find(([key]) => key === state.bar)[1]} · ${motions.find(([key]) => key === state.motion)[1]} · ${copyName}`; };
  function render() {
    target.dataset.bar = state.bar; target.dataset.motion = state.motion;
    target.classList.toggle('is-hovered', state.hold);
    hub.dataset.reduced = String(state.reduced);
    document.getElementById('desktop-preview').style.width = `${state.width}px`;
    document.getElementById('preview-width').value = state.width;
    document.getElementById('path-length').value = state.path;
    document.getElementById('hold-hover').checked = state.hold;
    document.getElementById('reduced-motion').checked = state.reduced;
    target.querySelector('.folder-path').innerHTML = state.path === 'long'
      ? '~/Movies/VidSnag/Marvel Collection/<strong>Watch Spider Man Brand New Day — Original Theatrical Edition (2026)</strong>'
      : '~/Movies/VidSnag/<strong>Watch Spider Man Brand New Day</strong>';
    for (const [kind, list] of [['bar', bars], ['motion', motions]]) {
      for (const button of document.querySelectorAll(`#${kind}-options button`)) button.setAttribute('aria-pressed', String(button.dataset.key === state[kind]));
      document.getElementById('hover-note').textContent = `${motions.find(([key]) => key === state.motion)[2]} ${bars.find(([key]) => key === state.bar)[2]} Hover the bar to try it; click to preview opening the folder.`;
    }
    selection();
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(state)) url.searchParams.set(key, String(value));
    history.replaceState(null, '', url);
  }
  for (const [kind, list] of [['bar', bars], ['motion', motions]]) {
    const picker = document.getElementById(`${kind}-options`);
    list.forEach(([key, name, description], index) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.key = key;
      button.innerHTML = `<span>${index + 1} · ${name}</span><small>${description}</small>${kind === 'bar' ? '<i class="mini-bar" aria-hidden="true"></i>' : ''}`;
      button.addEventListener('click', () => { state[kind] = key; render(); }); picker.append(button);
    });
    picker.addEventListener('keydown', event => { const button = picker.querySelectorAll('button')[Number(event.key) - 1]; if (button && /^[1-9]$/.test(event.key)) { event.preventDefault(); button.click(); button.focus(); } });
  }
  for (const [id, key] of [['preview-width', 'width'], ['path-length', 'path'], ['hold-hover', 'hold'], ['reduced-motion', 'reduced']]) {
    document.getElementById(id).addEventListener('change', event => { state[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value; render(); });
  }
  let noticeTimer;
  for (const bar of document.querySelectorAll('.folder-target')) bar.addEventListener('click', () => {
    clearTimeout(noticeTimer); document.getElementById('folder-notice').textContent = 'Preview: this opens the saved folder in Finder.';
    noticeTimer = setTimeout(() => { document.getElementById('folder-notice').textContent = ''; }, 2500);
  });
  document.addEventListener('copy-study-change', event => { copyName = event.detail.name; selection(); });
  document.getElementById('reset').addEventListener('click', () => {
    Object.assign(state, { bar: 'today', motion: 'still', width: '820', path: 'normal', hold: false, reduced: false });
    render(); document.dispatchEvent(new Event('design-study-reset'));
  });
  render();
})();
