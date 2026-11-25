import { audit, requireAgent } from '../../../_lib/agent';
import { error, json, readJson } from '../../../_lib/http';
import { money, parseAccount } from '../../../_lib/validate';
import type { ClientRow, Env, Fn } from '../../../_lib/types';

export const PAGE_SIZE = 50;

function filter(q: string): { where: string; binds: string[] } {
  if (!q) return { where: '', binds: [] };
  const like = '%' + q.toLowerCase().replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  return {
    where: "WHERE (lower(account_no) LIKE ?1 ESCAPE '\\' OR lower(name) LIKE ?1 ESCAPE '\\' OR lower(email) LIKE ?1 ESCAPE '\\')",
    binds: [like],
  };
}

export function toApi(c: ClientRow) {
  return {
    id: c.id,
    accountNo: c.account_no,
    name: c.name,
    email: c.email,
    startDate: c.start_date,
    depositCents: c.deposit_cents,
    interestCents: c.interest_cents,
    balanceCents: c.deposit_cents + c.interest_cents,
    active: Boolean(c.active),
    lastLoginAt: c.last_login_at,
  };
}

async function list(env: Env, url: URL) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const { where, binds } = filter(q);
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(deposit_cents), 0) AS dep, COALESCE(SUM(interest_cents), 0) AS intr FROM clients ${where}`,
  )
    .bind(...binds)
    .first<{ n: number; dep: number; intr: number }>();
  const all = q ? await env.DB.prepare('SELECT COUNT(*) AS n FROM clients').first<{ n: number }>() : totals;
  const total = totals?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  let page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const focus = Number(url.searchParams.get('focus'));
  if (Number.isInteger(focus) && focus > 0) {
    const target = await env.DB.prepare('SELECT account_no FROM clients WHERE id = ?1').bind(focus).first<{ account_no: string }>();
    if (target) {
      const extra = where ? `${where} AND account_no < ?2` : 'WHERE account_no < ?1';
      const rank = await env.DB.prepare(`SELECT COUNT(*) AS n FROM clients ${extra}`)
        .bind(...binds, target.account_no)
        .first<{ n: number }>();
      page = Math.floor((rank?.n ?? 0) / PAGE_SIZE) + 1;
    }
  }
  page = Math.min(page, pages);

  const offsetParam = binds.length + 1;
  const { results } = await env.DB.prepare(
    `SELECT id, account_no, name, email, start_date, deposit_cents, interest_cents, active, last_login_at FROM clients ${where} ORDER BY account_no LIMIT ${PAGE_SIZE} OFFSET ?${offsetParam}`,
  )
    .bind(...binds, (page - 1) * PAGE_SIZE)
    .all<ClientRow>();

  return {
    accounts: results.map(toApi),
    page,
    pages,
    pageSize: PAGE_SIZE,
    total,
    allCount: all?.n ?? 0,
    sums: { depositCents: totals?.dep ?? 0, interestCents: totals?.intr ?? 0, balanceCents: (totals?.dep ?? 0) + (totals?.intr ?? 0) },
  };
}

export const onRequestGet: Fn = async ({ env, request }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  return json(await list(env, new URL(request.url)));
};

export const onRequestPost: Fn = async ({ env, request }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const body = await readJson(request);
  if (!body) return error('invalid', 400, { message: 'Nothing was received.' });
  const parsed = parseAccount(body);
  if (!parsed.ok) return error('invalid', 400, { message: parsed.error });
  const v = parsed.value;
  const now = Date.now();
  try {
    const res = await env.DB.prepare(
      'INSERT INTO clients (account_no, name, email, start_date, deposit_cents, interest_cents, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)',
    )
      .bind(v.account_no, v.name, v.email, v.start_date, v.deposit_cents, v.interest_cents, v.active ?? 1, now)
      .run();
    await audit(env, agent.id, 'add', `Added ${v.account_no} (${v.name}): deposit ${money(v.deposit_cents)}, interest ${money(v.interest_cents)}`);
    return json({ ok: true, id: Number(res.meta.last_row_id) });
  } catch (err) {
    if (String(err).includes('UNIQUE')) return error('duplicate', 409, { message: `Account # ${v.account_no} is already in use.` });
    throw err;
  }
};
