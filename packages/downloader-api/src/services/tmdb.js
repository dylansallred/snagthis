const https = require('https');

// Simple TMDB helper that searches by title, then fetches details for richer metadata.
// Expects API key to be provided via config or environment. All calls are best-effort.
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function normalizeTitleForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractEntityYear(entity) {
  const dateStr = String(entity?.release_date || entity?.first_air_date || '').trim();
  const match = dateStr.match(/^(\d{4})/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function scoreTmdbCandidate(entity, index, { title, year, today }) {
  const queryNorm = normalizeTitleForMatch(title);
  const candidateNames = [entity?.title, entity?.original_title, entity?.name, entity?.original_name]
    .map(normalizeTitleForMatch)
    .filter(Boolean);

  let score = 0;
  if (queryNorm) {
    if (candidateNames.includes(queryNorm)) score += 100;
    else if (candidateNames.some((name) => name.includes(queryNorm) || queryNorm.includes(name))) score += 35;
  }

  const candidateYear = extractEntityYear(entity);
  if (Number.isFinite(year) && candidateYear) {
    const diff = Math.abs(candidateYear - year);
    if (diff === 0) score += 80;
    else if (diff === 1) score += 20;
    else score -= 25;
  }

  const releaseDate = String(entity?.release_date || entity?.first_air_date || '').slice(0, 10);
  if (releaseDate && today) {
    if (releaseDate > today) score -= 30;
    else score += 15;
  }

  if (entity?.poster_path) score += 10;
  if (Number(entity?.vote_count) >= 50) score += 10;
  score -= index * 2;
  return score;
}

function selectBestTmdbCandidate(results, { title, year = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  if (list.length === 0) return null;

  const ranked = list
    .map((entity, index) => ({
      entity,
      index,
      score: scoreTmdbCandidate(entity, index, { title, year, today }),
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  return ranked[0].entity;
}

function scoreRuntimeDelta(runtimeMinutes, durationSeconds) {
  if (!Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0) return 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 600) return 0;
  const fileMinutes = durationSeconds / 60;
  const delta = Math.abs(runtimeMinutes - fileMinutes);
  if (delta <= 4) return 70;
  if (delta <= 8) return 45;
  if (delta <= 14) return 15;
  if (delta >= 20) return -45;
  return 0;
}

async function lookupPoster({ apiKey, title, type, year = null, durationSeconds = null }) {
  if (!apiKey || !title) return null;

  const baseImg = 'https://image.tmdb.org/t/p/w500';
  const parsedYear = Number.isFinite(Number(year)) && Number(year) >= 1920 ? Math.floor(Number(year)) : null;
  const today = new Date().toISOString().slice(0, 10);

  const pickImages = (images) => {
    const posterList = Array.isArray(images?.posters) ? images.posters : [];
    const backdropList = Array.isArray(images?.backdrops) ? images.backdrops : [];
    const imageUrls = [];
    posterList.slice(0, 3).forEach((p) => {
      if (p.file_path) imageUrls.push(`${baseImg}${p.file_path}`);
    });
    backdropList.slice(0, 3).forEach((b) => {
      if (b.file_path) imageUrls.push(`${baseImg}${b.file_path}`);
    });
    return imageUrls;
  };

  const buildResult = (entity, details, images) => {
    const posterUrl = entity?.poster_path ? `${baseImg}${entity.poster_path}` : null;
    const backdropUrl = entity?.backdrop_path ? `${baseImg}${entity.backdrop_path}` : null;
    const imageUrls = pickImages(images);
    if (posterUrl && !imageUrls.includes(posterUrl)) imageUrls.unshift(posterUrl);
    if (backdropUrl && !imageUrls.includes(backdropUrl)) imageUrls.unshift(backdropUrl);
    return {
      id: entity?.id,
      title: details?.name || details?.title || entity?.name || entity?.title,
      releaseDate: details?.first_air_date || details?.release_date || entity?.first_air_date || entity?.release_date,
      posterUrl,
      backdropUrl,
      overview: details?.overview || entity?.overview,
      runtime: details?.runtime,
      tagline: details?.tagline,
      genres: Array.isArray(details?.genres) ? details.genres.map((g) => g.name) : undefined,
      imageUrls: imageUrls.slice(0, 6),
    };
  };

  const searchTv = async (query) => {
    try {
      let tvResults = [];
      if (parsedYear) {
        const filtered = await fetchJson(`https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${query}&first_air_date_year=${parsedYear}`);
        tvResults = Array.isArray(filtered?.results) ? filtered.results : [];
      }
      if (tvResults.length === 0) {
        const tvResult = await fetchJson(`https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${query}`);
        tvResults = Array.isArray(tvResult?.results) ? tvResult.results : [];
      }
      const tvBest = selectBestTmdbCandidate(tvResults, { title, year: parsedYear, today });
      if (!tvBest) return null;
      let tvDetails = {};
      let tvImages = {};
      try {
        tvDetails = await fetchJson(`https://api.themoviedb.org/3/tv/${tvBest.id}?api_key=${apiKey}`);
      } catch (_) {}
      try {
        tvImages = await fetchJson(`https://api.themoviedb.org/3/tv/${tvBest.id}/images?api_key=${apiKey}`);
      } catch (_) {}
      const result = buildResult(tvBest, tvDetails, tvImages);
      return result ? { ...result, mediaType: 'tv' } : null;
    } catch (_) {
      return null;
    }
  };

  const searchMovie = async (query) => {
    try {
      let movieResults = [];
      if (parsedYear) {
        const filtered = await fetchJson(`https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${query}&year=${parsedYear}`);
        movieResults = Array.isArray(filtered?.results) ? filtered.results : [];
      }
      if (movieResults.length === 0) {
        const movieResult = await fetchJson(`https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${query}`);
        movieResults = Array.isArray(movieResult?.results) ? movieResult.results : [];
      }
      if (movieResults.length === 0) return null;

      const ranked = movieResults
        .map((entity, index) => ({
          entity,
          index,
          score: scoreTmdbCandidate(entity, index, { title, year: parsedYear, today }),
        }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index));

      let chosen = ranked[0].entity;
      let movieDetails = {};

      // When no year is known and multiple remakes score closely, check runtime against durationSeconds.
      const close = !parsedYear && Number.isFinite(durationSeconds) && durationSeconds >= 600
        ? ranked.filter((item) => item.score >= ranked[0].score - 25).slice(0, 3)
        : [];
      if (close.length >= 2) {
        const detailsByIndex = await Promise.all(
          close.map(async (item) => {
            try {
              return await fetchJson(`https://api.themoviedb.org/3/movie/${item.entity.id}?api_key=${apiKey}`);
            } catch (_) {
              return {};
            }
          }),
        );
        let bestClose = null;
        close.forEach((item, idx) => {
          const details = detailsByIndex[idx] || {};
          const totalScore = item.score + scoreRuntimeDelta(Number(details.runtime), durationSeconds);
          if (!bestClose || totalScore > bestClose.totalScore) {
            bestClose = { entity: item.entity, details, totalScore };
          }
        });
        if (bestClose) {
          chosen = bestClose.entity;
          movieDetails = bestClose.details;
        }
      } else {
        try {
          movieDetails = await fetchJson(`https://api.themoviedb.org/3/movie/${chosen.id}?api_key=${apiKey}`);
        } catch (_) {}
      }

      let movieImages = {};
      try {
        movieImages = await fetchJson(`https://api.themoviedb.org/3/movie/${chosen.id}/images?api_key=${apiKey}`);
      } catch (_) {}
      const result = buildResult(chosen, movieDetails, movieImages);
      return result ? { ...result, mediaType: 'movie' } : null;
    } catch (_) {
      return null;
    }
  };

  try {
    const query = encodeURIComponent(title);

    if (type === 'tv') {
      return (await searchTv(query)) || (await searchMovie(query));
    }
    if (type === 'movie') {
      return (await searchMovie(query)) || (await searchTv(query));
    }

    // Default: movie first, then TV
    return (await searchMovie(query)) || (await searchTv(query));
  } catch (err) {
    return null;
  }
}

module.exports = {
  lookupPoster,
  selectBestTmdbCandidate,
  scoreRuntimeDelta,
};
