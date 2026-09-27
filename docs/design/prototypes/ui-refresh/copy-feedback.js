(() => {
  const hub = document.querySelector('#hub');
  const picker = document.querySelector('#copy-options');
  const note = document.querySelector('#copy-note');
  if (!hub || !picker) return;

  const options = [
    ['today', 'Today', 'A green check pops in and “Copied” rises into place.'],
    ['draw', 'Draw the check', 'The check draws itself; the label changes quietly.'],
    ['flip', 'Label flip', 'The label turns over like a small departure-board tile.'],
    ['ring', 'Soft ring', 'A fine green ring briefly expands around the action.'],
    ['underline', 'Underline finish', 'A green underline draws across to confirm the click.'],
    ['fade', 'Quiet crossfade', 'The icon and label gently fade to their confirmation.'],
    ['press', 'Gentle press', 'A small press and release, then a still green check.'],
    ['stack', 'Sheets snap', 'A second sheet slides into a neat copied stack.', true],
    ['clipboard', 'Into clipboard', 'A small page lands inside a clipboard.', true],
    ['echo', 'Link echo', 'The link sends out two fine rings as the label confirms.', true],
    ['float', 'Floating label', '“Copied” floats above the unchanged Copy link action.', true],
    ['sweep', 'Light sweep', 'A soft highlight crosses the action and leaves “Copied”.', true],
  ];
  const requested = new URLSearchParams(location.search).get('copy');
  let selected = options.some(([key]) => key === requested) ? requested : 'stack';
  const timers = new Map();
  const link = '<svg class="cf-link" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)"/></svg>';
  const check = '<svg class="cf-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  const stack = '<span class="cf-new-art cf-art-stack"><svg viewBox="0 0 24 24"><rect class="cf-stack-back" x="3" y="3" width="12" height="14" rx="1.5"/><rect class="cf-stack-front" x="8" y="7" width="12" height="14" rx="1.5"/></svg></span>';
  const clipboard = '<span class="cf-new-art cf-art-clipboard"><svg viewBox="0 0 24 24"><path d="M8 5H5v16h14V5h-3"/><rect x="8" y="2" width="8" height="5" rx="1.5"/><g class="cf-flying-page"><path d="M8 10h8v8H8z"/><path d="M10 13h4m-4 2h4"/></g></svg></span>';
  const echo = '<span class="cf-new-art cf-art-echo"><i></i><i></i></span>';

  function initialize(button) {
    if (button.classList.contains('cf-button')) return;
    button.type = 'button';
    button.classList.add('cf-button');
    button.setAttribute('aria-label', 'Copy link, preview only');
    button.innerHTML = `<span class="cf-symbol" aria-hidden="true">${link}${check}${stack}${clipboard}${echo}</span><span class="cf-label" aria-hidden="true"><span class="cf-original">Copy link</span><span class="cf-done">Copied</span></span><span class="cf-ring" aria-hidden="true"></span><span class="cf-float" aria-hidden="true">Copied</span><span class="cf-wash" aria-hidden="true"></span><span class="cf-announcement" role="status" aria-live="polite"></span>`;
  }

  function resetButton(button) {
    const timer = timers.get(button);
    if (timer) clearTimeout(timer);
    timers.delete(button);
    button.classList.remove('cf-copied');
    const announcement = button.querySelector('.cf-announcement');
    if (announcement) announcement.textContent = '';
  }

  function confirm(button) {
    initialize(button);
    resetButton(button);
    // Re-enter the CSS animation immediately, including on repeated clicks.
    void button.offsetWidth;
    button.classList.add('cf-copied');
    button.querySelector('.cf-announcement').textContent = 'Copied. Preview only; the clipboard was not changed.';
    timers.set(button, setTimeout(() => resetButton(button), 1600));
  }

  function render(remember = false) {
    hub.dataset.copy = selected;
    for (const button of picker.querySelectorAll('button[data-copy-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.copyChoice === selected));
    }
    for (const button of document.querySelectorAll('button[data-copy-action]')) {
      initialize(button);
      resetButton(button);
    }
    const [key, name, description] = options.find(([key]) => key === selected);
    if (note) note.textContent = `${name}: ${description} Click Copy link in the preview to try it. Nothing is written to your clipboard.`;
    if (remember) {
      const url = new URL(location.href);
      url.searchParams.set('copy', selected);
      history.replaceState(null, '', url);
    }
    document.dispatchEvent(new CustomEvent('copy-study-change', { detail: { name, key } }));
  }

  picker.innerHTML = options.map(([key, name, description, noCheck], index) => `<button type="button" data-copy-choice="${key}" aria-pressed="false"><span>${index + 1} · ${name}</span><small>${description}</small>${noCheck ? '<em class="cf-option-new">New · no checkmark</em>' : ''}</button>`).join('');
  picker.addEventListener('click', event => {
    const button = event.target.closest('button[data-copy-choice]');
    if (!button) return;
    selected = button.dataset.copyChoice;
    render(true);
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-copy-action]');
    if (button) { event.preventDefault(); confirm(button); }
  });
  document.addEventListener('design-study-reset', () => { selected = 'today'; render(true); });
  render();
})();
