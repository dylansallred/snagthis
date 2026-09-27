import './strings.js';
import * as moduleNamespace from './rows.js';
// Node exposes the CommonJS export; browsers execute the same UMD implementation.
const rows = Reflect.get(moduleNamespace, 'default') || globalThis.SnagThisRows;
export const { toRowModel, mergeRows, formatEta, formatSize, formatWhen, formatDuration, formatQualityBadge, classifyProblem } = rows;
export default rows;
