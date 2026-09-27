// Node's CommonJS loader runs this file with `this` bound to the exports object;
// classic scripts bind the global object and ES modules leave it undefined. Avoiding
// the free `module` identifier keeps bundlers from wrapping the file in a CommonJS shim.
(function (exported, factory) {
  if (exported) Object.assign(exported, factory());
  else globalThis.SnagThisAudioTracks = factory();
})(this && this !== globalThis ? this : null, function () {
  'use strict';

  // Plain-language audio track labels shared by the popup and desktop picker
  // (docs/design/prototypes/audio-tracks, Labels 2 · Plain language).
  const NO_LANGUAGE = /^(?:und|mul|zxx|mis|root|q[a-t][a-z])$/i;
  const GENERIC_NAME = /^(?:(?:audio|track|stream|sound|default|main|alt(?:ernate)?|a)\s*[#:.-]?\s*\d*|\d+)$/i;
  const DESCRIBES_VIDEO = /public\.accessibility\.describes-video/i;
  const displayNames = new Map();

  function text(value) { return typeof value === 'string' ? value.trim() : ''; }

  function languageName(code, locale) {
    const value = text(code).replace(/_/g, '-');
    if (!value || value.length > 35 || NO_LANGUAGE.test(value.split('-')[0])) return null;
    try {
      const displayLocale = locale || 'en';
      if (!displayNames.has(displayLocale)) {
        if (displayNames.size >= 32) displayNames.clear();
        displayNames.set(displayLocale, new Intl.DisplayNames([displayLocale], { type: 'language', languageDisplay: 'standard' }));
      }
      const names = displayNames.get(displayLocale);
      const primary = value.split('-')[0];
      const name = names.of(value);
      // Unknown codes come back unchanged (or as "xx (YY)"); they say nothing to a person.
      return name && name.toLowerCase() !== value.toLowerCase() && String(names.of(primary)).toLowerCase() !== primary.toLowerCase() ? name : null;
    } catch { return null; }
  }

  function channelsLabel(value) {
    const raw = text(value === undefined || value === null ? '' : String(value));
    if (!raw) return null;
    if (/JOC/i.test(raw)) return 'Atmos';
    const count = Number.parseInt(raw, 10);
    return ({ 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' })[count] || (count > 0 ? count + ' ch' : null);
  }

  // Identity of a rendition independent of its (possibly rotating) URL and
  // codec group. Identical nameless renditions within one group stay distinct.
  function audioRenditionKeys(audio) {
    const counts = new Map();
    return (Array.isArray(audio) ? audio : []).map(function (rendition) {
      const item = rendition || {};
      const base = [text(item.language), text(item.name), text(item.channels), text(item.characteristics)].join('|');
      const scoped = (item.groupId || '') + '\u0000' + base;
      const occurrence = (counts.get(scoped) || 0) + 1;
      counts.set(scoped, occurrence);
      return occurrence > 1 ? base + '#' + occurrence : base;
    });
  }

  function describeAudioTracks(audio, options) {
    const opts = options || {};
    const list = Array.isArray(audio) ? audio : [];
    const keys = audioRenditionKeys(list);
    const tracks = [];
    const byKey = new Map();
    list.forEach(function (rendition, index) {
      const item = rendition || {};
      const key = keys[index];
      const existing = byKey.get(key);
      // Collapse one track repeated across GROUP-IDs (one group per codec family).
      if (existing && (text(item.language) || !existing.renditions.some(function (other) { return other.groupId === item.groupId; }))) {
        existing.renditions.push(item);
        existing.isDefault = existing.isDefault || item.default === true;
        return;
      }
      const track = { key: key, renditions: [item], isDefault: item.default === true };
      byKey.set(key, track);
      tracks.push(track);
    });
    const out = tracks.map(function (track, index) {
      const item = track.renditions[0];
      const name = text(item.name);
      const code = text(item.language);
      const english = languageName(code, opts.locale);
      const native = english ? languageName(code, code) : null;
      const lowerName = name.toLowerCase();
      const role = text(item.role).toLowerCase();
      const ad = DESCRIBES_VIDEO.test(item.characteristics || '') || role === 'description' || /\b(?:audio description|described)\b/i.test(name);
      const commentary = role === 'commentary' || /commentary/i.test(name);
      const nameUseful = Boolean(name) && !GENERIC_NAME.test(name) && lowerName !== code.toLowerCase();
      const extra = nameUseful && !ad && (!english || !(lowerName.includes(english.toLowerCase()) || (native && lowerName === native.toLowerCase()))) ? name : null;
      const ordinal = index + 1;
      return {
        key: track.key, ordinal: ordinal, renditions: track.renditions, url: track.renditions.map(function (value) { return value.url; }).find(Boolean) || null,
        language: english, languageCode: english ? code : null, unknown: !english,
        primary: english || extra || 'Track ' + ordinal, extra: english ? extra : null,
        channels: channelsLabel(item.channels), ad: ad, commentary: commentary, isDefault: track.isDefault,
      };
    });
    // Channels only help when they differ between tracks.
    if (new Set(out.map(function (track) { return track.channels; })).size === 1) out.forEach(function (track) { track.channels = null; });
    const identity = function (track) { return [track.primary, track.extra, track.channels, track.ad, track.commentary].join('|'); };
    const totals = {};
    out.forEach(function (track) { const id = identity(track); totals[id] = (totals[id] || 0) + 1; });
    const seen = {};
    return out.map(function (track) {
      const id = identity(track);
      seen[id] = (seen[id] || 0) + 1;
      const title = track.primary + (totals[id] > 1 ? ' · ' + seen[id] : '');
      const tags = [track.channels && track.channels !== 'Stereo' ? track.channels : null, track.ad ? 'AD' : null].filter(Boolean);
      const detail = track.unknown
        ? ['Unknown language', track.isDefault ? 'Default' : ''].filter(Boolean).join(' · ')
        : [track.extra && !track.commentary ? track.extra : '', track.commentary ? 'Commentary' : '', track.channels === 'Stereo' ? 'Stereo' : '', track.isDefault ? 'Default' : ''].filter(Boolean).join(' · ');
      const ariaLabel = [track.unknown ? title + ', unknown language' : title, track.unknown ? null : track.extra, track.channels, track.ad && 'audio description', track.commentary && 'commentary', track.isDefault && 'default'].filter(Boolean).join(', ');
      return Object.assign({}, track, { title: title, tags: tags, detail: detail, ariaLabel: ariaLabel, shortLabel: track.unknown ? 'Track ' + track.ordinal : title });
    });
  }

  function defaultAudioTrack(tracks) {
    const list = Array.isArray(tracks) ? tracks : [];
    return list.find(function (track) { return track.isDefault; }) || list[0] || null;
  }

  // Resolve a chosen track key to the rendition in the selected video's group.
  function findAudioRendition(audio, groupId, trackKey) {
    const list = Array.isArray(audio) ? audio : [];
    const keys = audioRenditionKeys(list);
    const matches = list.filter(function (_item, index) { return keys[index] === trackKey; });
    return matches.find(function (item) { return !groupId || item.groupId === groupId; }) || matches[0] || null;
  }

  // A saved job's chosen track, in plain language ("Hindi", "Track 3", "English (AD)").
  function selectionAudioLabel(selection) {
    const value = selection || {};
    if (typeof value.audioTrack === 'string' && value.audioTrack) {
      const parts = value.audioTrack.replace(/#\d+$/, '').split('|');
      if (parts.length >= 4) {
        const characteristics = parts.pop(); const channels = parts.pop(); const language = parts.shift();
        const name = parts.join('|');
        const track = describeAudioTracks([{ language: language, name: name, channels: channels, characteristics: characteristics }])[0];
        const base = track.unknown ? (name || null) : track.primary;
        if (base) return base + (track.ad ? ' (AD)' : track.commentary && !track.unknown ? ' (commentary)' : '');
      }
    }
    if (typeof value.audioLang === 'string' && value.audioLang) return languageName(value.audioLang) || value.audioLang;
    return null;
  }

  function attribute(tag, name) {
    const match = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag || '');
    return match ? decodeXml(match[1] !== undefined ? match[1] : match[2]) : '';
  }
  function decodeXml(value) {
    return String(value || '').replace(/&(?:lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, function (entity, dec, hex) {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' })[entity.toLowerCase()];
    });
  }
  function dashChannels(scheme, value) {
    const raw = text(value);
    if (/23003:3/.test(scheme) && /^\d+$/.test(raw)) return raw;
    if (/cicp:ChannelConfiguration/i.test(scheme)) return ({ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '8', 12: '8', 14: '8' })[raw] || null;
    return null;
  }

  // Audio adaptation sets of a DASH manifest, shaped like HLS renditions.
  // streamIndex is FFmpeg's audio stream index (dashdec orders audio
  // representations by appearance in the first period).
  function parseDashAudio(textValue, manifestUrl) {
    const source = String(textValue || '').replace(/<!--[\s\S]*?-->/g, '');
    if (!/<MPD\b/i.test(source)) return [];
    const firstPeriod = /<Period\b[\s\S]*?<\/Period>/i.exec(source);
    const scope = firstPeriod ? firstPeriod[0] : source;
    const sets = scope.match(/<AdaptationSet\b[\s\S]*?<\/AdaptationSet>/gi) || [];
    const audio = [];
    let streamIndex = 0;
    sets.forEach(function (set) {
      const open = /<AdaptationSet\b[^>]*>/i.exec(set)[0];
      const representations = set.match(/<Representation\b[^>]*>/gi) || [];
      const mime = attribute(open, 'mimeType') || attribute(open, 'contentType') || (representations[0] && attribute(representations[0], 'mimeType')) || '';
      if (!/^audio/i.test(mime) && attribute(open, 'contentType').toLowerCase() !== 'audio') return;
      const roles = (set.match(/<Role\b[^>]*>/gi) || []).filter(function (tag) { return /urn:mpeg:dash:role:2011/i.test(attribute(tag, 'schemeIdUri')); }).map(function (tag) { return attribute(tag, 'value').toLowerCase(); });
      const accessibility = (set.match(/<Accessibility\b[^>]*>/gi) || []).some(function (tag) {
        const scheme = attribute(tag, 'schemeIdUri'); const value = attribute(tag, 'value');
        return (/urn:mpeg:dash:role:2011/i.test(scheme) && value === 'description') || (/AudioPurposeCS:2007/i.test(scheme) && value === '1');
      });
      const channelTag = /<AudioChannelConfiguration\b[^>]*>/i.exec(set);
      const labelElement = /<Label\b[^>]*>([\s\S]*?)<\/Label>/i.exec(set);
      const description = roles.includes('description') || accessibility;
      audio.push({
        url: null, manifestUrl: manifestUrl || null, groupId: 'dash', language: attribute(open, 'lang') || null,
        name: attribute(open, 'label') || (labelElement ? decodeXml(labelElement[1]).trim() : ''),
        default: roles.includes('main'), autoselect: false, forced: false,
        channels: channelTag ? dashChannels(attribute(channelTag[0], 'schemeIdUri'), attribute(channelTag[0], 'value')) : null,
        characteristics: description ? 'public.accessibility.describes-video' : null,
        role: description ? 'description' : roles.includes('commentary') ? 'commentary' : roles[0] || null,
        streamIndex: streamIndex,
      });
      streamIndex += Math.max(1, representations.length);
    });
    if (audio.length && !audio.some(function (item) { return item.default; })) audio[0].default = true;
    return audio;
  }

  return { languageName: languageName, channelsLabel: channelsLabel, audioRenditionKeys: audioRenditionKeys, describeAudioTracks: describeAudioTracks, defaultAudioTrack: defaultAudioTrack, findAudioRendition: findAudioRendition, selectionAudioLabel: selectionAudioLabel, parseDashAudio: parseDashAudio };
});
