import { mountLogo, animateLogo, stopLogo, LEAD_FINISH_MS } from './logo-entrance-motion.js';

const options = [
  { id: 'current', name: 'Current', caption: 'Instant. Your baseline.', description: 'The original logo appears immediately, as it does today.' },
  { id: 'lift', name: 'Soft rise', caption: 'A gentle lift into focus.', description: 'The whole logo rises a little and comes into focus, then rests. Quiet and quick.' },
  { id: 'light', name: 'Light wipe', caption: 'Uncover, then a glint.', description: 'A left-to-right reveal uncovers the artwork. A soft glint follows across the original lettering and arrow.' },
  { id: 'lead', name: 'Arrow leads', caption: 'Reveal, settle, shimmer.', description: 'The arrow reveals the text and settles. A soft shimmer crosses the finished logo, which lingers before moving into the header.' },
  { id: 'assemble', name: 'Word build', caption: 'Vid. Snag. Arrow.', description: 'Vid slides in, Snag rises to meet it, and the arrow settles into place. Three beats, one familiar logo.' },
  { id: 'shutters', name: 'Shutters', caption: 'Eight slices open in turn.', description: 'Narrow shutters open across the original artwork, joining into the complete logo.' },
];
const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
let selection = options.find(option => option.id === params.get('reveal')) || options[3];
let placement = params.get('placement') === 'header' ? 'header' : 'center';
let pace = [0.8, 1, 1.4].includes(Number(params.get('pace'))) ? Number(params.get('pace')) : 1;
let reduce = params.get('reduced') === '1';
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
const header = $('#header-logo');
const floating = $('#floating-logo');
const app = $('#app-window');
const body = $('#app-body');
const library = $('#library');
const miniLogos = [];
let run = 0;
let transitions = [];
const reduced = () => reduce || systemMotion.matches;

options.forEach((option, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'choice';
  button.dataset.reveal = option.id;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', `${index} · ${option.name}. ${option.caption}`);
  button.innerHTML = `<span class="choice-number">0${index}</span><span class="choice-dot" aria-hidden="true"></span><span class="choice-art" aria-hidden="true"></span><span class="choice-title">${option.name}</span><span class="choice-caption">${option.caption}</span>`;
  const logo = button.querySelector('.choice-art');
  mountLogo(logo);
  miniLogos.push(logo);
  const preview = () => animateLogo(logo, { variant: option.id, duration: 1000, reducedMotion: reduced() });
  button.addEventListener('pointerenter', preview);
  button.addEventListener('focus', preview);
  button.addEventListener('pointerleave', () => stopLogo(logo));
  button.addEventListener('blur', () => stopLogo(logo));
  button.addEventListener('click', () => { selection = option; update(); play(); });
  $('#choices').append(button);
});
mountLogo(header);
mountLogo(floating);

function update() {
  document.querySelectorAll('[data-reveal]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.reveal === selection.id)));
  document.querySelectorAll('[data-placement]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.placement === placement)));
  $('#selected-title').textContent = `${options.indexOf(selection)} · ${selection.name}`;
  $('#description').textContent = selection.description;
  $('#pace').value = String(pace);
  $('#reduced').checked = reduced();
  $('#reduced').disabled = systemMotion.matches;
  $('#reduced').title = systemMotion.matches ? 'Enabled by your device’s motion preference' : 'Preview without movement';
  const time = selection.id === 'current' || reduced() ? 0 : (1200 + (selection.id === 'lead' ? LEAD_FINISH_MS : 0) + (placement === 'center' ? 500 : 0)) * pace;
  $('#duration').textContent = time ? `${(time / 1000).toFixed(2)}s · one pass` : 'Instant';
  $('#sequence-middle').innerHTML = placement === 'center' ? '<i>2</i> Settle into the header' : '<i>2</i> Stay in the header';
  $('#selection-summary').textContent = `${selection.name} · ${placement === 'center' ? 'Center → header' : 'In the header'} · ${$('#pace').selectedOptions[0].textContent}`;
  const url = new URL(location.href);
  url.search = new URLSearchParams({ reveal: selection.id, placement, pace: String(pace), reduced: reduce ? '1' : '0' }).toString();
  history.replaceState(null, '', url);
}

function resetStage() {
  transitions.forEach(animation => animation.cancel());
  transitions = [];
  stopLogo(header);
  stopLogo(floating);
  floating.hidden = true;
  header.style.visibility = 'visible';
  body.style.opacity = '1';
}

function transition(element, frames, timing) {
  const animation = element.animate(frames, { fill: 'both', ...timing });
  transitions.push(animation);
  return animation.finished.catch(() => {});
}

async function play() {
  const token = ++run;
  resetStage();
  app.dataset.state = 'playing';
  $('#playback-status').textContent = 'Opening…';
  if (selection.id !== 'current' && !reduced()) {
    if (placement === 'center') {
      const bounds = app.getBoundingClientRect();
      const target = header.getBoundingClientRect();
      const width = Math.min(280, bounds.width - 64);
      const height = width * 164 / 830;
      const start = `translate(${(app.clientWidth - width) / 2}px, ${(app.clientHeight - height) / 2 + 10}px) scale(1)`;
      const end = `translate(${target.left - bounds.left - app.clientLeft}px, ${target.top - bounds.top - app.clientTop}px) scale(${target.width / width})`;
      floating.style.width = `${width}px`;
      floating.style.transform = start;
      floating.hidden = false;
      header.style.visibility = 'hidden';
      body.style.opacity = '0';
      await animateLogo(floating, { variant: selection.id, duration: 1200 * pace });
      if (token !== run) return;
      $('#playback-status').textContent = 'Settling into place…';
      await Promise.all([
        transition(floating, [{ transform: start }, { transform: end }], { duration: 500 * pace, easing: 'cubic-bezier(.65, 0, .2, 1)' }),
        transition(body, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 * pace, delay: 100 * pace, easing: 'ease-out' }),
      ]);
    } else {
      await Promise.all([
        animateLogo(header, { variant: selection.id, duration: 1200 * pace }),
        transition(library, [{ opacity: 0 }, { opacity: 1 }], { duration: 450 * pace, easing: 'ease-out' }),
      ]);
    }
  }
  if (token !== run) return;
  resetStage();
  app.dataset.state = 'ready';
  $('#playback-status').textContent = reduced() ? 'Ready · reduced motion' : 'Ready to use';
}

$('#replay').addEventListener('click', play);
$('#placement').addEventListener('click', event => {
  const button = event.target.closest('[data-placement]');
  if (!button) return;
  placement = button.dataset.placement;
  update(); play();
});
$('#pace').addEventListener('change', event => { pace = Number(event.target.value); update(); play(); });
$('#reduced').addEventListener('change', event => {
  reduce = event.target.checked;
  miniLogos.forEach(stopLogo);
  update(); play();
});
$('#reset').addEventListener('click', () => { selection = options[0]; placement = 'header'; pace = 1; reduce = false; update(); play(); });
$('#choices').addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || !/^[0-5]$/.test(event.key)) return;
  event.preventDefault();
  const button = $('#choices').children[Number(event.key)];
  button.focus(); button.click();
});
systemMotion.addEventListener('change', () => { miniLogos.forEach(stopLogo); update(); play(); });
window.addEventListener('resize', () => { if (app.dataset.state === 'playing') play(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  ++run;
  resetStage();
  miniLogos.forEach(stopLogo);
  app.dataset.state = 'ready';
  $('#playback-status').textContent = 'Ready to replay';
});
update();
await Promise.all([header, floating].map(host => host.querySelector('img').decode().catch(() => {})));
play();
