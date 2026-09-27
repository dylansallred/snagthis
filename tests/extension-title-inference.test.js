const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPopupTitleHelpers() {
  return require('../apps/extension/popup/titles');
}

function loadPopupJobPayloadHelpers() {
  const helpers = require('../apps/extension/popup/titles');
  helpers.setActiveTab({ title: 'Fallback Page', url: 'https://example.com/watch' });
  return helpers;
}

function loadMediaDetectorHelpers() {
  const detectorPath = path.join(__dirname, '..', 'apps', 'extension', 'js', 'media-detector.js');
  const source = fs.readFileSync(detectorPath, 'utf8');
  const start = source.indexOf('function resolveRequestUrl(');
  const end = source.indexOf('function absolute(');

  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Failed to locate media detector helper block');
  }

  const script = [
    source.slice(start, end),
    'globalThis.__mediaDetectorHelpers = { resolveRequestUrl };',
  ].join('\n');

  const context = {
    URL,
    globalThis: {},
  };

  vm.createContext(context);
  vm.runInContext(script, context);
  return context.globalThis.__mediaDetectorHelpers;
}

test('popup title inference ignores generic subtitles labels', () => {
  const { getDisplayTitle, inferTitleHints, stripTitleNoise } = loadPopupTitleHelpers();

  const item = {
    sourcePageTitle: 'Step Up',
    sourcePageUrl: 'https://www.cineby.gd/movie/9762',
    filename: 'aW5kZXgubTN1OA==.m3u8',
    url: 'https://example.com/aW5kZXgubTN1OA==.m3u8',
    pageTitleCandidates: [
      { source: 'document.title', value: 'Step Up' },
      { source: 'dom.text', value: 'Subtitles' },
      { source: 'url.pathname', value: 'movie 9762' },
    ],
    resourceSignals: [],
    pageEpisodeHint: null,
    youtubeMetadata: null,
    pageIsTvContext: false,
    mediaKind: 'hls-manifest',
    contentType: 'application/vnd.apple.mpegurl',
  };

  assert.equal(stripTitleNoise('Subtitles'), '');

  const displayTitle = getDisplayTitle(item);
  assert.equal(displayTitle, 'Step Up');

  const hints = inferTitleHints(item, item.sourcePageTitle, displayTitle);
  assert.equal(hints.lookupTitle, 'Step Up');
  assert.equal(hints.isTvCandidate, false);
});

test('popup job payload prefers a custom title override before sending to app', () => {
  const { buildJobPayload, setCustomTitleOverride } = loadPopupJobPayloadHelpers();

  const item = {
    id: 'media-1',
    type: 'hls',
    url: 'https://example.com/severance.1x09.m3u8',
    filename: 'severance.1x09.m3u8',
    sourcePageTitle: 'Wrong Title',
    sourcePageUrl: 'https://example.com/watch',
    requestHeaders: {},
    fallbackUrl: '',
    youtubeMetadata: null,
    pageTitleCandidates: [],
    resourceSignals: [],
    pageEpisodeHint: null,
    pageIsTvContext: false,
    mediaKind: 'hls-manifest',
    contentType: 'application/vnd.apple.mpegurl',
  };

  setCustomTitleOverride(item, 'Severance 1x09 The We We Are');
  const payload = buildJobPayload(item, 'Severance 1x09 The We We Are');

  assert.equal(payload.title, 'Severance 1x09 The We We Are');
  assert.equal(payload.resourceName, 'Severance 1x09 The We We Are');
  assert.equal(payload.titleHints.lookupTitle, 'Severance 1x09 The We We Are');
  assert.equal(payload.titleHints.seasonNumber, 1);
  assert.equal(payload.titleHints.episodeNumber, 9);
});

