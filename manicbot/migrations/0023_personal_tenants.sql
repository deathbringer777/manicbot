-- Independent masters: mark tenants created for solo practitioners
ALTER TABLE tenants ADD COLUMN is_personal INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_tenant_personal ON tenants(is_personal);
