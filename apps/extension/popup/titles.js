(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VidSnagTitles = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
let activeTab = null;
const customTitleOverrides = new Map();
function getSendKey(item) {
  if (item && item.id) return String(item.id);
  return String(item && item.url || '');
}

function normalizeCustomTitleOverride(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getCustomTitleOverride(item) {
  return customTitleOverrides.get(getSendKey(item)) || '';
}

function setCustomTitleOverride(item, value) {
  const sendKey = getSendKey(item);
  const normalized = normalizeCustomTitleOverride(value);
  if (!normalized) {
    customTitleOverrides.delete(sendKey);
    return '';
  }
  customTitleOverrides.set(sendKey, normalized);
  return normalized;
}

function tryDecodeBase64(str) {
  try {
    const cleaned = str.replace(/[~]/g, '/');
    const decoded = atob(cleaned);
    if (/^[\x20-\x7E]+$/.test(decoded)) return decoded;
  } catch { /* not valid base64 */ }
  return null;
}

function extractResolution(url) {
  // Check for common resolution patterns in URL path
  const plainMatch = url.match(/[\/_\-.](\d{3,4})[pP](?:[\/_\-.]|$)/);
  if (plainMatch) return `${plainMatch[1]}p`;

  // Try decoding base64 path segments that might contain resolution
  try {
    const pathSegments = new URL(url).pathname.split('/').filter(Boolean);
    for (const seg of pathSegments) {
      if (/^[A-Za-z0-9+/=]{2,8}$/.test(seg)) {
        const decoded = tryDecodeBase64(seg);
        if (decoded && /^\d{3,4}$/.test(decoded)) {
          return `${decoded}p`;
        }
      }
    }
  } catch { /* ignore */ }

  return null;
}

function decodeFilenameCandidate(filename) {
  const raw = String(filename || '').trim();
  if (!raw) return '';
  const nameWithoutExt = raw.replace(/\.[^.]+$/, '');
  if (!/^[A-Za-z0-9+/=~]{8,}$/.test(nameWithoutExt)) return '';
  return String(tryDecodeBase64(nameWithoutExt) || '').trim();
}

function isLikelySiteSlogan(value) {
  const text = normalizeTitleText(value).toLowerCase();
  if (!text) return false;
  return /\bwatch free movies online\b/.test(text)
    || /\bfree movies online\b/.test(text)
    || /\bwatch movies online\b/.test(text)
    || /\bfmovies\b/.test(text);
}

function extractSeriesTitleFromPageTitle(pageTitle) {
  const raw = String(pageTitle || '').trim();
  if (!raw) return '';

  const patterns = [
    /watch\s+(.+?)\s+s\d{1,2}\s*e\d{1,3}\b/i,
    /^(.+?)\s+s\d{1,2}\s*e\d{1,3}\b/i,
    /watch\s+(.+?)\s+season\s*\d{1,2}\s*(?:episode|ep)\s*\d{1,3}\b/i,
    /^(.+?)\s+season\s*\d{1,2}\s*(?:episode|ep)\s*\d{1,3}\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match || !match[1]) continue;
    const candidate = normalizeTitleText(match[1])
      .replace(/^watch\s+/i, '')
      .replace(/\s*\|\s*.*$/g, '')
      .trim();
    if (candidate && !isLikelySiteSlogan(candidate)) {
      return candidate;
    }
  }

  return '';
}

function extractQuotedEpisodeTitleFromPageTitle(pageTitle) {
  const raw = String(pageTitle || '').trim();
  if (!raw) return '';
  const match = raw.match(/["“]([^"”]{2,140})["”]/);
  if (!match || !match[1]) return '';
  return normalizeTitleText(match[1]);
}

function isLikelyTitleNoise(value, source = '') {
  const raw = String(value || '').trim();
  const text = normalizeTitleText(raw);
  const lower = text.toLowerCase();
  const sourceLower = String(source || '').toLowerCase();

  if (!text) return true;
  if (text.length < 2 || text.length > 140) return true;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^\d+(?:\s+\d+)*$/.test(lower)) return true;
  if (GENERIC_LOOKUP_TITLE_RE.test(text)) return true;
  if (/^(go back|back|home|menu|close|play|pause|next|previous)$/i.test(lower)) return true;
  if (/^season\s*\d{1,2}(?:\s*episode(?:\s*\d{1,3})?)?$/i.test(lower)) return true;

  if (sourceLower.startsWith('resource.')) {
    if (/\b(db|users)\s+videasy\s+net\b/.test(lower)) return true;
    if (/\b(trending|popular|top rated|discover|collection)\b/.test(lower)) return true;
  }

  return false;
}

function scoreDisplayTitleCandidate(value, source, pageTitle, tvContextFromUrl) {
  if (isLikelyTitleNoise(value, source)) return -1000;

  const sourceLower = String(source || '').toLowerCase();
  const text = normalizeTitleText(value);
  let score = 0;

  if (sourceLower.startsWith('jsonld.')) score += 120;
  else if (sourceLower.includes('og:title') || sourceLower.includes('twitter:title') || sourceLower.includes('meta[name="title"]')) score += 95;
  else if (sourceLower === 'player.text') score += 90;
  else if (sourceLower === 'dom.data-title' || sourceLower === 'dom.data-name') score += 80;
  else if (sourceLower === 'document.title') score += 45;
  else if (sourceLower.startsWith('dom.')) score += 55;
  else if (sourceLower.startsWith('resource.query.')) score += 35;
  else if (sourceLower.startsWith('resource.')) score += 10;
  else if (sourceLower === 'url.pathname') score += 5;

  if (isLikelySiteSlogan(text)) score -= 140;
  if (normalizeTitleText(text) === normalizeTitleText(pageTitle) && isLikelySiteSlogan(pageTitle)) score -= 100;
  if (/\bseason\b|\bepisode\b/i.test(text) && !/[a-z]{3,}/i.test(stripTitleNoise(text))) score -= 70;

  if (tvContextFromUrl) {
    const quotedEpisodeTitle = extractQuotedEpisodeTitleFromPageTitle(pageTitle);
    if (quotedEpisodeTitle && normalizeTitleText(text) === quotedEpisodeTitle) {
      score -= 220;
    }
    if (sourceLower === 'player.text') score += 24;
    if (sourceLower.startsWith('jsonld.')) score += 10;
  }

  if (text.length >= 4 && text.length <= 80) score += 8;
  if (/[A-Za-z].*[:\-].*[A-Za-z]/.test(text)) score += 6;

  return score;
}

function getSourcePageTitle(item, fallback = '') {
  const sourcePageUrl = String(item && item.sourcePageUrl || '').trim();
  // The tab title may settle after the first media request on a client-rendered
  // page. Only use its fresh value for this exact page, never after navigation.
  if (activeTab && sourcePageUrl && sourcePageUrl === String(activeTab.url || '').trim()) {
    const currentTitle = String(activeTab.title || '').trim();
    if (currentTitle) return currentTitle;
  }
  return String(item && item.sourcePageTitle || fallback || (!sourcePageUrl && activeTab && activeTab.title) || '').trim();
}

function siteTitleKeys(item) {
  const keys = new Set();
  const sourcePageUrl = String(item && item.sourcePageUrl || (activeTab && activeTab.url) || '').trim();
  try {
    const labels = new URL(sourcePageUrl).hostname.replace(/^www\./i, '').split('.');
    for (const label of labels.slice(0, -1)) {
      if (label.length > 2) keys.add(titleKey(label));
    }
  } catch { /* no site identity available */ }
  for (const candidate of Array.isArray(item && item.pageTitleCandidates) ? item.pageTitleCandidates : []) {
    if (/og:site_name/i.test(String(candidate && candidate.source || ''))) {
      const key = titleKey(candidate.value);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function titleKey(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function removeSiteTitleSuffix(value, siteKeys) {
  const text = String(value || '').trim();
  const match = /^(.*)\s+[-–—|]\s+(.+)$/.exec(text);
  return match && siteKeys.has(titleKey(match[2])) ? match[1].trim() : text;
}

function pickPreferredContentTitle(item, pageTitle, tvContextFromUrl) {
  const siteKeys = siteTitleKeys(item);
  const storedCandidates = Array.isArray(item && item.pageTitleCandidates) ? item.pageTitleCandidates : [];
  const candidates = storedCandidates.filter((entry) => String(entry && entry.source || '') !== 'document.title');
  candidates.push({ source: 'document.title', value: pageTitle });
  let bestValue = '';
  let bestScore = -Infinity;

  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') continue;
    const source = String(entry.source || '').trim();
    const value = removeSiteTitleSuffix(entry.value, siteKeys);
    // Sitewide OG metadata often stays at the brand name while the actual
    // document title changes. A brand by itself is not a content title.
    if (!value || siteKeys.has(titleKey(value))) continue;

    const score = scoreDisplayTitleCandidate(value, source, pageTitle, tvContextFromUrl);
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
    }
  }

  if (bestScore >= 30 && bestValue) return bestValue;
  return '';
}

function getDisplayTitle(item) {
  const pageTitle = getSourcePageTitle(item);
  const youtubeTitle = cleanYoutubeTitleText(item && item.youtubeMetadata && item.youtubeMetadata.title);
  if (youtubeTitle && !isLikelySiteSlogan(youtubeTitle)) {
    return youtubeTitle;
  }

  if (isYoutubePageItem(item)) {
    const cleanedPageTitle = cleanYoutubeTitleText(pageTitle);
    if (cleanedPageTitle && !isLikelySiteSlogan(cleanedPageTitle)) {
      return cleanedPageTitle;
    }
  }

  const sourcePageUrl = String(item.sourcePageUrl || (activeTab && activeTab.url) || '').trim();
  const tvContextFromUrl = detectTvContextFromUrl(sourcePageUrl);
  const seriesTitleFromPageTitle = tvContextFromUrl ? extractSeriesTitleFromPageTitle(pageTitle) : '';
  const preferredContentTitle = pickPreferredContentTitle(item, pageTitle, tvContextFromUrl);

  if (seriesTitleFromPageTitle) {
    return seriesTitleFromPageTitle;
  }

  const filename = item.filename || '';
  const decodedFilename = decodeFilenameCandidate(filename);
  if (decodedFilename) {
    // If decoded is generic (index, playlist, master), prefer page title
    if (/^(index|playlist|master|chunklist|media)\b/i.test(decodedFilename)) {
      if (preferredContentTitle) return preferredContentTitle;
      if (pageTitle && !isLikelySiteSlogan(pageTitle)) return pageTitle;
    }
    return decodedFilename;
  }

  if (preferredContentTitle) {
    return preferredContentTitle;
  }

  // If filename is generic, prefer page title
  if (/^(index|playlist|master|media)\.(m3u8|mpd)$/i.test(filename) && pageTitle && !isLikelySiteSlogan(pageTitle)) {
    return pageTitle;
  }

  if (pageTitle && !isLikelySiteSlogan(pageTitle)) {
    return pageTitle;
  }

  return filename || pageTitle || 'Media';
}

const TITLE_SEASON_EPISODE_PATTERNS = [
  { id: 'sxe', regex: /(?:^|[^a-z0-9])s(?:eason)?\s*0*(\d{1,2})\s*[-_. ]*e(?:pisode)?\s*0*(\d{1,3})(?:[^a-z0-9]|$)/i },
  { id: 'x-format', regex: /(?:^|[^a-z0-9])(\d{1,2})\s*x\s*(\d{1,3})(?:[^a-z0-9]|$)/i },
  { id: 'season-episode-words', regex: /(?:^|[^a-z0-9])season\s*0*(\d{1,2})\s*[-_. ]*(?:episode|ep)\s*0*(\d{1,3})(?:[^a-z0-9]|$)/i },
];

const TITLE_SEASON_ONLY_PATTERNS = [
  { id: 'season-word', regex: /(?:^|[^a-z0-9])season\s*0*(\d{1,2})(?:[^a-z0-9]|$)/i },
  { id: 's-word', regex: /(?:^|[^a-z0-9])s\s*0*(\d{1,2})(?:[^a-z0-9]|$)/i },
];

const TITLE_EPISODE_ONLY_PATTERNS = [
  { id: 'episode-word', regex: /(?:^|[^a-z0-9])episode\s*0*(\d{1,3})(?:[^a-z0-9]|$)/i },
  { id: 'ep-word', regex: /(?:^|[^a-z0-9])ep\s*0*(\d{1,3})(?:[^a-z0-9]|$)/i },
  { id: 'e-word', regex: /(?:^|[^a-z0-9])e\s*0*(\d{1,3})(?:[^a-z0-9]|$)/i },
];

function parseBoundedInteger(value, min, max) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function normalizeTitleText(value) {
  return String(value || '')
    .replace(/[._]+/g, ' ')
    .replace(/[-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_LOOKUP_TITLE_RE = /^(index|playlist|master|chunklist|manifest|media|video|stream|subtitle|subtitles|caption|captions|closed captions|cc|audio|audio track|audio tracks|quality|qualities|server|servers|source|sources)$/i;

function cleanYoutubeTitleText(value) {
  return String(value || '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/^\[\d+\]\s*/, '')
    .replace(/\s*[-|]\s*youtube\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isYoutubePageItem(item) {
  const mediaKind = String(item && item.mediaKind || '').toLowerCase();
  if (mediaKind === 'youtube-page') return true;
  return String(item && item.contentType || '').toLowerCase() === 'video/youtube';
}

function stripTitleNoise(value) {
  const cleaned = normalizeTitleText(value)
    .replace(/(?:^|[^a-z0-9])s(?:eason)?\s*0*\d{1,2}\s*[-_. ]*e(?:pisode)?\s*0*\d{1,3}(?:[^a-z0-9]|$)/gi, ' ')
    .replace(/(?:^|[^a-z0-9])\d{1,2}\s*x\s*\d{1,3}(?:[^a-z0-9]|$)/gi, ' ')
    .replace(/(?:^|[^a-z0-9])season\s*0*\d{1,2}(?:[^a-z0-9]|$)/gi, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|8k|x264|x265|h264|h265|hevc|webrip|web[-_. ]?dl|bluray)\b/gi, ' ')
    .replace(/[()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return GENERIC_LOOKUP_TITLE_RE.test(cleaned) ? '' : cleaned;
}

function trimDebugText(value, max = 260) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function detectTvContextFromUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const path = decodeURIComponent(parsed.pathname || '').toLowerCase();
    const query = String(parsed.search || '').toLowerCase();
    if (/(^|\/)(tv|series|show|shows|season|episode)(\/|$)/.test(path)) return true;
    if (/[?&](type|media|mediatype)=tv(?:&|$)/.test(query)) return true;
    if (/[?&](season|episode)=\d+/.test(query)) return true;
    return false;
  } catch {
    return false;
  }
}

function inferHintFromSourcePageUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const decodedPath = decodeURIComponent(parsed.pathname || '');
    const pathParts = decodedPath.split('/').filter(Boolean);

    let seasonNumber = parseBoundedInteger(
      parsed.searchParams.get('season')
      || parsed.searchParams.get('seasonNumber')
      || parsed.searchParams.get('s'),
      1,
      60
    );
    let episodeNumber = parseBoundedInteger(
      parsed.searchParams.get('episode')
      || parsed.searchParams.get('episodeNumber')
      || parsed.searchParams.get('ep')
      || parsed.searchParams.get('e'),
      1,
      999
    );

    if (!(seasonNumber && episodeNumber)) {
      const tvRoots = new Set(['tv', 'series', 'show', 'shows']);
      for (let i = 0; i < pathParts.length - 3; i += 1) {
        const root = String(pathParts[i] || '').toLowerCase();
        if (!tvRoots.has(root)) continue;
        const seasonCandidate = parseBoundedInteger(pathParts[i + 2], 1, 60);
        const episodeCandidate = parseBoundedInteger(pathParts[i + 3], 1, 999);
        if (seasonCandidate && episodeCandidate) {
          seasonNumber = seasonCandidate;
          episodeNumber = episodeCandidate;
          break;
        }
      }
    }

    if (!(seasonNumber && episodeNumber)) {
      return null;
    }

    return {
      seasonNumber,
      episodeNumber,
      matchedPattern: 'source-url-route',
      matchedField: 'sourcePageUrl.route',
      matchedText: value,
    };
  } catch {
    return null;
  }
}

function inferHintFromText(text, field) {
  const normalized = normalizeTitleText(text);
  if (!normalized) return null;

  for (const pattern of TITLE_SEASON_EPISODE_PATTERNS) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;
    const seasonNumber = parseBoundedInteger(match[1], 1, 60);
    const episodeNumber = parseBoundedInteger(match[2], 1, 999);
    if (!seasonNumber || !episodeNumber) continue;
    return {
      seasonNumber,
      episodeNumber,
      matchedPattern: pattern.id,
      matchedField: field,
    };
  }

  let seasonOnly = null;
  for (const pattern of TITLE_SEASON_ONLY_PATTERNS) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;
    const seasonNumber = parseBoundedInteger(match[1], 1, 60);
    if (!seasonNumber) continue;
    seasonOnly = {
      seasonNumber,
      episodeNumber: null,
      matchedPattern: pattern.id,
      matchedField: field,
    };
    break;
  }

  for (const pattern of TITLE_EPISODE_ONLY_PATTERNS) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;
    const episodeNumber = parseBoundedInteger(match[1], 1, 999);
    if (!episodeNumber) continue;
    return {
      seasonNumber: seasonOnly ? seasonOnly.seasonNumber : null,
      episodeNumber,
      matchedPattern: seasonOnly ? `${seasonOnly.matchedPattern}+${pattern.id}` : pattern.id,
      matchedField: field,
    };
  }

  return seasonOnly;
}

function scoreEpisodeHint(hint) {
  const seasonNumber = parseBoundedInteger(hint && hint.seasonNumber, 1, 60);
  const episodeNumber = parseBoundedInteger(hint && hint.episodeNumber, 1, 999);
  if (!seasonNumber && !episodeNumber) return -1;

  let score = 0;
  if (seasonNumber) score += 100;
  if (episodeNumber) score += 220;
  if (seasonNumber && episodeNumber) score += 120;

  const pattern = String(hint && hint.matchedPattern || '').toLowerCase();
  if (pattern.includes('sxe') || pattern.includes('season-episode') || pattern.includes('x-format')) {
    score += 15;
  }

  const field = String(hint && hint.matchedField || '').toLowerCase();
  if (field.includes('sourcepageurl.route') || field.includes('pageepisodehint.url-route')) {
    score += 1000;
  }

  return score;
}

function pickPreferredEpisodeHint(currentHint, nextHint) {
  const currentScore = scoreEpisodeHint(currentHint);
  const nextScore = scoreEpisodeHint(nextHint);
  if (nextScore < 0) return currentHint;
  if (currentScore < 0 || nextScore > currentScore) return nextHint;

  if (nextScore === currentScore) {
    const currentEpisode = parseBoundedInteger(currentHint && currentHint.episodeNumber, 1, 999);
    const nextEpisode = parseBoundedInteger(nextHint && nextHint.episodeNumber, 1, 999);
    if (nextEpisode && !currentEpisode) return nextHint;
    if (nextEpisode && currentEpisode) return nextHint;
  }

  return currentHint;
}

function inferTitleHints(item, pageTitle, displayTitle) {
  pageTitle = getSourcePageTitle(item, pageTitle);
  const isYoutubePageDetection = isYoutubePageItem(item);
  const sourcePageUrl = String(item && item.sourcePageUrl || (activeTab && activeTab.url) || '').trim();
  const sourceUrlHint = isYoutubePageDetection ? null : inferHintFromSourcePageUrl(sourcePageUrl);
  const tvContextFromUrl = detectTvContextFromUrl(sourcePageUrl);
  const preferredContentTitle = isYoutubePageDetection
    ? ''
    : pickPreferredContentTitle(item, pageTitle, tvContextFromUrl);
  const decodedFilename = decodeFilenameCandidate(item && item.filename);
  const pageCandidates = Array.isArray(item && item.pageTitleCandidates)
    ? item.pageTitleCandidates
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => ({
        field: `pageCandidate.${index}`,
        label: `Page Candidate (${String(entry.source || 'unknown')})`,
        source: String(entry.source || '').trim().toLowerCase(),
        value: String(entry.value || '').trim(),
      }))
      .filter((entry) => entry.value)
    : [];

  const selectedPageCandidates = isYoutubePageDetection
    ? pageCandidates.filter((entry) => {
      const source = String(entry.source || '').trim();
      return source === 'youtube.title'
        || source === 'youtube.channel'
        || source === 'youtube.dom.title'
        || source === 'youtube.dom.channel'
        || source === 'document.title'
        || source.startsWith('meta[');
    })
    : pageCandidates;

  const youtubeMetadata = item && item.youtubeMetadata && typeof item.youtubeMetadata === 'object'
    ? item.youtubeMetadata
    : null;
  const youtubeCandidates = youtubeMetadata
    ? [
      { field: 'youtube.title', label: 'YouTube Title', value: cleanYoutubeTitleText(String(youtubeMetadata.title || '').trim()) },
      { field: 'youtube.channel', label: 'YouTube Channel', value: String(youtubeMetadata.channelName || '').trim() },
    ].filter((entry) => entry.value)
    : [];

  const resourceSignalCandidates = isYoutubePageDetection
    ? []
    : Array.isArray(item && item.resourceSignals)
    ? item.resourceSignals
      .filter((entry) => entry && typeof entry === 'object')
      .flatMap((entry, index) => {
        const output = [];
        const source = String(entry.source || 'resource').trim() || 'resource';
        const urlValue = String(entry.url || '').trim();
        if (urlValue) {
          output.push({
            field: `resourceSignal.${index}.url`,
            label: `Resource Signal URL (${source})`,
            value: urlValue,
          });
        }

        const seasonNumber = parseBoundedInteger(entry.seasonNumber, 1, 60);
        const episodeNumber = parseBoundedInteger(entry.episodeNumber, 1, 999);
        if (seasonNumber || episodeNumber) {
          output.push({
            field: `resourceSignal.${index}.episodeHint`,
            label: `Resource Episode Hint (${source})`,
            value: `season ${seasonNumber || ''} episode ${episodeNumber || ''}`.trim(),
          });
        }

        const patternValue = String(entry.matchedPattern || '').trim();
        if (patternValue) {
          output.push({
            field: `resourceSignal.${index}.pattern`,
            label: `Resource Pattern (${source})`,
            value: patternValue,
          });
        }

        return output;
      })
      .filter((entry) => entry.value)
    : [];

  const candidates = [
    { field: 'displayTitle', label: 'Display Title', value: displayTitle },
    { field: 'pageTitle', label: 'Page Title', value: pageTitle },
    ...youtubeCandidates,
    ...selectedPageCandidates,
    ...resourceSignalCandidates,
    { field: 'filename', label: 'Filename', value: item && item.filename },
    { field: 'filenameDecoded', label: 'Decoded Filename', value: decodedFilename },
    { field: 'url', label: 'Request URL', value: item && item.url },
  ].filter((candidate) => String(candidate.value || '').trim());

  if (isYoutubePageDetection) {
    const lookupTitle = [
      cleanYoutubeTitleText((youtubeMetadata && youtubeMetadata.title) || ''),
      cleanYoutubeTitleText(displayTitle),
      cleanYoutubeTitleText(pageTitle),
      item && item.filename,
    ]
      .map((candidate) => stripTitleNoise(candidate))
      .find(Boolean) || '';
    const candidateTitles = candidates.map((candidate) => ({
      field: candidate.field,
      label: candidate.label,
      value: trimDebugText(candidate.value),
      normalized: trimDebugText(normalizeTitleText(candidate.value)),
      lookupCandidate: trimDebugText(stripTitleNoise(candidate.value)),
      matchedPattern: null,
      seasonNumber: null,
      episodeNumber: null,
    }));

    return {
      lookupTitle,
      seasonNumber: null,
      episodeNumber: null,
      isTvCandidate: false,
      matchedPattern: null,
      matchedField: null,
      mediaGuess: lookupTitle ? 'movie_or_unknown' : 'unknown',
      candidateTitles,
      tvContextFromUrl: false,
      pageIsTvContext: false,
    };
  }

  const pageEpisodeHint = item && item.pageEpisodeHint && typeof item.pageEpisodeHint === 'object'
    ? item.pageEpisodeHint
    : null;

  let matched = null;
  if (sourceUrlHint) {
    matched = pickPreferredEpisodeHint(matched, sourceUrlHint);
  }

  let pageEpisodeHintMatch = null;
  if (pageEpisodeHint) {
    const seasonNumber = parseBoundedInteger(pageEpisodeHint.seasonNumber, 1, 60);
    const episodeNumber = parseBoundedInteger(pageEpisodeHint.episodeNumber, 1, 999);
    if (seasonNumber || episodeNumber) {
      pageEpisodeHintMatch = {
        seasonNumber: seasonNumber || null,
        episodeNumber: episodeNumber || null,
        matchedPattern: String(pageEpisodeHint.matchedPattern || 'page-episode-hint').trim(),
        matchedField: `pageEpisodeHint.${String(pageEpisodeHint.source || 'unknown').trim() || 'unknown'}`,
      };
      matched = pickPreferredEpisodeHint(matched, pageEpisodeHintMatch);
    }
  }

  const candidateTitles = [];
  for (const candidate of candidates) {
    const normalized = normalizeTitleText(candidate.value);
    const candidateMatch = inferHintFromText(candidate.value, candidate.field);
    if (candidateMatch) {
      matched = pickPreferredEpisodeHint(matched, candidateMatch);
    }

    candidateTitles.push({
      field: candidate.field,
      label: candidate.label,
      value: trimDebugText(candidate.value),
      normalized: trimDebugText(normalized),
      lookupCandidate: trimDebugText(stripTitleNoise(candidate.value)),
      matchedPattern: candidateMatch ? candidateMatch.matchedPattern : null,
      seasonNumber: candidateMatch ? candidateMatch.seasonNumber : null,
      episodeNumber: candidateMatch ? candidateMatch.episodeNumber : null,
    });
  }

  if (pageEpisodeHint) {
    candidateTitles.unshift({
      field: `pageEpisodeHint.${String(pageEpisodeHint.source || 'unknown').trim() || 'unknown'}`,
      label: 'Page Episode Hint',
      value: String(pageEpisodeHint.matchedText || '').trim() || '(from structured page context)',
      normalized: String(pageEpisodeHint.matchedText || '').trim() || '(from structured page context)',
      lookupCandidate: '',
      matchedPattern: String(pageEpisodeHint.matchedPattern || 'page-episode-hint').trim(),
      seasonNumber: pageEpisodeHintMatch ? pageEpisodeHintMatch.seasonNumber : null,
      episodeNumber: pageEpisodeHintMatch ? pageEpisodeHintMatch.episodeNumber : null,
    });
  }

  if (sourceUrlHint) {
    candidateTitles.unshift({
      field: 'sourcePageUrl.route',
      label: 'Source URL Episode Hint',
      value: String(sourceUrlHint.matchedText || sourcePageUrl).trim(),
      normalized: String(sourceUrlHint.matchedText || sourcePageUrl).trim(),
      lookupCandidate: '',
      matchedPattern: sourceUrlHint.matchedPattern,
      seasonNumber: sourceUrlHint.seasonNumber,
      episodeNumber: sourceUrlHint.episodeNumber,
    });
  }

  const matchedSource = matched
    ? String(candidates.find((candidate) => candidate.field === matched.matchedField)?.value || '').trim()
    : '';
  const matchedLookup = stripTitleNoise(matchedSource);
  const lookupTitle = matchedLookup || [
    preferredContentTitle,
    pageTitle,
    displayTitle,
    item && item.filename,
  ]
    .map((candidate) => stripTitleNoise(candidate))
    .find(Boolean) || '';
  const pageIsTvContext = Boolean(item && item.pageIsTvContext);
  const hasEpisodeSignal = Boolean(
    matched
    && (Number.isFinite(matched.episodeNumber) || Number.isFinite(matched.seasonNumber))
  );
  const isTvCandidate = Boolean(hasEpisodeSignal || pageIsTvContext || tvContextFromUrl);

  return {
    lookupTitle,
    seasonNumber: matched && Number.isFinite(matched.seasonNumber) ? matched.seasonNumber : null,
    episodeNumber: matched && Number.isFinite(matched.episodeNumber) ? matched.episodeNumber : null,
    isTvCandidate,
    matchedPattern: matched ? matched.matchedPattern : null,
    matchedField: matched ? matched.matchedField : null,
    mediaGuess: isTvCandidate ? 'tv' : (lookupTitle ? 'movie_or_unknown' : 'unknown'),
    candidateTitles,
    tvContextFromUrl,
    pageIsTvContext,
  };
}

function pickJobTitleHints(hints) {
  return {
    lookupTitle: String(hints && hints.lookupTitle ? hints.lookupTitle : '').trim(),
    seasonNumber: Number.isFinite(hints && hints.seasonNumber) ? hints.seasonNumber : null,
    episodeNumber: Number.isFinite(hints && hints.episodeNumber) ? hints.episodeNumber : null,
    isTvCandidate: Boolean(hints && hints.isTvCandidate),
    matchedPattern: String(hints && hints.matchedPattern ? hints.matchedPattern : '').trim(),
    matchedField: String(hints && hints.matchedField ? hints.matchedField : '').trim(),
  };
}

function formatEpisodeTag(seasonNumber, episodeNumber) {
  if (!seasonNumber && !episodeNumber) return '';
  const seasonPart = Number.isFinite(seasonNumber) ? `S${String(seasonNumber).padStart(2, '0')}` : 'S??';
  const episodePart = Number.isFinite(episodeNumber) ? `E${String(episodeNumber).padStart(2, '0')}` : 'E??';
  return `${seasonPart}${episodePart}`;
}

function appendEpisodeTagToTitle(titleValue, titleHints) {
  const title = String(titleValue || '').trim();
  if (!title) return title;

  const seasonNumber = parseBoundedInteger(titleHints && titleHints.seasonNumber, 1, 60);
  const episodeNumber = parseBoundedInteger(titleHints && titleHints.episodeNumber, 1, 999);
  if (!seasonNumber || !episodeNumber) return title;

  const seasonText = String(seasonNumber);
  const episodeText = String(episodeNumber);
  if (
    new RegExp(`\\bs\\s*0*${seasonText}\\s*e\\s*0*${episodeText}\\b`, 'i').test(title)
    || new RegExp(`\\b${seasonText}\\s*x\\s*0*${episodeText}\\b`, 'i').test(title)
    || new RegExp(`\\bseason\\s*0*${seasonText}\\s*(?:-|\\s)*(?:episode|ep)\\s*0*${episodeText}\\b`, 'i').test(title)
  ) {
    return title;
  }

  const tag = formatEpisodeTag(seasonNumber, episodeNumber);
  return tag ? `${title} ${tag}` : title;
}

function appendDisplayEpisodeTagToTitle(titleValue, titleHints) {
  const title = String(titleValue || '').trim();
  if (!title) return title;

  const tag = formatEpisodeTag(
    titleHints && titleHints.seasonNumber,
    titleHints && titleHints.episodeNumber
  );
  if (!tag) return title;

  const normalizedTitle = title.toUpperCase().replace(/\s+/g, '');
  if (normalizedTitle.includes(tag.toUpperCase())) {
    return title;
  }

  return `${title} ${tag}`;
}

function buildJobPayload(item, titleOverride = '') {
  const mediaUrl = item.url;
  const pageTitle = getSourcePageTitle(item);
  const sourcePageUrl = String(item.sourcePageUrl || (activeTab && activeTab.url) || '').trim();
  const overrideTitle = normalizeCustomTitleOverride(titleOverride);
  const displayTitle = overrideTitle || getDisplayTitle(item);
  const titleHints = pickJobTitleHints(inferTitleHints(item, pageTitle, displayTitle));
  if (overrideTitle) {
    titleHints.lookupTitle = overrideTitle;
  }
  const baseTitle = displayTitle || pageTitle || item.filename || 'Download';
  const title = overrideTitle
    ? overrideTitle
    : appendEpisodeTagToTitle(baseTitle, titleHints);
  const youtubeMetadata = item && item.youtubeMetadata && typeof item.youtubeMetadata === 'object'
    ? item.youtubeMetadata
    : null;
  const thumbnailUrl = String(youtubeMetadata && youtubeMetadata.thumbnailUrl || item.thumbnailUrl || item.poster || '').trim();

  return {
    mediaUrl,
    mediaType: item.type || (/\.m3u8(\?|$)/i.test(mediaUrl) ? 'hls' : 'file'),
    title,
    resourceName: overrideTitle || item.filename || title,
    headers: item.requestHeaders || {},
    sourcePageUrl,
    sourcePageTitle: pageTitle || title,
    titleHints,
    youtubeMetadata,
    thumbnailUrl,
  };
}


return { getDisplayTitle, inferTitleHints, stripTitleNoise, buildJobPayload, setCustomTitleOverride, getCustomTitleOverride, setActiveTab(tab) { activeTab = tab; } };
});
