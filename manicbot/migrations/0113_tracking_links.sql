-- 0113_tracking_links.sql — 2026-06-06
--
-- Persisted short codes for owner-generated tracking links. The link generator
-- used to embed the whole attribution payload as base64url(JSON) into Telegram's
-- /start param, which (a) crashed on Cyrillic — btoa() is Latin-1 only — and
-- (b) overflowed Telegram's hard 64-char /start limit. Now it mints a short opaque
-- code (e.g. `ab12cd34`); the Worker's /start handler looks it up to recover
-- {source, medium, campaign, content}. Idempotent per (tenant_id, payload_hash):
-- re-generating the same meta returns the same code instead of spawning rows.
--
-- Also adds user_origins.web_user_id so a web touch (anonymousId, no Telegram
-- chat_id) can be recorded in the same touch ledger as Telegram — this is what
-- makes the analytics funnel/sources multichannel instead of Telegram-only.
-- Additive + nullable column → safe, no backfill, ignored by older code paths.
CREATE TABLE IF NOT EXISTS tracking_links (
  short_code    TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  source        TEXT NOT NULL,
  medium        TEXT,
  campaign      TEXT,
  content       TEXT,
  payload_hash  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tl_tenant_hash ON tracking_links(tenant_id, payload_hash);
CREATE INDEX IF NOT EXISTS idx_tl_tenant_code ON tracking_links(tenant_id, short_code);

ALTER TABLE user_origins ADD COLUMN web_user_id TEXT;
