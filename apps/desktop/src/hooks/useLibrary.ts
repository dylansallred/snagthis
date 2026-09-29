import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mergeRows } from '@m3u8/contracts/src/rows.mjs';
import type { QueueData } from '@/types/queue';
import type { HistoryItem } from '@/types/history';
import type { ApiClient, HistoryScope } from '@/lib/api';
import { toWebSocketUrl } from '@/lib/network';

/**
 * The queue and the saved videos in `scope` (one folder of Saved and a sort order, or the whole
 * library). A new search starts from scratch; a new folder or order keeps the current rows on
 * screen until its own arrive, so moving between folders never flashes the loading skeleton.
 */
export function useLibrary(api: ApiClient | null, query: string, scope: HistoryScope = {}) {
  const [queue, setQueue] = useState<QueueData>({ queue: [], settings: { maxConcurrent: 1, autoStart: true } });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  // Counts completed refreshes, so folder information can reload alongside the list.
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const queueRevision = useRef(0);
  const historyCount = useRef(100);
  const scopeKey = `${scope.folder ?? '\u0000'}\n${scope.sort || ''}`;
  const scopeRef = useRef(scope);
  useLayoutEffect(() => { scopeRef.current = scope; });
  const refresh = useCallback(async () => {
    if (!api) return;
    const current = generation.current;
    const request = ++refreshSequence.current;
    const revision = queueRevision.current;
    const requestScope = scopeRef.current;
    try {
      const [nextQueue, firstPage] = await Promise.all([api.getQueue(), api.getHistory(query, undefined, requestScope)]);
      let items = firstPage.items || [];
      let nextCursor = firstPage.nextCursor;
      while (nextCursor && items.length < historyCount.current) {
        const page = await api.getHistory(query, nextCursor, requestScope);
        items = items.concat(page.items || []);
        nextCursor = page.nextCursor;
      }
      if (current !== generation.current || request !== refreshSequence.current) return;
      // A WebSocket update received while this request was pending is newer.
      if (revision === queueRevision.current) setQueue(nextQueue);
      setHistory(items); setCursor(nextCursor || null); setError(''); setLoading(false); setRevision((value) => value + 1);
    } catch (err) {
      if (current !== generation.current || request !== refreshSequence.current) return;
      setError(err instanceof Error ? err.message : 'Unable to load your videos'); setLoading(false);
    }
    // scopeKey stands for the scope object, which is read through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, query, scopeKey]);
  const refreshRef = useRef(refresh);
  useLayoutEffect(() => { refreshRef.current = refresh; });
  useEffect(() => {
    generation.current += 1; historyCount.current = 100; setLoading(true); setHistory([]); setCursor(null);
  }, [api, query]);
  // A new folder or order: forget paging and load it, keeping the rows shown until then.
  const firstScope = useRef(true);
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return; }
    generation.current += 1; historyCount.current = 100;
    refreshRef.current();
  }, [scopeKey]);
  useEffect(() => {
    if (!api) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(toWebSocketUrl(api.baseUrl), ['snagthis', `snagthis-auth.${api.authToken}`]);
      socket.onopen = () => {
        if (disposed) { socket?.close(); return; }
        clearInterval(fallback); fallback = undefined;
        for (const channel of ['queue', 'history']) socket?.send(JSON.stringify({ type: 'subscribe', channel }));
        refreshRef.current();
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'queue:update' && Array.isArray(payload.data?.queue)) {
            queueRevision.current += 1;
            setQueue(payload.data);
          }
          if (payload.type === 'history:update') refreshRef.current();
        } catch { /* Ignore malformed notification. */ }
      };
      socket.onclose = () => {
        if (disposed) return;
        if (!fallback) fallback = setInterval(() => refreshRef.current(), 5000);
        reconnect = setTimeout(connect, 2000);
      };
      socket.onerror = () => { /* Close starts recovery. */ };
    };
    connect();
    // Coming back to the window rescans the save folder, so changes made in Finder or Explorer show up.
    const onFocus = () => { refreshRef.current(); };
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true; generation.current += 1; clearTimeout(reconnect); clearInterval(fallback);
      window.removeEventListener('focus', onFocus);
      if (socket?.readyState === WebSocket.OPEN) socket.close();
      else if (socket?.readyState === WebSocket.CONNECTING) socket.onopen = () => socket?.close();
    };
  }, [api]);
  // A new search (or a new connection) loads at once.
  useEffect(() => { refresh(); }, [api, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMore = useCallback(async () => {
    if (!api || !cursor || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const page = await api.getHistory(query, cursor, scopeRef.current);
      if (current !== generation.current) return;
      setHistory((items) => {
        const byId = new Map(items.map((item) => [item.id, item]));
        for (const item of page.items || []) byId.set(item.id, item);
        historyCount.current = byId.size;
        return [...byId.values()];
      });
      setCursor(page.nextCursor || null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load more videos'); }
    finally { setLoadingMore(false); }
  }, [api, cursor, loadingMore, query]);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    const visibleQueue = text ? queue.queue.filter((job) => job.title?.toLowerCase().includes(text)) : queue.queue;
    return mergeRows(visibleQueue, history, { surface: 'desktop' });
  }, [queue.queue, history, query]);
  return { rows, queue, history, loading, loadingMore, error, hasMore: !!cursor, refresh, loadMore, revision };
}
