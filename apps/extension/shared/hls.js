(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VidSnagHls = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function parseAttributes(value) {
    const attributes = {};
    const pattern = /([A-Z0-9-]+)\s*=\s*(?:"([^"]*)"|([^,]*))(?:,|$)/gi;
    let match;
    while ((match = pattern.exec(value))) attributes[match[1].toUpperCase()] = match[2] === undefined ? match[3].trim() : match[2];
    return attributes;
  }

  function httpUrl(value, base) {
    if (!value) return null;
    try {
      const url = new URL(value, base);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch { return null; }
  }

  function number(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function estimateSizeBytes(bandwidth, durationSeconds) {
    const rate = number(bandwidth);
    const duration = number(durationSeconds);
    return rate > 0 && duration > 0 ? Math.round(rate * duration / 8) : null;
  }

  function parseHlsManifest(text, manifestUrl, options) {
    const url = httpUrl(manifestUrl);
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!url || lines[0] !== '#EXTM3U') throw new TypeError('A valid playlist URL and #EXTM3U manifest are required');
    const opts = options || {};
    const variants = [];
    const audio = [];
    const subtitles = [];
    const encryption = [];
    const segmentUrls = [];
    let pendingVariant = null;
    let endList = false;
    let playlistType = null;
    let duration = 0;
    let hasDuration = false;
    let isMaster = false;
    lines.forEach(function (line) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        isMaster = true;
        pendingVariant = parseAttributes(line.slice(line.indexOf(':') + 1));
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        isMaster = true;
        const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
        const renditionUrl = httpUrl(attrs.URI, url);
        const rendition = {
          url: renditionUrl, language: attrs.LANGUAGE || null, name: attrs.NAME || attrs.LANGUAGE || '',
          groupId: attrs['GROUP-ID'] || null, default: attrs.DEFAULT === 'YES', autoselect: attrs.AUTOSELECT === 'YES',
          forced: attrs.FORCED === 'YES', channels: attrs.CHANNELS || null,
        };
        if (attrs.TYPE === 'AUDIO') audio.push(rendition);
        if (attrs.TYPE === 'SUBTITLES' && renditionUrl) subtitles.push(rendition);
      } else if (/^#EXT-X-(?:SESSION-)?KEY:/.test(line)) {
        const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
        if (attrs.METHOD && attrs.METHOD !== 'NONE') encryption.push({ method: attrs.METHOD, keyFormat: attrs.KEYFORMAT || 'identity', url: httpUrl(attrs.URI, url), iv: attrs.IV || null });
      } else if (line.startsWith('#EXTINF:')) {
        const seconds = number(line.slice(8).split(',')[0]);
        if (seconds !== null) { duration += seconds; hasDuration = true; }
      } else if (line === '#EXT-X-ENDLIST') endList = true;
      else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) playlistType = line.slice(line.indexOf(':') + 1);
      else if (!line.startsWith('#')) {
        const uri = httpUrl(line, url);
        if (!uri) { pendingVariant = null; return; }
        if (pendingVariant) {
          const attrs = pendingVariant;
          const resolution = /^(\d+)x(\d+)$/i.exec(attrs.RESOLUTION || '');
          const bandwidth = number(attrs.BANDWIDTH);
          const averageBandwidth = number(attrs['AVERAGE-BANDWIDTH']);
          variants.push({
            id: uri, url: uri, variantUrl: uri,
            width: resolution ? Number(resolution[1]) : null, height: resolution ? Number(resolution[2]) : null,
            bandwidth: bandwidth, averageBandwidth: averageBandwidth, codecs: attrs.CODECS || null,
            frameRate: number(attrs['FRAME-RATE']), audioGroup: attrs.AUDIO || null, subtitleGroup: attrs.SUBTITLES || null,
            sizeBytes: estimateSizeBytes(averageBandwidth || bandwidth, opts.durationSeconds),
          });
          pendingVariant = null;
        } else segmentUrls.push(uri);
      }
    });
    variants.sort(function (a, b) { return (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0); });
    const durationSeconds = isMaster ? number(opts.durationSeconds) : hasDuration ? duration : null;
    const referencedUrls = Array.from(new Set(variants.map(function (variant) { return variant.url; }).concat(audio.map(function (rendition) { return rendition.url; }), subtitles.map(function (rendition) { return rendition.url; })).filter(Boolean)));
    return {
      url: url, isMaster: isMaster, variants: variants, audio: audio, subtitles: subtitles,
      durationSeconds: durationSeconds, isLive: isMaster ? null : !endList && playlistType !== 'VOD',
      isDrm: encryption.some(function (key) { return key.method !== 'AES-128' || key.keyFormat !== 'identity'; }),
      encryption: encryption, referencedUrls: referencedUrls, segmentUrls: segmentUrls,
    };
  }

  function collapseDetections(items) {
    const detected = Array.isArray(items) ? items : [];
    const roots = detected.map(function (_, index) { return index; });
    function rootOf(index) {
      while (roots[index] !== index) index = roots[index];
      return index;
    }
    function manifest(item) { return item.manifest || item.hls || item; }
    function urls(item) {
      const hls = manifest(item);
      return new Set((hls.referencedUrls || []).concat((hls.variants || []).map(function (variant) { return variant.url || variant.variantUrl; })).map(function (url) { return httpUrl(url, item.url); }).filter(Boolean));
    }
    const references = detected.map(urls);
    for (let i = 0; i < detected.length; i += 1) {
      for (let j = i + 1; j < detected.length; j += 1) {
        const a = detected[i];
        const b = detected[j];
        const aUrl = httpUrl(a.url);
        const bUrl = httpUrl(b.url);
        const aPage = a.pageUrl || a.sourcePageUrl;
        const bPage = b.pageUrl || b.sourcePageUrl;
        const aDuration = number(a.durationSeconds ?? manifest(a).durationSeconds);
        const bDuration = number(b.durationSeconds ?? manifest(b).durationSeconds);
        const samePageDuration = aPage && aPage === bPage && aDuration > 0 && aDuration === bDuration;
        const matches = (aUrl && aUrl === bUrl) || references[i].has(bUrl) || references[j].has(aUrl) || samePageDuration;
        if (matches) roots[rootOf(j)] = rootOf(i);
      }
    }
    const groups = new Map();
    detected.forEach(function (item, index) {
      const key = rootOf(index);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return Array.from(groups.values()).map(function (group) {
      const main = group.find(function (item) { return manifest(item).isMaster || (manifest(item).variants || []).length > 0; }) || group[0];
      const hls = manifest(main);
      const variants = [];
      const seen = new Set();
      const addVariant = function (variant) {
        const url = httpUrl(variant.url || variant.variantUrl, main.url);
        if (url && !seen.has(url)) { seen.add(url); variants.push(Object.assign({}, variant, { url: url, variantUrl: url })); }
      };
      group.forEach(function (item) { (manifest(item).variants || []).forEach(addVariant); });
      group.forEach(function (item) {
        // A master is a container, not a second selectable quality.
        if (manifest(item).isMaster || (manifest(item).variants || []).length) return;
        if (item === main && group.length === 1) return;
        if ((hls.audio || []).concat(hls.subtitles || []).some(function (rendition) { return rendition.url === item.url; })) return;
        addVariant({ url: item.url, height: item.height || null, sizeBytes: item.sizeBytes || null });
      });
      variants.sort(function (a, b) { return (b.height || 0) - (a.height || 0) || (b.bandwidth || 0) - (a.bandwidth || 0); });
      return Object.assign({}, main, {
        variants: variants, audio: hls.audio || [], subtitles: hls.subtitles || [],
        detectedStreams: group.slice(), collapsedCount: group.length,
      });
    });
  }

  return { parseAttributes: parseAttributes, parseHlsManifest: parseHlsManifest, collapseDetections: collapseDetections, estimateSizeBytes: estimateSizeBytes };
});
