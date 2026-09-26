export type AccentId = 'orange' | 'cobalt' | 'violet' | 'mint' | 'magenta';
export interface AccentTokens {
  primary: string; strong: string; hover: string; muted: string; ring: string;
  /** "THIS" in the logo and the startup cursor. */
  logo: string;
  /** Pixel play button: face, lit (top-left) edge, and shaded edge and shadow. */
  bevelFace: string; bevelLight: string; bevelDark: string;
}
/** An accent choice and when it was made (ms since the epoch; 0 = never chosen). */
export interface AccentRecord { accent: AccentId; changedAt: number }
export const DEFAULT_ACCENT: 'orange';
export const ACCENTS: ReadonlyArray<{ id: AccentId; name: string; swatch: string }>;
export const ACCENT_IDS: ReadonlyArray<AccentId>;
export const ACCENT_TOKENS: Readonly<Record<AccentId, AccentTokens>>;
export function isAccent(value: unknown): value is AccentId;
export function isAccentTimestamp(value: unknown, now?: number): value is number;
export function accentVariables(id: AccentId): Array<[string, string]>;
export function newerAccent(local: AccentRecord | null | undefined, remote: AccentRecord | null | undefined): AccentRecord;
export function buttonRoles(variant?: 'play' | 'pause'): ReadonlyArray<'face' | 'light' | 'dark' | 'shade' | 'glyph' | ''>;
export function buttonIconPixels(id: AccentId, scale?: number): { width: number; height: number; data: Uint8ClampedArray };
