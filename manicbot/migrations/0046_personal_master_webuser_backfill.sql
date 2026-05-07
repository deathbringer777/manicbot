-- 0046: bind personal-tenant masters to their web_user (P0-4 prerequisite)
--
-- Personal tenants (tenants.is_personal = 1) host independent masters whose
-- master record (masters.web_user_id) is the authoritative IDOR check in
-- masterRouter.assertCallerIsMaster. Some legacy rows have web_user_id NULL,
-- which forced a count-based fallback that was racy when a second master was
-- ever added to a personal tenant.
--
-- The web_user owning a personal tenant has web_users.tenant_id = <tenant>.
-- For personal tenants where exactly one such web_user exists, that user IS
-- the master. We backfill conservatively: only when the mapping is unambiguous.
--
-- After this migration:
--   * masters with web_user_id set keep that binding (no overwrite).
--   * masters in a personal tenant with exactly one matching web_user get
--     that user's id.
--   * everything else stays NULL — the new code path will return FORBIDDEN
--     for those rows (safer than the previous count-based fallback). Operators
--     can rebind manually via the admin UI before the next release that
--     removes the fallback.

UPDATE masters
SET web_user_id = (
  SELECT u.id
  FROM web_users u
  WHERE u.tenant_id = masters.tenant_id
)
WHERE web_user_id IS NULL
  AND tenant_id IN (SELECT id FROM tenants WHERE is_personal = 1)
  AND (SELECT COUNT(*) FROM web_users WHERE tenant_id = masters.tenant_id) = 1;
