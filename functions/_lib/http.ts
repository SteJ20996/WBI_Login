export function json(data: unknown, status = 200, extra?: Headers | Record<string, string>): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

export function error(code: string, status: number, more: Record<string, unknown> = {}): Response {
  return json({ error: code, ...more }, status);
}

/** Reads a small JSON body. Returns null when it is missing, too big or not valid JSON. */
export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 20_000): Promise<T | null> {
  const type = (request.headers.get('Content-Type') || '').toLowerCase().split(';')[0].trim();
  if (type !== 'application/json') return null;
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) return null;
  const text = await request.text();
  if (!text || text.length > maxBytes) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? (value as T) : null;
  } catch {
    return null;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || '';
}

export function isLocalHost(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}
