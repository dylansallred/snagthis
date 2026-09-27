/* Local, generated media only: each page exercises a browser embedding technique. */
const kind = document.body.dataset.kind || 'direct';
const base = document.body.dataset.base;
const other = document.body.dataset.other;
document.body.style.cssText = 'background:#121316;color:#eee;font:16px system-ui;padding:24px';
const heading = document.createElement('h1');
heading.textContent = `SnagThis fixture — ${kind}`;
document.body.append(heading);
if (kind === 'iframe' || kind === 'nested') {
  const frame = document.createElement('iframe');
  frame.id = 'player';
  frame.src = `${other}/pages/${kind === 'nested' ? 'iframe' : 'hls'}.html`;
  frame.width = '800'; frame.height = '540';
  frame.allow = 'autoplay';
  document.body.append(frame);
} else {
  const video = document.createElement('video');
  video.controls = true; video.muted = true; video.width = 640;
  if (kind === 'poster') video.poster = `${base}/media/poster.jpg`;
  document.body.append(video);
  const play = document.createElement('button');
  play.id = 'play'; play.textContent = 'Play video';
  document.body.append(play);
  const start = async () => {
    let mediaUrl = `${base}/media/ts/index.m3u8`;
    if (['direct', 'poster', 'og', 'none', 'spa'].includes(kind)) {
      video.src = `${base}/media/direct.mp4`;
    } else {
      if (kind === 'variants') mediaUrl = `${base}/media/master.m3u8`;
      if (kind === 'black-preview') mediaUrl = `${base}/media/black-preview/index.m3u8`;
      if (kind === 'base64') mediaUrl = atob(btoa(`${base}/cases/tiny/manifest`));
      if (kind === 'fetch') {
        const manifest = await (await fetch(mediaUrl)).text();
        const absolute = manifest.split('\n').map((line) => line && !line.startsWith('#') ? new URL(line, mediaUrl).href : line).join('\n');
        mediaUrl = URL.createObjectURL(new Blob([absolute], { type: 'application/vnd.apple.mpegurl' }));
      }
      if (kind === 'xhr') {
        await new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('GET', mediaUrl); xhr.onload = resolve; xhr.onerror = reject; xhr.send(); });
      }
      if (window.Hls?.isSupported()) {
        const hls = new window.Hls({ autoStartLoad: true });
        hls.loadSource(mediaUrl); hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      } else video.src = mediaUrl;
    }
    await video.play().catch(() => {});
  };
  play.addEventListener('click', start);
  if (kind !== 'click') start().catch(() => {});
  if (kind === 'two') {
    const second = document.createElement('video');
    second.controls = true; second.muted = true; second.width = 640;
    second.src = `${base}/media/second.mp4`;
    document.body.append(second);
    second.play().catch(() => {});
  }
  if (kind === 'spa') {
    const navigate = document.createElement('button');
    navigate.id = 'navigate'; navigate.textContent = 'Next page';
    navigate.onclick = () => { video.pause(); video.removeAttribute('src'); video.load(); history.pushState({}, '', '/pages/spa.html?next=1'); heading.textContent = 'A different page without a video'; };
    document.body.append(navigate);
  }
}
