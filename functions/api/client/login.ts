import { clientIp, error, json, readJson } from '../../_lib/http';
import { beginAttempt } from '../../_lib/lockout';
import { sendSignInNotice } from '../../_lib/notify';
import { startSession } from '../../_lib/session';
import { verifyHuman } from '../../_lib/turnstile';
import { ACCOUNT_RE, normalizeAccount, normalizeEmail } from '../../_lib/validate';
import type { ClientRow, Fn } from '../../_lib/types';

export const onRequestPost: Fn = async (ctx) => {
  const { env, request } = ctx;
  const body = await readJson(request);
  if (!body) return error('invalid', 400);
  const accountNo = normalizeAccount(body.accountNo);
  const email = normalizeEmail(body.email);
  if (!ACCOUNT_RE.test(accountNo) || !email) return error('invalid', 401);

  const human = await verifyHuman(env, request, body.turnstileToken, 'client-login');
  if (human === 'unavailable') return error('unavailable', 503);
  if (human === 'failed') return error('verification', 400);

  const attempt = await beginAttempt(env, `client:${accountNo}`, clientIp(request));
  if (attempt.lockedSec) return error('locked', 429, { retryAfterSec: attempt.lockedSec });

  const client = await env.DB.prepare('SELECT id, email, active FROM clients WHERE account_no = ?1')
    .bind(accountNo)
    .first<Pick<ClientRow, 'id' | 'email' | 'active'>>();
  if (!client || !client.active || client.email.toLowerCase() !== email) {
    const lockedSec = await attempt.failed();
    if (lockedSec) return error('locked', 429, { retryAfterSec: lockedSec });
    return error('invalid', 401);
  }

  await attempt.succeeded();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE clients SET last_login_at = ?1 WHERE id = ?2').bind(now, client.id),
    env.DB.prepare('INSERT INTO client_logins (client_id, at) VALUES (?1, ?2)').bind(client.id, now),
  ]);
  const setCookie = await startSession(env, 'client', client.id);
  ctx.waitUntil(sendSignInNotice(env, client.email, 'Client Portal'));
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie });
};
