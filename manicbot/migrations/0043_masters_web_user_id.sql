-- 0043_masters_web_user_id.sql — 2026-04-29
--
-- #S-01 / #S-03 — closes the master IDOR + wrong-master-on-getMyRole pair.
--
-- Before this migration, there is NO authoritative link between a `web_users`
-- row (the email/password account) and a specific `masters` row in a tenant.
--   - `auth.getMyRole` resolved a master by picking the first active row in
--     the tenant — wrong on multi-master tenants.
--   - `masterRouter.update*` mutations trusted the client-supplied masterId
--     without checking it belongs to the caller — IDOR within tenant.
--
-- The fix: add `masters.web_user_id` (nullable, indexed). New invitations
-- populate it; existing rows are backfilled where we can prove a 1:1 link
-- (personal tenants: a personal tenant has exactly one master and exactly
-- one web user).
--
-- Mixed-master salons keep `web_user_id = NULL` for legacy rows; the runtime
-- falls back to existing personal-tenant logic and forces a `null` masterId
-- so authorization fails closed rather than open.

ALTER TABLE masters ADD COLUMN web_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_master_web_user_id ON masters(web_user_id);
CREATE INDEX IF NOT EXISTS idx_master_tenant_web_user ON masters(tenant_id, web_user_id);

-- Backfill: personal tenants are 1:1 (one tenant, one master, one web user).
-- For any master in a personal tenant where exactly one web_users row matches
-- by tenant_id, link them. Multi-master tenants are intentionally skipped —
-- there is no deterministic mapping and we prefer fail-closed over guessing.
UPDATE masters
SET web_user_id = (
  SELECT wu.id FROM web_users wu
  WHERE wu.tenant_id = masters.tenant_id
  LIMIT 1
)
WHERE web_user_id IS NULL
  AND tenant_id IN (SELECT id FROM tenants WHERE is_personal = 1)
  AND (SELECT COUNT(*) FROM masters m2 WHERE m2.tenant_id = masters.tenant_id) = 1
  AND (SELECT COUNT(*) FROM web_users wu2 WHERE wu2.tenant_id = masters.tenant_id) = 1;
