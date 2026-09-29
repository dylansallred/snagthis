// Node's CommonJS loader runs this file with `this` bound to the exports object;
// classic scripts bind the global object and ES modules leave it undefined.
(function (exported, factory) {
  if (exported) Object.assign(exported, factory());
  else globalThis.SnagThisLibrary = factory();
})(this && this !== globalThis ? this : null, function () {
  'use strict';

  /**
   * Organise the library (owner choice: B · Real folders, with C's sort and group-by).
   * Folders are real subfolders of the save folder; a video lives in exactly one of them.
   * Copy, sort orders, groups and folder-name rules are shared by the desktop renderer
   * and the local bridge so both say and check the same thing.
   */
  const strings = Object.freeze({
    sortBy: 'Sort by', groupBy: 'Group by', sortAndGroup: 'Sort and group: {label}',
    sortNewest: 'Newest saved', sortOldest: 'Oldest saved', sortName: 'Name A–Z', sortSize: 'Largest', sortLength: 'Longest', sortSite: 'Site',
    shortNewest: 'Newest', shortOldest: 'Oldest', shortName: 'Name', shortSize: 'Largest', shortLength: 'Longest', shortSite: 'Site',
    groupNone: 'None', groupSite: 'Site', groupDate: 'Date saved', groupQuality: 'Quality',
    viewRemembered: '{scope} remembers this view.', activeStayOnTop: 'Downloads in progress stay on top.',
    scopeAll: 'All', queueOrder: 'Queue order', queueOrderHint: 'Drag waiting videos to reorder',
    allVideos: 'All videos', downloadingScope: 'Downloading',
    today: 'Today', yesterday: 'Yesterday', thisWeek: 'This week', monthYear: '{month} {year}',
    unknownSite: 'Unknown site', unknownQuality: 'Unknown quality',
    oneVideo: '1 video', manyVideos: '{n} videos', oneFile: '1 file', manyFiles: '{n} files',
    countAndSize: '{count} · {size}', emptyFolder: 'Empty',
    expandGroup: 'Show {label}', collapseGroup: 'Hide {label}',
    // Folders and the path bar.
    pathBar: 'Folder', back: 'Back', backTo: 'Back to {name}', newFolder: 'New folder', newFolderMenu: 'New folder…',
    folderNamePlaceholder: 'Folder name', newFolderHint: 'Creates {path}', renameHint: 'Renames the folder on disk',
    revealMac: 'Show in Finder', revealWindows: 'Show in Explorer', revealOther: 'Open in file manager',
    openFolder: 'Open', renameFolder: 'Rename', deleteFolderMenu: 'Delete folder…', folderOptions: 'Folder options: {name}',
    folderLabel: 'Folder {name}, {count}', openFolderLabel: 'Open {name}', folderChevron: 'Open folder',
    emptyFolderTitle: '{name} is empty',
    emptyFolderBody: 'Drag videos onto this folder in Saved, or choose ⋯ ▸ Move to…. Anything you put in it with your file manager shows up here too.',
    backToRoot: 'Back to {name}', inFolder: 'In {name}',
    // Moving.
    moveTo: 'Move to…', moveToHeading: 'Move to', moveManyHeading: 'Move {n} videos to', here: 'Here',
    moveNote: 'Moves the file, its subtitles and poster into {path}', moveHere: 'Move here · {path}',
    createAndMove: 'Create and move', create: 'Create', cancel: 'Cancel', save: 'Save',
    newFolderTitle: 'New folder', newFolderMoveBody: 'The new folder is made in {parent}, and the videos move into it.',
    movedOne: 'Moved “{title}” to {folder}', movedMany: 'Moved {count} to {folder}',
    movedPartial: 'Moved {moved} of {total} videos to {folder}. {failed} couldn’t move.',
    moveFailed: 'Couldn’t move to {folder}: {reason}', retryMove: 'Try again',
    reasonInUse: 'the file is open in another app', reasonPermission: 'SnagThis isn’t allowed to change it',
    reasonSpace: 'there isn’t enough space', reasonMissing: 'the file was moved or deleted',
    reasonFolderMissing: 'that folder is gone', reasonUnknown: 'something went wrong',
    dragCount: '{n} videos',
    // Selection.
    selectedCount: '{n} selected', removeFromList: 'Remove from list', clearSelection: 'Clear', selectionBar: 'Selected videos',
    selected: 'Selected', removedMany: 'Removed {count} from the list. The files stay in their folders.',
    // Deleting a folder.
    deleteTitle: 'Delete the folder “{name}”?', deleteChoices: 'What happens to its videos',
    keepVideos: 'Keep the videos', keepVideosBody: 'Move its {count} up to {parent}, then remove the empty folder.',
    trashFolder: 'Move folder to Trash', trashFolderBody: 'The folder and its {count} ({size}) go to the Trash. You can put them back from there.',
    otherFiles: 'It also holds {count} SnagThis didn’t save ({names}). They go with your choice.',
    deleteConfirm: 'Delete folder', trashConfirm: 'Move to Trash',
    folderDeleted: 'Deleted “{name}”', folderDeletedKept: 'Deleted “{name}”. Its {count} are now in {parent}.',
    folderTrashed: 'Moved “{name}” and its {count} to the Trash',
    folderFailed: 'Couldn’t change “{name}”: {reason}',
    // Folder names.
    nameEmpty: 'Type a name for the folder', nameSeparator: 'Folder names can’t contain / or \\',
    nameCharacters: 'Folder names can’t contain < > : " | ? * or control characters',
    nameReserved: '“{name}” is reserved by Windows. Choose another name.',
    nameTrailing: 'Folder names can’t end with a dot or a space', nameLeadingDot: 'Folder names can’t start with a dot',
    nameInternal: 'SnagThis uses that name. Choose another.', nameTooLong: 'That name is too long',
    nameDuplicate: 'There’s already a folder called “{name}” here',
    months: Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']),
  });

  function t(key, values) {
    return String(strings[key] || key).replace(/\{(\w+)\}/g, function (_, name) {
      return values && values[name] !== undefined ? String(values[name]) : '';
    });
  }

  const SORTS = Object.freeze([
    { id: 'newest', label: strings.sortNewest, short: strings.shortNewest },
    { id: 'oldest', label: strings.sortOldest, short: strings.shortOldest },
    { id: 'name', label: strings.sortName, short: strings.shortName },
    { id: 'size', label: strings.sortSize, short: strings.shortSize },
    { id: 'length', label: strings.sortLength, short: strings.shortLength },
    { id: 'site', label: strings.sortSite, short: strings.shortSite },
  ]);
  const GROUPS = Object.freeze([
    { id: 'none', label: strings.groupNone }, { id: 'site', label: strings.groupSite },
    { id: 'date', label: strings.groupDate }, { id: 'quality', label: strings.groupQuality },
  ]);
  const DEFAULT_VIEW = Object.freeze({ sort: 'newest', group: 'none' });
  const isSort = function (value) { return SORTS.some(function (item) { return item.id === value; }); };
  const isGroup = function (value) { return GROUPS.some(function (item) { return item.id === value; }); };

  /** The persisted view for one place: `all`, or `saved:` plus the folder path ('' is the save folder). */
  function viewKey(tab, folder) { return tab === 'all' ? 'all' : 'saved:' + (folder || ''); }
  function normalizeView(value) {
    const view = value && typeof value === 'object' ? value : {};
    return { sort: isSort(view.sort) ? view.sort : DEFAULT_VIEW.sort, group: isGroup(view.group) ? view.group : DEFAULT_VIEW.group };
  }
  function viewLabel(view) {
    const current = normalizeView(view);
    const sort = SORTS.find(function (item) { return item.id === current.sort; });
    if (current.group === 'none') return sort.label;
    return GROUPS.find(function (item) { return item.id === current.group; }).label + ' · ' + sort.short;
  }

  const finite = function (value) { return typeof value === 'number' && Number.isFinite(value); };
  function countLabel(n) { return n === 1 ? strings.oneVideo : t('manyVideos', { n: n }); }
  function fileCountLabel(n) { return n === 1 ? strings.oneFile : t('manyFiles', { n: n }); }

  function savedTime(item) {
    const value = new Date(item.completedAt ?? item.modifiedAt ?? item.updatedAt ?? item.createdAt ?? 0).getTime();
    return Number.isFinite(value) ? value : 0;
  }
  function titleOf(item) { return String(item.title || item.tmdbTitle || (item.youtubeMetadata && item.youtubeMetadata.title) || item.label || item.fileName || ''); }
  function durationOf(item) {
    const value = item.durationSeconds ?? item.duration ?? (item.youtubeMetadata && item.youtubeMetadata.durationSeconds) ?? (item.tmdbMetadata && item.tmdbMetadata.runtime ? item.tmdbMetadata.runtime * 60 : null);
    return finite(value) && value > 0 ? value : null;
  }
  function heightOf(item) {
    const value = Number(item.height || item.resolutionHeight || (item.selection && item.selection.height));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  /** The site a video came from: its page's host without `www.`, or '' when unknown. */
  function siteOf(item) {
    const source = item.sourcePageUrl || item.url || '';
    try {
      const url = new URL(source);
      if (!/^https?:$/.test(url.protocol)) return '';
      return url.hostname.replace(/^www\./i, '').toLowerCase();
    } catch { return ''; }
  }
  const sortableTitle = function (item) { return titleOf(item).replace(/^(the|a|an)\s+/i, ''); };
  const byName = function (a, b) { return sortableTitle(a).localeCompare(sortableTitle(b), 'en', { sensitivity: 'base', numeric: true }); };
  const newest = function (a, b) { return savedTime(b) - savedTime(a); };
  // Unknown values sort after known ones whichever way the order runs.
  const known = function (a, b, value, descending) {
    const x = value(a); const y = value(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return descending ? y - x : x - y;
  };
  const COMPARE = {
    newest: newest,
    oldest: function (a, b) { return savedTime(a) - savedTime(b); },
    name: function (a, b) { return byName(a, b) || newest(a, b); },
    size: function (a, b) { return known(a, b, function (item) { return finite(item.sizeBytes) && item.sizeBytes > 0 ? item.sizeBytes : null; }, true) || newest(a, b); },
    length: function (a, b) { return known(a, b, durationOf, true) || newest(a, b); },
    site: function (a, b) {
      const x = siteOf(a); const y = siteOf(b);
      if (x !== y) { if (!x) return 1; if (!y) return -1; return x.localeCompare(y); }
      return newest(a, b);
    },
  };
  /** Compares two saved items (history records or row sources) for a sort order. */
  function compareSaved(sort) { return COMPARE[sort] || COMPARE.newest; }
  function sortSaved(items, sort) { return items.slice().sort(compareSaved(sort)); }

  function dayNumber(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; }
  function dateGroup(item, now) {
    const date = new Date(savedTime(item));
    const today = new Date(now === undefined ? Date.now() : now);
    const days = dayNumber(today) - dayNumber(date);
    if (days <= 0) return { key: 'd0', label: strings.today, rank: 0 };
    if (days === 1) return { key: 'd1', label: strings.yesterday, rank: 1 };
    // This week runs back to the most recent Monday.
    const sinceMonday = (today.getDay() + 6) % 7;
    if (days <= sinceMonday) return { key: 'd2', label: strings.thisWeek, rank: 2 };
    const month = strings.months[date.getMonth()];
    const label = date.getFullYear() === today.getFullYear() ? month : t('monthYear', { month: month, year: date.getFullYear() });
    return { key: 'm' + date.getFullYear() + '-' + String(date.getMonth()).padStart(2, '0'), label: label, rank: 3 + (today.getFullYear() - date.getFullYear()) * 12 + today.getMonth() - date.getMonth() };
  }
  function qualityGroup(item) {
    const height = heightOf(item);
    if (!height) return { key: 'q~', label: strings.unknownQuality, rank: Infinity };
    const tiers = { 480: 'SD', 576: 'SD', 360: 'SD', 720: 'HD', 1080: 'FHD', 1440: 'QHD', 2160: '4K', 4320: '8K' };
    return { key: 'q' + height, label: tiers[height] ? tiers[height] + ' · ' + height + 'p' : height + 'p', rank: -height };
  }
  function siteGroup(item) {
    const site = siteOf(item);
    return site ? { key: 's:' + site, label: site, rank: 0, name: site } : { key: 's~', label: strings.unknownSite, rank: 1, name: '' };
  }

  /**
   * Splits sorted saved items into labelled groups. Items stay in `sort` order inside each group;
   * groups run A–Z by site, newest date first (oldest first for the Oldest order), highest quality first.
   */
  function groupSaved(items, group, options) {
    const opts = options || {};
    if (!group || group === 'none') return [];
    const sort = opts.sort || 'newest';
    const read = opts.read || function (value) { return value; };
    const keyOf = group === 'site' ? siteGroup : group === 'date' ? function (item) { return dateGroup(item, opts.now); } : qualityGroup;
    const map = new Map();
    items.forEach(function (entry) {
      const g = keyOf(read(entry));
      if (!map.has(g.key)) map.set(g.key, { key: g.key, label: g.label, rank: g.rank, name: g.name, items: [], sizeBytes: 0 });
      const bucket = map.get(g.key);
      bucket.items.push(entry);
      const size = read(entry).sizeBytes;
      if (finite(size) && size > 0) bucket.sizeBytes += size;
    });
    const groups = Array.from(map.values());
    groups.sort(function (a, b) {
      if (a.rank !== b.rank) return group === 'date' && sort === 'oldest' ? b.rank - a.rank : a.rank - b.rank;
      return String(a.name || a.label).localeCompare(String(b.name || b.label));
    });
    return groups.map(function (g) { return { key: g.key, label: g.label, items: g.items, sizeBytes: g.sizeBytes, count: g.items.length }; });
  }

  // Windows device names, with or without an extension; they cannot be folder names there.
  const RESERVED = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;
  const MAX_NAME_BYTES = 200;
  /** Folder names SnagThis keeps for itself in the save folder (scratch space and previews). */
  function isInternalName(name) { return /^temp-/i.test(name) || /^__previews$/i.test(name) || /^local-preview-[A-Za-z0-9]{6}$/.test(name); }

  /**
   * Why a folder name can't be used, or null. Names are checked as typed (no trimming), so the
   * same rules hold on every platform: nothing Windows, macOS or Linux would refuse or alter.
   * `siblings` are the names already in the parent; `caseInsensitive` compares them as macOS and
   * Windows do. `current` is the folder's own name when renaming.
   */
  function folderNameProblem(value, options) {
    const opts = options || {};
    const name = typeof value === 'string' ? value.normalize('NFC') : '';
    const fail = function (code, extra) { return { code: code, message: t(code, Object.assign({ name: name }, extra || {})) }; };
    if (!name.trim()) return fail('nameEmpty');
    if (/[/\\]/.test(name)) return fail('nameSeparator');
    if (/[<>:"|?*\u0000-\u001f\u007f]/.test(name)) return fail('nameCharacters');
    if (name === '.' || name === '..' || name.startsWith('.')) return fail('nameLeadingDot');
    if (/[. ]$/.test(name)) return fail('nameTrailing');
    if (RESERVED.test(name)) return fail('nameReserved');
    if (isInternalName(name)) return fail('nameInternal');
    if (utf8Length(name) > MAX_NAME_BYTES) return fail('nameTooLong');
    const fold = function (text) { const normal = String(text).normalize('NFC'); return opts.caseInsensitive ? normal.toLocaleLowerCase('en') : normal; };
    const current = typeof opts.current === 'string' ? fold(opts.current) : null;
    const wanted = fold(name);
    if ((opts.siblings || []).some(function (sibling) { const other = fold(sibling); return other === wanted && other !== current; })) return fail('nameDuplicate');
    return null;
  }
  function utf8Length(text) {
    let bytes = 0;
    for (const character of text) {
      const code = character.codePointAt(0);
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
  }

  const REASONS = { 'in-use': 'reasonInUse', permission: 'reasonPermission', space: 'reasonSpace', missing: 'reasonMissing', 'folder-missing': 'reasonFolderMissing' };
  /** Plain words for a move or folder failure code from the bridge. */
  function failureReason(code) { return strings[REASONS[code] || 'reasonUnknown']; }
  /** Maps a filesystem error to a failure code the interface can explain. */
  function failureCode(error) {
    const code = error && typeof error === 'object' ? String(error.code || '') : '';
    // Windows refuses to rename a file another program holds open with EPERM (or EBUSY).
    if (code === 'EBUSY' || code === 'ETXTBSY' || (code === 'EPERM' && typeof process !== 'undefined' && process.platform === 'win32')) return 'in-use';
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'permission';
    if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'EFBIG') return 'space';
    if (code === 'ENOENT') return 'missing';
    if (code === 'FOLDER_MISSING') return 'folder-missing';
    return 'unknown';
  }

  /** The last segment of a folder path ('' is the save folder, named `rootName`). */
  function folderName(folderPath, rootName) {
    const parts = String(folderPath || '').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : rootName;
  }
  function parentFolder(folderPath) {
    const parts = String(folderPath || '').split('/').filter(Boolean);
    return parts.slice(0, -1).join('/');
  }

  return {
    libraryStrings: strings, libraryText: t, SORTS: SORTS, GROUPS: GROUPS, DEFAULT_VIEW: DEFAULT_VIEW,
    isSort: isSort, isGroup: isGroup, viewKey: viewKey, normalizeView: normalizeView, viewLabel: viewLabel,
    countLabel: countLabel, fileCountLabel: fileCountLabel, siteOf: siteOf, durationOf: durationOf, titleOf: titleOf,
    compareSaved: compareSaved, sortSaved: sortSaved, groupSaved: groupSaved,
    folderNameProblem: folderNameProblem, isInternalName: isInternalName, failureReason: failureReason, failureCode: failureCode,
    folderName: folderName, parentFolder: parentFolder,
  };
});
