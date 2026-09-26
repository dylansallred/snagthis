export interface HlsVariant { id: string; url: string; variantUrl: string; width: number | null; height: number | null; bandwidth: number | null; averageBandwidth: number | null; codecs: string | null; frameRate: number | null; audioGroup: string | null; subtitleGroup: string | null; videoRange?: string | null; sizeBytes: number | null; sizeEstimated?: boolean; backupUrls?: string[]; observed?: boolean; }
export interface HlsRendition { url: string | null; language: string | null; name: string; groupId: string | null; default: boolean; autoselect: boolean; forced: boolean; channels: string | null; characteristics?: string | null; }
export interface HlsManifest { url: string; isMaster: boolean; variants: HlsVariant[]; audio: HlsRendition[]; subtitles: HlsRendition[]; durationSeconds: number | null; isLive: boolean | null; isDrm: boolean; encryption: { method: string; keyFormat: string; url: string | null; iv: string | null }[]; referencedUrls: string[]; segmentUrls: string[]; initializationUrls: string[]; }
export function parseAttributes(value: string): Record<string, string>;
export function parseHlsManifest(text: string, url: string, options?: { durationSeconds?: number | null }): HlsManifest;
export function estimateSizeBytes(bandwidth?: number | null, durationSeconds?: number | null): number | null;
export function collapseDetections<T extends object>(items: T[]): (T & { durationSeconds: number | null; variants: Partial<HlsVariant>[]; audio: HlsRendition[]; subtitles: HlsRendition[]; detectedStreams: T[]; collapsedCount: number })[];
export interface VariantLike { url?: string; height?: number | null; bandwidth?: number | null; codecs?: string | null; videoRange?: string | null; audioGroup?: string | null; observed?: boolean; backupUrls?: string[]; }
export function isHdrOrHevc(variant: VariantLike | null | undefined): boolean;
export function compareVariants(a: VariantLike, b: VariantLike): number;
export function variantKey(variant: VariantLike | null | undefined): string | null;
export function dedupeVariants<V extends VariantLike>(variants: V[]): V[];
export function defaultVariant<V extends VariantLike>(variants: V[] | null | undefined, preferredQuality?: string | number | null, options?: { atMost?: boolean }): V | null;
