import { clientIp, isLocalHost } from './http';
import type { Env } from './types';

export type HumanCheck = 'ok' | 'failed' | 'unavailable';

/** Cloudflare's published test keys start with 1x/2x/3x followed by zeros. */
const TEST_KEY = /^[123]x0{8}/;

export function turnstileBypassed(env: Env, request: Request): boolean {
  return env.TURNSTILE_TEST_BYPASS === 'true' && isLocalHost(request);
}

/** Server-side check of a Turnstile token with Cloudflare Siteverify. */
export async function verifyHuman(env: Env, request: Request, token: unknown, action: string): Promise<HumanCheck> {
  if (turnstileBypassed(env, request)) return 'ok';
  const secret = env.TURNSTILE_SECRET_KEY || '';
  if (!secret || !env.TURNSTILE_SITE_KEY || (TEST_KEY.test(secret) && !isLocalHost(request))) return 'unavailable';
  if (typeof token !== 'string' || !token || token.length > 2048) return 'failed';
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: clientIp(request) || undefined }),
    });
    if (!res.ok) return 'unavailable';
    const data = (await res.json()) as { success?: boolean; hostname?: string; action?: string };
    const host = new URL(request.url).hostname;
    if (data.success !== true || data.hostname !== host || data.action !== action) return 'failed';
    return 'ok';
  } catch {
    return 'unavailable';
  }
}
