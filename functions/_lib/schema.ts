// Same statements as migrations/0001_init.sql (tests/e2e.mjs checks they match).
// Applied once per Worker instance, so a fresh D1 database works without a manual migration.
import type { Env } from './types';

export const SCHEMA: string[] = [
  "CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, account_no TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, start_date TEXT NOT NULL, deposit_cents INTEGER NOT NULL DEFAULT 0, interest_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, last_login_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (email);",
  "CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_login_at INTEGER, password_changed_at INTEGER, created_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('client', 'agent')), subject_id INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions (kind, subject_id);",
  "CREATE TABLE IF NOT EXISTS login_failures (key TEXT PRIMARY KEY, count INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);",
  "CREATE TABLE IF NOT EXISTS client_logins (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, at INTEGER NOT NULL);",
  "CREATE INDEX IF NOT EXISTS idx_client_logins_client ON client_logins (client_id, at);",
  "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, agent_id INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL);",
];

let ready: Promise<void> | null = null;

export function ensureSchema(env: Env): Promise<void> {
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql))).then(
      () => undefined,
      (err) => {
        ready = null; // try again on the next request
        throw err;
      },
    );
  }
  return ready;
}
