import { json } from '../_lib/http';
import { turnstileBypassed } from '../_lib/turnstile';
import type { Fn } from '../_lib/types';

/** Public settings the pages need: the Turnstile site key (safe to show in the browser). */
export const onRequestGet: Fn = async ({ env, request }) => {
  return json({
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    localTestMode: turnstileBypassed(env, request),
  });
};
