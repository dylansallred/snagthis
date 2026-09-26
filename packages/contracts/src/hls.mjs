import * as moduleNamespace from './hls.js';
// Node exposes the CommonJS export; browsers execute the same UMD implementation.
const hls = Reflect.get(moduleNamespace, 'default') || globalThis.SnagThisHls;
export const { parseAttributes, parseHlsManifest, collapseDetections, estimateSizeBytes, compareVariants, dedupeVariants, defaultVariant, isHdrOrHevc, variantKey } = hls;
export default hls;
