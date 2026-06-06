-- 0116_tenants_parent_tenant.sql
--
-- Multi-salon ownership (MAX plan). A "secondary" salon created by a MAX-plan
-- owner is billed UNDER its parent (the owner's home tenant), not as a separate
-- paying customer. `parent_tenant_id` points at the home tenant id; NULL means a
-- normal, independently-billed tenant.
--
-- Used to (a) exclude secondaries from MRR / customer metrics so an owner pays
-- once for MAX and gets N salons, and (b) cascade-freeze secondaries if the
-- parent leaves the MAX plan. Threaded through the Worker putTenant landmine
-- (src/tenant/storage.js) so billing writes preserve it.
ALTER TABLE tenants ADD COLUMN parent_tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenants(parent_tenant_id);
