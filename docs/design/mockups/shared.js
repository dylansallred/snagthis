// Icon sprite + tiny simulated-download behaviour shared by all concepts. Nothing is fetched.
const ICONS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.8-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1.1z"/>',
  queue: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 19h16"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
  app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  updown: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M3 4v6h6M21 20v-6h-6"/><path d="M20 10a8 8 0 0 0-14.5-3L3 10m1 4a8 8 0 0 0 14.500 3L21 14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700L12 6.300M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  alert: '<path d="M12 4 2.500 20h19zM12 10v4m0 3h.01"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="16.500" cy="16" r="2.500"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.500a2 2 0 1 0 0 3m6-3a2 2 0 1 0 0 3"/>',
  reveal: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
sprite.setAttribute('style', 'display:none');
sprite.innerHTML = Object.entries(ICONS)
  .map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('');
document.body.prepend(sprite);

// <i data-i="gear"></i> -> svg
document.querySelectorAll('[data-i]').forEach((el) => {
  el.outerHTML = `<svg class="ic ${el.className}" aria-hidden="true"><use href="#i-${el.dataset.i}"/></svg>`;
});

// Simulated download: any [data-dl] inside a [data-card] swaps the card into its "running" state.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dl]');
  if (!btn) return;
  const card = btn.closest('[data-card]');
  if (!card || card.dataset.state === 'running') return;
  card.dataset.state = 'running';
  if (btn.dataset.dl) card.querySelectorAll('[data-q]').forEach((q) => (q.textContent = btn.dataset.dl));
  let p = 0;
  const bars = [card, ...card.querySelectorAll('[data-bar]')];
  const pct = card.querySelector('[data-pct]');
  const tick = setInterval(() => {
    p = Math.min(100, p + 1.5 + Math.random() * 3);
    bars.forEach((b) => b.style.setProperty('--p', p + '%'));
    if (pct) pct.textContent = Math.floor(p) + '%';
    if (p >= 100) { clearInterval(tick); card.dataset.state = 'done'; }
  }, 120);
});
