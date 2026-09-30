/* Storyboards for docs/design/prototypes/pairing-simple/index.html. Prototype only; nothing connects. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MEDIA = '../../../../apps/extension/popup/media/';
const WM = $('#wordmark').innerHTML.replace('width="120" height="22"', 'width="96" height="18"');
const PB = { tile: 'M3 0h10v1h-10zM1 1h14v1h-14zM1 2h14v1h-14zM0 3h16v10h-16zM1 13h14v1h-14zM1 14h14v1h-14zM3 15h10v1h-10z', hi: 'M3 0h10v1h-10zM1 1h2v1h-2zM13 1h1v1h-1zM1 2h1v1h-1zM0 3h1v10h-1zM1 13h1v1h-1z', lo: 'M14 1h1v1h-1zM14 2h1v1h-1zM15 3h1v10h-1zM14 13h1v1h-1zM1 14h2v1h-2zM13 14h2v1h-2zM3 15h10v1h-10z', shadow: 'M13 8h1v1h-1zM11 9h3v1h-3zM10 10h2v1h-2zM8 11h3v1h-3zM7 12h2v1h-2zM6 13h2v1h-2z', glyph: 'M5 3h2v1h-2zM5 4h3v1h-3zM5 5h5v1h-5zM5 6h6v1h-6zM5 7h8v1h-8zM5 8h8v1h-8zM5 9h6v1h-6zM5 10h5v1h-5zM5 11h3v1h-3zM5 12h2v1h-2z' };
const pb = size => `<svg class="pb" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><path class="pb-face" d="${PB.tile}"/><path class="pb-light" d="${PB.hi}"/><path class="pb-dark" d="${PB.lo}"/><path class="pb-dark" d="${PB.shadow}"/><path class="pb-glyph" d="${PB.glyph}"/></svg>`;
const I = {
  dl: '<svg class="i" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  gear: '<svg class="i" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  link: '<svg class="i" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  puzzle: '<svg class="i" viewBox="0 0 24 24"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>',
  clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  ban: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  alert: '<svg class="i" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  lock: '<svg class="i" viewBox="0 0 24 24" style="width:12px;height:12px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  folder: '<svg class="i" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
};
const CODE = '4719';
const tap = n => `<span class="tapno" aria-hidden="true">${n}</span>`;
const cart = (code = CODE, cls = '') => `<div class="cart ${cls}" role="img" aria-label="Match code ${[...code].join(' ')}">${[...code].map(d => `<span>${d}</span>`).join('')}</div>`;
const pips = (gone = 1, cls = '') => `<div class="pips ${cls}" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<i class="${i < gone ? 'gone' : ''}"></i>`).join('')}</div>`;

/* ── Chrome side ── */
const ROWS = {
  neon: { img: 'neon-rain.jpg', title: 'Neon Rain — night drive', meta: '<span class="q">HD</span>1080p · HLS stream', dur: '12:37' },
  tide: { img: 'ember-tide.jpg', title: 'Ember Tide — sunset crossing', meta: '<span class="q">HD</span>1080p · MP4 · 950 MB', dur: '22:14' },
};
function vrow(key, { btn = `<button class="dl" aria-label="Download">${I.dl}</button>`, st, extra = '', cls = '', prog } = {}) {
  const r = ROWS[key];
  return `<div class="vrow ${cls}"><div class="th"><img src="${MEDIA}${r.img}" alt=""><span class="dur">${r.dur}</span></div><div><div class="tt">${esc(r.title)}</div><div class="st ${st?.cls || ''}">${st?.text || r.meta}</div></div>${btn}${extra}${prog ? `<div class="prog"><i style="width:${prog}%"></i></div>` : ''}</div>`;
}
function popup({ banner = '', rows, footer = 'Open SnagThis', body } = {}) {
  const list = body || rows || (vrow('neon') + vrow('tide'));
  return `<div class="pop"><div class="pop-h">${WM}<span class="cnt">2 videos on this page</span></div>${banner}<div>${list}</div><div class="pop-f">${I.gear}<span>No video?</span><span class="r">${footer}</span></div></div>`;
}
function chrome({ pop = '', badge = '', badgeOk = false, note = '', over = '', extOn = !!pop } = {}) {
  const page = `<div class="ch-page"><img src="${MEDIA}neon-rain.jpg" alt=""><div class="pg-title">Neon Rain — night drive</div><div class="pg-sub">videos.example · 12:37</div>${note ? `<div class="ch-note">${note}</div>` : ''}</div>`;
  return `<div class="col"><div class="col-label"><i style="background:#6aa4ff"></i>Chrome · popup at 400px (real: 480px)</div><div class="chrome"><div class="ch-bar"><div class="ch-url">${I.lock}videos.example/neon-rain</div><div class="ch-ext ${extOn ? 'on' : ''}">${pb(16)}${badge ? `<span class="ch-badge ${badgeOk ? 'ok' : ''}">${badge}</span>` : ''}</div></div>${page}${pop}${over}</div></div>`;
}
const sysPrompt = (title, body, primary, secondary = 'Cancel', check = '') => `<div class="sys-dialog"><b>${title}</b>${body}${check ? `<label><input type="checkbox" checked disabled> ${check}</label>` : ''}<div class="sb"><span>${secondary}</span><span class="p">${primary}</span></div></div>`;

