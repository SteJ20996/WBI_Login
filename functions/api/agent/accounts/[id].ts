import { audit, requireAgent } from '../../../_lib/agent';
import { error, json, readJson } from '../../../_lib/http';
import { endAllSessions } from '../../../_lib/session';
import { money, parseAccount } from '../../../_lib/validate';
import type { ClientRow, Env, Fn } from '../../../_lib/types';

function idFrom(params: Record<string, string | string[]>): number {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

async function find(env: Env, id: number): Promise<ClientRow | null> {
  return env.DB.prepare(
    'SELECT id, account_no, name, email, start_date, deposit_cents, interest_cents, active, last_login_at FROM clients WHERE id = ?1',
  )
    .bind(id)
    .first<ClientRow>();
}

export const onRequestPut: Fn = async ({ env, request, params }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const id = idFrom(params);
  const before = id ? await find(env, id) : null;
  if (!before) return error('not_found', 404, { message: 'This account no longer exists.' });
  const body = await readJson(request);
  if (!body) return error('invalid', 400, { message: 'Nothing was received.' });
  const parsed = parseAccount(body);
  if (!parsed.ok) return error('invalid', 400, { message: parsed.error });
  const v = { ...parsed.value, active: parsed.value.active ?? 1 };

  try {
    await env.DB.prepare(
      'UPDATE clients SET account_no = ?1, name = ?2, email = ?3, start_date = ?4, deposit_cents = ?5, interest_cents = ?6, active = ?7, updated_at = ?8 WHERE id = ?9',
    )
      .bind(v.account_no, v.name, v.email, v.start_date, v.deposit_cents, v.interest_cents, v.active, Date.now(), id)
      .run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) return error('duplicate', 409, { message: `Account # ${v.account_no} is already in use.` });
    throw err;
  }

  const changes: string[] = [];
  if (before.account_no !== v.account_no) changes.push(`account # ${before.account_no} → ${v.account_no}`);
  if (before.name !== v.name) changes.push(`name ${before.name} → ${v.name}`);
  if (before.email !== v.email) changes.push(`email ${before.email} → ${v.email}`);
  if (before.start_date !== v.start_date) changes.push(`start date ${before.start_date} → ${v.start_date}`);
  if (before.deposit_cents !== v.deposit_cents) changes.push(`deposit ${money(before.deposit_cents)} → ${money(v.deposit_cents)}`);
  if (before.interest_cents !== v.interest_cents) changes.push(`interest ${money(before.interest_cents)} → ${money(v.interest_cents)}`);
  if (before.active !== v.active) changes.push(v.active ? 'reactivated' : 'deactivated');
  if (changes.length) await audit(env, agent.id, 'update', `Updated ${v.account_no} (${v.name}): ${changes.join('; ')}`);

  // A client signed in under the old details is signed out.
  if (!v.active || before.email !== v.email || before.account_no !== v.account_no) await endAllSessions(env, 'client', id);
  return json({ ok: true, id });
};

export const onRequestDelete: Fn = async ({ env, request, params }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const id = idFrom(params);
  const before = id ? await find(env, id) : null;
  if (!before) return error('not_found', 404, { message: 'This account no longer exists.' });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM clients WHERE id = ?1').bind(id),
    env.DB.prepare('DELETE FROM client_logins WHERE client_id = ?1').bind(id),
    env.DB.prepare("DELETE FROM sessions WHERE kind = 'client' AND subject_id = ?1").bind(id),
  ]);
  await audit(env, agent.id, 'delete', `Deleted ${before.account_no} (${before.name})`);
  return json({ ok: true });
};
