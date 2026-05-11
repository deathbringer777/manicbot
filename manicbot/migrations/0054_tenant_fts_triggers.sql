-- Migration 0054: Keep tenant_fts in sync with tenants via INSERT/UPDATE/DELETE triggers.
--
-- Why: migration 0004 created the `tenant_fts` FTS5 virtual table
-- (`unicode61 remove_diacritics 1`) and added a denormalized `search_text`
-- column on `tenants`, but the index is currently maintained ad-hoc — only
-- the `/admin/seed`/`/admin/provision` HTTP handlers in adminKeyHttp.js
-- explicitly INSERT into `tenant_fts`. Regular tenant updates (slug change,
-- city change, salon profile edits) silently leave `tenant_fts` stale.
--
-- This migration installs canonical triggers so every write on `tenants`
-- reindexes the corresponding `tenant_fts` row. Mirrors what migration
-- 0004's docblock implied. Triggers fire on the `search_text` column —
-- if `search_text` is NULL we still index an empty body (deterministic
-- delete-then-insert so the row id stays consistent).
--
-- Schema columns indexed by tenant_fts (per 0004):
--   tenant_id  UNINDEXED  ← maps back to tenants.id
--   content               ← lowercase search blob (tenants.search_text)
--
-- Backfill: rebuild `tenant_fts` from the current `tenants` table so that
-- pre-existing rows (created before the trigger landed) are searchable.
-- Idempotent — safe to re-run after rollback.

-- 0. Backfill: drop any existing fts rows and reseed from tenants.
DELETE FROM tenant_fts;

INSERT INTO tenant_fts(tenant_id, content)
SELECT id, COALESCE(search_text, '')
FROM tenants;

-- 1. INSERT trigger: when a new tenants row appears, index it.
CREATE TRIGGER IF NOT EXISTS tenant_fts_ai
AFTER INSERT ON tenants
BEGIN
  INSERT INTO tenant_fts(tenant_id, content)
  VALUES (NEW.id, COALESCE(NEW.search_text, ''));
END;

-- 2. UPDATE trigger: when any tenants row changes, reindex it.
--    SQLite FTS5 doesn't have a stable rowid to UPDATE through, so the
--    canonical pattern is "delete the old fts row, then insert the new
--    one" — keyed on the UNINDEXED `tenant_id` column.
CREATE TRIGGER IF NOT EXISTS tenant_fts_au
AFTER UPDATE ON tenants
BEGIN
  DELETE FROM tenant_fts WHERE tenant_id = OLD.id;
  INSERT INTO tenant_fts(tenant_id, content)
  VALUES (NEW.id, COALESCE(NEW.search_text, ''));
END;

-- 3. DELETE trigger: when a tenant is removed, drop the fts row too.
CREATE TRIGGER IF NOT EXISTS tenant_fts_ad
AFTER DELETE ON tenants
BEGIN
  DELETE FROM tenant_fts WHERE tenant_id = OLD.id;
END;
