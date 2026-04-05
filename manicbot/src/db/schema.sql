-- ManicBot D1 Schema
-- Tenant-scoped tables

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  svc_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  master_id INTEGER,
  user_name TEXT,
  user_phone TEXT,
  user_tg TEXT,
  confirmed_by INTEGER,
  counter_time TEXT,
  counter_comment TEXT,
  reject_comment TEXT,
  cancel_reason TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  rem_h24 INTEGER NOT NULL DEFAULT 0,
  rem_h2 INTEGER NOT NULL DEFAULT 0,
  google_event_id TEXT,
  google_calendar_id TEXT,
  google_integration_id TEXT,
  sync_retries INTEGER DEFAULT 0,
  sync_retry_after INTEGER DEFAULT NULL,
  sync_last_error TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_date ON appointments(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_chat ON appointments(tenant_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_status ON appointments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_ts ON appointments(tenant_id, ts);

CREATE TABLE IF NOT EXISTS users (
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  name TEXT,
  tg_username TEXT,
  tg_lang TEXT,
  phone TEXT,
  registered_at INTEGER,
  tos_accepted_at INTEGER,
  PRIMARY KEY (tenant_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_user_username ON users(tenant_id, tg_username);
CREATE INDEX IF NOT EXISTS idx_user_phone ON users(tenant_id, phone);

CREATE TABLE IF NOT EXISTS masters (
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  name TEXT,
  tg_username TEXT,
  services TEXT,
  work_hours TEXT,
  work_days TEXT,
  on_vacation INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER,
  google_calendar_id TEXT,
  calendar_enabled INTEGER NOT NULL DEFAULT 0,
  bio TEXT,
  photo TEXT,
  portfolio TEXT,
  PRIMARY KEY (tenant_id, chat_id)
);

CREATE TABLE IF NOT EXISTS tenant_roles (
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, chat_id)
);

CREATE TABLE IF NOT EXISTS services (
  tenant_id TEXT NOT NULL,
  svc_id TEXT NOT NULL,
  emoji TEXT,
  duration INTEGER NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  names TEXT,
  description TEXT,
  photos TEXT,
  PRIMARY KEY (tenant_id, svc_id)
);

CREATE TABLE IF NOT EXISTS tenant_config (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS blocked_users (
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, chat_id)
);

CREATE TABLE IF NOT EXISTS local_tickets (
  tenant_id TEXT NOT NULL,
  client_cid INTEGER NOT NULL,
  master_cid INTEGER,
  open INTEGER NOT NULL DEFAULT 1,
  data TEXT,
  PRIMARY KEY (tenant_id, client_cid)
);

CREATE TABLE IF NOT EXISTS human_requests (
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, chat_id)
);

-- Global tables (no tenant prefix)

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  salon TEXT,
  photos TEXT,
  about_photos TEXT,
  maps_url TEXT,
  instagram_url TEXT,
  plan TEXT DEFAULT 'start',
  billing_status TEXT DEFAULT 'trialing',
  subscription_status TEXT,
  trial_ends_at INTEGER,
  grace_ends_at INTEGER,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  current_period_end INTEGER,
  next_payment_date INTEGER,
  billing_email TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  slug TEXT,
  description TEXT,
  lat REAL,
  lng REAL,
  city TEXT,
  public_active INTEGER NOT NULL DEFAULT 0,
  search_text TEXT,
  logo TEXT,
  cover_photo TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenant_city ON tenants(city);
CREATE INDEX IF NOT EXISTS idx_tenant_location ON tenants(lat, lng);
CREATE INDEX IF NOT EXISTS idx_tenant_public ON tenants(public_active, city);

CREATE TABLE IF NOT EXISTS bots (
  bot_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  bot_username TEXT,
  webhook_secret TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_tenant ON bots(tenant_id);

CREATE TABLE IF NOT EXISTS platform_roles (
  chat_id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS support_agents (
  chat_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (chat_id, type)
);

CREATE TABLE IF NOT EXISTS tenant_support_agents (
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, chat_id)
);

CREATE TABLE IF NOT EXISTS platform_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  client_chat_id INTEGER NOT NULL,
  client_bot_id TEXT,
  client_name TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  claimed_by INTEGER,
  claimed_by_web_user_id TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pticket_status ON platform_tickets(status);
CREATE INDEX IF NOT EXISTS idx_pticket_agent ON platform_tickets(claimed_by);

CREATE TABLE IF NOT EXISTS platform_ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT,
  attachment_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ptmsg_ticket ON platform_ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS stripe_customers (
  customer_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL
);

-- ─── Multi-channel tables ────────────────────────────────────────────────────

-- Channel credentials per tenant (one row per channel_type per tenant)
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

-- 24-hour messaging window tracking for WhatsApp and Instagram
CREATE TABLE IF NOT EXISTS message_windows (
  tenant_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  last_user_message_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, channel_type, channel_user_id)
);

-- WhatsApp template usage tracking (for plan quota enforcement)
CREATE TABLE IF NOT EXISTS template_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'whatsapp',
  template_name TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tu_tenant_sent ON template_usage(tenant_id, sent_at);

-- Unified conversations table (one row per user+channel session)
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

-- ─── Google Calendar integration ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS google_integrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  master_chat_id INTEGER,
  provider_account_email TEXT,
  calendar_id TEXT NOT NULL,
  calendar_summary TEXT,
  refresh_token_enc TEXT NOT NULL,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  sync_direction TEXT NOT NULL DEFAULT 'two_way',
  watch_channel_id TEXT,
  watch_resource_id TEXT,
  watch_expiration INTEGER,
  last_sync_at INTEGER,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gcal_integration_scope ON google_integrations(tenant_id, scope, master_chat_id);

CREATE TABLE IF NOT EXISTS google_busy_blocks (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  location TEXT,
  creator TEXT,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gcal_busy_lookup ON google_busy_blocks(integration_id, start_ts, end_ts);

-- Web Auth (email/password login for admin-app users)
CREATE TABLE IF NOT EXISTS web_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id TEXT,
  role TEXT NOT NULL DEFAULT 'tenant_owner',
  name TEXT,
  lang TEXT DEFAULT 'en',
  referral_source TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  verification_token_expires_at INTEGER,
  password_reset_token TEXT,
  password_reset_expires_at INTEGER,
  new_email TEXT,
  email_change_token TEXT,
  email_change_token_expires_at INTEGER,
  tos_accepted_at INTEGER,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER DEFAULT NULL,
  last_login_ip TEXT,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_user_email ON web_users(email);
CREATE INDEX IF NOT EXISTS idx_web_user_tenant ON web_users(tenant_id);

-- Persistent audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at);
