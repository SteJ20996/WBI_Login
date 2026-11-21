import type { Env } from './types';

/**
 * Sign-in limits.
 * - Per account number (or agent email) AND network: 5 tries, then locked for 5 minutes.
 *   Keying on the network means a stranger cannot lock the real owner out from elsewhere.
 * - Per account number (or agent email) from anywhere: 30 tries an hour, then locked for 15 minutes.
 * Every try is counted BEFORE the password/email is checked, in one atomic statement,
 * so many requests sent at once cannot get past the limit.
 */
interface Rule { max: number; forgetMs: number; lockMs: number }
const NEAR: Rule = { max: 5, forgetMs: 15 * 60 * 1000, lockMs: 5 * 60 * 1000 };
const WIDE: Rule = { max: 30, forgetMs: 60 * 60 * 1000, lockMs: 15 * 60 * 1000 };

export interface Attempt {
  /** Seconds left on a lock; 0 when this try may go ahead. */
  lockedSec: number;
  /** Call after a wrong try. Returns seconds left if this try started a lock, else 0. */
  failed(): Promise<number>;
  /** Call after a successful sign-in. */
  succeeded(): Promise<void>;
}

async function claim(env: Env, key: string, rule: Rule, now: number): Promise<{ count: number; lockedUntil: number }> {
  const row = await env.DB.prepare(
    'INSERT INTO login_failures (key, count, locked_until, updated_at) VALUES (?1, 1, 0, ?2) ' +
      'ON CONFLICT(key) DO UPDATE SET ' +
      'count = CASE WHEN login_failures.locked_until > ?2 THEN login_failures.count ' +
      'WHEN ?2 - login_failures.updated_at < ?3 THEN login_failures.count + 1 ELSE 1 END, ' +
      'updated_at = CASE WHEN login_failures.locked_until > ?2 THEN login_failures.updated_at ELSE ?2 END ' +
      'RETURNING count, locked_until',
  )
    .bind(key, now, rule.forgetMs)
    .first<{ count: number; locked_until: number }>();
  return { count: row?.count ?? 1, lockedUntil: row?.locked_until ?? 0 };
}

async function lock(env: Env, key: string, rule: Rule, now: number): Promise<number> {
  await env.DB.prepare('UPDATE login_failures SET count = 0, locked_until = ?2, updated_at = ?3 WHERE key = ?1')
    .bind(key, now + rule.lockMs, now)
    .run();
  return Math.ceil(rule.lockMs / 1000);
}

/** Starts one sign-in try for `identifier` (e.g. "client:WBI-20481937-01") from `ip`. */
export async function beginAttempt(env: Env, identifier: string, ip: string): Promise<Attempt> {
  const now = Date.now();
  const nearKey = `${identifier}|${ip || 'unknown'}`;
  const wideKey = identifier;
  const near = await claim(env, nearKey, NEAR, now);
  const wide = await claim(env, wideKey, WIDE, now);

  let lockedSec = 0;
  for (const [state, key, rule] of [[near, nearKey, NEAR], [wide, wideKey, WIDE]] as const) {
    if (state.lockedUntil > now) lockedSec = Math.max(lockedSec, Math.ceil((state.lockedUntil - now) / 1000));
    else if (state.count > rule.max) lockedSec = Math.max(lockedSec, await lock(env, key, rule, now));
  }

  return {
    lockedSec,
    async failed() {
      let started = 0;
      if (near.count >= NEAR.max) started = Math.max(started, await lock(env, nearKey, NEAR, Date.now()));
      if (wide.count >= WIDE.max) started = Math.max(started, await lock(env, wideKey, WIDE, Date.now()));
      return started;
    },
    async succeeded() {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM login_failures WHERE key = ?1').bind(nearKey),
        env.DB.prepare('DELETE FROM login_failures WHERE key = ?1').bind(wideKey),
      ]);
    },
  };
}

/** Simple lock for the one-time setup form (5 wrong tokens = 5 minutes). */
export async function beginSimple(env: Env, key: string): Promise<Attempt> {
  const now = Date.now();
  const s = await claim(env, key, NEAR, now);
  let lockedSec = 0;
  if (s.lockedUntil > now) lockedSec = Math.ceil((s.lockedUntil - now) / 1000);
  else if (s.count > NEAR.max) lockedSec = await lock(env, key, NEAR, now);
  return {
    lockedSec,
    async failed() { return s.count >= NEAR.max ? lock(env, key, NEAR, Date.now()) : 0; },
    async succeeded() { await env.DB.prepare('DELETE FROM login_failures WHERE key = ?1').bind(key).run(); },
  };
}
