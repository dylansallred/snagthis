export interface MediaSelection { variantUrl?: string; height?: number; audioLang?: string; audioTrack?: string; subtitleLang?: string; audioOnly?: boolean; }
export interface SelectionError { field: string; code: string; message: string; }
export const SELECTION_FIELDS: readonly string[];
export const SELECTION_SCHEMA: Readonly<Record<string, unknown>>;
export function validateSelection(input: unknown): { ok: boolean; value: MediaSelection | undefined; errors: SelectionError[] };
