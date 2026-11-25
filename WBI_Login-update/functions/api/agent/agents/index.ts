import { audit, parseRole, requireOwner, roleLabel } from '../../../_lib/agent';
import { hashPassword } from '../../../_lib/crypto';
import { error, json, readJson } from '../../../_lib/http';
import { MIN_PASSWORD, cleanName, isEmail, normalizeEmail } from '../../../_lib/validate';
import type { AgentRole, Fn } from '../../../_lib/types';

/** Lists every Agent/Financial Specialist account (Main accounts only). */
export const onRequestGet: Fn = async ({ env, request }) => {
  const me = await requireOwner(env, request);
  if (me instanceof Response) return me;
  const { results } = await env.DB.prepare(
    'SELECT id, email, name, role, active, last_login_at, created_at FROM agents ORDER BY role DESC, email',
  ).all<{ id: number; email: string; name: string; role: AgentRole; active: number; last_login_at: number | null; created_at: number }>();
  return json({
    meId: me.id,
    agents: results.map((a) => ({ id: a.id, email: a.email, name: a.name, role: a.role, active: Boolean(a.active), lastLoginAt: a.last_login_at, createdAt: a.created_at })),
  });
};

/** Adds an Agent/Financial Specialist account (Main accounts only). */
export const onRequestPost: Fn = async ({ env, request }) => {
  const me = await requireOwner(env, request);
  if (me instanceof Response) return me;
  const body = await readJson(request);
  if (!body) return error('invalid', 400);
  const email = normalizeEmail(body.email);
  const name = cleanName(body.name);
  const role = parseRole(body.role) || 'agent';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name) return error('invalid', 400, { message: 'Enter a name.' });
  if (!isEmail(email)) return error('invalid', 400, { message: 'Enter a valid email address.' });
  if (password.length < MIN_PASSWORD || password.length > 200) {
    return error('invalid', 400, { message: `Use a first password of at least ${MIN_PASSWORD} characters.` });
  }
  const now = Date.now();
  try {
    const res = await env.DB.prepare(
      'INSERT INTO agents (email, name, password_hash, active, password_changed_at, created_at, role) VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5)',
    )
      .bind(email, name, await hashPassword(password), now, role)
      .run();
    await audit(env, me.id, 'agent-add', `Added Agent/Financial Specialist account ${email} (${name}, ${roleLabel(role)})`);
    return json({ ok: true, id: Number(res.meta.last_row_id) });
  } catch (err) {
    if (String(err).includes('UNIQUE')) return error('duplicate', 409, { message: 'An Agent/Financial Specialist account with this email already exists.' });
    throw err;
  }
};
