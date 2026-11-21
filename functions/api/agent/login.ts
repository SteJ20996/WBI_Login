import { audit } from '../../_lib/agent';
import { verifyPassword } from '../../_lib/crypto';
import { clientIp, error, json, readJson } from '../../_lib/http';
import { beginAttempt } from '../../_lib/lockout';
import { sendSignInNotice } from '../../_lib/notify';
import { startSession } from '../../_lib/session';
import { verifyHuman } from '../../_lib/turnstile';
import { normalizeEmail } from '../../_lib/validate';
import type { AgentRow, Fn } from '../../_lib/types';

export const onRequestPost: Fn = async (ctx) => {
  const { env, request } = ctx;
  const body = await readJson(request);
  if (!body) return error('invalid', 400);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!email || !password) return error('invalid', 401);

  const human = await verifyHuman(env, request, body.turnstileToken, 'agent-login');
  if (human === 'unavailable') return error('unavailable', 503);
  if (human === 'failed') return error('verification', 400);

  const attempt = await beginAttempt(env, `agent:${email}`, clientIp(request));
  if (attempt.lockedSec) return error('locked', 429, { retryAfterSec: attempt.lockedSec });

  const agent = await env.DB.prepare('SELECT id, email, name, password_hash, active FROM agents WHERE email = ?1')
    .bind(email)
    .first<AgentRow>();
  // verifyPassword runs even for an unknown email, so both cases take the same time.
  const ok = (await verifyPassword(password, agent?.password_hash)) && Boolean(agent?.active);
  if (!agent || !ok) {
    const lockedSec = await attempt.failed();
    if (lockedSec) return error('locked', 429, { retryAfterSec: lockedSec });
    return error('invalid', 401);
  }

  await attempt.succeeded();
  await env.DB.prepare('UPDATE agents SET last_login_at = ?1 WHERE id = ?2').bind(Date.now(), agent.id).run();
  await audit(env, agent.id, 'sign-in', `${agent.email} signed in`);
  const setCookie = await startSession(env, 'agent', agent.id);
  ctx.waitUntil(sendSignInNotice(env, agent.email, 'Agent/Financial Specialist Portal'));
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie });
};
