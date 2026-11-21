import { audit, requireAgent } from '../../_lib/agent';
import { error, json, readJson } from '../../_lib/http';
import { parseAccount, type AccountInput } from '../../_lib/validate';
import type { Fn } from '../../_lib/types';

const MAX_ROWS = 2000;

/**
 * Adds or updates many accounts at once (rows come from a CSV file read in the browser).
 * All rows are checked first; if any row has a problem, nothing is saved. The save itself is
 * one D1 batch, which runs as a single transaction: either every row is saved or none is.
 */
export const onRequestPost: Fn = async ({ env, request }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const body = await readJson<{ rows?: unknown }>(request, 2_000_000);
  const rows = body && Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length === 0) return error('invalid', 400, { message: 'The file has no account rows.' });
  if (rows.length > MAX_ROWS) return error('invalid', 400, { message: `Import at most ${MAX_ROWS} rows at a time.` });

  const clean: AccountInput[] = [];
  const problems: { line: number; message: string }[] = [];
  const seen = new Map<string, number>();
  rows.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return void problems.push({ line: i + 2, message: 'This row could not be read.' });
    const row = raw as Record<string, unknown>;
    const line = Number(row.line) || i + 2;
    const parsed = parseAccount(row);
    if (!parsed.ok) return void problems.push({ line, message: parsed.error });
    const first = seen.get(parsed.value.account_no);
    if (first) return void problems.push({ line, message: `Account # ${parsed.value.account_no} also appears on line ${first}.` });
    seen.set(parsed.value.account_no, line);
    clean.push(parsed.value);
  });
  if (problems.length) return json({ ok: false, problems: problems.slice(0, 50), problemCount: problems.length }, 400);

  // Which accounts already exist (one batch of lookups, 90 numbers each).
  const lookups = [];
  for (let i = 0; i < clean.length; i += 90) {
    const chunk = clean.slice(i, i + 90).map((r) => r.account_no);
    lookups.push(env.DB.prepare(`SELECT id, account_no, email FROM clients WHERE account_no IN (${chunk.map((_, k) => `?${k + 1}`).join(', ')})`).bind(...chunk));
  }
  const existing = new Map<string, { id: number; email: string }>();
  for (const r of await env.DB.batch<{ id: number; account_no: string; email: string }>(lookups)) {
    for (const row of r.results) existing.set(row.account_no, { id: row.id, email: row.email });
  }

  const now = Date.now();
  const upsert = env.DB.prepare(
    'INSERT INTO clients (account_no, name, email, start_date, deposit_cents, interest_cents, active, created_at, updated_at) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, 1), ?8, ?8) ' +
      'ON CONFLICT(account_no) DO UPDATE SET name = excluded.name, email = excluded.email, start_date = excluded.start_date, ' +
      'deposit_cents = excluded.deposit_cents, interest_cents = excluded.interest_cents, ' +
      'active = COALESCE(?7, clients.active), updated_at = excluded.updated_at',
  );
  const endSession = env.DB.prepare("DELETE FROM sessions WHERE kind = 'client' AND subject_id = ?1");
  const statements = clean.map((v) => upsert.bind(v.account_no, v.name, v.email, v.start_date, v.deposit_cents, v.interest_cents, v.active, now));
  // Sign out clients who are now deactivated or whose sign-in email changed.
  for (const v of clean) {
    const before = existing.get(v.account_no);
    if (before && (v.active === 0 || before.email !== v.email)) statements.push(endSession.bind(before.id));
  }
  await env.DB.batch(statements);

  const updated = clean.filter((r) => existing.has(r.account_no)).length;
  const added = clean.length - updated;
  await audit(env, agent.id, 'import', `Imported a CSV file: ${added} added, ${updated} updated`);
  return json({ ok: true, added, updated });
};
