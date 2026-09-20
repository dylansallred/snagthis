const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../apps/extension/js/browser-downloads');

const media = (patch = {}) => ({ id: 'file', url: 'https://media.example/movie.mp4?signature=private-fixture-value', type: 'file', mediaKind: 'video', contentType: 'video/mp4', height: 1080, durationSeconds: 123, ...patch });

function fixture() {
  const values = {};
  const downloads = new Map();
  const calls = [];
  let nextId = 1;
  const chrome = {
    runtime: { id: 'vidsnag-test' },
    storage: { local: {
      get: async key => structuredClone(key == null ? values : { [key]: values[key] }),
      set: async entry => { Object.assign(values, structuredClone(entry)); },
      remove: async key => { delete values[key]; },
    } },
    downloads: {
      download: async options => {
        calls.push(['download', options]);
        const id = nextId++;
        downloads.set(id, { id, byExtensionId: 'vidsnag-test', state: 'in_progress', paused: false, canResume: false, danger: 'safe', mime: '', bytesReceived: 0, totalBytes: -1, filename: `/Downloads/${options.filename}`, startTime: '2026-09-20T12:00:00.000Z' });
        return id;
      },
      search: async ({ id }) => downloads.has(id) ? [structuredClone(downloads.get(id))] : [],
      pause: async id => { calls.push(['pause', id]); Object.assign(downloads.get(id), { paused: true, canResume: true }); },
      resume: async id => { calls.push(['resume', id]); Object.assign(downloads.get(id), { paused: false, canResume: false }); },
      cancel: async id => { calls.push(['cancel', id]); Object.assign(downloads.get(id), { state: 'interrupted', error: 'USER_CANCELED', paused: false, canResume: false }); },
      show: id => { calls.push(['show', id]); },
    },
  };
  return { values, downloads, calls, manager: () => B.createManager({ chrome, crypto: webcrypto }) };
}

test('Chrome capability accepts only observed standalone MP4/WebM and exact selected alternatives', () => {
  assert.equal(B.isSupported(media()), true);
  assert.equal(B.isSupported(media({ url: 'https://media.example/opaque', contentType: 'video/webm' })), true);
  assert.equal(B.isSupported(media({ url: 'https://media.example/movie.webm', contentType: 'application/octet-stream' })), true);
  const dom = media({ contentType: 'video/unknown', streamType: null });
  assert.equal(B.isSupported({ ...dom, detectedStreams: [dom], selection: { variantUrl: dom.url, subtitleLang: 'none' } }), true,
    'an observed DOM video with no declared type still supports its exact MP4 alternative');
  assert.equal(B.isSupported({ ...dom, url: 'https://media.example/opaque' }), false, 'an unknown MIME cannot qualify an opaque URL');
  for (const patch of [
    { url: 'blob:https://site.example/uuid' }, { url: 'https://user:secret@site.example/movie.mp4' },
    { mediaKind: 'youtube-page' }, { mediaKind: 'dash-manifest' }, { type: 'hls' }, { streamType: 'dash' },
    { contentType: 'text/html' }, { contentType: 'audio/mp4' }, { contentType: 'application/dash+xml' },
    { url: 'https://media.example/movie.mkv', contentType: 'video/x-matroska' },
    { url: 'https://media.example/init.mp4' }, { url: 'https://media.example/chunk-12.mp4' },
    { url: 'https://media.example/00012.m4s' }, { url: 'https://media.example/voice.m4a' },
    { url: 'https://media.example/video-only.mp4' }, { url: 'https://media.example/audio.mp4' }, { hasAudio: false },
    { selection: { audioOnly: true } }, { selection: { audioLang: 'en' } }, { selection: { subtitleLang: 'en' } },
    { manifest: { isMaster: false } }, { url: 'https://rr1.googlevideo.com/videoplayback', contentType: 'video/mp4' },
  ]) assert.equal(B.isSupported(media(patch)), false, JSON.stringify(patch));
  const file = media({ id: 'observed-file' });
  const playlist = { id: 'hls', url: 'https://media.example/master.m3u8', type: 'hls', manifest: { variants: [] } };
  const group = { ...playlist, detectedStreams: [playlist, file], selection: { variantUrl: file.url, subtitleLang: 'none' } };
  assert.equal(B.resolveSource(group), file);
  assert.equal(B.isSupported({ ...group, selection: { variantUrl: 'https://unobserved.example/movie.mp4' } }), false);
  playlist.manifest.initializationUrls = [file.url];
  assert.equal(B.isSupported(group), false, 'a known initialization URL cannot be offered as a standalone file');
  delete playlist.manifest.initializationUrls;
  playlist.manifest.audio = [{ url: file.url }];
  assert.equal(B.isSupported(group), false, 'a manifest audio rendition cannot become a direct video');
});

