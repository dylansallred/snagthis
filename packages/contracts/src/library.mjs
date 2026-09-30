import * as moduleNamespace from './library.js';
// Node exposes the CommonJS export; browsers execute the same UMD implementation.
const library = Reflect.get(moduleNamespace, 'default') || globalThis.SnagThisLibrary;
export const { libraryStrings, libraryText, SORTS, GROUPS, DEFAULT_VIEW, isSort, isGroup, viewKey, normalizeView, viewLabel, countLabel, fileCountLabel, siteOf, durationOf, titleOf, compareSaved, sortSaved, groupSaved, folderNameProblem, isInternalName, failureReason, failureCode, folderName, parentFolder, videoNameProblem, codecLabel, containerLabel, formatBitrate, formatFrameRate } = library;
export default library;
