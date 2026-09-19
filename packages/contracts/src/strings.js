(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VidSnagStrings = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const strings = Object.freeze({
    untitled: 'Untitled video', waiting: 'Waiting', waitingNext: 'Waiting · starts next',
    finishing: 'Finishing up…', saved: 'Saved', today: 'today', yesterday: 'yesterday',
    underMinute: 'under a minute left', minutesLeft: '{m} min left', hoursLeft: '{h} hr {m} min left',
    paused: 'Paused at {pct}%', savedWhen: 'Saved {when}', about: 'about {size}',
    expired: 'Link expired. Reopen the page to continue from {pct}%.',
    connectionLost: 'Connection lost at {pct}%', diskFull: 'Not enough space in {folder}',
    unsupported: "This video can't be downloaded", missing: 'File was moved or deleted',
    unknownProblem: 'Something went wrong at {pct}%', saveFolder: 'your save folder',
    download: 'Download', pause: 'Pause', resume: 'Resume', play: 'Play',
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
