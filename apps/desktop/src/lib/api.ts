import type { QueueData, QueueSettings, QueueJob } from '@/types/queue';
import type { HistoryItem } from '@/types/history';
import { normalizeLocalApiBase } from '@/lib/network';

export interface LibraryPage { items: HistoryItem[]; total: number; nextCursor: string | null }
export interface ThumbnailPreview { status: 'pending' | 'ready' | 'unavailable'; previewClipUrl?: string | null; previewClipDurationSeconds?: number }
export interface MediaSelection { variantUrl?: string; height?: number; audioLang?: string; subtitleLang?: string; audioOnly?: boolean }
export interface MediaInspection {
  mediaUrl?: string;
  mediaType?: 'hls' | 'file';
  title?: string;
  sourcePageUrl?: string;
  thumbnailUrl?: string;
  headers?: Record<string, string>;
  isDrm?: boolean;
  isLive?: boolean | null;
  variants?: { url: string; height?: number; bandwidth?: number; estimatedSizeBytes?: number; sizeBytes?: number; audioGroupId?: string }[];
  audio?: { language?: string; name?: string; url?: string }[];
  subtitles?: { language?: string; name?: string; url?: string }[];
  durationSeconds?: number;
}
export class MediaInspectionError extends Error {}

export function createApiClient(baseUrl: string, authToken = '') {
  const base = normalizeLocalApiBase(baseUrl);
  async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Client', 'vidsnag-desktop');
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message;
      throw new Error(message || `Request failed (${response.status})`);
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
    getHistory: (query = '', cursor?: string | null) => {
      const params = new URLSearchParams({ limit: '100', q: query });
      if (cursor) params.set('cursor', cursor);
      return request<LibraryPage>(`/api/history?${params}`);
    },
    createJob: (url: string, selection: MediaSelection, inspection?: MediaInspection) => post('/api/jobs', { queue: {
      url: inspection?.mediaUrl || url, selection, mediaType: inspection?.mediaType,
      title: inspection?.title, sourcePageUrl: inspection?.sourcePageUrl || url,
      thumbnailUrl: inspection?.thumbnailUrl, headers: inspection?.headers,
    } }),
    inspectMedia: async (url: string) => {
      try { return await post<MediaInspection>('/api/media/inspect', { mediaUrl: url }); }
      catch (error) { throw new MediaInspectionError(error instanceof Error ? error.message : 'Could not check this video link.'); }
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
