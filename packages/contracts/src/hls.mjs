import * as moduleNamespace from './hls.js';
const hls = Reflect.get(moduleNamespace, 'default') || globalThis.VidSnagHls;
export const { parseAttributes, parseHlsManifest, collapseDetections, estimateSizeBytes } = hls;
export default hls;
