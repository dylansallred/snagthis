import './strings.js';
import * as moduleNamespace from './rows.js';
// Node exposes the CommonJS export; browsers execute the same UMD implementation.
const rows = Reflect.get(moduleNamespace, 'default') || globalThis.VidSnagRows;
export const { toRowModel, mergeRows, formatEta, formatSize, formatWhen, formatDuration, classifyProblem } = rows;
export default rows;
