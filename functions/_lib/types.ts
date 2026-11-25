export interface Env {
  DB: D1Database;
  /** Public Turnstile site key (shown in the browser). */
  TURNSTILE_SITE_KEY?: string;
  /** Turnstile secret key (server only). */
  TURNSTILE_SECRET_KEY?: string;
  /** "true" skips the human check, but only when the request host is localhost / 127.0.0.1. */
  TURNSTILE_TEST_BYPASS?: string;
  /** One-time token that lets you create the first Agent/Financial Specialist account. */
  SETUP_TOKEN?: string;
  /** Optional: sign-in notice emails through Resend. */
  RESEND_API_KEY?: string;
  /** Optional: sender, e.g. "WBI <portal@notify.wealthbuilderins.com>". */
  NOTIFY_FROM?: string;
}

export type Fn = PagesFunction<Env>;

export interface ClientRow {
  id: number;
  account_no: string;
  name: string;
  email: string;
  start_date: string;
  deposit_cents: number;
  interest_cents: number;
  active: number;
  last_login_at: number | null;
}

export interface AgentRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  active: number;
}
