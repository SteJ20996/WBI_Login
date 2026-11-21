import { audit, requireAgent } from '../../_lib/agent';
import { hashPassword, verifyPassword } from '../../_lib/crypto';
import { error, json, readJson } from '../../_lib/http';
import { endOtherSessions } from '../../_lib/session';
import { MIN_PASSWORD } from '../../_lib/validate';
import type { Fn } from '../../_lib/types';

export const onRequestPost: Fn = async ({ env, request }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const body = await readJson(request);
  if (!body) return error('invalid', 400);
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  const row = await env.DB.prepare('SELECT password_hash FROM agents WHERE id = ?1').bind(agent.id).first<{ password_hash: string }>();
  if (!(await verifyPassword(current, row?.password_hash))) return error('invalid', 400, { message: 'Your current password is not correct.' });
  if (next.length < MIN_PASSWORD || next.length > 200) return error('invalid', 400, { message: `Use a new password of at least ${MIN_PASSWORD} characters.` });
  if (next === current) return error('invalid', 400, { message: 'The new password must be different from the current one.' });
  await env.DB.prepare('UPDATE agents SET password_hash = ?1, password_changed_at = ?2 WHERE id = ?3')
    .bind(await hashPassword(next), Date.now(), agent.id)
    .run();
  // Any other device that was signed in with the old password is signed out.
  await endOtherSessions(env, request, 'agent', agent.id);
  await audit(env, agent.id, 'password', `${agent.email} changed the password`);
  return json({ ok: true });
};