/* ── Desktop side ── */
const DROWS = [
  { img: 'sky-hop.jpg', title: 'Sky Hop — a play button’s day out', st: 'Saved · 720p · 182 MB' },
  { img: 'ember-tide.jpg', title: 'Ember Tide — sunset crossing', st: 'Saved · 1080p · 950 MB' },
];
const drow = (r, extra = '') => `<div class="drow ${r.cls || ''}"><div class="th"><img src="${MEDIA}${r.img}" alt=""></div><div><div class="tt">${esc(r.title)}</div><div class="st">${r.st}</div>${r.bar ? `<div class="bar"><i style="width:${r.bar}%"></i></div>` : ''}</div>${extra}</div>`;
const library = (rows = DROWS) => `<div class="d-tabs"><span class="on">All</span><span>Downloading</span><span>Saved</span></div>${rows.map(r => drow(r)).join('')}`;
function desk({ body = library(), over = '', behind = false, tag = '', foot = 'Saving to Downloads/SnagThis' } = {}) {
  return `<div class="col"><div class="col-label"><i style="background:var(--accent-bevel-face)"></i>SnagThis desktop app</div><div class="desk ${behind ? 'behind' : ''}"><div class="d-title"><i></i><i></i><i></i><span>SnagThis</span></div><div class="d-top">${WM}<div class="d-paste">${I.link}Paste a video link</div></div><div class="d-body">${body}${over}</div><div class="d-foot">${foot}<span class="r">${I.folder}</span>${I.gear}</div>${tag ? `<span class="float-tag">${tag}</span>` : ''}</div></div>`;
}
const who = (store = false) => store
  ? `<div class="who">${pb(14)}<b>SnagThis for Chrome</b><span class="id">1.0.1</span><span class="chip good">✓ Web Store</span></div>`
  : `<div class="who">${I.puzzle}<b>Chrome extension</b><span class="id">gedjai…nombmb</span><span class="chip">Not Web Store</span></div>`;
function approve({ title = 'Connect Chrome?', body = 'Allow only if Chrome shows the same digits.', ctx = '', t = 1, time = '1:52', allowTap = 0, scrim = '' } = {}) {
  return `<div class="scrim ${scrim}"><div class="appr">${pb(30)}<h3>${title}</h3><p>${body}</p>${ctx}${cart()}${pips(t)}${who()}<div class="btns"><span class="btn deny">Deny</span><span class="btn primary ${allowTap ? 'tap' : ''}">Allow${allowTap ? tap(allowTap) : ''}</span></div><div class="afoot"><span>Different digits? Choose Deny.</span><span class="t">${time}</span></div></div></div>`;
}
const connectedCard = (line = 'Chrome can send downloads here now.') => `<div class="scrim clear"><div class="appr">${pb(40)}<div class="done-check"><div class="word">CONNECTED</div><p>${line}</p></div>${pips(0, 'good')}<div class="closing" aria-hidden="true"><i></i></div><p style="font-size:11px">Closes by itself</p></div></div>`;
const toast = (icon, text) => `<div class="toast"><span class="i">${icon}</span>${text}</div>`;

/* ── Frames ── */
const bannerConnect = n => `<div class="banner"><span>Save supported files in Chrome. Connect SnagThis for streams and more.</span><span class="btn primary tap">Connect${tap(n)}</span></div>`;
const bannerOk = `<div class="banner ok fading">${I.check}<span><b>Connected to SnagThis</b></span></div>`;
const bannerPairing = (lead = 'Choose <b>Allow</b> in SnagThis if it shows these digits', sub = 'Waiting · 1:52') => `<div class="banner pairing">${cart(CODE, 'sm')}<span class="t">${lead}<small>${sub}</small></span><span class="btn">Cancel</span></div>`;

