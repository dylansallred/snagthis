import * as moduleNamespace from './accents.js';
// Node exposes the CommonJS export; browsers execute the same UMD implementation.
const accents = Reflect.get(moduleNamespace, 'default') || globalThis.SnagThisAccents;
export const { DEFAULT_ACCENT, ACCENTS, ACCENT_IDS, ACCENT_TOKENS, isAccent, isAccentTimestamp, accentVariables, newerAccent, buttonRoles, buttonIconPixels } = accents;
export default accents;
