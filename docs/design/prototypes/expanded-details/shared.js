(() => {
  const embedded = new URLSearchParams(location.search).has('embedded');
  document.body.classList.toggle('embedded', embedded);
  const icons = {
    folder:'<path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v1"/><path d="M4 21h15l3-12H6L3 19a2 2 0 0 0 1 2Z"/>',
    arrow:'<path d="m9 5 7 7-7 7"/>', link:'<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"/>',
    external:'<path d="M14 3h7v7M10 14 21 3M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    cancel:'<path d="m6 6 12 12M18 6 6 18"/>',pause:'<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',play:'<path d="m7 3 14 9-14 9Z"/>',check:'<path d="m5 12 4 4L19 6"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  };
  const icon = (name, className='') => `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  const folder = '/Users/dylanallred/Library/Application Support/VidSnag-development/data/downloads/Neon Rain (2)';
  const media = '/apps/extension/popup/media/neon-rain';
  document.getElementById('study').innerHTML = `<main class="study-shell">
    <div class="study-controls"><label>Progress <input id="progress" aria-label="Progress" type="range" min="0" max="100" value="29"><output>29%</output></label><label>State <select id="state"><option value="downloading">Downloading</option><option value="paused">Paused</option><option value="saved">Saved</option></select></label></div>
    <article class="download-card" data-state="downloading">
      <header class="download-heading"><div class="thumb" tabindex="0" role="group" aria-label="Preview Neon Rain"><img src="${media}.jpg" alt="Neon Rain video frame"><video src="${media}.mp4" muted loop playsinline preload="none" aria-hidden="true"></video></div><div class="heading-copy"><div class="title-line"><h1>Sintel</h1><span class="duration">14:48</span></div><div class="status">29% · 4 min left</div></div><button class="heading-action" aria-label="Pause" title="Pause">${icon('pause')}</button></header>
      <div class="progress-strip" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="29">${'<i></i>'.repeat(40)}</div>
      <div class="details-layout">
        <dl class="facts"><div class="fact quality"><dt>Quality</dt><dd>1080p</dd></div><div class="fact size"><dt>Size · speed</dt><dd>1.5 GB / ~5.1 GB · 11.03 MB/s</dd></div><div class="fact connections"><dt>Connections</dt><dd>15 of 16 active</dd></div><div class="fact source"><dt>From</dt><dd>studio.blender.org</dd></div></dl>
        <button class="location" data-action="folder" aria-label="Open download folder" title="Open folder">${icon('folder','folder-icon')}<span class="location-copy"><span class="location-label">Saving to</span><span class="location-path">${folder}</span></span>${icon('arrow','location-arrow')}</button>
        <div class="detail-actions" aria-label="Video actions"><button class="icon-button" data-action="copy" aria-label="Copy link" title="Copy link">${icon('link')}</button><button class="icon-button" data-action="page" aria-label="Open source page" title="Open source page">${icon('external')}</button><button class="icon-button" data-action="cancel" aria-label="Cancel download" title="Cancel download">${icon('cancel')}</button></div>
        <section class="pieces"><div class="pieces-heading"><h2>Pieces</h2><span class="piece-count">542 of 1781</span></div><div class="piece-grid" aria-label="Piece download status">${'<i></i>'.repeat(640)}</div><div class="piece-legend"><span><i class="done"></i>Completed</span><span><i class="current"></i>Downloading</span><span><i class="retry"></i>Retrying</span><span><i></i>Pending</span></div></section>
        <div class="saved-message" hidden>${icon('check')}Saved and ready to play</div>
      </div>
    </article><p class="prototype-note">Interactive design study. Folder and action buttons demonstrate feedback; they do not change your files. Video: the original Neon Rain sample clip.</p><div class="notice" role="status" hidden></div>
  </main>`;
  let state = 'downloading', progress = 29, timer;
  const $ = selector => document.querySelector(selector);
  function notice(text) { clearTimeout(timer); $('.notice').textContent=text; $('.notice').hidden=false; timer=setTimeout(()=>$('.notice').hidden=true,2600); }
  function render() {
    const saved=state==='saved',paused=state==='paused',percent=saved?100:progress;
    $('.download-card').dataset.state=state;
    $('#state').value=state; $('#progress').value=progress; $('output').textContent=`${progress}%`;
    $('.status').textContent=saved?'Saved today · 5.1 GB':paused?`Paused at ${progress}%`:`${progress}% · ${Math.max(1,Math.round((100-progress)/18))} min left`;
    $('.progress-strip').hidden=saved;$('.progress-strip').setAttribute('aria-valuenow',percent);
    $('.progress-strip').querySelectorAll('i').forEach((cell,index)=>cell.className=index<Math.floor(percent*.4)?'done':index===Math.floor(percent*.4)?'current':'');
    $('.size dd').textContent=saved?'5.1 GB':`${(5.1*progress/100).toFixed(1)} GB / ~5.1 GB${paused?'':' · 11.03 MB/s'}`;
    $('.connections').hidden=saved; $('.connections dd').textContent=paused?'0 of 16 active':'15 of 16 active';
    $('.location-label').textContent=saved?'Saved in':'Saving to';$('.pieces').hidden=saved;$('.saved-message').hidden=!saved;
    $('.piece-count').textContent=`${Math.floor(progress/100*1781)} of 1781${paused?'':' · 2 retrying'}`;
    $('.piece-grid').querySelectorAll('i').forEach((cell,index)=> {const completed=Math.floor(progress/100*640);cell.className=index<completed?'done':index<completed+(paused?0:12)?'current':index<completed+(paused?0:14)?'retry':'';});
    const action=$('.heading-action');action.innerHTML=icon(saved||paused?'play':'pause');action.setAttribute('aria-label',saved?'Play':paused?'Resume':'Pause');action.title=action.getAttribute('aria-label');
    const cancel=$('[data-action=cancel]');cancel.innerHTML=icon(saved?'trash':'cancel');cancel.setAttribute('aria-label',saved?'Remove from list':'Cancel download');cancel.title=cancel.getAttribute('aria-label');
  }
  $('#progress').addEventListener('input',event=>{progress=Number(event.target.value);render();});$('#state').addEventListener('change',event=>{state=event.target.value;render();});
  $('.heading-action').addEventListener('click',()=>{if(state==='saved'){notice('Play the saved video');return;}state=state==='paused'?'downloading':'paused';render();});
  document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.action;
    if(action==='folder')notice('Opens this download’s folder in Finder');
    if(action==='copy')notice('Video link copied — preview');
    if(action==='page')notice('Opens the original video page');
    if(action==='cancel'){notice(state==='saved'?'Removes this entry; the saved file stays in its folder':'Download cancelled — preview only');if(state!=='saved'){state='paused';render();}}
  }));
  const thumb=$('.thumb'),video=$('.thumb video');
  const play=()=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;video.play().then(()=>thumb.classList.add('playing')).catch(()=>{});};
  const stop=()=>{video.pause();thumb.classList.remove('playing');};
  thumb.addEventListener('mouseenter',play);thumb.addEventListener('focus',play);thumb.addEventListener('mouseleave',stop);thumb.addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.type!=='vidsnag:details-design')return;if(event.data.active===false)stop();if(['downloading','paused','saved'].includes(event.data.state))state=event.data.state;if(Number.isFinite(event.data.progress))progress=Math.max(0,Math.min(100,event.data.progress));render();});
  render();
})();
