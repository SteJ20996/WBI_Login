import { audit, requireAgent } from '../../_lib/agent';
import type { ClientRow, Fn } from '../../_lib/types';

function cell(value: string | number, isText = false): string {
  let s = String(value);
  // Stop spreadsheet apps from running a cell as a formula.
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** Downloads every account as a CSV file (same columns the import accepts). */
export const onRequestGet: Fn = async ({ env, request }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const { results } = await env.DB.prepare(
    'SELECT account_no, name, email, start_date, deposit_cents, interest_cents, active FROM clients ORDER BY account_no',
  ).all<ClientRow>();
  const lines = ['Account #,Client name,Email,Start date,Total deposit,Interest earned,Total balance,Status'];
  for (const c of results) {
    lines.push(
      [
        cell(c.account_no),
        cell(c.name, true),
        cell(c.email, true),
        cell(c.start_date),
        dollars(c.deposit_cents),
        dollars(c.interest_cents),
        dollars(c.deposit_cents + c.interest_cents),
        c.active ? 'Active' : 'Deactivated',
      ].join(','),
    );
  }
  await audit(env, agent.id, 'export', `Downloaded all accounts as CSV (${results.length} rows)`);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="wbi-accounts-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};
