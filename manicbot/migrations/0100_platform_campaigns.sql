-- 0100_platform_campaigns.sql — 2026-05-31
--
-- Platform campaigns: operator (system_admin) scheduled / recurring / templated
-- messaging to tenant owners across multiple channels (message center, in-app
-- bell, Telegram, Email). Authored in the God-Mode "Рассылки" panel
-- (/system/marketing/broadcasts); the Worker cron reads these rows to perform
-- the actual delivery + scheduling.
--
-- Why three NEW tables (not extending 0076 platform_broadcasts):
--   * 0076 platform_broadcasts is an immediate, fire-once audit record written
--     synchronously from a single cross-tenant tRPC call. It has no schedule,
--     no recurrence, no per-channel fan-out, and no idempotency ledger.
--   * This feature needs (a) a durable definition the */15 cron re-reads each
--     tick, (b) recurrence/occurrence math, (c) a per-(campaign, occurrence,
--     recipient, channel) idempotency ledger so the cron never double-sends
--     across ticks or across the per-tenant fan-out fleet.
--
-- Scope model (IMPORTANT — mirrors 0076, do NOT "fix" by adding tenant_id):
--   * platform_campaigns and platform_message_templates are PLATFORM-scoped:
--     authored only by system_admin, NO tenant_id column — they describe an
--     operator broadcast definition, not tenant data.
--   * platform_campaign_deliveries IS per-tenant: tenant_id is the scoping
--     handle. The Worker dispatch phase runs per-tenant (ctx.tenantId) and
--     every read/write of this table is scoped by tenant_id.
--
-- Idempotency (claim-by-INSERT, mirrors notifyWebUser's INSERT OR IGNORE on
-- uq_user_notifications_source and tryClaimPhase): UNIQUE(campaign_id,
-- occurrence_key, recipient_web_user_id, channel). A delivery is "claimed" by
-- inserting its row; an INSERT that conflicts means another tick/worker already
-- owns it → skip.
--
-- monthly_report + subscription_reminder are auto-seeded SINGLETON rows
-- (deterministic ids 'sys_monthly_report' / 'sys_subscription_reminder',
-- status='paused' until the operator enables them). A partial UNIQUE on kind
-- enforces exactly one of each, while allowing unlimited 'announcement' rows.
--
-- Additive only. No existing tables touched.

CREATE TABLE IF NOT EXISTS platform_campaigns (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,               -- 'announcement' | 'monthly_report' | 'subscription_reminder'
  title                 TEXT,
  body                  TEXT,                         -- default/fallback body (center channel default)
  bodies_json           TEXT,                         -- per-channel overrides: {center,bell,telegram,email:{subject,html}}
  audience_filter_json  TEXT,                         -- {scope:'all'|'by_plan'|'by_billing_status', plans?, statuses?}
  channels_json         TEXT NOT NULL,                -- ["center","bell","telegram","email"]
  schedule_kind         TEXT NOT NULL DEFAULT 'now',  -- 'now' | 'once' | 'recurring'
  scheduled_at          INTEGER,                      -- unix seconds; for schedule_kind='once'
  recurrence_json       TEXT,                         -- {freq:'daily'|'weekly'|'monthly', day?, weekday?, hour, minute, daysBefore?}
  template_id           TEXT,                         -- optional platform_message_templates(id)
  status                TEXT NOT NULL DEFAULT 'draft',-- 'draft'|'scheduled'|'active'|'paused'|'done'|'failed'
  next_run_at           INTEGER,                      -- precomputed next fire (unix seconds); dispatch scan optimization
  last_run_at           INTEGER,
  created_by            TEXT,                         -- web_users.id of the authoring system_admin
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

-- Dispatch scan: WHERE status IN ('active','scheduled') AND next_run_at <= now.
CREATE INDEX IF NOT EXISTS idx_platform_campaigns_status_next
  ON platform_campaigns(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_platform_campaigns_kind
  ON platform_campaigns(kind);

-- Exactly one monthly_report and one subscription_reminder row, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_campaigns_singleton_kind
  ON platform_campaigns(kind)
  WHERE kind IN ('monthly_report', 'subscription_reminder');

CREATE TABLE IF NOT EXISTS platform_campaign_deliveries (
  id                    TEXT PRIMARY KEY,
  campaign_id           TEXT NOT NULL,
  occurrence_key        TEXT NOT NULL,                -- 'once' | 'YYYY-MM' | 'YYYY-MM-DD' | 'YYYY-Www' | anchor epoch
  recipient_web_user_id TEXT NOT NULL,                -- web_users.id, or '_none' sentinel for the zero-audience audit row
  tenant_id             TEXT NOT NULL,
  channel               TEXT NOT NULL,                -- 'center'|'bell'|'telegram'|'email' | '_audit'
  status                TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'sent'|'failed'|'skipped'
  error                 TEXT,
  created_at            INTEGER NOT NULL,
  sent_at               INTEGER,
  FOREIGN KEY (campaign_id) REFERENCES platform_campaigns(id) ON DELETE CASCADE
);

-- Claim-by-INSERT idempotency key. One row per (campaign, occurrence, recipient, channel).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pcd_claim
  ON platform_campaign_deliveries(campaign_id, occurrence_key, recipient_web_user_id, channel);
CREATE INDEX IF NOT EXISTS idx_pcd_campaign
  ON platform_campaign_deliveries(campaign_id);
CREATE INDEX IF NOT EXISTS idx_pcd_tenant
  ON platform_campaign_deliveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pcd_status
  ON platform_campaign_deliveries(status);

CREATE TABLE IF NOT EXISTS platform_message_templates (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  category              TEXT,                         -- operator scenario, e.g. 'announcement','seasonal','billing','onboarding'
  channels_json         TEXT,                         -- suggested channels for this template
  bodies_json           TEXT,                         -- {center,bell,telegram,email:{subject,html}}
  locale                TEXT DEFAULT 'ru',
  is_builtin            INTEGER NOT NULL DEFAULT 0,
  created_by            TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pmt_category
  ON platform_message_templates(category);

-- Auto-seed the two singleton system campaigns, disabled (paused) until the
-- operator enables them and chooses channels. Deterministic ids → idempotent on
-- every deploy. recurrence_json carries the advisory schedule the due() function
-- reads (hour/minute, and daysBefore for the reminder); the operator overrides
-- via the settings cards.
INSERT OR IGNORE INTO platform_campaigns
  (id, kind, title, body, channels_json, schedule_kind, recurrence_json, status, created_at, updated_at)
VALUES
  ('sys_monthly_report', 'monthly_report', 'Monthly statistics report',
   'Your salon statistics for the previous month.',
   '["center","email"]', 'recurring',
   '{"freq":"monthly","day":1,"hour":7,"minute":0}',
   'paused', unixepoch(), unixepoch()),
  ('sys_subscription_reminder', 'subscription_reminder', 'Subscription renewal reminder',
   'Your subscription is approaching its renewal date.',
   '["center","email","bell"]', 'recurring',
   '{"freq":"daily","hour":9,"minute":0,"daysBefore":3}',
   'paused', unixepoch(), unixepoch());
