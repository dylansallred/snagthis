export interface AudioRenditionLike { url?: string | null; language?: string | null; name?: string | null; groupId?: string | null; default?: boolean; channels?: string | null; characteristics?: string | null; role?: string | null; streamIndex?: number; }
export interface AudioTrack<R extends AudioRenditionLike = AudioRenditionLike> {
  /** Stable identity for `selection.audioTrack`; independent of URL and codec group. */
  key: string; ordinal: number; renditions: R[]; url: string | null;
  language: string | null; languageCode: string | null; unknown: boolean;
  primary: string; extra: string | null; channels: string | null; ad: boolean; commentary: boolean; isDefault: boolean;
  /** "English", "Track 2", "English · 2". */
  title: string; tags: string[]; detail: string; ariaLabel: string; shortLabel: string;
}
export function languageName(code?: string | null, locale?: string): string | null;
export function channelsLabel(value?: string | number | null): string | null;
export function audioRenditionKeys(audio: AudioRenditionLike[]): string[];
export function describeAudioTracks<R extends AudioRenditionLike>(audio: R[] | undefined | null, options?: { locale?: string }): AudioTrack<R>[];
export function defaultAudioTrack<T extends { isDefault: boolean }>(tracks: T[]): T | null;
export function findAudioRendition<R extends AudioRenditionLike>(audio: R[], groupId: string | null | undefined, trackKey: string): R | null;
export function selectionAudioLabel(selection?: { audioTrack?: string; audioLang?: string } | null): string | null;
export function parseDashAudio(text: string, manifestUrl?: string): (AudioRenditionLike & { groupId: string; manifestUrl: string | null; streamIndex: number })[];
