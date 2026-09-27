/* Development-only sample data. Loaded only when popup.js explicitly chooses its non-extension demo branch. */
window.SnagThisDemo = (() => {
  const state = {};
  function init(mode = 'default') {
    const makeItem = (id, title, poster, height, duration, size) => ({ id, title, sourcePageTitle: title, url: `https://videos.example/${id}.mp4`, sourcePageUrl: 'https://videos.example/watch', type: 'file', height, durationSeconds: duration, contentLength: size, thumbnailUrl: `popup/media/${poster}.jpg`, pageTitleCandidates: [{ source: 'document.title', value: title }] });
    const items = [makeItem('neon', 'Neon Rain — night drive', 'neon-rain', 1080, 757, 2100000000), makeItem('hop', 'Sky Hop — a play button’s day out', 'sky-hop', 720, 342, 182000000), makeItem('tide', 'Ember Tide — sunset crossing', 'ember-tide', 1080, 1334, 950000000)];
    items[0].variants = [1080, 720, 480].map((height, index) => ({ url: `https://videos.example/neon-${height}.m3u8`, height, sizeBytes: [2100000000, 1200000000, 640000000][index] }));
    items[0].audio = [{ url: 'https://videos.example/neon-en.m3u8', language: 'en', name: 'English' }];
    items[0].subtitles = [{ url: 'https://videos.example/neon-en.vtt', language: 'en', name: 'English' }];
    const jobs = [{ id: 'job-neon', queueStatus: 'downloading', progress: 34, etaSeconds: 300, speedBps: 6_200_000 }, { id: 'job-tide', queueStatus: 'downloading', progress: 62, etaSeconds: 120, speedBps: 3_100_000 }];
    const mappings = { neon: 'job-neon', tide: 'job-tide' };
    // cinejoy.pk shape: four nameless renditions, only the first DEFAULT=YES.
    if (mode === 'audio') items[0].audio = [1, 2, 3, 4].map(n => ({ url: `https://videos.example/neon-audio-${n}.m3u8`, groupId: 'audio', name: `Track ${n}`, language: null, default: n === 1 }));
    if (['quality', 'audio', 'offline', 'version', 'settings'].includes(mode)) { jobs.length = 0; for (const key of Object.keys(mappings)) delete mappings[key]; }
    if (['quality', 'audio'].includes(mode)) items.splice(1);
    if (['empty', 'loading', 'error'].includes(mode)) items.length = 0;
    if (mode === 'states') { jobs[0].queueStatus = 'paused'; jobs[1].queueStatus = 'completed'; }
    if (mode === 'snag') { jobs[1].progress = 97; jobs[1].etaSeconds = 4; }
    if (mode === 'problem') { jobs[0].queueStatus = 'failed'; jobs[0].error = 'SOURCE_EXPIRED'; jobs[1].progress = 97; jobs[1].status = 'Verifying output'; }
    state.mode = mode;
    Object.assign(state, { items, mappings, queue: jobs, reachable: mode !== 'offline', compatible: mode !== 'version', tab: { id: 1, title: 'Open movies', url: 'https://videos.example/watch' }, preferences: { outputDirectory: '~/Movies/SnagThis', subtitleLanguage: 'en' } });
    return state;
  }
  function act(id, action) {
    let job = state.queue.find(item => item.id === state.mappings[id]);
    if (action === 'download') { job = { id: `demo-${id}`, queueStatus: 'downloading', progress: 0 }; state.mappings[id] = job.id; state.queue.push(job); }
    else if (action === 'pause') job.queueStatus = 'paused';
    else if (action === 'resume') job.queueStatus = 'downloading';
    else if (['retry', 'continue'].includes(action)) { job.queueStatus = 'downloading'; delete job.error; }
  }
  // Sample speeds wander like a real transfer; 'snag' finishes a download a moment after opening.
  function live(update) {
    let tick = 0;
    setInterval(() => {
      tick++;
      for (const job of state.queue) if (job.queueStatus === 'downloading' && job.speedBps) job.speedBps = Math.max(400_000, job.speedBps * (0.82 + Math.random() * 0.36) + (Math.sin(tick / 3) * 600_000));
      if (state.mode === 'snag' && tick === 3) Object.assign(state.queue[1], { queueStatus: 'completed', progress: 100, completedAt: Date.now() });
      update();
    }, 1000);
  }
  return { state, init, act, live };
})();
