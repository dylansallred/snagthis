(() => {
  const MEDIA = '../../../../apps/extension/popup/media/';
  const LOGO = '../../../../apps/extension/img/vidsnag-logo-title.png';
  const TOTAL_MB = 2100;
  const SPEED = 4.1;
  const PIECES = 280;

  const PATHS = {
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
  };
  const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;

  const JOBS = [
    { id: 'j1', live: true, title: 'Sintel', media: 'sintel', dur: '14:48', quality: '1080p', host: 'durian.blender.org', folder: 'Sintel', size: '2.1 GB', when: 'today' },
    { id: 'j2', state: 'waiting', title: 'Tears of Steel', media: 'tears-of-steel', dur: '12:14', quality: '1080p', host: 'mango.blender.org', folder: 'Tears of Steel' },
    { id: 's1', state: 'saved', title: 'Big Buck Bunny', media: 'big-buck-bunny', dur: '9:56', quality: '1080p', host: 'peach.blender.org', folder: 'Big Buck Bunny', size: '655 MB', when: 'today' },
    { id: 's2', state: 'saved', title: 'Tears of Steel: Director’s Commentary', media: 'tears-of-steel', dur: '12:14', quality: '2160p', host: 'mango.blender.org', folder: 'Tears of Steel Directors Commentary', size: '2.3 GB', when: 'yesterday' },
    { id: 's3', state: 'saved', title: 'Sintel: Behind the Scenes', media: 'sintel', dur: '26:02', quality: '720p', host: 'durian.blender.org', folder: 'Sintel Behind the Scenes', size: '412 MB', when: 'Tuesday' },
    { id: 's4', state: 'saved', title: 'Big Buck Bunny (60 fps)', media: 'big-buck-bunny', dur: '9:56', quality: '1080p', host: 'peach.blender.org', folder: 'Big Buck Bunny (60 fps)', size: '1.1 GB', when: '12 Sep' },
    { id: 's5', state: 'saved', title: 'Tears of Steel', media: 'tears-of-steel', dur: '12:14', quality: '720p', host: 'mango.blender.org', folder: 'Tears of Steel (2)', size: '318 MB', when: '9 Sep' },
  ];
  const PAGE = [
    { id: 'p1', title: 'Sintel: Open Movie by the Blender Foundation', media: 'sintel', quality: '2160p', size: '21.0 GB', dur: '14:48' },
    { id: 'p2', title: 'Tears of Steel', media: 'tears-of-steel', quality: '1080p', size: '1.4 GB', dur: '12:14' },
    { id: 'p3', title: 'Big Buck Bunny', media: 'big-buck-bunny', quality: '720p', size: '182 MB', dur: '9:56' },
  ];

  const NOTES = {
    a: {
      changes: [
        'Popup: slightly smaller thumbnail and a two-line title, so “Spider-Man: Across the …” is readable; quality, size and duration share one evenly spaced line that no longer truncates the size.',
        'Saved rows: the green badge on every row becomes a small check in the status line, plus the quality so duplicate titles can be told apart.',
        'The Pieces lane and the Pieces map now share one palette (today the lane is muted green and the map is vivid green and orange).',
        'An open row gets a slim orange edge and one continuous surface, so the row and its details read as a single unit.',
        'Folder path uses ~ for the home folder and emphasises the final folder name; paste field shows a ⌘V hint.',
      ],
      departs: ['Nothing structural. Home folder shown as ~ rather than /Users/name (path is still complete).'],
    },
    b: {
      changes: [
        'Everything in A, plus: anything that is downloading, paused or needs you sits in its own card with a larger thumbnail and a large percentage, so the thing you are waiting on is obvious at a glance.',
        'Saved videos collapse into a compact, quiet group beneath, fitting more history on screen.',
        'Popup: when the page has one video (the common case) it becomes a hero with a full-width preview and a labelled Download button. With several videos it falls back to compact cards.',
      ],
      departs: [
        'Two row sizes instead of “same row everywhere”, and a small “Saved” label (the spec says no section headers).',
        'Popup Download is a labelled full-width button in the single-video case rather than a 30 px icon.',
      ],
    },
    c: {
      changes: [
        'Everything in A, plus: saved videos become a poster grid, like a media library. Hovering still plays the clip; nothing covers the image.',
        'Active downloads stay as compact rows on top, with the Pieces lane.',
        'Clicking a poster opens a docked details bar above the footer instead of expanding inline, so the grid never reflows.',
        'Popup: several videos show as a two-up grid with larger previews; one video fills the width.',
      ],
      departs: [
        'Largest change: saved items are tiles, not rows, so desktop and popup no longer share one row component for saved state.',
        'Play appears on hover in tiles (click opens details). In the two-up popup grid, duration is hidden to keep the line short.',
      ],
    },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const hub = $('#hub');
  // hover.html starts collapsed with three popup videos so more rows are available to hover.
  const ui = { design: hub.dataset.design || 'a', state: 'downloading', progress: 34, tab: 'all', expanded: 'expanded' in hub.dataset ? hub.dataset.expanded || null : 'j1', count: Number(hub.dataset.count) || 1, sent: new Set(['p2']) };

  const stateOf = job => (job.live ? ui.state : job.state);
  const isActive = job => stateOf(job) !== 'saved';

  function thumb(media) {
    return `<div class="thumb"><img src="${MEDIA}${media}.jpg" alt=""><video muted loop playsinline preload="none" src="${MEDIA}${media}.mp4"></video></div>`;
  }
  const lane = state => `<div class="lane${state === 'downloading' ? ' live' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100">${'<i></i>'.repeat(40)}</div>`;

  function statusLine(job) {
    const state = stateOf(job);
    if (state === 'downloading') return '<div class="status"><b data-pct></b><span class="sep">·</span><span data-eta></span></div>';
    if (state === 'paused') return '<div class="status">Paused at&nbsp;<b data-pct></b></div>';
    if (state === 'attention') return '<div class="status attention"><span>Link expired. Reopen the page to continue from <span data-pct></span>.</span></div>';
    if (state === 'waiting') return '<div class="status">Waiting · starts next</div>';
    return `<div class="status">${icon('check', 'ok')}Saved ${job.when} · ${job.size} · ${job.quality}</div>`;
  }

  function primaryAction(job) {
    const state = stateOf(job);
    if (state === 'downloading') return `<button type="button" class="act" aria-label="Pause">${icon('pause')}</button>`;
    if (state === 'paused') return `<button type="button" class="act" aria-label="Resume">${icon('play')}</button>`;
    if (state === 'attention') return '<button type="button" class="act bordered">Open page</button>';
    if (state === 'saved') return `<button type="button" class="act" aria-label="Play">${icon('play')}</button>`;
    return '';
  }

  function details(job) {
    const state = stateOf(job);
    const saved = state === 'saved';
    const live = ['downloading', 'paused', 'attention'].includes(state);
    const size = saved ? job.size : live ? `<span data-got></span>${state === 'downloading' ? ` · ${SPEED} MB/s` : ''}` : 'Total unknown';
    const third = saved ? ['Length', job.dur] : ['Connections', state === 'downloading' ? '6 of 16 active' : 'None active'];
    return `<div class="details"><div class="details-main">
      <dl class="facts">
        <div><dt>Quality</dt><dd>${job.quality} · English audio</dd></div>
        <div><dt>Size</dt><dd>${size}</dd></div>
        <div><dt>${third[0]}</dt><dd>${third[1]}</dd></div>
        <div><dt>From</dt><dd>${job.host}</dd></div>
      </dl>
      <div class="detail-actions">
        <button type="button" aria-label="Copy link" title="Copy link">${icon('link')}</button>
        <button type="button" aria-label="Open page" title="Open page">${icon('external')}</button>
        <button type="button" class="danger" aria-label="${saved ? 'Remove' : 'Cancel download'}" title="${saved ? 'Remove…' : 'Cancel download'}">${icon('x')}</button>
      </div>
      <button type="button" class="location">${icon('folder')}
        <span class="location-copy"><small>${saved ? 'Saved in' : 'Saving to'}</small><span>~/Movies/VidSnag/<strong>${job.folder}</strong></span></span>${icon('right', 'arrow')}
      </button>
    </div>${live ? `<div class="pieces">
      <div class="pieces-caption"><span>Pieces</span><span data-pieces></span></div>
      <div class="map${state === 'downloading' ? ' live' : ''}">${'<i></i>'.repeat(PIECES)}</div>
      <div class="legend"><span><i style="background:var(--piece-done)"></i>Completed</span><span><i style="background:var(--piece-now)"></i>Downloading</span><span><i style="background:hsl(44 88% 58%)"></i>Retrying</span><span><i style="background:#2a3039"></i>Pending</span></div>
    </div>` : ''}</div>`;
  }

  function row(job) {
    const state = stateOf(job);
    const open = ui.expanded === job.id;
    const hasLane = ['downloading', 'paused', 'attention'].includes(state);
    return `<div class="item${open ? ' expanded' : ''}">
      <div class="row preview-host" tabindex="0" data-id="${job.id}" aria-expanded="${open}">
        ${thumb(job.media)}
        <div class="text"><div class="heading"><span class="title">${job.title}</span><span class="dur">${job.dur}</span></div>${statusLine(job)}</div>
        <div class="actions">
          ${state === 'saved' ? `<button type="button" class="act hover-only" aria-label="Show in folder">${icon('folder')}</button>` : ''}
          <button type="button" class="act hover-only" aria-label="More">${icon('more')}</button>
          ${primaryAction(job)}
        </div>
        ${hasLane ? lane(state) : ''}
      </div>
      ${open ? details(job) : ''}
    </div>`;
  }

  function tile(job) {
    return `<div class="tile preview-host${ui.expanded === job.id ? ' selected' : ''}" tabindex="0" role="button" data-id="${job.id}">
      ${thumb(job.media)}
      <div class="cap"><div class="text"><div class="heading"><span class="title">${job.title}</span><span class="dur">${job.dur}</span></div>
      <div class="status">${icon('check', 'ok')}${job.when} · ${job.size}</div></div>
      <button type="button" class="act hover-only" aria-label="Play">${icon('play')}</button></div>
    </div>`;
  }

  function renderDesktop() {
    const visible = JOBS.filter(job => ui.tab === 'all' || (ui.tab === 'downloading') === isActive(job));
    const active = visible.filter(isActive);
    const saved = visible.filter(job => !isActive(job));
    let body;
    let inspector = '';
    if (!visible.length) {
      body = `<div class="empty-note">${ui.tab === 'downloading' ? 'Nothing downloading' : 'No saved videos yet'}</div>`;
    } else if (ui.design === 'b') {
      const waiting = active.filter(job => stateOf(job) === 'waiting');
      body = active.filter(job => stateOf(job) !== 'waiting').map(job => `<div class="group active">${row(job)}</div>`).join('')
        + (waiting.length ? `<div class="group compact">${waiting.map(row).join('')}</div>` : '')
        + (saved.length ? `${active.length ? '<div class="group-label">Saved</div>' : ''}<div class="group compact">${saved.map(row).join('')}</div>` : '');
    } else if (ui.design === 'c') {
      body = (active.length ? `<div class="active-rows">${active.map(row).join('')}</div>` : '')
        + (saved.length ? `<div class="tiles">${saved.map(tile).join('')}</div>` : '');
      const picked = saved.find(job => job.id === ui.expanded);
      if (picked) {
        inspector = `<div class="inspector"><div class="inspector-title"><span class="title">${picked.title}</span><button type="button" class="icon-button" data-close aria-label="Close details">${icon('x')}</button></div>${details(picked)}</div>`;
      }
    } else {
      body = visible.map(row).join('');
    }
    const downloading = ui.state === 'downloading';
    const tabs = [['all', 'All'], ['downloading', 'Downloading'], ['saved', 'Saved']];
    $('#desktop').innerHTML = `
      <div class="top-bar"><img class="wordmark" src="${LOGO}" alt="VidSnag">
        <div class="paste-field">${icon('link')}<span>Paste a video link</span><kbd>⌘V</kbd></div>
        <div class="list-tabs">${tabs.map(([key, label]) => `<button type="button" data-tab="${key}" aria-pressed="${ui.tab === key}">${label}</button>`).join('')}</div>
        <button type="button" class="icon-button" aria-label="Search">${icon('search')}</button>
      </div>
      <div class="content">${body}</div>${inspector}
      <div class="app-footer"><span>${downloading ? `1 downloading · ${SPEED} MB/s` : 'Saving to Movies/VidSnag'}</span>
        <button type="button" class="icon-button" aria-label="Open save folder">${icon('folder')}</button>
        <button type="button" class="icon-button" aria-label="Settings">${icon('settings')}</button>
      </div>`;
  }

  function popupRow(video) {
    const sent = ui.sent.has(video.id);
    const state = sent ? ui.state : 'detected';
    let meta;
    let action;
    if (state === 'detected') {
      meta = `<div class="pmeta"><button type="button" class="quality">${video.quality}${icon('down')}</button><span class="dot">·</span><span>${video.size}</span><span class="dot duration-dot">·</span><span class="duration">${video.dur}</span></div>`;
      action = `<button type="button" class="act primary" data-send="${video.id}" aria-label="Download" title="Download">${icon('download')}<span class="label">Download</span></button>`;
    } else if (state === 'downloading') {
      meta = '<div class="pmeta"><b data-pct></b><span class="dot">·</span><span data-eta></span></div>';
      action = `<button type="button" class="act" aria-label="Pause">${icon('pause')}<span class="label">Pause</span></button>`;
    } else if (state === 'paused') {
      meta = '<div class="pmeta">Paused at <b data-pct></b></div>';
      action = `<button type="button" class="act" aria-label="Resume">${icon('play')}<span class="label">Resume</span></button>`;
    } else if (state === 'attention') {
      meta = '<div class="pmeta attention"><span>Link expired. Reopen the page to continue from <span data-pct></span>.</span></div>';
      action = '<button type="button" class="act bordered">Open page</button>';
    } else {
      meta = '<div class="pmeta success">Saved</div>';
      action = `<button type="button" class="act bordered">${icon('play')}Play</button>`;
    }
    const body = `<div class="pbody"><div class="ptitle">${video.title}</div>${meta}</div>`;
    const progress = ['downloading', 'paused', 'attention'].includes(state) ? lane(state) : '';
    const inner = ui.design === 'c'
      ? `${thumb(video.media)}<div class="cap">${body}${action}</div>${progress}`
      : `${thumb(video.media)}${body}${action}${progress}`;
    return `<div class="prow preview-host">${inner}</div>`;
  }

  function renderPopup() {
    const videos = PAGE.slice(0, ui.count);
    const busy = videos.filter(video => ui.sent.has(video.id) && ui.state !== 'saved').length;
    $('#popup').innerHTML = `
      <div class="popup-header"><img class="wordmark" src="${LOGO}" alt="VidSnag"><span>${videos.length === 1 ? '1 video on this page' : `${videos.length} videos on this page`}</span></div>
      <div class="plist ${videos.length === 1 ? 'single' : 'multi'}">${videos.map(popupRow).join('')}</div>
      <div class="popup-footer"><button type="button" class="act" aria-label="Settings">${icon('settings')}</button><button type="button" class="act">No video?</button><span class="spacer"></span>
        <button type="button" class="act">Open VidSnag${busy ? ` <span class="badge">${busy}</span>` : ''}</button></div>`;
  }

  function renderNotes() {
    const note = NOTES[ui.design];
    $('#notes').innerHTML = `<article><h3>What changes</h3><ul>${note.changes.map(text => `<li>${text}</li>`).join('')}</ul></article>
      <article class="departs"><h3>Where it departs from the current spec</h3><ul>${note.departs.map(text => `<li>${text}</li>`).join('')}</ul></article>`;
  }

  function eta(progress) {
    const seconds = ((100 - progress) / 100) * TOTAL_MB / SPEED;
    if (seconds < 60) return 'under a minute left';
    return `${Math.round(seconds / 60)} min left`;
  }

  function paintProgress() {
    const p = ui.progress;
    $$('[data-pct]').forEach(el => { el.textContent = `${Math.floor(p)}%`; });
    $$('[data-eta]').forEach(el => { el.textContent = eta(p); });
    $$('[data-got]').forEach(el => { el.textContent = `${Math.round(p / 100 * TOTAL_MB)} MB / ~2.1 GB`; });
    $$('.lane').forEach(el => {
      const cells = [...el.children].filter(cell => getComputedStyle(cell).display !== 'none').length || 40;
      const done = Math.floor(p / 100 * cells);
      el.setAttribute('aria-valuenow', String(Math.floor(p)));
      [...el.children].forEach((cell, i) => { cell.className = i < done ? 'done' : i === done ? 'now' : ''; });
    });
    const donePieces = Math.floor(p / 100 * PIECES);
    $$('.map').forEach(el => {
      const live = el.classList.contains('live');
      [...el.children].forEach((cell, i) => {
        const ahead = i - donePieces;
        cell.className = i < donePieces ? 'done' : live && ahead < 8 ? (ahead === 2 || ahead === 5 ? 'retry' : 'now') : '';
      });
    });
    $$('[data-pieces]').forEach(el => { el.textContent = `${donePieces} of ${PIECES}${ui.state === 'downloading' ? ' · 2 retrying' : ''}`; });
  }

  function render() {
    hub.dataset.design = ui.design;
    renderDesktop();
    renderPopup();
    paintProgress();
  }

  // Hover/focus previews: play only while the pointer or focus is on the row.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function preview(host, on) {
    const video = host && $('video', host);
    if (!video) return;
    if (on && !reduced.matches) {
      host.classList.add('previewing');
      video.play().catch(() => host.classList.remove('previewing'));
    } else {
      host.classList.remove('previewing');
      video.pause();
    }
  }
  for (const [type, on] of [['mouseover', true], ['mouseout', false], ['focusin', true], ['focusout', false]]) {
    document.addEventListener(type, event => {
      const host = event.target.closest?.('.preview-host');
      if (!host || (event.relatedTarget && host.contains(event.relatedTarget))) return;
      preview(host, on);
    });
  }

  document.addEventListener('click', event => {
    const target = event.target;
    const design = target.closest('.design-tabs button');
    if (design) {
      ui.design = design.dataset.design;
      $$('.design-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button === design)));
      renderNotes();
      return render();
    }
    const count = target.closest('[data-count]:is(button)');
    if (count) {
      ui.count = Number(count.dataset.count);
      $$('.segmented button').forEach(button => button.setAttribute('aria-pressed', String(button === count)));
      return render();
    }
    const tab = target.closest('[data-tab]');
    if (tab) { ui.tab = tab.dataset.tab; return render(); }
    const send = target.closest('[data-send]');
    if (send) { ui.sent.add(send.dataset.send); return render(); }
    if (target.closest('[data-close]')) { ui.expanded = null; return render(); }
    if (target.closest('button')) return;
    const host = target.closest('.row, .tile');
    if (host) { ui.expanded = ui.expanded === host.dataset.id ? null : host.dataset.id; render(); }
  });
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.row, .tile')) {
      event.preventDefault();
      event.target.click();
    }
  });

  const progress = $('#progress');
  const state = $('#state');
  const simulate = $('#simulate');
  let timer = null;
  function stop() {
    clearInterval(timer);
    timer = null;
    simulate.textContent = 'Animate progress';
    simulate.setAttribute('aria-pressed', 'false');
  }
  function syncControls() {
    progress.value = String(ui.progress);
    state.value = ui.state;
    progress.disabled = ui.state === 'saved';
    $('#progress-value').value = `${Math.floor(ui.progress)}%`;
  }
  progress.addEventListener('input', () => { stop(); ui.progress = Number(progress.value); syncControls(); paintProgress(); });
  state.addEventListener('change', () => { stop(); ui.state = state.value; syncControls(); render(); });
  simulate.addEventListener('click', () => {
    if (timer) return stop();
    if (ui.state !== 'downloading' || ui.progress >= 99) {
      ui.state = 'downloading';
      if (ui.progress >= 99) ui.progress = 0;
      render();
    }
    simulate.textContent = 'Stop';
    simulate.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => {
      ui.progress = Math.min(100, ui.progress + 1);
      if (ui.progress >= 100) { ui.progress = 99; ui.state = 'saved'; stop(); syncControls(); return render(); }
      syncControls();
      paintProgress();
    }, 220);
    syncControls();
  });
  addEventListener('pagehide', stop);

  renderNotes();
  syncControls();
  render();
})();