test('DOM rescans cannot overwrite an observed response MIME with video/unknown', async () => {
  const extension = path.join(__dirname, '../apps/extension');
  const values = {};
  const storage = { setAccessLevel: async () => {}, get: async key => ({ [key]: values[key] }), set: async value => Object.assign(values, value), remove: async key => { delete values[key]; } };
  const event = { addListener() {} };
  const chrome = {
    storage: { session: storage, local: storage },
    runtime: { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}`, onMessage: event },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { onRemoved: event },
    webNavigation: { onCommitted: event, onHistoryStateUpdated: event },
    webRequest: { onBeforeSendHeaders: event, onHeadersReceived: event, onCompleted: event, onErrorOccurred: event },
  };
  const context = vm.createContext({ chrome, URL, crypto: webcrypto });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(extension, 'service-worker.js'), 'utf8'), context);
  const observed = await context.storeMedia(7, media(), 0, 'https://cinema.example/watch');
  const scanned = await context.storeMedia(7, media({ contentType: 'video/unknown', streamType: null }), 0, 'https://cinema.example/watch');
  assert.equal(scanned.item.id, observed.item.id);
  assert.equal(scanned.item.contentType, 'video/mp4');
  assert.equal(B.isSupported(scanned.item), true);
  const rejected = await context.storeMedia(7, media({ contentType: 'text/html' }), 0, 'https://cinema.example/watch');
  const rescanned = await context.storeMedia(7, media({ contentType: 'video/unknown' }), 0, 'https://cinema.example/watch');
  assert.equal(rejected.item.contentType, 'text/html');
  assert.equal(rescanned.item.contentType, 'text/html');
  assert.equal(B.isSupported(rescanned.item), false, 'a DOM hint must not erase a conflicting response type');
});

test('filenames are relative safe basenames with the actual video extension', () => {
  assert.equal(B.filenameFor('../A/B\\C: movie?.webm', 'mp4'), 'A B C movie.mp4');
  assert.equal(B.filenameFor('CON', 'webm'), 'Video CON.webm');
  assert.equal(B.filenameFor('..', 'mp4'), 'Video.mp4');
  assert.equal(B.filenameFor('Film.mp4', 'mp4'), 'Film.mp4');
});

test('native transfer ownership survives manager restart without persisting source credentials', async () => {
  const f = fixture(); const manager = f.manager(); const source = media();
  const options = { source, pageUrl: 'https://cinema.example/watch?token=private-page-token#secret', title: 'My film' };
  const [first, simultaneous] = await Promise.all([manager.start(options), manager.start(options)]);
  assert.equal(first.jobId, 'browser:1'); assert.equal(simultaneous.jobId, first.jobId);
  assert.equal(f.calls.filter(([name]) => name === 'download').length, 1);
  assert.deepEqual(Object.keys(f.calls[0][1]).sort(), ['conflictAction', 'filename', 'saveAs', 'url']);
  assert.equal(first.job.totalBytes, null); assert.equal(first.job.queueStatus, 'downloading');
  const record = f.values[`${B.RECORD_PREFIX}1`];
  assert.deepEqual(Object.keys(record).sort(), ['downloadId', 'durationSeconds', 'height', 'pageKey', 'sourceKey', 'title']);
  assert.match(record.sourceKey, /^[a-f0-9]{64}$/); assert.match(record.pageKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(record), /https:|signature|token|Downloads|headers/i);
  // Recreate the worker-owned manager and change the tab's transient media id.
  const restarted = f.manager(); const observedAgain = { ...source, id: 'different-tab-new-observation' };
  f.downloads.get(1).bytesReceived = 25; f.downloads.get(1).totalBytes = 100;
  const snapshot = await restarted.snapshot([observedAgain], {});
  assert.equal(snapshot.mappings[observedAgain.id], first.jobId);
  assert.equal(snapshot.queue[0].progress, 25);
  assert.equal((await restarted.action(first.jobId, 'pause')).job.queueStatus, 'paused');
  assert.equal((await restarted.action(first.jobId, 'resume')).job.queueStatus, 'downloading');
  const desktopMapping = await restarted.snapshot([observedAgain], { [observedAgain.id]: 'desktop-job' });
  assert.equal(desktopMapping.mappings[observedAgain.id], 'desktop-job');
  await restarted.action(first.jobId, 'cancel');
  assert.equal((await restarted.snapshot([observedAgain])).queue[0].queueStatus, 'cancelled');
  const retry = await restarted.start(options);
  assert.equal(retry.jobId, 'browser:2');
  Object.assign(f.downloads.get(2), { state: 'complete', exists: true, bytesReceived: 100, totalBytes: 100, mime: 'video/mp4', endTime: '2026-09-20T12:01:00.000Z' });
  const saved = (await restarted.snapshot([observedAgain])).queue.find(job => job.id === retry.jobId);
  assert.equal(saved.queueStatus, 'completed'); assert.equal(saved.fileName, 'My film.mp4');
  assert.equal(saved.fileExists, true); assert.equal(saved.progress, 100);
  await restarted.action(retry.jobId, 'show'); assert.deepEqual(f.calls.at(-1), ['show', 2]);
  f.downloads.get(2).exists = false;
  const missing = (await restarted.snapshot([observedAgain])).queue.find(job => job.id === retry.jobId);
  assert.equal(missing.fileExists, false); assert.equal(missing.fileName, undefined);
  await assert.rejects(restarted.action(retry.jobId, 'show'), /saved file is unavailable/);
});

test('wrong response types and Chrome danger states are never reported as saved video', async () => {
  const f = fixture(); const manager = f.manager();
  const result = await manager.start({ source: media(), title: 'Expected film' });
  Object.assign(f.downloads.get(1), { mime: 'text/html' });
  await manager.changed({ id: 1, mime: { current: 'text/html' } });
  assert.equal(f.downloads.get(1).state, 'interrupted');
  const failed = (await manager.snapshot([media()])).queue[0];
  assert.equal(failed.queueStatus, 'failed'); assert.equal(failed.status, 'invalid-media');
  assert.equal(failed.fileName, undefined); assert.match(failed.error, /different file/);
  Object.assign(f.downloads.get(1), { state: 'interrupted', mime: 'text/plain', error: 'SERVER_FORBIDDEN' });
  const expired = (await manager.snapshot([media()])).queue[0];
  assert.equal(expired.queueStatus, 'failed'); assert.equal(expired.status, 'failed');
  assert.match(expired.error, /site refused/);
  Object.assign(f.downloads.get(1), { state: 'complete', mime: 'video/mp4', danger: 'content', exists: true });
  const blocked = (await manager.snapshot([media()])).queue[0];
  assert.equal(blocked.queueStatus, 'failed'); assert.equal(blocked.status, 'blocked');
  await assert.rejects(manager.action(result.jobId, 'show'), /saved file is unavailable/);
});

test('download controls require a VidSnag record and the matching Chrome owner', async () => {
  const f = fixture(); const manager = f.manager();
  await assert.rejects(manager.action('browser:41', 'cancel'), /not owned/);
  await assert.rejects(manager.action('desktop-job', 'pause'), /not a Chrome/);
  await manager.start({ source: media(), title: 'Owned film' });
  f.downloads.get(1).byExtensionId = 'another-extension';
  await assert.rejects(manager.action('browser:1', 'cancel'), /no longer has/);
  await assert.rejects(manager.action('browser:1', 'acceptDanger'), /unavailable/);
  await manager.erased(1);
  assert.equal(f.values[`${B.RECORD_PREFIX}1`], undefined);
});
