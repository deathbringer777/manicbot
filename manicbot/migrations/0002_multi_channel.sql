-- ManicBot multi-channel schema migration
-- Apply with: wrangler d1 migrations apply <database-name>

-- Channel credentials per tenant
CREATE TABLE IF NOT EXISTS channel_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  config TEXT,
  token_encrypted TEXT,
  token_expires_at INTEGER,
  webhook_verify_token TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_tenant ON channel_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cc_type ON channel_configs(channel_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_tenant_type ON channel_configs(tenant_id, channel_type);

-- Cross-channel user identity mapping
CREATE TABLE IF NOT EXISTS channel_identities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  internal_user_id INTEGER,
  channel_type TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_unique ON channel_identities(tenant_id, channel_type, channel_user_id);
CREATE INDEX IF NOT EXISTS idx_ci_internal ON channel_identities(tenant_id, internal_user_id);

-- 24-hour messaging window (WhatsApp + Instagram)
CREATE TABLE IF NOT EXISTS message_windows (
  tenant_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  last_user_message_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, channel_type, channel_user_id)
);

-- WhatsApp template usage (plan quota)
CREATE TABLE IF NOT EXISTS template_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'whatsapp',
  template_name TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tu_tenant_sent ON template_usage(tenant_id, sent_at);

-- Unified conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  internal_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_tenant_msg ON conversations(tenant_id, last_message_at);
