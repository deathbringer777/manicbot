-- 0022_user_origins.sql
-- User acquisition tracking: per-touch history + denormalized first-touch on users.
--
-- Every column is nullable except the autoincrement id / tenant_id / chat_id / channel
-- / captured_at / is_first_touch, so existing users are unaffected.
--
-- Apply: wrangler d1 execute manicbot-db --remote --file migrations/0022_user_origins.sql

CREATE TABLE IF NOT EXISTS user_origins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  chat_id         INTEGER NOT NULL,
  channel         TEXT NOT NULL,           -- 'telegram' | 'whatsapp' | 'instagram' | 'web'
  source          TEXT,                    -- 'qr' | 'tiktok' | 'website_card' | 'instagram' | 'custom'
  medium          TEXT,                    -- 'organic' | 'cpc' | 'referral' | 'social' | …
  campaign        TEXT,                    -- free-form campaign identifier
  content         TEXT,                    -- ad creative / button label
  landing_url     TEXT,                    -- web widget only: document.location.href at widget mount
  referer         TEXT,                    -- web widget only: document.referrer
  raw_payload     TEXT,                    -- original /start payload or query string
  captured_at     INTEGER NOT NULL,
  is_first_touch  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_chat ON user_origins(tenant_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_source ON user_origins(tenant_id, source, captured_at);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_campaign ON user_origins(tenant_id, campaign, captured_at);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_first ON user_origins(tenant_id, is_first_touch, captured_at);

-- Denormalized first-touch attribution on users — avoids join for hot-path queries.
ALTER TABLE users ADD COLUMN first_source TEXT;
ALTER TABLE users ADD COLUMN first_campaign TEXT;
ALTER TABLE users ADD COLUMN first_medium TEXT;
ALTER TABLE users ADD COLUMN first_touch_at INTEGER;
