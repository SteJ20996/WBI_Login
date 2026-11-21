import { error, json } from '../../_lib/http';
import { endAllSessions, readSession } from '../../_lib/session';
import type { ClientRow, Fn } from '../../_lib/types';

/** The signed-in client's own account. A client can only ever read this one row. */
export const onRequestGet: Fn = async ({ env, request }) => {
  const id = await readSession(env, request, 'client');
  if (!id) return error('signed_out', 401);
  const c = await env.DB.prepare(
    'SELECT account_no, name, start_date, deposit_cents, interest_cents, active FROM clients WHERE id = ?1',
  )
    .bind(id)
    .first<Pick<ClientRow, 'account_no' | 'name' | 'start_date' | 'deposit_cents' | 'interest_cents' | 'active'>>();
  if (!c || !c.active) {
    await endAllSessions(env, 'client', id);
    return error('signed_out', 401);
  }
  return json({
    accountNo: c.account_no,
    name: c.name,
    startDate: c.start_date,
    depositCents: c.deposit_cents,
    interestCents: c.interest_cents,
    balanceCents: c.deposit_cents + c.interest_cents,
  });
};
