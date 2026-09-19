import * as moduleNamespace from './strings.js';
const copy = Reflect.get(moduleNamespace, 'default') || globalThis.VidSnagStrings;
export const { strings, interpolate } = copy;
export default copy;
