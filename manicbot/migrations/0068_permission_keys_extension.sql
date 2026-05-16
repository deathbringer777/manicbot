-- 0068_permission_keys_extension.sql — permission system unification.
-- (Originally numbered 0063 in PR-A — renumbered to 0068 to avoid collision
-- with 0063_master_origin_and_archive.sql that landed on main first.)
--
-- The `tenant_member_permissions` table already supports any web_user row
-- (it's keyed by (tenant_id, web_user_id, permission)). This migration is
-- data-only + adds a covering index for the unified Staff UI:
--
-- 1. Backfill default permissions for existing salon-invited masters
--    (masters.web_user_id IS NOT NULL AND is_synthetic = 0). These rows
--    were previously denied admin access; now they fall through to the
--    permission-row check in assertPermission().
--
-- 2. New composite index on (tenant_id, web_user_id) for the listMembers
--    query that joins both tenant_managers and masters per tenant.
--
-- Permission keys themselves are validated in TypeScript; the table
-- accepts any TEXT, so no schema change is needed for the new keys.

INSERT OR IGNORE INTO tenant_member_permissions
  (tenant_id, web_user_id, permission, granted_at, granted_by)
SELECT
  m.tenant_id,
  m.web_user_id,
  p.permission,
  CAST(strftime('%s', 'now') AS INTEGER),
  'migration:0068'
FROM masters m
CROSS JOIN (
  SELECT 'appointments.view_own'    AS permission UNION ALL
  SELECT 'appointments.manage_own'                UNION ALL
  SELECT 'clients.view_own'                       UNION ALL
  SELECT 'services.view'                          UNION ALL
  SELECT 'earnings.view_own'
) AS p
WHERE m.web_user_id IS NOT NULL
  AND m.is_synthetic = 0;

CREATE INDEX IF NOT EXISTS idx_tmp_tenant_user
  ON tenant_member_permissions (tenant_id, web_user_id);
