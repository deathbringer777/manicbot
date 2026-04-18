-- ── Marketing module: CRM + campaigns + providers (dormant, not wired to sends yet) ──
-- Fase 1 skeleton for God Mode → Marketing section. All tables are global (not
-- tenant-scoped by default) — a marketing team operates across the whole platform.
-- tenant_id is nullable on contacts/segments/campaigns so a salon can also have
-- private segments/campaigns later (phase 3: white-label marketing for tenants).

-- ─── Extend marketing_contacts with CRM fields ───────────────────────
ALTER TABLE marketing_contacts ADD COLUMN tenant_id TEXT;
ALTER TABLE marketing_contacts ADD COLUMN tags TEXT;                      -- CSV
ALTER TABLE marketing_contacts ADD COLUMN custom_fields TEXT;             -- JSON
ALTER TABLE marketing_contacts ADD COLUMN consent_email INTEGER NOT NULL DEFAULT 1;
ALTER TABLE marketing_contacts ADD COLUMN consent_sms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketing_contacts ADD COLUMN brevo_contact_id TEXT;
ALTER TABLE marketing_contacts ADD COLUMN unsubscribe_token TEXT;
ALTER TABLE marketing_contacts ADD COLUMN locale TEXT;                    -- ru/ua/en/pl
ALTER TABLE marketing_contacts ADD COLUMN lifecycle_stage TEXT;           -- lead/active/dormant/customer
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_tenant ON marketing_contacts(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_unsub_tok ON marketing_contacts(unsubscribe_token);

-- ─── Segments: saved audience filters ────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_segments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,                   -- NULL = platform-wide
  name TEXT NOT NULL,
  description TEXT,
  filter_json TEXT NOT NULL,        -- {tags:[...], lifecycle_stage:'active', ...}
  contact_count INTEGER NOT NULL DEFAULT 0,
  last_computed_at INTEGER,
  created_by INTEGER,               -- chat_id or web_user id
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_segments_tenant ON marketing_segments(tenant_id);

-- ─── Templates: reusable email/SMS templates ─────────────────────────
CREATE TABLE IF NOT EXISTS marketing_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,                   -- NULL = platform-wide
  name TEXT NOT NULL,
  channel TEXT NOT NULL,            -- email | sms | whatsapp
  subject TEXT,                     -- email only
  body TEXT NOT NULL,               -- HTML for email, plain for SMS
  variables_json TEXT,              -- ["{{name}}","{{salon}}"]
  locale TEXT,                      -- ru/ua/en/pl or NULL = multi
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_tenant ON marketing_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_channel ON marketing_templates(channel);

-- ─── Campaigns: scheduled/sent batches ───────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,                   -- NULL = platform-wide
  name TEXT NOT NULL,
  channel TEXT NOT NULL,            -- email | sms | whatsapp
  segment_id TEXT,                  -- FK to marketing_segments.id
  template_id TEXT,                 -- FK to marketing_templates.id
  provider TEXT,                    -- brevo | resend | twilio
  status TEXT NOT NULL DEFAULT 'draft',  -- draft|scheduled|sending|sent|paused|failed
  scheduled_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  stats_json TEXT,                  -- {queued,sent,delivered,opened,clicked,bounced,failed}
  error TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_tenant ON marketing_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_scheduled ON marketing_campaigns(scheduled_at);

-- ─── Sends: per-recipient delivery log ───────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_sends (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id INTEGER NOT NULL,
  recipient TEXT NOT NULL,          -- email or phone at send time
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued|sent|delivered|opened|clicked|bounced|failed|unsubscribed
  error TEXT,
  queued_at INTEGER NOT NULL,
  sent_at INTEGER,
  delivered_at INTEGER,
  opened_at INTEGER,
  clicked_at INTEGER,
  bounced_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mkt_sends_campaign ON marketing_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mkt_sends_contact ON marketing_sends(contact_id);
CREATE INDEX IF NOT EXISTS idx_mkt_sends_status ON marketing_sends(status);
CREATE INDEX IF NOT EXISTS idx_mkt_sends_provider_msg ON marketing_sends(provider_message_id);

-- ─── Automations: trigger → step pipelines (phase 2) ─────────────────
CREATE TABLE IF NOT EXISTS marketing_automations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,       -- registered | inactive_30d | birthday | appointment_booked | etc.
  trigger_config_json TEXT,
  steps_json TEXT NOT NULL,         -- [{type:'email',template_id,delay_hours},...]
  enabled INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_automations_tenant ON marketing_automations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mkt_automations_enabled ON marketing_automations(enabled);

-- ─── Providers: email/SMS transport configs + health ─────────────────
-- Single row per provider. API keys read from env; this table tracks enable
-- flag, health-check status, and rate-limit headroom for the dashboard.
CREATE TABLE IF NOT EXISTS marketing_providers (
  name TEXT PRIMARY KEY,            -- brevo | resend | twilio
  type TEXT NOT NULL,               -- email | sms | multi
  enabled INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  config_json TEXT,                 -- non-secret config (from address, sender id)
  health_status TEXT,               -- ok | degraded | down | unknown
  health_detail TEXT,
  last_check_at INTEGER,
  quota_used INTEGER,
  quota_limit INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ─── Consent log: GDPR audit trail ───────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_consent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  event TEXT NOT NULL,              -- opt_in | opt_out | email_opt_in | sms_opt_in | email_opt_out | sms_opt_out
  source TEXT,                      -- landing | booking_form | admin_import | unsubscribe_link | api
  ip TEXT,
  user_agent TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_consent_contact ON marketing_consent_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_mkt_consent_created ON marketing_consent_log(created_at);

-- ─── Seed built-in providers (disabled by default) ───────────────────
INSERT OR IGNORE INTO marketing_providers (name, type, enabled, is_default, health_status, created_at, updated_at)
VALUES
  ('resend', 'email', 1, 1, 'unknown', unixepoch(), unixepoch()),
  ('brevo',  'multi', 0, 0, 'unknown', unixepoch(), unixepoch());
