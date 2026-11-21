import { error } from './http';
import { readSession } from './session';
import type { AgentRow, Env } from './types';

export type SignedInAgent = Pick<AgentRow, 'id' | 'email' | 'name'>;

/** Returns the signed-in agent, or a 401 response. */
export async function requireAgent(env: Env, request: Request): Promise<SignedInAgent | Response> {
  const id = await readSession(env, request, 'agent');
  if (!id) return error('signed_out', 401);
  const agent = await env.DB.prepare('SELECT id, email, name FROM agents WHERE id = ?1 AND active = 1').bind(id).first<SignedInAgent>();
  return agent || error('signed_out', 401);
}

export async function audit(env: Env, agentId: number | null, action: string, detail: string): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (at, agent_id, action, detail) VALUES (?1, ?2, ?3, ?4)')
    .bind(Date.now(), agentId, action, detail.slice(0, 1000))
    .run();
}