test('popup job payload does not auto-append episode tag when title override is manual', () => {
  const { buildJobPayload, setCustomTitleOverride } = loadPopupJobPayloadHelpers();

  const item = {
    id: 'media-2',
    type: 'hls',
    url: 'https://example.com/thedinosaurs.1x01.m3u8',
    filename: 'thedinosaurs.1x01.m3u8',
    sourcePageTitle: 'The Dinosaurs',
    sourcePageUrl: 'https://example.com/watch',
    requestHeaders: {},
    fallbackUrl: '',
    youtubeMetadata: null,
    pageTitleCandidates: [],
    resourceSignals: [],
    pageEpisodeHint: null,
    pageIsTvContext: false,
    mediaKind: 'hls-manifest',
    contentType: 'application/vnd.apple.mpegurl',
  };

  setCustomTitleOverride(item, 'The Dinosaurs');
  const payload = buildJobPayload(item, 'The Dinosaurs');

  assert.equal(payload.title, 'The Dinosaurs');
  assert.equal(payload.resourceName, 'The Dinosaurs');
  assert.equal(payload.titleHints.seasonNumber, 1);
  assert.equal(payload.titleHints.episodeNumber, 1);
});

test('manual title override remains exact text even when source looks episodic', () => {
  const { getDisplayTitle } = loadPopupTitleHelpers();
  const item = {
    sourcePageTitle: 'The Dinosaurs',
    sourcePageUrl: 'https://example.com/show/1',
    filename: 'thedinosaurs.1x01.m3u8',
    url: 'https://example.com/thedinosaurs.1x01.m3u8',
    pageTitleCandidates: [],
    resourceSignals: [],
    pageEpisodeHint: null,
    youtubeMetadata: null,
    pageIsTvContext: false,
    mediaKind: 'hls-manifest',
    contentType: 'application/vnd.apple.mpegurl',
  };

  assert.equal(getDisplayTitle(item), 'The Dinosaurs');
});

test('media detector resolves URL objects passed to fetch', () => {
  const { resolveRequestUrl } = loadMediaDetectorHelpers();
  const url = new URL('https://media.example.com/master.m3u8');

  assert.equal(resolveRequestUrl(url), 'https://media.example.com/master.m3u8');
});

test('settled same-page titles beat stale brand metadata without leaking across navigation', () => {
  const helpers = loadPopupTitleHelpers();
  const item = {
    sourcePageTitle: 'Acme Video',
    sourcePageUrl: 'https://acmevideo.test/watch/movie/42',
    filename: 'master.m3u8',
    url: 'https://media.example.test/master.m3u8',
    type: 'hls',
    pageTitleCandidates: [
      { source: 'document.title', value: 'Acme Video' },
      { source: 'meta[property="og:title"]', value: 'Acme Video' },
    ],
  };
  try {
    helpers.setActiveTab({ url: item.sourcePageUrl, title: 'Ember: Across the Sea - Acme Video' });
    assert.equal(helpers.getDisplayTitle(item), 'Ember: Across the Sea');
    const payload = helpers.buildJobPayload(item);
    assert.equal(payload.title, 'Ember: Across the Sea');
    assert.equal(payload.titleHints.lookupTitle, 'Ember: Across the Sea');
    assert.equal(payload.sourcePageTitle, 'Ember: Across the Sea - Acme Video');

    // Genuine content metadata still wins over a generic browser heading.
    assert.equal(helpers.getDisplayTitle({ ...item, pageTitleCandidates: [
      { source: 'meta[property="og:title"]', value: 'The Original Cut' },
    ] }), 'The Original Cut');

    helpers.setActiveTab({ url: 'https://acmevideo.test/watch/movie/99', title: 'A Different Movie - Acme Video' });
    assert.equal(helpers.getDisplayTitle({ ...item, sourcePageTitle: 'Ember: Across the Sea - Acme Video' }), 'Ember: Across the Sea');
  } finally {
    helpers.setActiveTab(null);
  }
});

test('brand-only YouTube metadata falls back to the real page title without overriding genuine video metadata', () => {
  const helpers = loadPopupTitleHelpers();
  const item = {
    sourcePageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    sourcePageTitle: 'YouTube',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    mediaKind: 'youtube-page', contentType: 'video/youtube', type: 'file',
    youtubeMetadata: { videoId: 'abcdefghijk', title: 'YouTube' },
  };
  try {
    helpers.setActiveTab({ url: item.sourcePageUrl, title: 'The Actual Video - YouTube' });
    assert.equal(helpers.getDisplayTitle(item), 'The Actual Video');
    assert.equal(helpers.buildJobPayload(item).title, 'The Actual Video');
    helpers.setActiveTab({ url: item.sourcePageUrl, title: 'YouTube' });
    assert.equal(helpers.getDisplayTitle({ ...item, youtubeMetadata: { ...item.youtubeMetadata, title: 'Verified Video Title' } }), 'Verified Video Title', 'a loading tab title cannot replace genuine video metadata');
  } finally {
    helpers.setActiveTab(null);
  }
});

