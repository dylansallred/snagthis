(() => {
  'use strict';
  const assets = '../../../../apps/extension/img/';
  const fonts = [
    { key: 'current', name: 'Original', caption: 'Your existing letterforms', description: 'The original thin “Vid” and bold “Snag”.' },
    { key: 'geometric', name: 'Geometric', caption: 'Futura · crisp & circular', family: 'Futura, Avenir Next, sans-serif', weight: 500, size: 141, description: 'Futura brings circular forms, sharp joins, and a lighter rhythm.' },
    { key: 'rounded', name: 'Rounded', caption: 'Arial Rounded · soft & bold', family: 'Arial Rounded MT Bold, Arial, sans-serif', weight: 700, size: 142, description: 'Rounded terminals make the name softer and more approachable.' },
    { key: 'condensed', name: 'Condensed', caption: 'Impact · tall & compact', family: 'Impact, Avenir Next Condensed, sans-serif', weight: 400, size: 154, description: 'A tall, compressed wordmark with a compact footprint.' },
    { key: 'heavy', name: 'Heavy', caption: 'Inter Black · wide & solid', family: 'Inter Study, Inter, sans-serif', weight: 900, size: 140, description: 'Inter Black makes the name broad, solid, and emphatic.' },
  ];
  const colors = [
    { key: 'current', name: 'Current', caption: 'Orange Vid · white Snag', vid: '#bc4700', snag: '#ffffff', icon: '#bc4700' },
    { key: 'reverse', name: 'Reversed', caption: 'White Vid · orange Snag', vid: '#ffffff', snag: '#fa5d0e', icon: '#fa5d0e' },
    { key: 'white', name: 'White + orange', caption: 'White name · orange symbol', vid: '#ffffff', snag: '#ffffff', icon: '#fa5d0e' },
    { key: 'silver', name: 'Silver + orange', caption: 'Silver Vid · orange Snag', vid: '#aab4c2', snag: '#fa5d0e', icon: '#aab4c2' },
  ];
  const icons = [
    { key: 'current', name: 'Original', caption: 'Your play-and-download mark' },
    { key: 'clean', name: 'Clean cut', caption: 'Play with a crisp down cutout' },
    { key: 'clipped', name: 'Clipped arrow', caption: 'Angular play meets save' },
    { key: 'outline', name: 'Outline + tray', caption: 'An open, lighter symbol' },
    { key: 'hook', name: 'Rounded hook', caption: 'A soft catch beneath play' },
  ];
  const groups = { font: fonts, color: colors, icon: icons };
  const params = new URLSearchParams(location.search);
  const state = { width: params.get('width') === '640' ? '640' : '820', mono: params.get('mono') === '1' };
  for (const [key, choices] of Object.entries(groups)) state[key] = choices.some(choice => choice.key === params.get(key)) ? params.get(key) : 'current';
  const study = document.getElementById('logo-study');
  const measure = document.createElement('canvas').getContext('2d');
  let maskId = 0;
  const selected = (group, key) => groups[group].find(choice => choice.key === key);
  const original = choice => choice.font === 'current' && choice.color === 'current' && choice.icon === 'current';
  const baseline = { font: 'current', color: 'current', icon: 'current' };

  // Alpha masks reuse the actual artwork for Original; no replacement font or
  // hand tracing is involved. The all-Current combination uses the untouched PNG.
  function originalLetters(palette, colorKey) {
    if (colorKey === 'current') return `<svg width="668" height="164" viewBox="0 0 668 164" overflow="hidden"><image href="${assets}vidsnag-logo-title.png" width="830" height="164"/></svg>`;
    const id = `letters-${++maskId}`;
    return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="668" height="164" style="mask-type:alpha"><image href="${assets}vidsnag-logo-title.png" width="830" height="164"/></mask></defs><g mask="url(#${id})"><path fill="${palette.vid}" d="M0 0h254v164H0z"/><path fill="${palette.snag}" d="M254 0h414v164H254z"/></g>`;
  }
  function symbolContent(key, color, isOriginalColor) {
    if (key === 'current') {
      if (isOriginalColor) return `<image href="${assets}vidsnag-logo-mark.png" x="3" y="0" width="58" height="64"/>`;
      const id = `symbol-${++maskId}`;
      return `<defs><mask id="${id}" style="mask-type:alpha"><image href="${assets}vidsnag-logo-mark.png" x="3" y="0" width="58" height="64"/></mask></defs><path fill="${color}" mask="url(#${id})" d="M0 0h64v64H0z"/>`;
    }
    if (key === 'clean') return `<path fill="${color}" fill-rule="evenodd" d="M7 4 61 32 7 60ZM23 18h9v13h9L27.5 45 14 31h9Z"/>`;
    if (key === 'clipped') return `<path fill="${color}" d="M7 7h13l29 18v8L7 57V41l25-12L7 16Z"/><path fill="${color}" d="M42 35h10v11h9L47 61 33 46h9Z"/>`;
    if (key === 'outline') return `<g fill="none" stroke="${color}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7 49 26 12 45ZM37 31v18m-7-7 7 7 7-7M21 51v7h32v-7"/></g>`;
    return `<g fill="${color}"><path d="M19 5c-3-2-6 0-6 3v26c0 3 3 5 6 3l22-13c3-2 3-5 0-7Z"/><path d="M53 24a4 4 0 0 1 4 4v15c0 11-8 18-18 18H18a4 4 0 0 1 0-8h21c6 0 10-4 10-10V28a4 4 0 0 1 4-4Z"/><path d="M22 42 9 57l13 7Z"/></g>`;
  }
  function symbol(choice) {
    const palette = selected('color', choice.color);
    return `<svg class="composed-symbol" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${symbolContent(choice.icon, palette.icon, choice.color === 'current')}</svg>`;
  }
  function wordmark(choice, lettersOnly = false) {
    if (original(choice) && !lettersOnly) return `<img class="baseline-wordmark" src="${assets}vidsnag-logo-title.png" alt="VidSnag">`;
    const font = selected('font', choice.font);
    const palette = selected('color', choice.color);
    let letters, width;
    if (choice.font === 'current') {
      width = 668;
      letters = originalLetters(palette, choice.color);
    } else {
      measure.font = `${font.weight} ${font.size}px ${font.family}`;
      const vidWidth = measure.measureText('Vid').width;
      width = measure.measureText('VidSnag').width + 3;
      letters = `<g font-family="${font.family}" font-size="${font.size}" font-weight="${font.weight}" letter-spacing="0"><text x="0" y="128" fill="${palette.vid}">Vid</text><text x="${vidWidth}" y="128" fill="${palette.snag}">Snag</text></g>`;
    }
    const totalWidth = lettersOnly ? width : width + 176;
    const icon = lettersOnly ? '' : `<svg x="${width + 21}" y="4" width="155" height="156" viewBox="0 0 64 64">${symbolContent(choice.icon, palette.icon, choice.color === 'current')}</svg>`;
    return `<svg class="composed-wordmark" viewBox="0 0 ${totalWidth} 164" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="VidSnag">${letters}${icon}</svg>`;
  }
  function iconContext(choice, toolbar = false) {
    if (original(choice)) return `<img class="baseline-app" src="${assets}${toolbar ? 'icon-16.png' : 'vidsnag-app-icon.png'}" alt="">`;
    return symbol(choice);
  }
  for (const [group, choices] of Object.entries(groups)) {
    const picker = document.getElementById(`${group}-grid`);
    picker.innerHTML = choices.map((choice, index) => `<button class="direction-card" type="button" data-group="${group}" data-choice="${choice.key}" aria-pressed="false" aria-label="${index + 1}. ${choice.name}. ${choice.caption}"><span class="option-number">0${index + 1}</span><span class="choice-check" aria-hidden="true"></span><span class="card-art" aria-hidden="true"></span><span class="direction-name">${choice.name}</span><span class="direction-caption">${choice.caption}</span></button>`).join('');
    picker.addEventListener('click', event => {
      const button = event.target.closest('button[data-choice]');
      if (button) { state[group] = button.dataset.choice; render(); }
    });
    picker.addEventListener('keydown', event => {
      if (!/^[1-5]$/.test(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      const button = picker.querySelectorAll('button')[Number(event.key) - 1];
      if (!button) return;
      event.preventDefault(); state[group] = button.dataset.choice; render(); button.focus();
    });
  }
  document.querySelector('[data-current-wordmark]').innerHTML = wordmark(baseline);
  document.querySelector('.progress-lane').innerHTML = Array.from({ length: 40 }, (_, index) => `<i class="${index < 13 ? 'done' : index === 13 ? 'current' : ''}"></i>`).join('');
  function render() {
    const font = selected('font', state.font), color = selected('color', state.color), icon = selected('icon', state.icon);
    study.classList.toggle('is-mono', state.mono);
    for (const button of document.querySelectorAll('button[data-choice]')) {
      const group = button.dataset.group;
      const choice = { ...state, [group]: button.dataset.choice };
      button.setAttribute('aria-pressed', String(button.dataset.choice === state[group]));
      // Each group previews only its own dimension against a neutral baseline,
      // so its alternatives remain easy to compare as the combination changes.
      button.querySelector('.card-art').innerHTML = group === 'icon' ? symbol({ ...baseline, icon: choice.icon }) : wordmark(group === 'font' ? { ...baseline, font: choice.font } : { ...baseline, color: choice.color }, true);
    }
    document.getElementById('selected-title').textContent = `${font.name} lettering`;
    document.getElementById('comparison-label').textContent = original(state) ? 'Your combination · current' : 'Your combination';
    document.getElementById('selection').textContent = `${color.name} colours · ${icon.name} symbol`;
    document.getElementById('direction-description').textContent = `${font.description} ${color.caption}. ${icon.caption}, always on the right.`;
    document.getElementById('desktop-width').value = state.width;
    document.getElementById('one-colour').checked = state.mono;
    document.getElementById('desktop-shell').style.setProperty('--desktop-width', `${state.width}px`);
    document.querySelectorAll('[data-selected-wordmark]').forEach(target => { target.innerHTML = wordmark(state); });
    document.querySelectorAll('[data-selected-mark]').forEach(target => { target.innerHTML = symbol(state); });
    document.querySelector('[data-selected-app]').innerHTML = iconContext(state);
    document.querySelector('[data-selected-toolbar]').innerHTML = iconContext(state, true);
    const url = new URL(location.href);
    url.searchParams.delete('logo');
    for (const key of Object.keys(groups)) url.searchParams.set(key, state[key]);
    url.searchParams.set('width', state.width); url.searchParams.set('mono', state.mono ? '1' : '0');
    history.replaceState(null, '', url);
  }
  document.getElementById('desktop-width').addEventListener('change', event => { state.width = event.target.value; render(); });
  document.getElementById('one-colour').addEventListener('change', event => { state.mono = event.target.checked; render(); });
  document.getElementById('reset').addEventListener('click', () => { Object.assign(state, { ...baseline, width: '820', mono: false }); render(); });
  render();
  // The local Inter asset can finish loading after the first paint. Measure its
  // true width once it is ready so Heavy cannot be clipped by fallback metrics.
  document.fonts.ready.then(render);
})();
