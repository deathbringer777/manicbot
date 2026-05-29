-- 0094_appointments_tenant_chat_index.sql — 2026-05-29
--
-- Add composite index on appointments(tenant_id, chat_id) for client-history
-- and booking-history lookups.
--
-- Context: idx_apt_tenant_chat was defined in the initial schema.sql but was
-- never materialised via a migration, so live databases created by running
-- migrations in sequence are missing this index. Hot queries in clients.ts
-- `getClient` and appointment history listings filter
-- WHERE tenant_id = ? AND chat_id = ? — without this index they scan the
-- entire tenant's appointment set.
--
-- IF NOT EXISTS is safe for re-apply.

CREATE INDEX IF NOT EXISTS idx_apt_tenant_chat
  ON appointments(tenant_id, chat_id);
