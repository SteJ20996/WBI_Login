import { audit, parseRole, requireOwner, roleLabel } from '../../../_lib/agent';
import { hashPassword } from '../../../_lib/crypto';
import { error, json, readJson } from '../../../_lib/http';
import { endAllSessions } from '../../../_lib/session';
import { MIN_PASSWORD, cleanName, isEmail, normalizeEmail } from '../../../_lib/validate';
import type { AgentRole, Fn } from '../../../_lib/types';

/**
 * Edits another Agent/Financial Specialist account (Main accounts only):
 * name, email, role, can-sign-in, and an optional new password.
 * There must always be at least one active Main account.
 */
export const onRequestPut: Fn = async ({ env, request, params }) => {
  const me = await requireOwner(env, request);
  if (me instanceof Response) return me;
  const id = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const before = Number.isInteger(id) && id > 0
    ? await env.DB.prepare('SELECT id, email, name, role, active FROM agents WHERE id = ?1').bind(id).first<{ id: number; email: string; name: string; role: AgentRole; active: number }>()
    : null;
  if (!before) return error('not_found', 404, { message: 'This account no longer exists.' });
  const body = await readJson(request);
  if (!body) return error('invalid', 400);

  const name = cleanName(body.name);
  const email = normalizeEmail(body.email);
  const role = parseRole(body.role) || before.role;
  const active = body.active === false ? 0 : 1;
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!name) return error('invalid', 400, { message: 'Enter a name.' });
  if (!isEmail(email)) return error('invalid', 400, { message: 'Enter a valid email address.' });
  if (newPassword && (newPassword.length < MIN_PASSWORD || newPassword.length > 200)) {
    return error('invalid', 400, { message: `Use a new password of at least ${MIN_PASSWORD} characters, or leave it empty.` });
  }
  if (before.id === me.id && (role !== before.role || !active || email !== before.email || newPassword)) {
    return error('invalid', 400, { message: 'For your own account, use Change email and Change password. You cannot change your own role or turn off your own sign-in.' });
  }
  if (before.role === 'owner' && before.active && (role !== 'owner' || !active)) {
    const others = await env.DB.prepare("SELECT COUNT(*) AS n FROM agents WHERE role = 'owner' AND active = 1 AND id <> ?1").bind(id).first<{ n: number }>();
    if (!others?.n) return error('invalid', 400, { message: 'There must always be at least one active Main account.' });
  }

  try {
    await env.DB.prepare('UPDATE agents SET name = ?1, email = ?2, role = ?3, active = ?4 WHERE id = ?5').bind(name, email, role, active, id).run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return error('duplicate', 409, { message: 'An Agent/Financial Specialist account with this email already exists.' });
    throw err;
  }
  if (newPassword) {
    await env.DB.prepare('UPDATE agents SET password_hash = ?1, password_changed_at = ?2 WHERE id = ?3').bind(await hashPassword(newPassword), Date.now(), id).run();
  }

  const changes: string[] = [];
  if (before.name !== name) changes.push(`name ${before.name} → ${name}`);
  if (before.email !== email) changes.push(`email ${before.email} → ${email}`);
  if (before.role !== role) changes.push(`role ${roleLabel(before.role)} → ${roleLabel(role)}`);
  if (Boolean(before.active) !== Boolean(active)) changes.push(active ? 'can sign in again' : 'sign-in turned off');
  if (newPassword) changes.push('password reset');
  if (changes.length) await audit(env, me.id, 'agent-update', `Updated Agent/Financial Specialist account ${email}: ${changes.join('; ')}`);

  // Signed-in devices of that person are signed out when access or credentials change.
  if (!active || newPassword || before.email !== email || before.role !== role) await endAllSessions(env, 'agent', id);
  return json({ ok: true });
};
