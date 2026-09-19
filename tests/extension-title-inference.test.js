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
