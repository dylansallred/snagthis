const {
  extractYear,
  getMediaType,
  resolveEpisodeInfo,
  resolvePreferredMediaTitle,
} = require('./plexNaming');

function pushTag(args, key, value) {
  const text = String(value || '').trim();
  if (!text) return;
  args.push('-metadata', `${key}=${text}`);
}

function buildFfmpegMetadataArgs(job) {
  const args = [];
  const title = resolvePreferredMediaTitle(job);
  const mediaType = getMediaType(job);
  const year = extractYear(job && job.tmdbReleaseDate);
  const genres = Array.isArray(job && job.tmdbMetadata && job.tmdbMetadata.genres)
    ? job.tmdbMetadata.genres.filter(Boolean)
    : [];

  pushTag(args, 'title', title);
  pushTag(args, 'comment', job && job.tmdbMetadata && job.tmdbMetadata.overview);
  pushTag(args, 'description', job && job.tmdbMetadata && job.tmdbMetadata.overview);
  pushTag(args, 'genre', genres.join(', '));
  pushTag(args, 'date', year);

  if (mediaType === 'tv') {
    const { seasonNumber, episodeNumber } = resolveEpisodeInfo(job);
    pushTag(args, 'show', title);
    pushTag(args, 'media_type', '10');
    if (Number.isFinite(seasonNumber)) {
      pushTag(args, 'season_number', seasonNumber);
    }
    if (Number.isFinite(episodeNumber)) {
      pushTag(args, 'episode_sort', episodeNumber);
      pushTag(args, 'episode_id', `S${String(seasonNumber || 0).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`);
    }
  } else {
    pushTag(args, 'media_type', '9');
  }

  return args;
}

module.exports = {
  buildFfmpegMetadataArgs,
};
