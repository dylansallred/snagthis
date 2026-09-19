export const API: { host: string; port: number; apiVersion: string; protocolVersion: string; minProtocolVersion: string; maxProtocolVersion: string; minExtensionVersion: string };
export const HEADER: { client: string; protocolVersion: string; apiVersion: string; authorization: string };
export const CLIENT: { extension: string };
export * from './rows';
export * from './selection';
export * from './hls';
export * from './strings';
