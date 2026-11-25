import { requireAgent } from '../../_lib/agent';
import { json } from '../../_lib/http';
import type { Fn } from '../../_lib/types';

export const onRequestGet: Fn = async ({ env, request }) => {
  const agent = await requireAgent(env, request);
  if (agent instanceof Response) return agent;
  return json({ email: agent.email, name: agent.name });
};
