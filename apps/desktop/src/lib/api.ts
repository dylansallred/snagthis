import type { QueueData, QueueSettings, QueueJob } from '@/types/queue';
import type { HistoryItem } from '@/types/history';
import type { DeleteMode, LibraryInfo, MoveResult } from '@/types/library';
import { normalizeLocalApiBase } from '@/lib/network';

export interface LibraryPage { items: HistoryItem[]; total: number; nextCursor: string | null }
export interface ThumbnailPreview { status: 'pending' | 'ready' | 'unavailable'; previewClipUrl?: string | null; previewClipDurationSeconds?: number }
export interface MediaSelection { variantUrl?: string; height?: number; audioLang?: string; audioTrack?: string; subtitleLang?: string; audioOnly?: boolean }
export interface AudioRendition { language?: string | null; name?: string | null; url?: string | null; groupId?: string | null; default?: boolean; channels?: string | null; characteristics?: string | null; role?: string | null; streamIndex?: number }
export interface AudioSampleRequest { mediaUrl: string; renditionUrl?: string; streamIndex?: number; durationSeconds?: number; headers?: Record<string, string> }
export interface MediaInspection {
  mediaUrl?: string;
  mediaType?: 'hls' | 'file';
  title?: string;
  sourcePageUrl?: string;
  thumbnailUrl?: string;
  headers?: Record<string, string>;
  isDrm?: boolean;
  isLive?: boolean | null;
  variants?: { url: string; height?: number; bandwidth?: number; estimatedSizeBytes?: number; sizeBytes?: number; audioGroupId?: string; observed?: boolean }[];
  audio?: AudioRendition[];
  subtitles?: { language?: string; name?: string; url?: string }[];
  durationSeconds?: number;
}
export class MediaInspectionError extends Error {}
/** A refused bridge request; `code` names the reason (such as `nameDuplicate` or `folder-missing`). */
export class ApiRequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}
/** Which saved videos to list: one folder of Saved ('' is the save folder), in a sort order. */
export interface HistoryScope { folder?: string; sort?: string }

export function createApiClient(baseUrl: string, authToken = '') {
  const base = normalizeLocalApiBase(baseUrl);
  async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Client', 'snagthis-desktop');
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message;
      throw new ApiRequestError(message || `Request failed (${response.status})`, typeof data?.code === 'string' ? data.code : undefined);
    }
    return data as T;
  }
  const post = <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  const id = encodeURIComponent;
  return {
    baseUrl: base, authToken, request,
    getQueue: () => request<QueueData>('/api/queue'),
    getJob: (jobId: string) => request<QueueJob>(`/api/jobs/${id(jobId)}?full=1`),
    ensureJobPreview: (jobId: string) => post<ThumbnailPreview>(`/api/jobs/${id(jobId)}/preview`),
    ensureHistoryPreview: (historyId: string) => post<ThumbnailPreview>(`/api/history/${id(historyId)}/preview`),
    getHistory: (query = '', cursor?: string | null, scope: HistoryScope = {}) => {
      const params = new URLSearchParams({ limit: '100', q: query });
      if (cursor) params.set('cursor', cursor);
      if (typeof scope.folder === 'string') params.set('folder', scope.folder);
      if (scope.sort) params.set('sort', scope.sort);
      return request<LibraryPage>(`/api/history?${params}`);
    },
    getLibrary: () => request<LibraryInfo>('/api/library'),
    createFolder: (parent: string, name: string) => post<{ path: string }>('/api/library/folders', { parent, name }),
    renameFolder: (path: string, name: string) => post<{ path: string }>('/api/library/folders/rename', { path, name }),
    deleteFolder: (path: string, mode?: DeleteMode) => post<{ deleted: 'empty' | 'keep' | 'trash'; moved: number }>('/api/library/folders/delete', { path, mode }),
    moveVideos: (ids: string[], to: string) => post<{ results: MoveResult[] }>('/api/library/move', { ids, to }),
    createJob: (url: string, selection: MediaSelection, inspection?: MediaInspection) => post('/api/jobs', { queue: {
      url: inspection?.mediaUrl || url, selection, mediaType: inspection?.mediaType,
      title: inspection?.title, sourcePageUrl: inspection?.sourcePageUrl || url,
      thumbnailUrl: inspection?.thumbnailUrl, headers: inspection?.headers,
    } }),
    inspectMedia: async (url: string) => {
      try { return await post<MediaInspection>('/api/media/inspect', { mediaUrl: url }); }
      catch (error) { throw new MediaInspectionError(error instanceof Error ? error.message : 'Could not check this video link.'); }
    },
    // A short AAC excerpt of one audio track, 25% in; the renderer plays it on hover.
    audioSample: async (sample: AudioSampleRequest, signal?: AbortSignal) => {
      const headers = new Headers({ 'Content-Type': 'application/json', 'X-Client': 'snagthis-desktop' });
      if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
      const response = await fetch(`${base}/api/media/audio-sample`, { method: 'POST', headers, body: JSON.stringify(sample), signal });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Sample unavailable'); }
      return response.blob();
    },
    startJob: (jobId: string) => post(`/api/queue/${id(jobId)}/start`),
    pauseJob: (jobId: string) => post(`/api/queue/${id(jobId)}/pause`),
    resumeJob: (jobId: string) => post(`/api/queue/${id(jobId)}/resume`),
    retryJob: (jobId: string) => post(`/api/jobs/${id(jobId)}/retry`),
    useChromeSession: (jobId: string) => post(`/api/queue/${id(jobId)}/use-chrome-session`),
    cancelJob: (jobId: string) => post(`/api/jobs/${id(jobId)}/cancel`),
    renameJob: (jobId: string, title: string) => post(`/api/queue/${id(jobId)}/rename`, { title }),
    moveJob: (jobId: string, position: number) => post(`/api/queue/${id(jobId)}/move`, { position }),
    removeJob: (jobId: string) => request(`/api/queue/${id(jobId)}`, { method: 'DELETE' }),
    startAll: () => post('/api/queue/start-all'),
    pauseAll: () => post('/api/queue/pause-all'),
    updateQueueSettings: (settings: Partial<QueueSettings>) => post<{ settings: QueueSettings }>('/api/queue/settings', settings),
    removeHistoryItem: (historyId: string, mode: 'list' | 'trash') => request(`/api/history/${id(historyId)}?mode=${mode}`, { method: 'DELETE' }),
    locateHistoryItem: (historyId: string) => post<{ ok: boolean; cancelled?: boolean; error?: string }>(`/api/history/${id(historyId)}/locate`),
    openHistoryItem: (historyId: string) => post<{ ok: boolean; error?: string }>(`/api/history/${id(historyId)}/open`),
    refreshSource: (jobId: string, mediaUrl: string) => post(`/api/jobs/${id(jobId)}/refresh-source`, { mediaUrl }),
    getDiagnostics: () => request<Record<string, unknown>>('/api/diagnostics'),
    clearTempDownloads: () => post<{ tempDirectoriesRemoved?: number; transientFilesRemoved?: number; emptiedJobDirectoriesRemoved?: number }>('/api/maintenance/clear-temp-downloads'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
