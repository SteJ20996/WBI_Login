import { randomToken, sha256Hex } from './crypto';
import type { Env } from './types';

export type SessionKind = 'client' | 'agent';

// __Host- cookies can only be set by this exact host over HTTPS, never by a subdomain.
const COOKIE: Record<SessionKind, string> = { client: '__Host-wbi_client', agent: '__Host-wbi_agent' };
const IDLE_MS = 30 * 60 * 1000; // server side; the page itself signs out after 5 minutes without activity
const MAX_MS = 8 * 60 * 60 * 1000;
const TOUCH_MS = 60 * 1000;

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

function cookie(name: string, value: string, maxAgeSec: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

/** Starts a session and returns the Set-Cookie header value. */
export async function startSession(env: Env, kind: SessionKind, subjectId: number): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1 OR last_seen < ?2').bind(now, now - IDLE_MS),
    env.DB.prepare('INSERT INTO sessions (id_hash, kind, subject_id, created_at, last_seen, expires_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5)')
      .bind(await sha256Hex(token), kind, subjectId, now, now + MAX_MS),
  ]);
  return cookie(COOKIE[kind], token, MAX_MS / 1000);
}

/** Returns the signed-in subject id, or null. Extends the idle timer. */
export async function readSession(env: Env, request: Request, kind: SessionKind): Promise<number | null> {
  const token = cookieValue(request, COOKIE[kind]);
  if (!token || token.length > 100) return null;
  const idHash = await sha256Hex(token);
  const row = await env.DB.prepare('SELECT subject_id, last_seen, expires_at FROM sessions WHERE id_hash = ?1 AND kind = ?2')
    .bind(idHash, kind)
    .first<{ subject_id: number; last_seen: number; expires_at: number }>();
  const now = Date.now();
  if (!row) return null;
  if (row.expires_at < now || row.last_seen < now - IDLE_MS) {
    await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?1').bind(idHash).run();
    return null;
  }
  if (now - row.last_seen > TOUCH_MS) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ?1 WHERE id_hash = ?2').bind(now, idHash).run();
  }
  return row.subject_id;
}

/** Ends the session and returns a Set-Cookie header that clears the cookie. */
export async function endSession(env: Env, request: Request, kind: SessionKind): Promise<string> {
  const token = cookieValue(request, COOKIE[kind]);
  if (token && token.length <= 100) {
    await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?1').bind(await sha256Hex(token)).run();
  }
  return cookie(COOKIE[kind], '', 0);
}

/** Ends every session of this person except the one making the request. */
export async function endOtherSessions(env: Env, request: Request, kind: SessionKind, subjectId: number): Promise<void> {
  const token = cookieValue(request, COOKIE[kind]) || '';
  await env.DB.prepare('DELETE FROM sessions WHERE kind = ?1 AND subject_id = ?2 AND id_hash <> ?3')
    .bind(kind, subjectId, await sha256Hex(token))
    .run();
}

export async function endAllSessions(env: Env, kind: SessionKind, subjectId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE kind = ?1 AND subject_id = ?2').bind(kind, subjectId).run();
}
