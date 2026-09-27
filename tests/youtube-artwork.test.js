const test = require('node:test');
const assert = require('node:assert/strict');
const { youtubeArtwork, youtubeVideoIdOf } = require('../packages/downloader-api/src/utils/youtubeArtwork');

test('YouTube artwork is kept only when it is this video’s thumbnail', () => {
  const id = 'v2yscspL_AQ';
  const own = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  assert.equal(youtubeArtwork(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, id), `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`);
  // Generic logo card and a previous video's thumbnail are replaced with this video's own.
  assert.equal(youtubeArtwork('https://www.youtube.com/img/desktop/yt_1200.png', id), own);
  assert.equal(youtubeArtwork('https://i.ytimg.com/vi/previous123/hqdefault.jpg', id), own);
  // Without a known video, generic YouTube images are dropped and thumbnails kept.
  assert.equal(youtubeArtwork('https://www.youtube.com/img/desktop/yt_1200.png', ''), '');
  assert.equal(youtubeArtwork('https://i.ytimg.com/vi/other12345/hqdefault.jpg', ''), 'https://i.ytimg.com/vi/other12345/hqdefault.jpg');
  // Artwork from other sites, local files and data images are not YouTube's to judge.
  for (const value of ['https://image.tmdb.org/t/p/w500/poster.jpg', '/downloads/job/poster.jpg', 'data:image/jpeg;base64,AAAA']) {
    assert.equal(youtubeArtwork(value, id), value);
  }
});

test('a job’s YouTube video id comes from its metadata or its links', () => {
  assert.equal(youtubeVideoIdOf({ youtubeMetadata: { videoId: 'v2yscspL_AQ' } }), 'v2yscspL_AQ');
  assert.equal(youtubeVideoIdOf({ url: 'https://www.youtube.com/watch?v=v2yscspL_AQ' }), 'v2yscspL_AQ');
  assert.equal(youtubeVideoIdOf({ sourcePageUrl: 'https://youtu.be/v2yscspL_AQ' }), 'v2yscspL_AQ');
  assert.equal(youtubeVideoIdOf({ url: 'https://example.com/video.mp4' }), '');
});