const OPTIONS = [
  {
    id: 'a', name: 'One tap', pitch: 'Connect stays one inline button; SnagThis surfaces its own approve card with the digits while the popup stays open; Allow closes both.',
    clicks: 3, screens: 2,
    frames: [
      { title: 'Open the popup', act: 'Click 1: the toolbar icon', text: 'Unpaired, the list works as it does today. The amber banner is the only pairing surface, with one button.',
        chrome: () => chrome({ pop: popup({ banner: bannerConnect(2) }) }), desk: () => desk({ behind: true, tag: 'In the background' }) },
      { title: 'Connect: the digits appear on both sides at once', act: 'Click 2: Connect', text: 'The banner becomes the waiting strip (no sheet, and the list stays visible). The desktop gets the request and shows its approve card itself, without the snagthis:// link, so there’s no “Open SnagThis?” prompt. It shows without taking focus, so Chrome’s popup stays open and the two sets of digits can be compared side by side.',
        chrome: () => chrome({ pop: popup({ banner: bannerPairing() }), badge: CODE }), desk: () => desk({ over: approve({ allowTap: 3 }), tag: 'Shown without taking focus' }) },
      { title: 'Allow: both sides finish by themselves', act: 'Click 3: Allow', text: 'Clicking Allow gives SnagThis focus, so Chrome closes its popup as it always does. The card turns into a one-second “Connected” and closes; if SnagThis was hidden before, it hides again. The worker has already saved the key, and the badge shows ✓ until the next opening or for 10 seconds.',
        chrome: () => chrome({ badge: '✓', badgeOk: true, note: 'Chrome closed the popup when you clicked in SnagThis. Nothing is waiting for you here.' }), desk: () => desk({ over: connectedCard() }) },
      { title: 'Next opening: a two-second check, then the list', act: 'No click', text: 'No Connected sheet and no Done. The banner slot shows a green line that shrinks away over two seconds, and Download works immediately. The desktop is back where it was.',
        chrome: () => chrome({ pop: popup({ banner: bannerOk }) }), desk: () => desk({ behind: true }) },
      { edge: true, title: 'SnagThis isn’t running', act: '+1 click: Chrome’s “Open” (first time only)', text: 'Connect still works. The worker opens snagthis://open, Chrome asks once before launching an app, and the strip reads “Opening SnagThis…”. It polls /v1/health for up to 15 s, then sends the request, and the flow continues at frame 2. If nothing answers: “SnagThis isn’t installed. <b>Get SnagThis</b>”.',
        chrome: () => chrome({ pop: popup({ banner: `<div class="banner pairing">${cart('····', 'sm off')}<span class="t"><b>Opening SnagThis…</b><small>Then check the digits and choose Allow there</small></span><span class="btn">Cancel</span></div>` }), over: `<div class="sys-over">${sysPrompt('Open SnagThis?', 'SnagThis wants to open this application.', 'Open SnagThis', 'Cancel', 'Always allow SnagThis to open links of this type')}</div>` }), desk: () => desk({ body: '<div class="first"><p style="margin-top:120px">Starting…</p></div>', behind: true, tag: 'Launching' }) },
      { edge: true, title: 'Deny or time out: one sentence, no sheet', act: 'No click to dismiss', text: 'Deny closes the card with the toast used today. The popup’s banner slot says so in one amber sentence with one button, shown once. After Deny that button is “Use a code”, because this extension can’t ask again for an hour. After a timeout it’s “Try again”.',
        chrome: () => chrome({ pop: popup({ banner: `<div class="banner"><span>SnagThis chose Deny. Chrome can ask again in an hour.</span><span class="btn bordered" style="color:hsl(44 80% 78%);border-color:hsl(44 40% 30%)">Use a code</span></div>` }) }), desk: () => desk({ over: toast(I.ban, 'Chrome wasn’t connected. It can ask again in an hour.') }) },
    ],
    notes: {
      edges: ['<b>Not running:</b> one Connect launches it (frame 5). Chrome’s “Open SnagThis?” prompt appears only in this case.', '<b>Not installed:</b> after 15 s with no health reply, the strip becomes “SnagThis isn’t installed” with <b>Get SnagThis</b>. The first run after installing shows the same Connect hint.', '<b>Local Network Access:</b> see the shared note. If Chrome prompts, the waiting strip names Chrome’s prompt.', '<b>Denied / expired / conflict:</b> one banner sentence and one button (frame 6), cleared after it has been shown once.', '<b>Second browser:</b> the same flow. The identity line on the card tells browsers apart. Desktop Settings keeps “Connect another browser”.', '<b>Disconnect:</b> unchanged. Afterwards the banner reads “Disconnected from SnagThis…” with <b>Connect again</b>, which runs this same flow.'],
      code: ['<b>popup.js:</b> drop the pairing sheet and <code>celebrateConnection()</code>. <code>renderConnection()</code> gets three banner states (waiting strip, 2 s OK line, one-line outcome). The code form moves to Settings ▸ Connection only.', '<b>service-worker.js:</b> <code>startPairing</code> skips <code>openPairingApp()</code> when <code>/v1/health</code> answers, and launches it and polls health when it doesn’t. Clear the ✓ badge on popup open or after 10 s.', '<b>electron/main.js:</b> on <code>onPairingChange</code> with a new pending request, show the window without activating it and deliver <code>pairing:show</code> (no deep link needed). After a decision, restore the previous hidden/minimised state.', '<b>PairingApproval.tsx:</b> the approved state closes itself after ~1 s (no Done) and is announced with <code>role=status</code>. Allow’s 700 ms arming and unfocused start stay.', '<b>Bridge API:</b> no change. <b>Spec §8</b> and <code>tests/e2e/pairing-onboarding.spec.js</code> (Done and celebration assertions) need updating.'],
      risks: ['Showing a window without taking focus behaves differently on each OS. Windows may only flash the taskbar, which puts the Chrome popup/Allow race back. Fallback: keep the badge digits.', 'Any installed extension can now make SnagThis’s card pop up (at most 3 times per 5 minutes). It still can’t get in without Allow and matching digits, and it carries the Not Web Store tag.', 'Removing the celebration drops the owner-selected Cartridge success moment on the Chrome side. The desktop keeps a shortened one.'],
    },
  },
  {
    id: 'b', name: 'Pair from the desktop', pitch: 'SnagThis leads: its first run (or Settings) listens for Chrome, and opening the popup is the whole Chrome side. The only click that connects is Allow in SnagThis.',
    clicks: 2, screens: 2,
    frames: [
      { title: 'SnagThis first run is already listening', act: 'No click (Settings ▸ Chrome extension: click “Connect Chrome”)', text: 'The first-run screen swaps the three numbered steps for one card: “Click SnagThis in Chrome.” While this card is on screen, and for up to 5 minutes, the desktop is listening. /v1/health reports pairing: "listening", a flag with no secret in it.',
        chrome: () => chrome({ note: 'SnagThis for Chrome is installed. Nothing has happened here yet.' }),
        desk: () => desk({ body: `<div class="first">${pb(56)}<h3>Download your first video</h3><p>Paste a link above, or send one from Chrome.</p><div class="connect-card"><b>Connect Chrome</b><div class="ext-hint">${pb(14)} Click <b>SnagThis</b> in Chrome’s toolbar</div><div class="listen"><span class="blip"></span>Waiting for Chrome…</div><span class="linkish">Don’t have it yet? Add SnagThis to Chrome ↗</span></div></div>` }) },
      { title: 'Open the popup: it connects without a button', act: 'Click 1: the toolbar icon', text: 'The popup sees that SnagThis is listening and starts the request itself. The desktop card changes in place (no new dialog) to the four digits and Allow. Both are on screen together, because the desktop card is already visible and doesn’t take focus.',
        chrome: () => chrome({ pop: popup({ banner: bannerPairing('Connecting to <b>SnagThis</b> on this computer', 'Choose Allow there · 1:58') }), badge: CODE }),
        desk: () => desk({ body: `<div class="first">${pb(56)}<h3>Download your first video</h3><p>Paste a link above, or send one from Chrome.</p><div class="connect-card"><b>Chrome wants to connect</b><p style="margin:0;font-size:12px;color:var(--color-foreground-muted)">Allow only if Chrome shows the same digits.</p>${cart()}${who()}<div class="btns"><span class="btn deny">Deny</span><span class="btn primary tap">Allow${tap(2)}</span></div></div></div>` }) },
      { title: 'Allow: the card becomes “Connected” and folds away', act: 'Click 2: Allow', text: 'The card shows “Connected” in place for about a second, then the first-run screen drops its Chrome section entirely. Chrome closed its popup when SnagThis took focus, and the ✓ badge is the only trace.',
        chrome: () => chrome({ badge: '✓', badgeOk: true, note: 'Chrome closed the popup when you clicked in SnagThis.' }),
        desk: () => desk({ body: `<div class="first">${pb(56)}<h3>Download your first video</h3><p>Paste a link above, or send one from Chrome.</p><div class="connect-card" style="border-color:#2b7a55"><div class="done-check"><div class="word">CONNECTED</div><p style="margin:0">Chrome can send downloads here now.</p></div><div class="closing"><i></i></div></div></div>` }) },
      { title: 'Next opening: just the list', act: 'No click', text: 'The same two-second green line as option A, then the list. The desktop first-run screen now only says “Paste a link above, or send one from Chrome.”',
        chrome: () => chrome({ pop: popup({ banner: bannerOk }) }), desk: () => desk({ body: `<div class="first" style="padding-top:110px">${pb(56)}<h3>Download your first video</h3><p>Paste a link above, or play a video in Chrome and click SnagThis.</p></div>`, behind: true }) },
      { edge: true, title: 'Popup opened first (SnagThis not listening)', act: 'Same as option A', text: 'If the person starts in Chrome, the banner offers Connect, which works exactly like option A: SnagThis surfaces its own card. Listening only changes whether the Connect click is needed. The request is never automatic unless the desktop has opened its listening card.',
        chrome: () => chrome({ pop: popup({ banner: bannerConnect(1) }) }), desk: () => desk({ behind: true, tag: 'Not listening' }) },
      { edge: true, title: 'Second browser', act: 'Click 1: Connect another browser', text: 'Desktop Settings ▸ Chrome extension lists connected browsers. “Connect another browser” opens the same listening card, and opening SnagThis in the other browser does the rest. Browsers that are already connected are never asked again, because they already hold a key.',
        chrome: () => chrome({ note: 'Another Chrome profile, or Edge/Brave with SnagThis installed.' }),
        desk: () => desk({ body: `<div style="padding:22px 26px;display:flex;flex-direction:column;gap:12px"><b style="font-size:15px">Chrome extension</b><div class="who">${pb(14)}<b>SnagThis for Chrome</b><span class="id">connected Sep 29 · seen now</span><span class="chip good">● Connected</span></div><div class="connect-card" style="width:auto;align-items:flex-start"><b>Connect another browser</b><div class="listen"><span class="blip"></span>Waiting for a browser… open SnagThis there</div><span class="linkish">Use a code instead</span></div></div>` }) },
    ],
    notes: {
      edges: ['<b>Not running:</b> this path starts on the desktop, so it is running. If Chrome is used first, see A frame 5.', '<b>Not installed:</b> the popup banner says “Get SnagThis (free) for streams and more”. After install, the first run is already listening, so opening the popup again connects.', '<b>Local Network Access:</b> see the shared note.', '<b>Denied / expired:</b> the listening card returns to “Waiting for Chrome…” and the popup gets the one-line outcome from A frame 6. Listening ends after 5 minutes or when the card is closed.', '<b>Two extensions at once:</b> the existing “two requests at once” rule cancels both, so an extension polling health can’t slip in first.', '<b>Disconnect:</b> unchanged. Afterwards Settings shows the listening card again.'],
      code: ['<b>Everything in A</b>, plus:', '<b>Bridge (security.js / createApiServer.js):</b> a listening window (<code>setListening(until)</code>), exposed as a boolean on <code>/v1/health</code>. Routes and auth are unchanged.', '<b>popup.js:</b> on open, when unpaired and <code>health.pairing === "listening"</code>, send <code>PAIR_START</code> automatically. Otherwise show Connect.', '<b>Desktop renderer:</b> a first-run/Settings “Connect Chrome” card with listening, digits and Allow in place, plus IPC <code>pairing:listen</code>. The Approve dialog stays for requests that arrive while the card isn’t shown.', '<b>Optional:</b> while unpaired, a worker alarm (30 s) checks health so the toolbar badge can show a dot when SnagThis is listening.'],
      risks: ['Two approve surfaces (the in-place card and the dialog) to keep consistent.', 'The public health endpoint reveals “listening”. That’s low sensitivity, but new.', 'The Chrome side does nothing until the popup is opened. Without the optional badge dot, people may not know to open it.', 'Brief deviation: the popup has no Allow of its own. A confirmation in Chrome could be pressed by a malicious extension itself, so the one confirmation stays in SnagThis.'],
    },
  },
  {
    id: 'c', name: 'Silent until needed', pitch: 'No pairing step up front. The first time something needs the desktop, the Download press itself asks SnagThis, and the download starts the moment Allow is chosen.',
    clicks: 3, screens: 1,
    frames: [
      { title: 'Unpaired is silent', act: 'Click 1: toolbar icon · Click 2: Download', text: 'No banner. MP4/WebM files already save in Chrome without SnagThis. Neon Rain is a stream, so its Download goes to SnagThis, and pressing it is what starts pairing.',
        chrome: () => chrome({ pop: popup({ rows: vrow('neon', { btn: `<button class="dl tap" aria-label="Download">${I.dl}${tap(2)}</button>` }) + vrow('tide') }) }), desk: () => desk({ behind: true, tag: 'In the background' }) },
      { title: 'One question, in context', act: 'Click 3: Allow', text: 'The row shows “Starting…” and a small inline strip with the digits. SnagThis surfaces a card that names the video (display-only context sent with the request) with the same four digits. It’s the same security check, asked in the moment it matters.',
        chrome: () => chrome({ pop: popup({ rows: vrow('neon', { btn: `<span class="dl busy">…</span>`, st: { cls: 'hot', text: 'Starting…' }, extra: `<div class="inline-pair">${cart(CODE, 'xs')}<span>First time only: choose <b>Allow</b> in SnagThis<small>if it shows these digits · 1:56</small></span></div>` }) + vrow('tide') }), badge: CODE }),
        desk: () => desk({ over: approve({ title: 'Let Chrome send downloads here?', body: 'First time only. Allow if Chrome shows the same digits.', ctx: `<div class="video-ctx"><img src="${MEDIA}neon-rain.jpg" alt=""><div><b>Neon Rain — night drive</b><small>from videos.example</small></div></div>`, allowTap: 3 }), tag: 'Shown without taking focus' }) },
      { title: 'Allow: the card closes into the download', act: 'No click', text: 'The card closes immediately and the new row is the confirmation. The worker kept the request (in storage.session, memory only) and submits it as soon as the key arrives.',
        chrome: () => chrome({ badge: '1', note: 'Chrome closed the popup when you clicked in SnagThis. The badge counts the desktop download.' }),
        desk: () => desk({ body: library([{ img: 'neon-rain.jpg', title: 'Neon Rain — night drive', st: 'Downloading · 1080p · 4.2 MB/s', bar: 6, cls: 'new' }, ...DROWS]), over: toast(I.check, 'Chrome connected · Neon Rain is downloading') }) },
      { title: 'Next opening: the row is just downloading', act: 'No click', text: 'Nothing about pairing remains. The row shows progress in the Pieces lane, like any desktop download.',
        chrome: () => chrome({ pop: popup({ rows: vrow('neon', { btn: `<span class="dl busy">${I.dl}</span>`, st: { cls: 'hot', text: 'Downloading in SnagThis · 18%' }, prog: 18 }) + vrow('tide') }) }), desk: () => desk({ body: library([{ img: 'neon-rain.jpg', title: 'Neon Rain — night drive', st: 'Downloading · 1080p · 4.4 MB/s', bar: 18 }, ...DROWS]), behind: true }) },
      { edge: true, title: 'SnagThis isn’t running (or isn’t installed)', act: '+1 click: Chrome’s “Open” (first time only)', text: 'Download on a stream launches SnagThis (“Opening SnagThis…” in the row), then carries on at frame 2. If nothing answers, the row explains in one line: “This one needs the free SnagThis app” with <b>Get SnagThis</b>. The row keeps its place, and the download can resume after install.',
        chrome: () => chrome({ pop: popup({ rows: vrow('neon', { btn: `<span class="btn primary" style="height:28px">Get SnagThis</span>`, st: { cls: 'warn', text: 'This one needs the free SnagThis app' } }) + vrow('tide') }) }), desk: () => desk({ body: '<div class="first"><p style="margin-top:160px">Not installed</p></div>', behind: true }) },
      { edge: true, title: 'Deny: the row says so', act: 'Click: Try again / Use a code', text: 'The download doesn’t start. The row reads “SnagThis didn’t allow Chrome” with <b>Use a code</b> (one-hour block) and no sheet. Desktop settings that need a connection (quality, subtitles) keep a Connect button that runs frame 2 without a video.',
        chrome: () => chrome({ pop: popup({ rows: vrow('neon', { btn: `<span class="btn bordered" style="height:28px">Use a code</span>`, st: { cls: 'warn', text: 'SnagThis didn’t allow Chrome · ask again in an hour' } }) + vrow('tide') }) }), desk: () => desk({ over: toast(I.ban, 'Chrome wasn’t connected. It can ask again in an hour.') }) },
    ],
    notes: {
      edges: ['<b>Not running / not installed:</b> handled on the row (frame 5). Nothing appears until a stream is downloaded.', '<b>Local Network Access:</b> see the shared note. The row line would name Chrome’s prompt.', '<b>Denied / expired:</b> on the row (frame 6). An expired request leaves the row at “Try again”.', '<b>Second browser:</b> the same first download in that browser. The card’s identity line shows “Connected here before” when relevant.', '<b>Disconnect:</b> Chrome goes silent again. The next stream download asks again.', '<b>Without a video:</b> popup Settings ▸ Downloads and ▸ Connection keep a Connect button (the A flow) for accent/quality sync.'],
      code: ['<b>popup.js:</b> remove the unpaired banner. Download on a desktop-only row sends <code>PAIR_START</code> with the pending download, and the row renders the inline strip and outcome lines.', '<b>service-worker.js:</b> <code>startPairing(message)</code> keeps the pending download in <code>storage.session</code>. On approve it POSTs the job with the new token; on deny/expire it hands the outcome to the row. Request headers are never written to <code>storage.local</code>.', '<b>Bridge:</b> <code>/v1/pair/request</code> accepts an optional, sanitized, display-only <code>{ title, host }</code>, never trusted for auth. Everything else is unchanged.', '<b>Desktop:</b> the card shows the video context and closes into the new row with a toast. The first run drops the pairing steps (“Then click SnagThis on any video”).', '<b>Spec §6/§8</b> and e2e updates, plus the extension-bridge tests for the queued first download.'],
      risks: ['A security question in the middle of a task can read as a nag. The video context and “first time only” copy have to carry it.', 'MV3 may stop the worker while it waits; the pending job must survive in storage.session. Signed URLs can expire during a slow Allow, so the job is re-inspected before starting.', 'Accent and preference sync stay offline until the first desktop download (or a manual Connect). That’s a larger spec change (§6 unpaired banner, §8 onboarding).', 'Harder to explain “what is connected” when nothing was ever set up.'],
    },
  },
];

