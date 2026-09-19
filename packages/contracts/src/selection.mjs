import * as moduleNamespace from './selection.js';
const selection = Reflect.get(moduleNamespace, 'default') || globalThis.VidSnagSelection;
export const { SELECTION_FIELDS, SELECTION_SCHEMA, validateSelection } = selection;
export default selection;
