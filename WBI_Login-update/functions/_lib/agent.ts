import { error } from './http';
import { readSession } from './session';
import type { AgentRow, Env } from './types';

export type SignedInAgent = Pick<AgentRow, 'id' | 'email' | 'name' | 'role'>;

/** Returns the signed-in agent, or a 401 response. */
export async function requireAgent(env: Env, request: Request): Promise<SignedInAgent | Response> {
  const id = await readSession(env, request, 'agent');
  if (!id) return error('signed_out', 401);
  const agent = await env.DB.prepare('SELECT id, email, name, role FROM agents WHERE id = ?1 AND active = 1').bind(id).first<SignedInAgent>();
  return agent || error('signed_out', 401);
}

/** Like requireAgent, but only the Main account(s) may continue. */
export async function requireOwner(env: Env, request: Request): Promise<SignedInAgent | Response> {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  return agent.role === 'owner' ? agent : error('forbidden', 403, { message: 'Only a Main account can manage Agent/Financial Specialist accounts.' });
}

export function parseRole(value: unknown): 'owner' | 'agent' | null {
  return value === 'owner' || value === 'agent' ? value : null;
}

export const roleLabel = (role: string) => (role === 'owner' ? 'Main' : 'Standard');

export async function audit(env: Env, agentId: number | null, action: string, detail: string): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (at, agent_id, action, detail) VALUES (?1, ?2, ?3, ?4)')
    .bind(Date.now(), agentId, action, detail.slice(0, 1000))
    .run();
}
