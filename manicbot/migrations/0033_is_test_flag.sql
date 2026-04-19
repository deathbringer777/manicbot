-- 0033_is_test_flag.sql
-- Adds an is_test flag on tenants so platform engineers can mark synthetic
-- accounts created by `npm run seed:test-accounts`. The flag is purely a
-- presentation/filtering signal — no business logic gates off it.

ALTER TABLE tenants ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_tenant_is_test ON tenants(is_test);
