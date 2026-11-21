-- WBI Client Portal schema (version 1).
-- The app also applies these statements on first use (CREATE ... IF NOT EXISTS),
-- so running this migration by hand is optional. Keep it identical to functions/_lib/schema.ts.

-- One row per client account. Money is stored in cents to avoid rounding errors.
CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, account_no TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL, start_date TEXT NOT NULL, deposit_cents INTEGER NOT NULL DEFAULT 0, interest_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, last_login_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients (email);

-- Agent/Financial Specialist accounts (password stored only as a PBKDF2 hash).
CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_login_at INTEGER, password_changed_at INTEGER, created_at INTEGER NOT NULL);

-- Sign-in sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('client', 'agent')), subject_id INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions (kind, subject_id);

-- Wrong-try counters for the 5-tries / 5-minute lock.
CREATE TABLE IF NOT EXISTS login_failures (key TEXT PRIMARY KEY, count INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);

-- Client sign-in history.
CREATE TABLE IF NOT EXISTS client_logins (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_client_logins_client ON client_logins (client_id, at);

-- Change log of everything done in the agent back office.
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, agent_id INTEGER, action TEXT NOT NULL, detail TEXT NOT NULL);
