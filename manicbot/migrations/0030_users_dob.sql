-- 0030: users.dob for birthday promo (Sprint 4)
-- Format: YYYY-MM-DD (nullable). NULL = user didn't share.
ALTER TABLE users ADD COLUMN dob TEXT;
CREATE INDEX IF NOT EXISTS idx_users_tenant_dob ON users(tenant_id, dob);
