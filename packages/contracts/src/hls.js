// Node's CommonJS loader runs this file with `this` bound to the exports object;
// classic scripts bind the global object and ES modules leave it undefined. Avoiding
// the free `module` identifier keeps bundlers from wrapping the file in a CommonJS shim.
(function (exported, factory) {
  if (exported) Object.assign(exported, factory());
  else globalThis.SnagThisHls = factory();
})(this && this !== globalThis ? this : null, function () {
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

  // HEVC/Dolby Vision or PQ/HLG renditions play in fewer places than AVC SDR.
  function isHdrOrHevc(variant) {
    const codecs = String(variant && variant.codecs || '').toLowerCase();
    const range = String(variant && variant.videoRange || '').toUpperCase();
    return /(?:^|,)\s*(?:hvc1|hev1|dvh1|dvhe|dav1)/.test(codecs) || range === 'PQ' || range === 'HLG';
  }

  // Highest first; at equal height the broadly playable AVC/SDR copy comes
  // first, so a default never lands on HEVC/HDR unless the user picks it.
  function compareVariants(a, b) {
    return (b.height || 0) - (a.height || 0)
      || (isHdrOrHevc(a) ? 1 : 0) - (isHdrOrHevc(b) ? 1 : 0)
      || (b.bandwidth || 0) - (a.bandwidth || 0);
  }

  function variantKey(variant) {
    // Without bandwidth, resolution and codecs, attributes cannot prove that two
    // URLs carry the same encode (rather than two different sources).
    if (!variant || !variant.bandwidth || !variant.height || !variant.codecs) return null;
    return [variant.height || 0, variant.bandwidth, String(variant.codecs || '').toLowerCase(), variant.audioGroup || '', variant.videoRange || ''].join('|');
  }

  // Redundant CDN copies (identical attributes, different URL) are one quality.
  // Extra copies are kept as ordered failover URLs rather than extra choices.
  function dedupeVariants(list) {
    const result = [];
    const byKey = new Map();
    (list || []).slice().sort(compareVariants).forEach(function (variant) {
      const key = variantKey(variant);
      const first = key && byKey.get(key);
      if (!first) {
        const copy = Object.assign({}, variant);
        if (key) byKey.set(key, copy);
        result.push(copy);
        return;
      }
      const backups = (first.backupUrls || []).slice();
      [variant.url].concat(variant.backupUrls || []).forEach(function (url) {
        if (url && url !== first.url && backups.indexOf(url) < 0) backups.push(url);
      });
      first.backupUrls = backups;
      if (variant.observed) first.observed = true;
    });
    return result;
  }

  // The quality a download starts with. A player that already loaded some
  // renditions has proven those work on this CDN; prefer the highest of them.
  // Otherwise choose the highest, broadly playable rendition.
  // A preferred height is used when present; otherwise `atMost` picks the
  // highest below it (lowest if none), else the highest candidate.
  function defaultVariant(variants, preferredQuality, options) {
    const ordered = (variants || []).slice().sort(compareVariants);
    if (!ordered.length) return null;
    const observed = ordered.filter(function (variant) { return variant.observed; });
    const candidates = observed.length ? observed : ordered;
    const wanted = Number.parseInt(preferredQuality, 10);
    let chosen;
    if (!(wanted > 0)) chosen = candidates[0];
    else {
      chosen = candidates.find(function (variant) { return variant.height === wanted; });
      if (!chosen && options && options.atMost) chosen = candidates.find(function (variant) { return (variant.height || 0) <= wanted; }) || candidates[candidates.length - 1];
      chosen = chosen || candidates[0];
    }
    // A player that loaded the HEVC/HDR copy proves the height plays; the AVC
    // copy of that same height is still the broadly compatible default.
    if (chosen && isHdrOrHevc(chosen)) {
      const avc = ordered.find(function (variant) { return variant.height === chosen.height && !isHdrOrHevc(variant); });
      if (avc) chosen = avc;
    }
    return chosen;
  }

  // DRM key systems, by the identifiers manifests and EME use for them. Plain
  // HLS AES-128 (an ordinary key file) is not DRM and is never reported here.
  const KEY_SYSTEMS = [
    { id: 'widevine', pattern: /edef8ba9-?79d6-?4ace-?a3c8-?27dcd51d21ed|widevine/i },
    { id: 'playready', pattern: /9a04f079-?9840-?4286-?ab92-?e65be0885f95|playready/i },
    { id: 'fairplay', pattern: /94ce86fb-?07ff-?4f43-?adb8-?93d2fa968ca2|com\.apple\.(?:fps|streamingkeydelivery)|fairplay|^skd:/i },
    { id: 'clearkey', pattern: /e2719d58-?a985-?b3c9-?781a-?b030af78d30e|1077efec-?c0b2-?4d02-?ace3-?3c1e52e2fb4b|clearkey/i },
  ];
  function keySystemOf(value) {
    const text = String(value || '');
    const match = KEY_SYSTEMS.find(function (system) { return system.pattern.test(text); });
    return match ? match.id : '';
  }
  function uniqueKeySystems(values) {
    return Array.from(new Set(values.map(keySystemOf).filter(Boolean)));
  }

  // ISO 8601 durations as DASH writes them (PT1H2M3.5S, P1DT2H).
  function isoDuration(value) {
    const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value || '').trim());
    if (!match || !match.slice(1).some(Boolean)) return null;
    const seconds = (Number(match[1]) || 0) * 86400 + (Number(match[2]) || 0) * 3600 + (Number(match[3]) || 0) * 60 + (Number(match[4]) || 0);
    return seconds > 0 ? seconds : null;
  }

  function isDashManifest(text) {
    return /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w-]+:)?MPD[\s>]/.test(String(text || '').slice(0, 4096));
  }

  // A light DASH reader for detection only: duration, protection and which
  // piece URLs belong to it. Works without DOMParser (service workers lack it).
  function parseDashManifest(text, manifestUrl) {
    const url = httpUrl(manifestUrl);
    const body = String(text || '');
    if (!url || !isDashManifest(body)) throw new TypeError('A valid manifest URL and MPD document are required');
    const attr = function (tag, name) {
      const match = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
      return match ? (match[1] === undefined ? match[2] : match[1]).replace(/&amp;/g, '&') : '';
    };
    const stack = [{ name: '', base: url }];
    const protection = [];
    const templates = [];
    const segmentUrls = [];
    const initializationUrls = [];
    let durationSeconds = null;
    let isLive = false;
    const heights = [];
    const pattern = /<!--[\s\S]*?-->|<(\/?)(?:[\w-]+:)?([A-Za-z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    let match;
    let characters = '';
    while ((match = pattern.exec(body))) {
      if (match[0].startsWith('<!--')) continue;
      if (match[5] !== undefined) { characters += match[5]; continue; }
      const closing = match[1] === '/';
      const name = match[2];
      const tag = match[3] || '';
      if (closing) {
        const top = stack.pop();
        if (top && top.name === 'BaseURL') {
          const parent = stack[stack.length - 1];
          const resolved = httpUrl(characters.trim().replace(/&amp;/g, '&'), parent.base);
          // The first BaseURL of an element wins; later ones are CDN alternates.
          if (resolved && !parent.hasBase) { parent.base = resolved; parent.hasBase = true; }
          if (resolved && parent.name === 'Representation' && !/\/$/.test(resolved)) parent.file = resolved;
        }
        if (top && top.name === 'Representation' && top.file && !top.template && segmentUrls.indexOf(top.file) < 0) segmentUrls.push(top.file);
        if (!stack.length) stack.push({ name: '', base: url });
        continue;
      }
      const parent = stack[stack.length - 1];
      if (name === 'MPD') {
        durationSeconds = isoDuration(attr(tag, 'mediaPresentationDuration'));
        isLive = attr(tag, 'type') === 'dynamic';
      } else if (name === 'ContentProtection') {
        protection.push(attr(tag, 'schemeIdUri') + ' ' + attr(tag, 'value'));
      } else if (name === 'SegmentTemplate') {
        ['media', 'initialization'].forEach(function (key) {
          const value = attr(tag, key);
          if (!value) return;
          const resolved = httpUrl(value.replace(/\$([A-Za-z]+)(?:%0\d+d)?\$/g, function (_, id) { return '__DASH_' + id + '__'; }), parent.base);
          if (resolved && templates.indexOf(resolved) < 0) templates.push(resolved);
        });
        for (let index = stack.length - 1; index >= 0; index -= 1) if (stack[index].name === 'Representation' || stack[index].name === 'AdaptationSet') { stack[index].template = true; break; }
      } else if (name === 'Initialization' || name === 'SegmentURL') {
        const value = attr(tag, name === 'Initialization' ? 'sourceURL' : 'media');
        const resolved = value && httpUrl(value, parent.base);
        if (resolved) (name === 'Initialization' ? initializationUrls : segmentUrls).push(resolved);
        if (name === 'SegmentURL') for (let index = stack.length - 1; index >= 0; index -= 1) if (stack[index].name === 'Representation') { stack[index].template = true; break; }
      } else if (name === 'Representation') {
        const height = number(attr(tag, 'height'));
        if (height) heights.push(height);
      }
      // AdaptationSet-level templates apply to each Representation below it.
      const inheritsTemplate = name === 'Representation' && stack.some(function (entry) { return entry.name === 'AdaptationSet' && entry.template; });
      if (match[4] !== '/') { stack.push({ name: name, base: parent.base, template: inheritsTemplate }); characters = ''; }
    }
    const keySystems = uniqueKeySystems(protection);
    return {
      url: url, isDash: true, isMaster: false, variants: [], audio: [], subtitles: [],
      durationSeconds: durationSeconds, isLive: isLive, isDrm: protection.length > 0, keySystems: keySystems,
      encryption: [], referencedUrls: [], segmentUrls: segmentUrls, initializationUrls: initializationUrls, segmentTemplates: templates,
      height: heights.length ? Math.max.apply(null, heights) : null,
    };
  }

  // Whether a URL is one the manifest's SegmentTemplate would produce.
  function matchesSegmentTemplate(candidate, templates) {
    const path = String(candidate || '').split(/[?#]/)[0];
    return (templates || []).some(function (template) {
      const source = String(template).split(/[?#]/)[0];
      const expression = source.split(/__DASH_[A-Za-z]+__/).map(function (part) { return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('[^/]+?');
      return new RegExp('^' + expression + '$').test(path);
    });
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
    const initializationUrls = [];
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
          forced: attrs.FORCED === 'YES', channels: attrs.CHANNELS || null, characteristics: attrs.CHARACTERISTICS || null,
        };
        if (attrs.TYPE === 'AUDIO') audio.push(rendition);
        if (attrs.TYPE === 'SUBTITLES' && renditionUrl) subtitles.push(rendition);
      } else if (/^#EXT-X-(?:SESSION-)?KEY:/.test(line)) {
        const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
        if (attrs.METHOD && attrs.METHOD !== 'NONE') encryption.push({ method: attrs.METHOD, keyFormat: attrs.KEYFORMAT || 'identity', url: httpUrl(attrs.URI, url), iv: attrs.IV || null });
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
        const initUrl = httpUrl(attrs.URI, url);
        if (initUrl && !initializationUrls.includes(initUrl)) initializationUrls.push(initUrl);
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
          const sizeBytes = estimateSizeBytes(averageBandwidth || bandwidth, opts.durationSeconds);
          variants.push({
            id: uri, url: uri, variantUrl: uri,
            width: resolution ? Number(resolution[1]) : null, height: resolution ? Number(resolution[2]) : null,
            bandwidth: bandwidth, averageBandwidth: averageBandwidth, codecs: attrs.CODECS || null,
            frameRate: number(attrs['FRAME-RATE']), audioGroup: attrs.AUDIO || null, subtitleGroup: attrs.SUBTITLES || null,
            videoRange: attrs['VIDEO-RANGE'] || null,
            sizeBytes: sizeBytes, sizeEstimated: sizeBytes !== null,
          });
          pendingVariant = null;
        } else segmentUrls.push(uri);
      }
    });
    const orderedVariants = dedupeVariants(variants);
    const durationSeconds = isMaster ? number(opts.durationSeconds) : hasDuration ? duration : null;
    const referencedUrls = Array.from(new Set(variants.map(function (variant) { return variant.url; }).concat(audio.map(function (rendition) { return rendition.url; }), subtitles.map(function (rendition) { return rendition.url; })).filter(Boolean)));
    return {
      url: url, isMaster: isMaster, variants: orderedVariants, audio: audio, subtitles: subtitles,
      durationSeconds: durationSeconds, isLive: isMaster ? null : !endList && playlistType !== 'VOD',
      isDrm: encryption.some(function (key) { return key.method !== 'AES-128' || key.keyFormat !== 'identity'; }),
      keySystems: uniqueKeySystems(encryption.filter(function (key) { return key.method !== 'AES-128' || key.keyFormat !== 'identity'; }).map(function (key) { return key.keyFormat + ' ' + (key.url || ''); })),
      encryption: encryption, referencedUrls: referencedUrls, segmentUrls: segmentUrls, initializationUrls: initializationUrls,
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
    function components(item) {
      const hls = manifest(item);
      return (hls.segmentUrls || []).concat(hls.initializationUrls || []).map(function (url) { return httpUrl(url, item.url); }).filter(Boolean);
    }
    function urls(item) {
      const hls = manifest(item);
      return new Set((hls.referencedUrls || []).concat((hls.variants || []).map(function (variant) { return variant.url || variant.variantUrl; }), components(item)).map(function (url) { return httpUrl(url, item.url); }).filter(Boolean));
    }
    const references = detected.map(urls);
    // Proxy fan-out (P-Stream forks) serves one title from several sources whose
    // playlists differ by a few frames. Short clips must match exactly.
    function sameDuration(a, b) {
      if (!(a > 0) || !(b > 0)) return false;
      if (a === b) return true;
      const longer = Math.max(a, b);
      return longer >= 60 && Math.abs(a - b) <= Math.max(1, longer * 0.0005);
    }
    // Wikimedia-style transcodes live under a directory named after the source
    // file (".../Title.webm/Title.webm.720p.vp9.webm"): one title, many rows.
    function transcodeKey(item) {
      if (item.type !== 'file' || manifest(item).isMaster || Array.isArray(manifest(item).segmentUrls)) return '';
      try {
        const parsed = new URL(item.url);
        const parts = parsed.pathname.split('/').filter(Boolean).map(function (part) { try { return decodeURIComponent(part); } catch { return part; } });
        const index = parts.findIndex(function (part) { return /\.(?:mp4|m4v|mov|webm|mkv|ogv|ogg)$/i.test(part); });
        if (index < 0) return null;
        return { key: [parsed.host].concat(parts.slice(Math.max(0, index - 2), index + 1)).join('/'), derived: index < parts.length - 1 };
      } catch { return null; }
    }
    const transcodeKeys = detected.map(transcodeKey);
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
        const samePageDuration = aPage && aPage === bPage && sameDuration(aDuration, bDuration);
        const aFile = transcodeKeys[i];
        const bFile = transcodeKeys[j];
        // Two plain files that merely share a name are not related; a derived
        // copy filed under the other's name is.
        const sameTranscode = aFile && bFile && aFile.key === bFile.key && (aFile.derived || bFile.derived)
          && (!aPage || !bPage || aPage === bPage);
        const matches = (aUrl && aUrl === bUrl) || references[i].has(bUrl) || references[j].has(aUrl) || samePageDuration || sameTranscode;
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
      const main = group.find(function (item) { return manifest(item).isMaster || (manifest(item).variants || []).length > 0; })
        || group.find(function (item) { return Array.isArray(manifest(item).segmentUrls); }) || group[0];
      const hls = manifest(main);
      const sourcesByUrl = new Map(group.map(function (item) { return [httpUrl(item.url), item]; }));
      const videoUrls = new Set();
      function includeVideo(url, base) {
        const resolved = httpUrl(url, base);
        if (!resolved || videoUrls.has(resolved)) return;
        videoUrls.add(resolved);
        const source = sourcesByUrl.get(resolved);
        if (source) (manifest(source).variants || []).forEach(function (variant) { includeVideo(variant.url || variant.variantUrl, source.url); });
      }
      // Follow only declared video variants, including nested masters. Audio,
      // subtitles and same-page alternatives cannot supply this video's art.
      includeVideo(main.url);
      const mediaPlaylists = group.filter(function (item) {
        const info = manifest(item);
        return !info.isMaster && Array.isArray(info.segmentUrls)
          && videoUrls.has(httpUrl(item.url));
      });
      // A child's EXTINF durations describe this stream. Page metadata can be
      // missing when the master arrives, or still belong to an earlier video.
      // A rendition's own playlist was requested by the page's player, so that
      // quality demonstrably plays on this CDN (some publish dead renditions).
      const loaded = new Set(group.filter(function (item) { return item !== main; }).map(function (item) { return httpUrl(item.url); }).filter(Boolean));
      const completePlaylist = mediaPlaylists.find(function (item) { return manifest(item).isLive === false && number(manifest(item).durationSeconds) > 0; });
      const durationSeconds = completePlaylist ? number(manifest(completePlaylist).durationSeconds) : number(main.durationSeconds ?? hls.durationSeconds);
      const componentUrls = new Set(group.flatMap(components));
      const variants = [];
      const seen = new Set();
      const addVariant = function (variant) {
        const url = httpUrl(variant.url || variant.variantUrl, main.url);
        if (url && !seen.has(url)) {
          seen.add(url);
          const copy = Object.assign({}, variant, { url: url, variantUrl: url });
          if (loaded.has(url) || (variant.backupUrls || []).some(function (backup) { return loaded.has(backup); })) copy.observed = true;
          variants.push(copy);
        }
      };
      group.forEach(function (item) { (manifest(item).variants || []).forEach(addVariant); });
      const hasDeclaredVariants = variants.length > 0;
      group.forEach(function (item) {
        // A master is a container, not a second selectable quality.
        if (manifest(item).isMaster || (manifest(item).variants || []).length) return;
        if (item === main && group.length === 1) return;
        // An fMP4 init or media segment can look like a direct MP4 request.
        // Its exact playlist reference proves it is a component, not a quality.
        if (componentUrls.has(httpUrl(item.url))) return;
        if ((hls.audio || []).concat(hls.subtitles || []).some(function (rendition) { return rendition.url === item.url; })) return;
        const kind = String(item.mediaKind || '');
        const contentType = String(item.contentType || '').toLowerCase();
        const isPlaylist = item.type === 'hls' || item.streamType === 'hls'
          || kind.startsWith('hls-') || /mpegurl|dash\+xml/.test(contentType)
          || Array.isArray(manifest(item).segmentUrls)
          || /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(item.url || '');
        if (hasDeclaredVariants) {
          // Observing a master/child request again does not discover another quality.
          // Its height may merely be copied from the currently playing video. Keep
          // the master's actual renditions authoritative, including equal heights.
          // Separately observed direct files can still be genuine alternatives.
          const isDirectFile = !isPlaylist && kind !== 'youtube-page' && (
            /\.(?:mp4|m4v|mov|webm|mkv|avi|flv|ogv|mp3|m4a|ogg|wav)(?:[?#]|$)/i.test(item.url || '')
            || /^(?:video|audio)\/(?!unknown(?:;|$)|youtube(?:;|$)|mp2t(?:;|$))/.test(contentType)
          );
          if (!isDirectFile) return;
        }
        addVariant({ url: item.url, height: item.height || null, sizeBytes: item.sizeBytes || (!isPlaylist && item.contentLength) || null, sizeEstimated: Boolean(item.sizeEstimated) });
      });
      variants.forEach(function (variant) {
        if (!(variant.averageBandwidth || variant.bandwidth)) return;
        const child = mediaPlaylists.find(function (item) { return httpUrl(item.url) === variant.url; });
        const childManifest = child && manifest(child);
        const duration = childManifest ? childManifest.isLive === false ? childManifest.durationSeconds : null : durationSeconds;
        const estimate = estimateSizeBytes(variant.averageBandwidth || variant.bandwidth, duration);
        if (estimate !== null) {
          variant.sizeBytes = estimate;
          variant.sizeEstimated = true;
        }
      });
      const orderedVariants = dedupeVariants(variants);
      return Object.assign({}, main, {
        durationSeconds: durationSeconds,
        thumbnailUrl: main.thumbnailUrl || mediaPlaylists.find(function (item) { return item.thumbnailUrl; })?.thumbnailUrl,
        poster: main.poster || mediaPlaylists.find(function (item) { return item.poster; })?.poster,
        height: main.height || mediaPlaylists.find(function (item) { return item.height; })?.height,
        variants: orderedVariants, audio: hls.audio || [], subtitles: hls.subtitles || [],
        detectedStreams: group.slice(), collapsedCount: group.length,
      });
    });
  }

  return {
    parseAttributes: parseAttributes, parseHlsManifest: parseHlsManifest, parseDashManifest: parseDashManifest, isDashManifest: isDashManifest,
    keySystemOf: keySystemOf, matchesSegmentTemplate: matchesSegmentTemplate, collapseDetections: collapseDetections, estimateSizeBytes: estimateSizeBytes,
    compareVariants: compareVariants, dedupeVariants: dedupeVariants, defaultVariant: defaultVariant, isHdrOrHevc: isHdrOrHevc, variantKey: variantKey,
  };
});
