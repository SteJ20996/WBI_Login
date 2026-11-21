import { requireAgent } from '../../_lib/agent';
import { json } from '../../_lib/http';
import type { Fn } from '../../_lib/types';

/** Most recent entries of the change log. */
export const onRequestGet: Fn = async ({ env, request }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  const { results } = await env.DB.prepare(
    'SELECT a.at, a.action, a.detail, g.email AS agent FROM audit_log a LEFT JOIN agents g ON g.id = a.agent_id ORDER BY a.id DESC LIMIT 30',
  ).all<{ at: number; action: string; detail: string; agent: string | null }>();
  return json({ entries: results });
};
