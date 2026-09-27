const DEFAULT_API_BASE = 'http://127.0.0.1:49732';

export function normalizeLocalApiBase(candidate: string | null | undefined): string {
  const value = String(candidate || '').trim();
  if (!value) return DEFAULT_API_BASE;

  try {
    const parsed = new URL(value);
    const hostname = String(parsed.hostname || '').toLowerCase();
    const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';

    if (isLoopback && parsed.protocol === 'https:') {
      parsed.protocol = 'http:';
    }

    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_API_BASE;
  }
}

export function toWebSocketUrl(apiBase: string): string {
  return normalizeLocalApiBase(apiBase).replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws';
}
