import type { Env } from './types';

/** Sends a short sign-in notice through Resend. Does nothing when Resend is not set up. */
export async function sendSignInNotice(env: Env, to: string, portal: 'Client Portal' | 'Agent/Financial Specialist Portal'): Promise<void> {
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM) return;
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
  const text =
    `Hello,\n\nYour WBI ${portal} account was signed in on ${when} (Pacific Time).\n\n` +
    `If this was you, no action is needed. If it was not you, please contact your WBI agent right away.\n\n` +
    `Wealth Builder & Insurances\n555 Anton Blvd, Ste. 150, Costa Mesa, CA 92626`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.NOTIFY_FROM, to: [to], subject: `New sign-in to your WBI ${portal}`, text }),
    });
  } catch {
    // A failed notice must not block the sign-in.
  }
}
