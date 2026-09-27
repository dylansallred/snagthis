// Node's CommonJS loader runs this file with `this` bound to the exports object;
// classic scripts bind the global object and ES modules leave it undefined. Avoiding
// the free `module` identifier keeps bundlers from wrapping the file in a CommonJS shim.
(function (exported, factory) {
  if (exported) Object.assign(exported, factory());
  else globalThis.SnagThisStrings = factory();
})(this && this !== globalThis ? this : null, function () {
  'use strict';
  const strings = Object.freeze({
    untitled: 'Untitled video', waiting: 'Waiting', waitingNext: 'Waiting · starts next',
    finishing: 'Finishing up…', saved: 'Saved', today: 'today', yesterday: 'yesterday',
    underMinute: 'under a minute left', minutesLeft: '{m} min left', hoursLeft: '{h} hr {m} min left',
    paused: 'Paused at {pct}%', savedWhen: 'Saved {when}', about: 'about {size}',
    expired: 'Link expired. Reopen the page to continue from {pct}%.',
    expiredOnPage: 'Link expired at {pct}%. Play the video, then click Download to continue.',
    signInRequired: 'Sign-in required to download this video.', useChromeSession: 'Use Chrome sign-in',
    connectionLost: 'Connection lost at {pct}%', diskFull: 'Not enough space in {folder}',
    unsupported: "This video can't be downloaded", missing: 'File was moved or deleted',
    unknownProblem: 'Something went wrong at {pct}%',
    qualityUnavailable: "This quality isn't available from the source. Choose another quality.",
    qualityFallback: '{to}p — {from}p unavailable', saveFolder: 'your save folder',
    // DRM-protected streaming: SnagThis never records, decrypts or saves it.
    drmProtected: "Protected by {site} (DRM) — SnagThis can't save it", drmWhy: 'Why?',
    drmHelpTitle: 'Protected video',
    drmHelpBody: '{site} locks this video with DRM (digital rights management), so it only plays inside its own player. SnagThis respects that: it never records, unlocks or saves protected video.',
    drmHelpOthers: 'Other videos on this page that are not protected are still listed and can be saved.',
    drmThisSite: 'this site',
    download: 'Download', pause: 'Pause', resume: 'Resume', resumeDownload: 'Resume download', play: 'Play',
    openPage: 'Open page', retry: 'Try again', chooseFolder: 'Choose folder', locate: 'Locate', details: 'Details',
    weekdays: Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']),
    months: Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']),
  });
  function interpolate(key, values) {
    return String(strings[key] || key).replace(/\{(\w+)\}/g, function (_, name) {
      return values && values[name] !== undefined ? String(values[name]) : '';
    });
  }
  return { strings: strings, interpolate: interpolate };
});
