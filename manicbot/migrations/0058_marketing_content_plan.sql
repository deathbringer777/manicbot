-- Migration 0058 — marketing_content_plan: scheduled posts for the
-- @manicbot_com IG autopilot (and future tenant-scoped IG autopilot
-- when this graduates from /godmode into a plugin).
--
-- Why: replaces the Manus-generated `content_plan_30days.md` markdown,
-- which has no machine-parseable status field. The cron phase
-- `phaseInstagramAutopilot` reads `pending` rows whose scheduled_at <=
-- now() and walks them through generation → publishing.
--
-- tenant_id is nullable on purpose: @manicbot_com publishes as
-- system_admin without a tenant row. When the plugin lands, tenants
-- get their own rows and the column becomes their scope.
--
-- Status lifecycle:
--   pending      → not started
--   generating   → image/caption being produced
--   ready        → assets ready, awaiting publish window
--   publishing   → media container created at Meta, awaiting publish
--   posted       → live on IG with meta_post_id
--   failed       → error_count exhausted, manual review needed
--   paused       → owner manually paused this slot
--
-- A NEXT marker isn't a status — concurrency is handled by claiming
-- the row with UPDATE … WHERE status='pending' RETURNING id (Worker
-- pattern), so two cron invocations don't pick the same slot.

CREATE TABLE IF NOT EXISTS marketing_content_plan (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT,
  scheduled_at    INTEGER NOT NULL,
  theme           TEXT NOT NULL,
  topic           TEXT NOT NULL,
  key_message     TEXT,
  headline_pl     TEXT,
  caption_pl      TEXT,
  hashtags_json   TEXT,
  image_url       TEXT,
  image_prompt    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  meta_post_id    TEXT,
  permalink       TEXT,
  error_msg       TEXT,
  error_count     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  published_at    INTEGER
);

-- Cron sweep: find next pending slot whose time has come.
CREATE INDEX IF NOT EXISTS idx_mcp_status_sched
  ON marketing_content_plan(status, scheduled_at);

-- Per-tenant timeline view in admin UI.
CREATE INDEX IF NOT EXISTS idx_mcp_tenant_sched
  ON marketing_content_plan(tenant_id, scheduled_at);

-- Prevent two slots colliding at the same minute for the same tenant
-- (NULL tenant_id treated as @manicbot_com singleton).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_unique_slot
  ON marketing_content_plan(IFNULL(tenant_id,''), scheduled_at);