/* ── Today: paths ── */
const T = n => `today/${n}.png`;
const shotStep = (side, img, copy, click, extra = {}) => ({ side, img, copy, click, ...extra });
const PATHS = [
  { title: 'Connect from the popup (SnagThis running)', clicks: 7, screens: 6, note: '5 clicks / 5 screens once Chrome remembers “Open SnagThis”.', steps: [
    shotStep('chrome', 'p03-unpaired-banner', 'Video list with the amber banner <q>Save supported files in Chrome. Connect SnagThis for streams and more.</q>', '1 · toolbar icon, 2 · Connect'),
    shotStep('chrome', 'p04-pairing-waiting', 'Sheet <q>Connect SnagThis</q> · <q>MATCH IN SNAGTHIS</q> · 4 digits · <q>Then choose Allow there.</q> · 12 pips · <q>Opening SnagThis… · 2:00</q> · Show SnagThis / Cancel · <q>SnagThis didn’t open? Use a code</q>. Unpacked copies show <q>DEV BUILD</q>.', null),
    { side: 'sys', mock: sysPrompt('Open SnagThis?', 'chrome-extension://… wants to open this application.', 'Open SnagThis', 'Cancel', 'Always allow'), copy: '1.2 s later the worker opens <code>snagthis://open/pair</code> in a tab, and Chrome asks before launching an external app (mock: headless Chromium can’t show it).', click: '3 · Open SnagThis (until remembered)', bad: true },
    { side: 'chrome', mock: '<b>Popup closes</b><br>Chrome closes it when SnagThis takes focus. The toolbar badge now carries the 4 digits.', copy: 'The digits to compare are now a 4-character badge.', click: null, bad: true },
    shotStep('desk', 'd04-approve-dialog', '<q>Connect Chrome?</q> · <q>Allow only if Chrome shows the same digits.</q> · cartridge · pips · <q>Chrome extension · ndnogh…cpclil · Not Web Store</q> · Deny / Allow (Allow arms for 700 ms) · <q>Different digits? Choose Deny.</q> 2:00', '4 · Allow'),
    shotStep('desk', 'd08-chrome-connected-dialog', '<q>CONNECTED</q> · <q>Downloads from Chrome now arrive here.</q> · green pips · <b>Done</b> (focused). Doesn’t close by itself.', '5 · Done', { bad: true }),
    shotStep('chrome', 'p10-reopen-connected-sheet', 'Badge ✓. The next popup opening shows the sheet again: <q>CONNECTED</q> · <q>Play a video, then choose Download.</q> · <b>Done</b> (focused). This is the owner’s “why?”.', '6 · toolbar icon, 7 · Done', { bad: true }),
    shotStep('chrome', 'p11-video-list-paired', 'Finally the list, with no banner.', null),
  ] },
  { title: 'Fresh install, desktop first', clicks: 11, screens: 10, note: 'Web Store steps are Chrome’s.', steps: [
    shotStep('desk', 'd01-first-launch', '<q>Download your first video</q> · <q>Paste a link above, or play a video in Chrome and click the SnagThis icon in the toolbar.</q> · <b>Add SnagThis to Chrome</b> · 3 numbered steps · <q>Already installed? Connect Chrome</q>', '1 · Add SnagThis to Chrome'),
    { side: 'sys', mock: '<b>Chrome Web Store</b><br>SnagThis listing → <b>Add to Chrome</b>, then Chrome’s <q>Add “SnagThis”?</q> → <b>Add extension</b>, then the “added” bubble', copy: 'Chrome-owned.', click: '2 · Add to Chrome, 3 · Add extension' },
    { side: 'chrome', mock: '<b>Find the icon</b><br>Extensions (puzzle) → SnagThis', copy: 'The extension isn’t pinned by default, so the steps say “Extensions (the puzzle icon) → SnagThis → Connect”.', click: '4 · puzzle, 5 · SnagThis' },
    { side: 'chrome', mock: '<b>Then the whole first path</b><br>Connect → Open SnagThis? → Allow → Done → reopen → Done', copy: 'Same as the path above, from Connect onwards.', click: '6 · Connect … 11 · Done', bad: true },
  ] },
  { title: 'Extension first, SnagThis not installed', clicks: 10, screens: 10, note: 'Plus the OS download and install.', steps: [
    shotStep('chrome', 'p01-app-not-running', '<q>Save supported files in Chrome. Open SnagThis for streams and more.</q> · <b>Open SnagThis</b>', '1 · toolbar icon, 2 · Open SnagThis'),
    shotStep('chrome', 'p02-get-the-app', 'Nothing answers <code>snagthis://open</code>, so 3 s later: <b>Get the app</b> and the footer <q>Don’t have the app? Get it</q>', '3 · Get the app'),
    { side: 'os', mock: '<b>snagthisvid.com</b><br>Download, install, open', copy: 'Outside SnagThis.', click: null },
    shotStep('desk', 'd01-first-launch', 'First run still says <b>Add SnagThis to Chrome</b>, although the extension is already installed: the desktop can’t know until the extension connects.', null, { bad: true }),
    { side: 'chrome', mock: '<b>Back to Chrome</b><br>popup → Connect → Open SnagThis? → Allow → Done → reopen → Done', copy: 'The whole first path.', click: '4 … 10', bad: true },
  ] },
  { title: 'Code fallback', clicks: 12, screens: 7, note: 'Shortest route. The popup closes when you switch to SnagThis.', steps: [
    shotStep('chrome', 'p06-code-sheet', '<q>Connect with a code</q> · <q>1. In the SnagThis desktop app, open Settings → Chrome extension → Show connection code.</q> · <q>2. Paste that code below…</q> · Connection code · <q>Six digits from the desktop app. Codes expire after 5 minutes.</q> · Connect / Open app settings', '1 · icon, 2 · Connect, 3 · Use a code'),
    shotStep('desk', 'd02-settings-chrome-unpaired', 'Settings ▸ Chrome extension: <q>Chrome isn’t connected</q> · <q>One-click connect</q> steps · <q>Use a code instead</q> · <q>For another browser, or if SnagThis didn’t come forward.</q>', '4 · Settings, 5 · Chrome extension'),
    shotStep('desk', 'd06-connection-code', 'Six digits with <q>Expires in 4:59</q> · <b>Copy code</b> (then <b>Get a new code</b> after expiry)', '6 · Show connection code, 7 · Copy code'),
    { side: 'chrome', mock: '<b>Reopen the popup</b><br>The code sheet is gone: Settings ▸ Connection ▸ Use a code instead', copy: 'Chrome closed the popup while you were in SnagThis.', click: '8 · icon, 9 · settings, 10 · Connection, 11 · Use a code instead', bad: true },
    shotStep('chrome', 'p07-code-connected-notice', 'Paste; six digits submit on their own. Notice: <q>Connected to SnagThis. Play a video in Chrome, then choose Download.</q>', '12 · paste'),
  ] },
  { title: 'Deny, time out, disconnect', clicks: null, screens: null, steps: [
    shotStep('desk', 'd05-denied-toast', 'Deny → toast <q>Chrome wasn’t connected. It can ask again in an hour.</q>', 'Deny'),
    shotStep('chrome', 'p05-denied', 'Next opening: sheet <q>Not connected</q> · <q>SnagThis chose Deny. Chrome can ask again in an hour.</q> · <b>Use a code</b> / Close', 'Close', { bad: true }),
    shotStep('chrome', 'p13-state-expired', 'After 2 min: <q>Timed out</q> · <q>Nothing was connected.</q> · <b>Try again</b> / Close · <q>Or use a code</q>. Desktop toast: <q>Chrome’s request timed out. Nothing was connected.</q>', 'Close', { bad: true }),
    shotStep('chrome', 'p08-settings-connection', 'Popup Settings ▸ Connection: <q>Connected to SnagThis</q> · <b>Disconnect</b>', 'Disconnect'),
    shotStep('chrome', 'p09-disconnected-banner', '<q>Disconnected from SnagThis. Supported files still save in Chrome.</q> · <b>Connect again</b> (the whole first path again)', null),
    shotStep('desk', 'd09-disconnect-confirm', 'Desktop Disconnect asks inline: <q>Chrome stops sending downloads here until you connect it again. Finished files and your library stay.</q>', 'Disconnect'),
  ] },
];
const SIDE = { chrome: 'Chrome', desk: 'SnagThis', sys: 'Chrome-owned', os: 'Web / OS' };
function renderPaths() {
  $('#paths').innerHTML = PATHS.map(p => `<div class="path"><div class="path-head"><h3>${p.title}</h3>${p.clicks ? `<span class="tally"><span class="hot"><b>${p.clicks}</b>clicks</span><span><b>${p.screens}</b>screens</span></span>` : ''}${p.note ? `<span style="color:var(--color-foreground-subtle);font-size:12px">${p.note}</span>` : ''}</div><div class="flow">${p.steps.map((s, i) => `<div class="step ${s.bad ? 'bad' : ''}"><span class="n">${i + 1}</span><div class="side s-${s.side}"><i></i>${SIDE[s.side]}</div>${s.img ? `<img src="${T(s.img)}" alt="${esc(s.img)}">` : `<div class="mockshot">${s.mock}</div>`}<div class="copy">${s.copy}</div><div class="click ${s.click ? '' : 'none'}">${s.click || 'no click'}</div></div>`).join('')}</div></div>`).join('');
  const all = ['d01-first-launch', 'd02-settings-chrome-unpaired', 'd03-settings-review-row', 'd04-approve-dialog', 'd05-denied-toast', 'd06-connection-code', 'd07-settings-connected', 'd08-chrome-connected-dialog', 'd09-disconnect-confirm', 'p01-app-not-running', 'p02-get-the-app', 'p03-unpaired-banner', 'p04-pairing-waiting', 'p05-denied', 'p06-code-sheet', 'p07-code-connected-notice', 'p08-settings-connection', 'p09-disconnected-banner', 'p10-reopen-connected-sheet', 'p11-video-list-paired', 'p12-state-starting', 'p13-state-expired', 'p14-state-waiting-store'];
  $('#gallery').innerHTML = all.map(n => `<figure><img src="${T(n)}" alt="${n}"><figcaption>${n}</figcaption></figure>`).join('');
  document.addEventListener('click', event => {
    const img = event.target.closest('.step img, .gallery img'); if (!img) return;
    const box = document.createElement('div'); box.className = 'lightbox'; box.innerHTML = `<img src="${img.src}" alt="">`; box.addEventListener('click', () => box.remove()); document.body.append(box);
  });
}

