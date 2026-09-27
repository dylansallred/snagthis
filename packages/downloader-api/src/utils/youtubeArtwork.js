function extractYouTubeVideoId(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    const host = String(parsed.hostname || '').toLowerCase();
    const pathParts = String(parsed.pathname || '').split('/').filter(Boolean);
    let videoId = '';

    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      videoId = String(pathParts[0] || '').trim();
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const first = String(pathParts[0] || '').toLowerCase();
      if (first === 'watch') {
        videoId = String(parsed.searchParams.get('v') || '').trim();
      } else if (first === 'shorts' || first === 'live' || first === 'embed') {
        videoId = String(pathParts[1] || '').trim();
      }
    }

    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return '';
    return videoId;
  } catch {
    return '';
  }
}

function youtubeVideoIdOf(item) {
  if (!item || typeof item !== 'object') return '';
  const fromMetadata = String(item.youtubeMetadata && item.youtubeMetadata.videoId || '').trim();
  if (/^[A-Za-z0-9_-]{6,20}$/.test(fromMetadata)) return fromMetadata;
  return extractYouTubeVideoId(String(item.url || '')) || extractYouTubeVideoId(String(item.sourcePageUrl || ''));
}

// YouTube leaves the previous page's share image, or its generic logo card
// (youtube.com/img/desktop/yt_1200.png), in og:image after in-page navigation.
// Keep YouTube artwork only when it is this video's thumbnail; otherwise use
// the video's own thumbnail. Artwork from other sites and local files pass through.
function youtubeArtwork(url, videoId) {
  const value = String(url || '').trim();
  let host = '';
  try { host = new URL(value).hostname.toLowerCase(); } catch { return value; }
  if (!/(^|\.)(youtube\.com|youtu\.be|ytimg\.com|ggpht\.com)$/.test(host)) return value;
  const id = /^[A-Za-z0-9_-]{6,20}$/.test(String(videoId || '')) ? String(videoId) : '';
  const thumbnailHost = /(^|\.)ytimg\.com$/.test(host);
  if (!id) return thumbnailHost ? value : '';
  if (thumbnailHost && value.includes(`/${id}/`)) return value;
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

module.exports = { extractYouTubeVideoId, youtubeVideoIdOf, youtubeArtwork };
