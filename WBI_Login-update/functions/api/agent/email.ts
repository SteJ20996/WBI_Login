import { audit, requireAgent } from '../../_lib/agent';
import { verifyPassword } from '../../_lib/crypto';
import { error, json, readJson } from '../../_lib/http';
import { beginSimple } from '../../_lib/lockout';
import { sendNotice } from '../../_lib/notify';
import { isEmail, normalizeEmail } from '../../_lib/validate';
import type { Fn } from '../../_lib/types';

/** Changes the signed-in agent's own sign-in email. The current password is required. */
export const onRequestPost: Fn = async (ctx) => {
  const { env, request } = ctx;
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const body = await readJson(request);
  if (!body) return error('invalid', 400);

  const attempt = await beginSimple(env, `recheck:${agent.id}`);
  if (attempt.lockedSec) return error('locked', 429, { retryAfterSec: attempt.lockedSec, message: 'Too many wrong passwords. Try again in 5 minutes.' });
  const row = await env.DB.prepare('SELECT password_hash FROM agents WHERE id = ?1').bind(agent.id).first<{ password_hash: string }>();
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!(await verifyPassword(password, row?.password_hash))) {
    const lockedSec = await attempt.failed();
    return error(lockedSec ? 'locked' : 'invalid', lockedSec ? 429 : 400, { message: lockedSec ? 'Too many wrong passwords. Try again in 5 minutes.' : 'Your password is not correct.' });
  }
  await attempt.succeeded();

  const email = normalizeEmail(body.newEmail);
  if (!isEmail(email)) return error('invalid', 400, { message: 'Enter a valid email address.' });
  if (email === agent.email) return error('invalid', 400, { message: 'This is already your sign-in email.' });
  try {
    await env.DB.prepare('UPDATE agents SET email = ?1 WHERE id = ?2').bind(email, agent.id).run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return error('duplicate', 409, { message: 'Another Agent/Financial Specialist account already uses this email.' });
    throw err;
  }
  await audit(env, agent.id, 'email', `${agent.email} changed the sign-in email to ${email}`);
  ctx.waitUntil(
    sendNotice(
      env,
      agent.email,
      'Your WBI Agent/Financial Specialist sign-in email was changed',
      `Hello,\n\nThe sign-in email of your WBI Agent/Financial Specialist account was changed from ${agent.email} to ${email}.\n\n` +
        `If you did not make this change, contact WBI right away.\n\nWealth Builder & Insurances`,
    ),
  );
  return json({ ok: true, email });
};
