import { json } from '../../_lib/http';
import { endSession } from '../../_lib/session';
import type { Fn } from '../../_lib/types';

export const onRequestPost: Fn = async ({ env, request }) => {
  const clear = await endSession(env, request, 'client');
  return json({ ok: true }, 200, { 'Set-Cookie': clear });
};
