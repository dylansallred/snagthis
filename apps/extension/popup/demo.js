/* Development-only sample data. Loaded only when popup.js explicitly chooses its non-extension demo branch. */
window.VidSnagDemo = (() => {
  const state = {};
  function init(mode = 'default') {
    const makeItem = (id, title, poster, height, duration, size) => ({ id, title, sourcePageTitle: title, url: `https://videos.example/${id}.mp4`, sourcePageUrl: 'https://videos.example/watch', type: 'file', height, durationSeconds: duration, contentLength: size, thumbnailUrl: `popup/media/${poster}.jpg`, pageTitleCandidates: [{ source: 'document.title', value: title }] });
    const items = [makeItem('sintel', 'Sintel — an open movie', 'sintel', 1080, 888, 2100000000), makeItem('bunny', 'Big Buck Bunny', 'big-buck-bunny', 720, 596, 182000000), makeItem('steel', 'Tears of Steel', 'tears-of-steel', 1080, 734, 950000000)];
    items[0].variants = [1080, 720, 480].map((height, index) => ({ url: `https://videos.example/sintel-${height}.m3u8`, height, sizeBytes: [2100000000, 1200000000, 640000000][index] }));
    items[0].audio = [{ url: 'https://videos.example/sintel-en.m3u8', language: 'en', name: 'English' }];
    items[0].subtitles = [{ url: 'https://videos.example/sintel-en.vtt', language: 'en', name: 'English' }];
    const jobs = [{ id: 'job-sintel', queueStatus: 'downloading', progress: 34, etaSeconds: 300 }, { id: 'job-steel', queueStatus: 'downloading', progress: 62, etaSeconds: 120 }];
    const mappings = { sintel: 'job-sintel', steel: 'job-steel' };
    if (['quality', 'offline', 'version', 'settings'].includes(mode)) { jobs.length = 0; for (const key of Object.keys(mappings)) delete mappings[key]; }
    if (mode === 'quality') items.splice(1);
    if (mode === 'empty') items.length = 0;
    if (mode === 'states') { jobs[0].queueStatus = 'paused'; jobs[1].queueStatus = 'completed'; }
    if (mode === 'problem') { jobs[0].queueStatus = 'failed'; jobs[0].error = 'SOURCE_EXPIRED'; jobs[1].progress = 97; jobs[1].status = 'Verifying output'; }
    Object.assign(state, { items, mappings, queue: jobs, reachable: mode !== 'offline', compatible: mode !== 'version', tab: { id: 1, title: 'Open movies', url: 'https://videos.example/watch' }, preferences: { outputDirectory: '~/Movies/VidSnag', subtitleLanguage: 'en' } });
    return state;
  }
  function act(id, action) {
    let job = state.queue.find(item => item.id === state.mappings[id]);
    if (action === 'download') { job = { id: `demo-${id}`, queueStatus: 'downloading', progress: 0 }; state.mappings[id] = job.id; state.queue.push(job); }
    else if (action === 'pause') job.queueStatus = 'paused';
    else if (action === 'resume') job.queueStatus = 'downloading';
    else if (action === 'retry') { job.queueStatus = 'downloading'; delete job.error; }
  }
  return { state, init, act };
})();
