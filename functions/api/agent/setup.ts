import { audit } from '../../_lib/agent';
import { hashPassword, sameText } from '../../_lib/crypto';
import { error, json, readJson } from '../../_lib/http';
import { beginSimple } from '../../_lib/lockout';
import { MIN_PASSWORD, cleanName, isEmail, normalizeEmail } from '../../_lib/validate';
import type { Env, Fn } from '../../_lib/types';

async function agentCount(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM agents').first<{ n: number }>();
  return row?.n ?? 0;
}

/** Tells the sign-in page whether the first Agent/Financial Specialist account still has to be created. */
export const onRequestGet: Fn = async ({ env }) => {
  const needed = (await agentCount(env)) === 0;
  return json({ needed, available: needed && Boolean(env.SETUP_TOKEN) });
};

/** Creates the first account. Works only while no agent exists and SETUP_TOKEN is set. */
export const onRequestPost: Fn = async ({ env, request }) => {
  if (!env.SETUP_TOKEN || (await agentCount(env)) > 0) return error('closed', 403);
  const body = await readJson(request);
  if (!body) return error('invalid', 400);
  const attempt = await beginSimple(env, 'setup');
  if (attempt.lockedSec) return error('locked', 429, { retryAfterSec: attempt.lockedSec });
  if (typeof body.setupToken !== 'string' || !sameText(body.setupToken, env.SETUP_TOKEN)) {
    const lockedSec = await attempt.failed();
    return lockedSec ? error('locked', 429, { retryAfterSec: lockedSec }) : error('token', 401);
  }
  const email = normalizeEmail(body.email);
  const name = cleanName(body.name);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!isEmail(email)) return error('invalid', 400, { message: 'Enter a valid email address.' });
  if (!name) return error('invalid', 400, { message: 'Enter your name.' });
  if (password.length < MIN_PASSWORD || password.length > 200) {
    return error('invalid', 400, { message: `Use a password of at least ${MIN_PASSWORD} characters.` });
  }
  const now = Date.now();
  // Inserts only while the table is still empty, so two requests at once cannot both succeed.
  const res = await env.DB.prepare(
    'INSERT INTO agents (email, name, password_hash, active, password_changed_at, created_at) ' +
      'SELECT ?1, ?2, ?3, 1, ?4, ?4 WHERE NOT EXISTS (SELECT 1 FROM agents)',
  )
    .bind(email, name, await hashPassword(password), now)
    .run();
  if (!res.meta.changes) return error('closed', 403);
  await attempt.succeeded();
  await audit(env, Number(res.meta.last_row_id) || null, 'setup', `Created the first Agent/Financial Specialist account (${email})`);
  return json({ ok: true });
};
