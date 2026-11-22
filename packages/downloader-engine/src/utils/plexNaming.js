function extractYear(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

function padNumber(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return String(parsed).padStart(2, '0');
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EPISODE_TITLE_PATTERNS = [
  /(?:^|[\s._\-([])[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})(?:$|[\s._\-)\]])/,
  /(?:^|[\s._\-([])(\d{1,2})[xX](\d{1,3})(?:$|[\s._\-)\]])/,
  /\bSeason[\s._-]*(\d{1,2})[\s._-]*Episode[\s._-]*(\d{1,3})\b/i,
];

function parseEpisodeFromText(value) {
  const text = String(value || '');
  if (!text.trim()) return null;
  for (const pattern of EPISODE_TITLE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const seasonNumber = Number.parseInt(match[1], 10);
    const episodeNumber = Number.parseInt(match[2], 10);
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) continue;
    if (seasonNumber < 0 || seasonNumber > 99 || episodeNumber < 0 || episodeNumber > 999) continue;
    const stripped = normalizeWhitespace(
      text.slice(0, match.index).replace(/[-–—_([.]+$/, ''),
    );
    return {
      seasonNumber,
      episodeNumber,
      cleanTitle: stripped || null,
    };
  }
  return null;
}

function toValidNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function resolveEpisodeInfo(job) {
  const hintedSeason = toValidNumber(job && job.mediaHints && job.mediaHints.seasonNumber);
  const hintedEpisode = toValidNumber(job && job.mediaHints && job.mediaHints.episodeNumber);
  if (hintedSeason !== null || hintedEpisode !== null) {
    return { seasonNumber: hintedSeason, episodeNumber: hintedEpisode, cleanTitle: null };
  }
  const fromTitle = parseEpisodeFromText(job && job.title);
  if (fromTitle) return fromTitle;
  const fromDownloadName = parseEpisodeFromText(job && job.downloadName);
  if (fromDownloadName) return fromDownloadName;
  return { seasonNumber: null, episodeNumber: null, cleanTitle: null };
}

function titleAlreadyIncludesYear(title, year) {
  const normalizedTitle = normalizeWhitespace(title);
  const normalizedYear = String(year || '').trim();
  if (!normalizedTitle || !normalizedYear) return false;
  return (
    normalizedTitle.endsWith(`(${normalizedYear})`)
    || new RegExp(`\\b${normalizedYear}\\b`).test(normalizedTitle)
  );
}

function getMediaType(job) {
  if (job && job.tmdbMetadata && job.tmdbMetadata.mediaType === 'tv') return 'tv';
  const { seasonNumber, episodeNumber } = resolveEpisodeInfo(job);
  if (Number.isFinite(seasonNumber) && Number.isFinite(episodeNumber)) return 'tv';
  if (job && job.tmdbMetadata && job.tmdbMetadata.mediaType === 'movie') return 'movie';
  if (job && job.mediaHints && job.mediaHints.isTvCandidate) return 'tv';
  return 'movie';
}

function stripEpisodeMarker(title) {
  const parsed = parseEpisodeFromText(title);
  return (parsed && parsed.cleanTitle) || title;
}

function resolvePreferredMediaTitle(job) {
  const manualTitle = normalizeWhitespace(job && job.title);
  const hintedTitle = normalizeWhitespace(job && job.mediaHints && job.mediaHints.lookupTitle);
  const tmdbTitle = normalizeWhitespace(job && job.tmdbTitle);
  const rawTitle = normalizeWhitespace(job && job.title);
  const isTv = getMediaType(job) === 'tv';

  if (job && job.manualTitleOverride) {
    const picked = hintedTitle || manualTitle || 'Download';
    return isTv ? stripEpisodeMarker(picked) : picked;
  }

  const picked = tmdbTitle || hintedTitle || rawTitle || 'Download';
  return isTv ? stripEpisodeMarker(picked) : picked;
}

function buildPlexBaseName(job) {
  const mediaType = getMediaType(job);
  const fallbackTitle = resolvePreferredMediaTitle(job);
  const year = extractYear(job && job.tmdbReleaseDate);

  if (mediaType === 'tv') {
    const { seasonNumber, episodeNumber } = resolveEpisodeInfo(job);
    const season = padNumber(seasonNumber);
    const episode = padNumber(episodeNumber);
    const showName = year && !titleAlreadyIncludesYear(fallbackTitle, year)
      ? `${fallbackTitle} (${year})`
      : fallbackTitle;

    if (season && episode) {
      return `${showName} - S${season}E${episode}`;
    }
    if (season) {
      return `${showName} - Season ${season}`;
    }
    return showName;
  }

  if (year && !titleAlreadyIncludesYear(fallbackTitle, year)) {
    return `${fallbackTitle} (${year})`;
  }
  return fallbackTitle;
}

module.exports = {
  buildPlexBaseName,
  extractYear,
  getMediaType,
  parseEpisodeFromText,
  resolveEpisodeInfo,
  resolvePreferredMediaTitle,
};