test('a page title that already names the episode as S4:E9 does not gain a second S04E09 tag', () => {
  const { buildJobPayload } = loadPopupJobPayloadHelpers();
  const { getDisplayTitle } = loadPopupTitleHelpers();
  const item = {
    id: 'media-colon-episode',
    type: 'hls',
    url: 'https://cdn.example.com/stream/index.m3u8',
    filename: 'index.m3u8',
    sourcePageTitle: 'Star Trek: Strange New Worlds S4:E9',
    sourcePageUrl: 'https://example.com/tv/12345/4/9',
    requestHeaders: {},
    fallbackUrl: '',
    youtubeMetadata: null,
    pageTitleCandidates: [],
    resourceSignals: [],
    pageEpisodeHint: { seasonNumber: 4, episodeNumber: 9 },
    pageIsTvContext: true,
    mediaKind: 'hls-manifest',
    contentType: 'application/vnd.apple.mpegurl',
  };
  const payload = buildJobPayload(item);
  assert.equal(payload.titleHints.seasonNumber, 4);
  assert.equal(payload.titleHints.episodeNumber, 9);
  assert.doesNotMatch(payload.title, /S04E09/);
  assert.match(payload.title, /S4:E9$/);
  assert.doesNotMatch(getDisplayTitle(item), /S04E09/);
  for (const written of ['Show S4 · E9', 'Show S04.E09', 'Show Season 4 Episode 9', 'Show 4x09']) {
    const title = buildJobPayload({ ...item, id: written, sourcePageTitle: written }).title;
    assert.equal((title.match(/\b(?:s\s*0*4\W*e\s*0*9|4x0*9)\b/gi) || []).length, 1, `${written} → ${title} names the episode exactly once`);
  }
  // A different episode in the title still receives the real tag.
  assert.match(buildJobPayload({ ...item, id: 'other', sourcePageTitle: 'Show S4:E8 recap' }).title, /S04E09$/);
});

test('several differently titled detections on one page keep their own titles instead of the tab title', () => {
  const helpers = loadPopupTitleHelpers();
  const page = 'https://videos.example/watch';
  const film = (id, title) => ({ id, url: `https://videos.example/${id}.mp4`, sourcePageUrl: page, sourcePageTitle: title, pageTitleCandidates: [{ source: 'document.title', value: title }] });
  const items = [film('sintel', 'Sintel — an open movie'), film('bunny', 'Big Buck Bunny'), film('steel', 'Tears of Steel')];
  try {
    helpers.setActiveTab({ title: 'Open movies', url: page });
    helpers.setPageItems(items);
    assert.deepEqual(items.map(helpers.getDisplayTitle), ['Sintel — an open movie', 'Big Buck Bunny', 'Tears of Steel']);
    assert.equal(helpers.buildJobPayload(items[1]).title, 'Big Buck Bunny');
    // One detection, or several sharing the captured page title, still follow the settled tab title.
    helpers.setPageItems([items[0]]);
    assert.equal(helpers.getDisplayTitle(items[0]), 'Open movies');
    helpers.setPageItems([items[0], { ...items[1], sourcePageTitle: items[0].sourcePageTitle }]);
    assert.equal(helpers.getDisplayTitle(items[0]), 'Open movies');
    // An untitled detection falls back to the tab title.
    helpers.setPageItems(items);
    assert.equal(helpers.getDisplayTitle({ id: 'untitled', url: 'https://videos.example/master.m3u8', sourcePageUrl: page }), 'Open movies');
  } finally {
    helpers.setPageItems([]);
    helpers.setActiveTab(null);
  }
});
