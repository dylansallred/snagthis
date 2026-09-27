import * as moduleNamespace from './audioTracks.js';
// Node exposes the CommonJS export; browsers execute the same UMD implementation.
const audioTracks = Reflect.get(moduleNamespace, 'default') || globalThis.SnagThisAudioTracks;
export const { languageName, channelsLabel, audioRenditionKeys, describeAudioTracks, defaultAudioTrack, findAudioRendition, selectionAudioLabel, parseDashAudio } = audioTracks;
export default audioTracks;