/* ── Options ── */
function stage(o, i) { const f = o.frames[i]; return `<div class="stage">${f.chrome()}${f.desk()}</div>`; }
function renderOption(o) {
  const host = document.createElement('section'); host.className = 'block option'; host.id = `opt-${o.id}`;
  host.innerHTML = `<div class="opt-head"><span class="badge">${o.id.toUpperCase()}</span><div><h2>${o.name}</h2><p>${o.pitch}</p></div>${o.id === 'b' ? '<span class="chosen-tag">Chosen</span>' : o.id === 'a' ? '<span class="chosen-tag fallback">Chosen as the popup-first fallback (banner only)</span>' : ''}<span class="tally" style="margin-left:auto"><span class="hot"><b>${o.clicks}</b>clicks</span><span><b>${o.screens}</b>pairing ${o.screens === 1 ? 'screen' : 'screens'}</span><span><b>0</b>dismiss clicks</span></span></div>
  <div class="player"><div class="player-bar"><button class="ctl" data-prev>← Back</button><button class="ctl primary" data-next>Next →</button><button class="ctl" data-play>▶ Auto-play</button><div class="dots" role="group" aria-label="Frames">${o.frames.map((f, i) => `<button class="${f.edge ? 'edge' : ''}" data-go="${i}" aria-label="Frame ${i + 1}${f.edge ? ' (edge case)' : ''}: ${esc(f.title)}">${i + 1}</button>`).join('')}</div><span class="counter" style="color:var(--color-foreground-subtle);font-size:12px">Orange = main path · amber = edge cases · ←/→ keys</span></div><div data-stage></div><div class="caption" aria-live="polite"></div></div>
  <div class="opt-notes"><div class="card"><h3>Edge cases</h3><ul>${o.notes.edges.map(x => `<li>${x}</li>`).join('')}</ul></div><div class="card"><h3>Code changes it implies</h3><ul>${o.notes.code.map(x => `<li>${x}</li>`).join('')}</ul></div><div class="card"><h3>Risks</h3><ul>${o.notes.risks.map(x => `<li>${x}</li>`).join('')}</ul></div></div>`;
  $('#options').append(host);
  let at = 0; let timer = null;
  const show = i => {
    at = (i + o.frames.length) % o.frames.length; const f = o.frames[at];
    host.querySelector('[data-stage]').innerHTML = stage(o, at);
    host.querySelector('.caption').innerHTML = `<h4>${at + 1}. ${f.title}${f.edge ? '<small>edge case</small>' : ''}</h4><p>${f.text}</p><div class="act">${f.act}</div>`;
    host.querySelectorAll('[data-go]').forEach((b, k) => { if (k === at) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  };
  host.querySelector('[data-prev]').onclick = () => show(at - 1);
  host.querySelector('[data-next]').onclick = () => show(at + 1);
  host.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => show(Number(b.dataset.go)); });
  const play = host.querySelector('[data-play]');
  play.onclick = () => { if (timer) { clearInterval(timer); timer = null; play.textContent = '▶ Auto-play'; return; } play.textContent = '❚❚ Pause'; timer = setInterval(() => show(at + 1), 3200); };
  host.addEventListener('keydown', e => { if (e.key === 'ArrowRight') show(at + 1); if (e.key === 'ArrowLeft') show(at - 1); });
  host.tabIndex = -1;
  show(0);
}
function renderCompare() {
  const rows = [
    ['Happy path clicks', '<span class="big">7</span>(5 once Chrome remembers)', '<span class="big">3</span>', '<span class="big">2</span>(3 from Settings)', '<span class="big">3</span>(2 of them are the download itself; +1 for pairing)'],
    ['Pairing screens', '<span class="big">6</span>banner, sheet, Chrome prompt, approve, desktop Connected, popup Connected', '<span class="big">2</span>banner strip, approve card', '<span class="big">2</span>listening card, popup strip', '<span class="big">1</span>approve card (plus a row strip)'],
    ['Clicks just to dismiss', '2 (Done, Done)', '0', '0', '0'],
    ['Lingers on the next popup opening', 'Full Connected sheet until Done', '2 s green line', '2 s green line', 'Nothing: the row is downloading'],
    ['Digits visible side by side', 'No: the popup closes, so you compare against the badge', 'Yes (card shown without focus)', 'Yes', 'Yes'],
    ['Chrome “Open SnagThis?” prompt', 'Every first pairing', 'Only if SnagThis isn’t running', 'Never on the desktop-led path', 'Only if SnagThis isn’t running'],
    ['Fresh install, desktop first', '11 clicks', '7 (store 3 + find the icon 2 + Connect + Allow)', '6 (store 3 + find the icon 2 + Allow)', '7 (store 3 + find the icon 2 + Download + Allow)'],
    ['Security check', 'Allow in SnagThis + digits', 'Unchanged', 'Unchanged (auto-request only while the desktop is listening)', 'Unchanged, with display-only video context'],
    ['Code fallback', 'In the main sheet footer', 'Settings ▸ Connection', 'Settings, and a link on the listening card', 'Settings, and on the Deny row'],
    ['Bridge API change', '—', 'None', 'Listening flag on /v1/health', 'Optional display context on /v1/pair/request'],
    ['Size of change', '—', 'Small–medium: popup banner, worker, main.js surfacing, dialog auto-close', 'Medium: A + desktop listening card + health flag', 'Large: A + queued first download + spec §6/§8 rewrite'],
    ['Main risk', 'Owner says: too many screens', 'OS differences in showing without focus', 'Chrome side is invisible until the popup is opened', 'Security prompt mid-task; MV3 worker lifetime'],
  ];
  $('#cmp').innerHTML = `<thead><tr><th></th><th>Today</th><th>A · One tap</th><th>B · Pair from the desktop</th><th>C · Silent until needed</th></tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i > 1 && /^<span class="big">[0-3]</.test(c) ? 'best' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

/* ── Screenshot mode ── */
const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot) {
  const o = OPTIONS.find(x => x.id === shot);
  document.body.classList.add('shot');
  const frame = params.has('frame') ? Number(params.get('frame')) : (o.previewFrame ?? 1);
  const f = o.frames[frame];
  $('#shot-root').innerHTML = `<div class="shot-head"><span class="opt-head"><span class="badge">${o.id.toUpperCase()}</span></span><div><h2>${o.name} · ${frame + 1}. ${f.title}</h2><p>${params.has('frame') ? `${f.act}` : o.pitch}</p></div><span class="tally"><span class="hot"><b>${o.clicks}</b>clicks</span><span><b>${o.screens}</b>${o.screens === 1 ? 'screen' : 'screens'}</span></span></div>${stage(o, frame)}`;
} else {
  renderPaths();
  OPTIONS.forEach(renderOption);
  renderCompare();
}
window.__frames = Object.fromEntries(OPTIONS.map(o => [o.id, o.frames.length]));
})();
