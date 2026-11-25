-- WBI Client Portal schema version 2: Agent/Financial Specialist roles.
-- The app applies this by itself on first use (functions/_lib/schema.ts, upgrade()).
-- Only run it by hand on a database that does not have the agents.role column yet.
--   owner = Main account: can add and manage other Agent/Financial Specialist accounts
--   agent = Standard account: manages client accounts only
ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent';
UPDATE agents SET role = 'owner' WHERE id = (SELECT MIN(id) FROM agents);
