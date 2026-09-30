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
    // Pairing in the Chrome popup (docs/design/prototypes/pairing-simple: B + A's one-tap banner). One inline line each.
    pairOffer: 'Connect SnagThis desktop for streams and more.', pairConnect: 'Connect',
    pairConnecting: 'Connecting to SnagThis on this computer', pairStarting: 'Asking SnagThis for four digits…',
    pairChooseAllow: 'Choose Allow there if the digits match', pairConnected: 'Connected to SnagThis',
    pairDenied: 'SnagThis chose Deny. Chrome can ask again in an hour.',
    pairBlocked: 'SnagThis chose Deny less than an hour ago, so Chrome can’t ask again yet.',
    pairExpired: 'Timed out. Nothing was connected.',
    pairConflict: 'Two requests arrived at once, so SnagThis cancelled both.',
    pairLimited: 'Too many requests. Wait a few minutes, or use a code.',
    pairOffline: 'SnagThis isn’t reachable. Open it, then try again.',
    pairFailed: 'Couldn’t connect to SnagThis.',
    pairUseCode: 'Use a code instead', pairUseCodeShort: 'Use a code', pairShowApp: 'Show SnagThis', pairMore: 'More ways to connect',
    pairSettingsHint: 'SnagThis shows four digits to check, then you choose Allow there. ',
    // Preview player (docs/design/prototypes/preview-player: A · Cinema). Desktop guidance repeats the popup's.
    playerPreview: 'Preview', playerLoading: 'Loading preview', playerHlsStream: 'HLS stream', playerVideoFile: 'Video file',
    playerSnag: 'Snag it', playerSnagging: 'Sending…', playerViaDesktop: 'Downloads with SnagThis', playerViaChrome: 'Saves in Chrome',
    playerNeedsDesktop: 'Needs SnagThis for desktop', playerSentDesktop: 'Sent to SnagThis', playerSentChrome: 'Saving in Chrome',
    playerSnagQuality: 'Snag it saves the quality you pick.', playerAuto: 'Auto', playerAutoNow: 'now {quality}', playerNormalSpeed: 'Normal',
    playerSubtitlesOff: 'Off', playerSubtitlesKey: 'Press C to turn subtitles on or off.',
    playerDesktopNeeded: 'Open SnagThis and connect Chrome to try this download. The desktop app handles supported streams, audio and subtitle choices, and your SnagThis library.',
    playerUpdateApp: 'Update SnagThis to use desktop downloads.', playerUpdateExtension: 'Update the Chrome extension to use desktop downloads.',
    playerOnlyOnPage: 'This video plays only on its page', playerUnavailable: 'Preview unavailable',
    playerBlocked: "{site} wouldn't let the preview load it here.", playerFailed: "The preview couldn't load this video here.",
    playerDash: 'This video can only be previewed on its page. Open the page to play it.',
    playerNoBrowser: 'This browser cannot preview this video. Open the page to play it.',
    playerUnsupported: 'This preview source is unsupported. Open the page to play the video.',
    playerStillSnag: 'You can still watch it on the page, try again, or snag it.', playerStill: 'You can still watch it on the page or try again.',
    playerWhy: "Why can't it play here?", playerWhyBlocked: 'The site answered not allowed (403) to the preview.',
    playerWhyTied: 'Some sites tie videos to their own page, sign-in or player.', playerWhyDrm: 'SnagThis never plays or saves copy-protected (DRM) video.',
    playerExpired: 'This preview expired', playerExpiredBody: 'Previews open for 10 minutes after you choose them. Choose Preview in SnagThis again to reload it.',
    playerSnagAnyway: 'Snag it anyway',
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
