(() => {
  const MEDIA = '../../../../apps/extension/popup/media/';
  const P = {
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>', external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>', right: '<path d="m9 18 6-6-6-6"/>', play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    folderopen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', listx: '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="m19 10-4 4"/><path d="m15 10 4 4"/>',
    quality: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>', subs: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 15h4"/><path d="M15 15h2"/><path d="M7 11h2"/><path d="M13 11h4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>', sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  };
  const icon = (n, c = '') => `<svg class="icon ${c}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const thumb = m => `<div class="thumb"><img src="${MEDIA}${m}.jpg" alt=""></div>`;
  const STUDIES = {
    links: [['today', 'Today', 'Grey hover; copying shows a toast'], ['text', 'Orange text', 'Turns orange; label flips to a green “Copied”'], ['tint', 'Tinted pill', 'Orange-tinted pill; turns green with a check'], ['under', 'Underline', 'Orange with a line that draws in'], ['sweep', 'Sweep fill', 'Fills orange from the left; green “Copied”'], ['bubble', 'Bubble', 'A small “Copied” bubble floats up from the button'], ['burst', 'Burst', 'Check pops in with a ring of light']],
    icons: [['today', 'Today', 'Grey square behind a white icon'], ['orange', 'Orange icon', 'Icon turns orange, nothing else'], ['tint', 'Orange tint', 'Orange icon on an orange-tinted square'], ['alive', 'Alive', 'Play nudges and fills, folder opens, dots hop'], ['disc', 'Disc', 'Orange disc springs in behind a white icon'], ['playfirst', 'Play first', 'Play is an outlined circle that fills; others tint'], ['glow', 'Glow', 'Icon grows and glows orange']],
    remove: [['today', 'Today', 'Card + red text button + Cancel'], ['duo', 'Two cards', 'Video on top; the two choices side by side with icons'], ['check', 'Checkbox', 'One confirm; tick “also move the file to Trash”'], ['inline', 'In the row', 'No dialog: the row itself asks'], ['popover', 'Popover', 'Small menu attached to the Remove button'], ['center', 'Centred sheet', 'Icon, short question, stacked buttons']],
    settings: [['today', 'Today', 'Flat rows and an Advanced accordion in both'], ['groups', 'Grouped cards', 'Titled groups with icons; popup links out instead of “Advanced”'], ['chips', 'Chips', 'Quality as one-tap chips; fewer dropdowns'], ['tabs', 'Tabs', 'General · Downloads · Advanced tabs on desktop; popup keeps essentials'], ['values', 'Value list', 'Compact rows showing the current value, like system settings']],
  };
  let hovered = null;
  for (const [id, variants] of Object.entries(STUDIES)) {
    const section = document.getElementById(id); const picker = $('.study-picker', section);
    picker.innerHTML = variants.map(([k, n, d], i) => `<button type="button" data-key="${k}" aria-pressed="${i === 0}"><span>${i + 1} · ${n}</span><small>${d}</small></button>`).join('');
    section.pick = key => { section.dataset.variant = key; $$('button', picker).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.key === key))); section.dispatchEvent(new Event('variant')); };
    picker.addEventListener('click', e => { const b = e.target.closest('button'); if (b) section.pick(b.dataset.key); });
    section.addEventListener('pointerenter', () => { hovered = section; });
  }
  addEventListener('keydown', e => { if (!hovered || e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input')) return; const v = STUDIES[hovered.id][Number(e.key) - 1]; if (v) hovered.pick(v[0]); });

  // 1 · links
  const cbtn = (kind, glyph, label) => `<button type="button" class="cbtn ${kind}">${icon(glyph, 'main')}${kind === 'copy' ? icon('check', 'ok') : ''}<span class="lab"><span class="a">${label}</span>${kind === 'copy' ? '<span class="b">Copied</span>' : ''}</span></button>`;
  $('#l-stage').innerHTML = `<div class="details v-card"><div class="icard"><button type="button" class="icard-head">${icon('folder')}<span>Saved in ~/Movies/VidSnag/<strong>Sintel</strong></span>${icon('right', 'arrow')}</button><div class="icard-body"><dl class="facts"><div><dt>Quality</dt><dd>1080p · English audio</dd></div><div><dt>Size</dt><dd>2.1 GB</dd></div><div><dt>Length</dt><dd>14:48</dd></div><div><dt>From</dt><dd>durian.blender.org</dd></div></dl></div>
    <div class="icard-foot">${cbtn('copy', 'link', 'Copy link')}${cbtn('open', 'external', 'Open page')}<span class="grow"></span><button type="button" class="tbtn danger">${icon('trash')}Remove…</button></div></div></div><div class="toast">Link copied</div>`;
  $('#l-stage').addEventListener('click', e => { const b = e.target.closest('.cbtn.copy'); if (!b || b.classList.contains('copied')) return; b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1500);
    if (document.getElementById('links').dataset.variant === 'today') { const t = $('.toast'); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1500); } });

  // 2 · icons
  const ract = (kind, soft) => `<button type="button" class="ract ${kind}${soft ? ' soft' : ''}" aria-label="${kind}">${kind === 'folder' ? `<svg class="base" viewBox="0 0 24 24">${P.folder}</svg><svg class="alt" viewBox="0 0 24 24">${P.folderopen}</svg>` : kind === 'more' ? '<svg viewBox="0 0 24 24"><circle class="dot" cx="5" cy="12" r="1"/><circle class="dot" cx="12" cy="12" r="1"/><circle class="dot" cx="19" cy="12" r="1"/></svg>' : `<svg viewBox="0 0 24 24">${P.play}</svg>`}</button>`;
  const savedRow = (m, t, d, s) => `<div class="item"><div class="row">${thumb(m)}<div class="text"><div class="heading"><span class="title">${t}</span><span class="dur">${d}</span></div><div class="status">${icon('check', 'ok')}${s}</div></div><div class="actions">${ract('folder', true)}${ract('more', true)}${ract('play')}</div></div></div>`;
  $('#i-stage').innerHTML = savedRow('big-buck-bunny', 'Big Buck Bunny', '9:56', 'Saved today · 655 MB · 1080p') + savedRow('tears-of-steel', 'Tears of Steel', '12:14', 'Saved yesterday · 2.3 GB · 2160p');

  // 3 · remove
  const vhead = `<div class="vhead">${thumb('sintel')}<div><b>Se7en</b><span>2.1 GB · saved today</span></div></div>`;
  function renderRemove() {
    const v = document.getElementById('remove').dataset.variant; let h;
    if (v === 'duo') h = `<div class="dlg"><h3>Remove this video?</h3>${vhead}<div class="duo"><button type="button" class="choice safe">${icon('listx')}<strong>Remove from list</strong><small>The file stays in your save folder</small></button><button type="button" class="choice trash">${icon('trash')}<strong>Move file to Trash</strong><small>Removes it from the list too</small></button></div><button type="button" class="ghost">Cancel</button></div>`;
    else if (v === 'check') h = `<div class="dlg">${vhead}<h3>Remove “Se7en” from VidSnag?</h3><p>The saved file stays in your folder unless you tick the box.</p><label class="checkrow"><input type="checkbox" id="also">Also move the file to Trash</label><div class="btnrow"><button type="button" class="pbtn">Cancel</button><button type="button" class="pbtn main" id="confirm">Remove from list</button></div></div>`;
    else if (v === 'inline') h = `<div class="inline-confirm"><div class="item"><div class="row">${thumb('sintel')}<div class="text"><div class="heading"><span class="title">Remove “Se7en”?</span></div><div class="status">Choose what happens to the saved file</div></div><div class="ask"><button type="button" class="pbtn">From list only</button><button type="button" class="pbtn red">${'Move file to Trash'}</button><button type="button" class="ract" aria-label="Cancel"><svg viewBox="0 0 24 24">${P.x}</svg></button></div></div></div>${savedRow('big-buck-bunny', 'Big Buck Bunny', '9:56', 'Saved today · 655 MB · 1080p')}</div>`;
    else if (v === 'popover') h = `<div class="pop-anchor"><div class="popover"><button type="button">${icon('listx')}<span><strong>Remove from list</strong><small>The file stays in your save folder</small></span></button><hr><button type="button" class="red">${icon('trash')}<span><strong>Move file to Trash</strong><small>Also removes it from the list</small></span></button></div><span class="fake">${icon('trash')}Remove…</span></div>`;
    else if (v === 'center') h = `<div class="dlg center"><div class="bigicon">${icon('trash')}</div><h3>Remove “Se7en”?</h3><p>Keep the file and just tidy the list, or move the 2.1 GB file to your Trash.</p><div class="stack"><button type="button" class="pbtn main">Remove from list</button><button type="button" class="pbtn redfill">Move file to Trash</button><button type="button" class="ghost">Cancel</button></div></div>`;
    else h = `<div class="dlg"><h3>Remove this video?</h3><p>Remove it from VidSnag, or move the saved file to your computer’s Trash.</p><div class="vt">Se7en</div><button type="button" class="choice"><strong>Remove from list</strong><small>The file stays in your save folder.</small></button><button type="button" class="choice red">Move file to Trash</button><button type="button" class="ghost">Cancel</button></div>`;
    $('#r-stage').innerHTML = h;
    const also = $('#also'); if (also) also.addEventListener('change', () => { const c = $('#confirm'); c.textContent = also.checked ? 'Move to Trash' : 'Remove from list'; c.classList.toggle('danger', also.checked); });
  }
  document.getElementById('remove').addEventListener('variant', renderRemove); renderRemove();

  // 4 · settings
  const sw = on => `<span class="sw${on ? ' on' : ''}" role="switch" tabindex="0"></span>`; const sel = t => `<span class="sel">${t}</span>`;
  const chips = `<span class="chips">${['Best', '1080p', '720p', '480p'].map((q, i) => `<button type="button" class="${i === 0 ? 'on' : ''}">${q}</button>`).join('')}</span>`;
  const head = t => `<div class="sheet-h"><span>${t}</span><button type="button" class="ract"><svg viewBox="0 0 24 24">${P.x}</svg></button></div>`;
  const row = (l, n, c, ic) => `<div class="srow">${ic ? `<span class="sico ${ic[1] || ''}">${icon(ic[0])}</span>` : ''}<div class="sd"><label>${l}</label>${n ? `<small>${n}</small>` : ''}</div>${c}</div>`;
  const change = '<button type="button" class="pbtn" style="height:28px;font-weight:500">Change</button>';
  function renderSettings() {
    const v = document.getElementById('settings').dataset.variant; let d; let p;
    if (v === 'groups') {
      const g = (t, rows) => `<div class="sgroup-t">${t}</div><div class="sgroup">${rows}</div>`;
      d = head('Settings') + `<div class="spad">${g('Downloads', row('Save videos to', '~/Movies/VidSnag', change, ['folder', 'o']) + row('Preferred quality', 'Used when a video offers it', sel('Best'), ['quality']) + row('Subtitles', 'Included when available', sel('English'), ['subs']))}${g('App', row('Tell me when a download finishes', '', sw(true), ['bell']) + row('Start VidSnag when I log in', '', sw(false), ['power']))}${g('More', `<div class="vrow">${`<span class="sico">${icon('sliders')}</span>`}Advanced<span class="val">Speed, naming, accounts, updates${icon('right')}</span></div>`)}</div>`;
      p = head('Settings') + `<div class="spad">${g('This browser', row('Preferred quality', '', sel('Best'), ['quality']) + row('Subtitles', '', sel('English'), ['subs']) + row('Tell me when a download finishes', '', sw(true), ['bell']))}<a class="linkrow">${icon('external')}<span>Folder, speed and more live in the VidSnag app</span>${icon('right')}</a></div>`;
    } else if (v === 'chips') {
      d = head('Settings') + `<div class="srow stack"><label>Preferred quality</label><small>Used when a video offers it</small>${chips}</div>` + row('Save videos to', '~/Movies/VidSnag', change) + row('Subtitles', 'Included when available', sel('English')) + row('Tell me when a download finishes', '', sw(true)) + row('Start VidSnag when I log in', '', sw(false)) + `<div class="adv">${icon('right')}Advanced</div>`;
      p = head('Settings') + `<div class="srow stack"><label>Preferred quality</label>${chips}</div>` + row('Subtitles', '', sel('English')) + row('Tell me when a download finishes', '', sw(true)) + `<a class="linkrow">${icon('external')}<span>More settings in the VidSnag app</span>${icon('right')}</a>`;
    } else if (v === 'tabs') {
      d = head('Settings') + `<div class="stabs"><button type="button" class="on">General</button><button type="button">Downloads</button><button type="button">Advanced</button></div>` + row('Save videos to', '~/Movies/VidSnag', change) + row('Preferred quality', 'Used when a video offers it', sel('Best')) + row('Subtitles', 'Included when available', sel('English')) + row('Tell me when a download finishes', '', sw(true)) + row('Start VidSnag when I log in', '', sw(false));
      p = head('Quick settings') + row('Preferred quality', '', sel('Best')) + row('Subtitles', '', sel('English')) + `<a class="linkrow">${icon('external')}<span>All settings open in the VidSnag app</span>${icon('right')}</a>`;
    } else if (v === 'values') {
      const vr = (l, val) => `<div class="vrow">${l}<span class="val">${val}${icon('right')}</span></div>`; const vs = (l, on) => `<div class="vrow">${l}${sw(on)}</div>`;
      d = head('Settings') + vr('Save videos to', '~/Movies/VidSnag') + vr('Preferred quality', 'Best') + vr('Subtitles', 'English') + vs('Tell me when a download finishes', true) + vs('Start VidSnag when I log in', false) + vr('Advanced', 'Speed, naming, updates');
      p = head('Settings') + vr('Preferred quality', 'Best') + vr('Subtitles', 'English') + vs('Tell me when a download finishes', true) + vr('More in the VidSnag app', '');
    } else {
      const rows = row('Save videos to', '~/Movies/VidSnag', change) + row('Preferred quality', 'Used when a video offers it', sel('Best')) + row('Subtitles', 'Included when available', sel('English')) + row('Tell me when a download finishes', '', sw(true)) + row('Start VidSnag when I log in', '', sw(false));
      d = head('Settings') + rows + `<div class="adv">${icon('right')}Advanced</div>`;
      p = head('Settings') + rows + `<div class="adv" style="color:var(--fg)">${icon('right')}Advanced</div><div class="adv-body">Speed, file naming, metadata and subtitle accounts, updates, and diagnostics are managed in VidSnag.<br><button type="button" class="pbtn">Open Advanced settings</button></div>`;
    }
    $('#s-desk').innerHTML = d; $('#s-pop').innerHTML = p;
  }
  document.getElementById('settings').addEventListener('variant', renderSettings); renderSettings();
  document.getElementById('settings').addEventListener('click', e => { const s = e.target.closest('.sw'); if (s) s.classList.toggle('on'); const c = e.target.closest('.chips button, .stabs button'); if (c) { $$('button', c.parentElement).forEach(o => o.classList.toggle('on', o === c)); } });
})();
