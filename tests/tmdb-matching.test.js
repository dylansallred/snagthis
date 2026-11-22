const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inferMediaMetadata,
  cleanLookupTitle,
  extractReleaseYear,
} = require('../packages/downloader-api/src/utils/mediaMetadata');
const {
  selectBestTmdbCandidate,
  scoreRuntimeDelta,
} = require('../packages/downloader-api/src/services/tmdb');

test('extractReleaseYear and cleanLookupTitle separate title and release year', () => {
  assert.equal(extractReleaseYear('The Cat in the Hat (2003)'), 2003);
  assert.equal(cleanLookupTitle('The Cat in the Hat (2003)'), 'The Cat in the Hat');

  assert.equal(extractReleaseYear('Dune.2021.1080p.WEB-DL.mp4'), 2021);
  assert.equal(cleanLookupTitle('Dune.2021.1080p.WEB-DL.mp4'), 'Dune');

  // Numeric movie titles without preceding text must not be stripped as years
  assert.equal(extractReleaseYear('1917'), null);
  assert.equal(cleanLookupTitle('1917'), '1917');
});

test('inferMediaMetadata exposes releaseYear alongside cleaned lookupTitle', () => {
  const hints = inferMediaMetadata({
    title: 'The Cat in the Hat (2003)',
    mediaUrl: 'https://cdn.example.com/hls/master.m3u8',
  });

  assert.equal(hints.lookupTitle, 'The Cat in the Hat');
  assert.equal(hints.releaseYear, 2003);
  assert.equal(hints.isTvCandidate, false);
});

test('selectBestTmdbCandidate prefers matching release year over first search result', () => {
  const results = [
    {
      id: 1001,
      title: 'The Cat in the Hat',
      release_date: '2026-11-06',
      poster_path: '/new.jpg',
      vote_count: 10,
    },
    {
      id: 10588,
      title: 'The Cat in the Hat',
      release_date: '2003-11-21',
      poster_path: '/old.jpg',
      vote_count: 1600,
    },
  ];

  const pickedWithYear = selectBestTmdbCandidate(results, {
    title: 'The Cat in the Hat',
    year: 2003,
    today: '2026-11-21',
  });
  assert.equal(pickedWithYear.id, 10588);

  // Even without an explicit year, an unreleased future movie should lose to a released exact match
  const pickedBeforeRelease = selectBestTmdbCandidate(results, {
    title: 'The Cat in the Hat',
    today: '2026-05-01',
  });
  assert.equal(pickedBeforeRelease.id, 10588);
});

test('scoreRuntimeDelta rewards close runtime matches and penalizes large mismatches', () => {
  const fileSeconds = 81.8 * 60;
  assert.ok(scoreRuntimeDelta(82, fileSeconds) > 0);
  assert.ok(scoreRuntimeDelta(108, fileSeconds) < 0);
  assert.ok(scoreRuntimeDelta(82, fileSeconds) > scoreRuntimeDelta(108, fileSeconds));
});
