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
  cancelled_by TEXT,
  cancelled_at INTEGER,
  no_show INTEGER DEFAULT 0,
  no_show_by TEXT,
  rem_h24 INTEGER NOT NULL DEFAULT 0,
  rem_h2 INTEGER NOT NULL DEFAULT 0,
  google_event_id TEXT,
  google_calendar_id TEXT,
  google_integration_id TEXT,
  sync_retries INTEGER DEFAULT 0,
  sync_retry_after INTEGER DEFAULT NULL,
  sync_last_error TEXT DEFAULT NULL,
  review_requested INTEGER DEFAULT 0,
  visit_confirmed_at INTEGER,
  visit_confirmed_by TEXT,
  review_requested_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_date ON appointments(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_chat ON appointments(tenant_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_status ON appointments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_apt_tenant_ts ON appointments(tenant_id, ts);
-- 0044: prevents double-booking of the same active slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_apt_unique_active_slot
  ON appointments(tenant_id, COALESCE(master_id, -1), date, time)
  WHERE cancelled = 0;
-- 0051: composite indexes for cron + analytics hot paths.
CREATE INDEX IF NOT EXISTS idx_apt_unsynced
  ON appointments(tenant_id, ts)
  WHERE google_event_id IS NULL AND status='confirmed' AND cancelled=0;
CREATE INDEX IF NOT EXISTS idx_apt_master_date ON appointments(tenant_id, master_id, date);
CREATE INDEX IF NOT EXISTS idx_apt_created ON appointments(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS users (
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  name TEXT,
  tg_username TEXT,
  tg_lang TEXT,
  phone TEXT,
  registered_at INTEGER,
  tos_accepted_at INTEGER,
  first_source TEXT,
  first_campaign TEXT,
  first_medium TEXT,
  first_touch_at INTEGER,
  dob TEXT,
  email TEXT,
  ig_username TEXT,
  notes TEXT,
  tags TEXT,
  marketing_contact_id INTEGER,
  is_blocked_global INTEGER NOT NULL DEFAULT 0,
  blocked_global_reason TEXT,
  blocked_global_at INTEGER,
  updated_at INTEGER,
  deleted_at INTEGER,
  lifetime_visits INTEGER NOT NULL DEFAULT 0,
  last_visit_at INTEGER,
  PRIMARY KEY (tenant_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant_dob ON users(tenant_id, dob);
CREATE INDEX IF NOT EXISTS idx_user_username ON users(tenant_id, tg_username);
CREATE INDEX IF NOT EXISTS idx_user_phone ON users(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_ig ON users(tenant_id, ig_username);
CREATE INDEX IF NOT EXISTS idx_users_marketing_id ON users(marketing_contact_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_blocked ON users(tenant_id, is_blocked_global);
CREATE INDEX IF NOT EXISTS idx_users_tenant_deleted ON users(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_last_visit ON users(tenant_id, last_visit_at);

-- FTS5 index over the user list. Kept in sync via the users_fts_ai/au/ad
-- triggers installed by migration 0062. Search blob is lower(name + phone
-- + tg + email + ig + tags). Used by salon-dashboard Clients tab and the
-- public-side autocomplete when an owner looks up a customer mid-flow.
CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(
  tenant_id UNINDEXED,
  chat_id UNINDEXED,
  search_text,
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TABLE IF NOT EXISTS master_client_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  master_chat_id INTEGER NOT NULL,
  client_chat_id INTEGER NOT NULL,
  reason TEXT,
  blocked_by INTEGER NOT NULL,
  blocked_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcb_uniq ON master_client_blocks(tenant_id, master_chat_id, client_chat_id);
CREATE INDEX IF NOT EXISTS idx_mcb_client ON master_client_blocks(tenant_id, client_chat_id);
CREATE INDEX IF NOT EXISTS idx_mcb_master ON master_client_blocks(tenant_id, master_chat_id);

CREATE TABLE IF NOT EXISTS user_origins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  chat_id         INTEGER NOT NULL,
  channel         TEXT NOT NULL,
  source          TEXT,
  medium          TEXT,
  campaign        TEXT,
  content         TEXT,
  landing_url     TEXT,
  referer         TEXT,
  raw_payload     TEXT,
  captured_at     INTEGER NOT NULL,
  is_first_touch  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_chat ON user_origins(tenant_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_source ON user_origins(tenant_id, source, captured_at);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_campaign ON user_origins(tenant_id, campaign, captured_at);
CREATE INDEX IF NOT EXISTS idx_uo_tenant_first ON user_origins(tenant_id, is_first_touch, captured_at);

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
  allow_delegation INTEGER NOT NULL DEFAULT 0,
  web_user_id TEXT,
  calendar_visibility TEXT NOT NULL DEFAULT 'salon_only',
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  public_hidden INTEGER NOT NULL DEFAULT 0,
  vacation_from INTEGER,
  vacation_until INTEGER,
  PRIMARY KEY (tenant_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_master_web_user_id ON masters(web_user_id);
CREATE INDEX IF NOT EXISTS idx_master_tenant_web_user ON masters(tenant_id, web_user_id);
CREATE INDEX IF NOT EXISTS idx_masters_vacation_until ON masters(vacation_until) WHERE vacation_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_masters_calendar_visibility ON masters(tenant_id, calendar_visibility);

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
  promo TEXT,
  category TEXT,
  industry_specific_props TEXT,
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
  display_name TEXT,
  logo_r2_key TEXT,
  cover_r2_key TEXT,
  brand_palette TEXT,
  is_personal INTEGER NOT NULL DEFAULT 0,
  industry TEXT NOT NULL DEFAULT 'beauty',
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenant_personal ON tenants(is_personal);
CREATE INDEX IF NOT EXISTS idx_tenant_city ON tenants(city);
CREATE INDEX IF NOT EXISTS idx_tenant_location ON tenants(lat, lng);
CREATE INDEX IF NOT EXISTS idx_tenant_public ON tenants(public_active, city);
CREATE INDEX IF NOT EXISTS idx_tenant_is_test ON tenants(is_test);

CREATE TABLE IF NOT EXISTS bots (
  bot_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  bot_username TEXT,
  webhook_secret TEXT,
  token_encrypted TEXT,
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
  page_id TEXT,
  phone_number_id TEXT,
  ig_business_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_tenant ON channel_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cc_type ON channel_configs(channel_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_tenant_type ON channel_configs(tenant_id, channel_type);
CREATE INDEX IF NOT EXISTS idx_cc_page_id ON channel_configs(channel_type, page_id);
CREATE INDEX IF NOT EXISTS idx_cc_phone ON channel_configs(channel_type, phone_number_id);
CREATE INDEX IF NOT EXISTS idx_cc_ig_biz ON channel_configs(channel_type, ig_business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_unique_page_id
  ON channel_configs(channel_type, page_id)
  WHERE page_id IS NOT NULL AND active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_unique_phone
  ON channel_configs(channel_type, phone_number_id)
  WHERE phone_number_id IS NOT NULL AND active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_unique_ig_biz
  ON channel_configs(channel_type, ig_business_id)
  WHERE ig_business_id IS NOT NULL AND active = 1;

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
-- 0051: enable "this user's history" lookups in unified inbox.
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(tenant_id, channel_user_id);

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
  password_hash TEXT NOT NULL DEFAULT '',
  tenant_id TEXT,
  role TEXT NOT NULL DEFAULT 'tenant_owner',
  name TEXT,
  lang TEXT DEFAULT 'en',
  referral_source TEXT,
  referral_note TEXT,
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
  password_changed_at INTEGER NOT NULL DEFAULT 0,
  sessions_invalidated_at INTEGER NOT NULL DEFAULT 0,
  login_token_hash TEXT,
  login_token_expires_at INTEGER,
  -- 0053: rolling-window companions to the three legacy plaintext-named
  -- token columns above (password_reset_token / verification_token /
  -- email_change_token). Writers populate both during the deprecation
  -- window; readers prefer the *_hash column.
  password_reset_token_hash TEXT,
  verification_token_hash TEXT,
  email_change_token_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_user_email ON web_users(email);
CREATE INDEX IF NOT EXISTS idx_web_user_tenant ON web_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_web_users_login_token ON web_users(login_token_hash);

-- Reviews & ratings
CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  appointment_id  TEXT,
  master_id       TEXT,
  chat_id         INTEGER NOT NULL,
  channel         TEXT DEFAULT 'telegram',
  rating          INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  text            TEXT,
  photos          TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  reply_text      TEXT,
  reply_at        INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_master ON reviews(tenant_id, master_id);
CREATE INDEX IF NOT EXISTS idx_reviews_apt ON reviews(appointment_id);

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
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor, created_at);

-- Role change requests (web users)
CREATE TABLE IF NOT EXISTS role_change_requests (
  id TEXT PRIMARY KEY,
  web_user_id TEXT NOT NULL,
  current_role TEXT NOT NULL,
  requested_role TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_rcr_user ON role_change_requests(web_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rcr_status ON role_change_requests(status, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (key, action)
);
CREATE INDEX IF NOT EXISTS idx_rl_window ON rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_rl_key_action_window ON rate_limits(key, action, window_start);

-- ── Sprint 2-5 additions (migration 0029) ────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_date ON ai_usage(tenant_id, usage_date);

CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'resend',
  suppressed_at INTEGER NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type, received_at);

CREATE TABLE IF NOT EXISTS tenant_onboarding (
  tenant_id TEXT PRIMARY KEY,
  completed_steps TEXT NOT NULL DEFAULT '[]',
  all_completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value INTEGER NOT NULL,
  max_uses INTEGER,
  max_uses_per_client INTEGER NOT NULL DEFAULT 1,
  valid_from INTEGER NOT NULL,
  valid_until INTEGER,
  min_order_pln INTEGER,
  client_id TEXT,
  service_ids TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_promos_tenant_valid ON promo_codes(tenant_id, valid_until, valid_from);

CREATE TABLE IF NOT EXISTS promo_code_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_code_id INTEGER NOT NULL,
  appointment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  UNIQUE(promo_code_id, appointment_id)
);

CREATE TABLE IF NOT EXISTS stamp_card_configs (
  tenant_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  visits_required INTEGER NOT NULL DEFAULT 5,
  reward_type TEXT NOT NULL DEFAULT 'free_service',
  reward_value INTEGER,
  service_ids TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stamp_card_progress (
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  visits_completed INTEGER NOT NULL DEFAULT 0,
  rewards_earned INTEGER NOT NULL DEFAULT 0,
  rewards_redeemed INTEGER NOT NULL DEFAULT 0,
  last_visit_at INTEGER,
  PRIMARY KEY (tenant_id, client_id)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  user_id TEXT,
  event TEXT NOT NULL,
  properties TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_tenant_event_time ON analytics_events(tenant_id, event, created_at);
-- migration 0055 — dedup `promo.returning_candidate` cron emits per
-- (tenant, client chat_id, day). Cron uses INSERT OR IGNORE so the unique
-- violation is silent. Partial index keeps other event types append-only.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_analytics_promo_returning
  ON analytics_events(tenant_id, user_id, event, date(created_at, 'unixepoch'))
  WHERE event = 'promo.returning_candidate';

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  salon_type TEXT,
  masters_count INTEGER,
  note TEXT,
  source TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  locale TEXT NOT NULL DEFAULT 'ru',
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  name TEXT,
  phone TEXT,
  source TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  lead_count INTEGER NOT NULL DEFAULT 1,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT,
  tags TEXT,
  custom_fields TEXT,
  consent_email INTEGER NOT NULL DEFAULT 1,
  consent_sms INTEGER NOT NULL DEFAULT 0,
  brevo_contact_id TEXT,
  unsubscribe_token TEXT,
  locale TEXT,
  lifecycle_stage TEXT,
  linked_user_chat_id INTEGER
);
-- Per-tenant unique (replaces the broken platform-wide UNIQUE that caused
-- cross-tenant email collisions). Partial — applies only to rows with a
-- real email; phone-first clients land with NULL email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_tenant_email
  ON marketing_contacts(tenant_id, email)
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_tenant_phone
  ON marketing_contacts(tenant_id, phone)
  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_phone ON marketing_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_last_seen ON marketing_contacts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_tenant ON marketing_contacts(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_unsub_tok
  ON marketing_contacts(unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_linked_user
  ON marketing_contacts(tenant_id, linked_user_chat_id);

CREATE TABLE IF NOT EXISTS marketing_segments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  filter_json TEXT NOT NULL,
  contact_count INTEGER NOT NULL DEFAULT 0,
  last_computed_at INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_segments_tenant ON marketing_segments(tenant_id);

CREATE TABLE IF NOT EXISTS marketing_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  variables_json TEXT,
  locale TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_tenant ON marketing_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mkt_templates_channel ON marketing_templates(channel);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  segment_id TEXT,
  template_id TEXT,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  stats_json TEXT,
  error TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_tenant ON marketing_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_mkt_campaigns_scheduled ON marketing_campaigns(scheduled_at);

CREATE TABLE IF NOT EXISTS marketing_sends (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
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
-- 0051: campaign progress page reads (campaign_id, status) together.
CREATE INDEX IF NOT EXISTS idx_msend_campaign_status ON marketing_sends(campaign_id, status);

CREATE TABLE IF NOT EXISTS marketing_automations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config_json TEXT,
  steps_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_automations_tenant ON marketing_automations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mkt_automations_enabled ON marketing_automations(enabled);

CREATE TABLE IF NOT EXISTS marketing_providers (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  config_json TEXT,
  health_status TEXT,
  health_detail TEXT,
  last_check_at INTEGER,
  quota_used INTEGER,
  quota_limit INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_consent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  source TEXT,
  ip TEXT,
  user_agent TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_consent_contact ON marketing_consent_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_mkt_consent_created ON marketing_consent_log(created_at);

CREATE TABLE IF NOT EXISTS industry_configs (
  industry TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  default_service_categories TEXT NOT NULL,
  default_features TEXT NOT NULL,
  ai_prompt_suffix TEXT,
  created_at INTEGER NOT NULL
);

-- ─── Phase 2: tenant_manager role ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_member_permissions (
  tenant_id   TEXT    NOT NULL,
  web_user_id TEXT    NOT NULL,
  permission  TEXT    NOT NULL,
  granted_at  INTEGER NOT NULL,
  granted_by  TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, web_user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_tmp_user ON tenant_member_permissions (web_user_id);
CREATE INDEX IF NOT EXISTS idx_tmp_tenant ON tenant_member_permissions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tmp_tenant_user ON tenant_member_permissions (tenant_id, web_user_id);

CREATE TABLE IF NOT EXISTS tenant_action_requests (
  id           TEXT    PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,
  requester_id TEXT    NOT NULL,
  action       TEXT    NOT NULL,
  payload      TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending',
  owner_note   TEXT,
  reviewed_by  TEXT,
  reviewed_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tar_tenant_status ON tenant_action_requests (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tar_requester ON tenant_action_requests (requester_id, created_at);

CREATE TABLE IF NOT EXISTS permission_elevation_codes (
  id             TEXT    PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  owner_user_id  TEXT    NOT NULL,
  target_user_id TEXT    NOT NULL,
  permissions    TEXT    NOT NULL,
  code_hash      TEXT    NOT NULL,
  expires_at     INTEGER NOT NULL,
  consumed_at    INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pec_owner ON permission_elevation_codes (owner_user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_pec_tenant ON permission_elevation_codes (tenant_id, expires_at);

-- ─── Plugin Marketplace (migration 0035) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS plugin_installations (
  id                          TEXT    PRIMARY KEY,
  tenant_id                   TEXT,
  plugin_slug                 TEXT    NOT NULL,
  enabled                     INTEGER NOT NULL DEFAULT 1,
  version                     TEXT    NOT NULL,
  installed_by                TEXT    NOT NULL,
  installed_at                INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  settings_json               TEXT,
  billing_state               TEXT    NOT NULL DEFAULT 'not_applicable',
  stripe_subscription_item_id TEXT,
  stripe_payment_intent_id    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_inst_scope_slug
  ON plugin_installations (COALESCE(tenant_id, '__platform__'), plugin_slug);
CREATE INDEX IF NOT EXISTS idx_plugin_inst_tenant  ON plugin_installations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_plugin_inst_slug    ON plugin_installations (plugin_slug);
CREATE INDEX IF NOT EXISTS idx_plugin_inst_billing ON plugin_installations (billing_state);

CREATE TABLE IF NOT EXISTS plugin_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id    TEXT    NOT NULL,
  event              TEXT    NOT NULL,
  actor_web_user_id  TEXT,
  detail_json        TEXT,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plugin_events_inst    ON plugin_events (installation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_events_created ON plugin_events (created_at);

-- Plugin pins (migration 0036, FK added in 0037) — per-user sidebar shortcuts.
-- ON DELETE CASCADE: deleting a web_user drops their pins automatically.
CREATE TABLE IF NOT EXISTS plugin_pins (
  web_user_id  TEXT    NOT NULL,
  tenant_id    TEXT    NOT NULL DEFAULT '',
  plugin_slug  TEXT    NOT NULL,
  pinned_at    INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (web_user_id, tenant_id, plugin_slug),
  FOREIGN KEY (web_user_id) REFERENCES web_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plugin_pins_user    ON plugin_pins (web_user_id, tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_plugin_pins_user_at ON plugin_pins (web_user_id, tenant_id, pinned_at);

-- Error log (migration 0039) — sink for client-side React error boundaries
-- and unhandled tRPC errors. See /api/error-report and trpc.ts errorFormatter.
CREATE TABLE IF NOT EXISTS error_log (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL,
  source       TEXT NOT NULL,
  message      TEXT NOT NULL,
  digest       TEXT,
  url          TEXT,
  user_agent   TEXT,
  user_id      TEXT,
  tenant_id    TEXT,
  detail_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_log_created_at ON error_log(created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_source     ON error_log(source, created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_user       ON error_log(user_id, created_at);

-- ─── Cookie consent audit trail (migration 0049) ─────────────────────────
-- APPEND-ONLY. Each banner decision (Accept All / Only Necessary / future
-- per-category) inserts a row. The application never UPDATEs or DELETEs.
-- See migrations/0049_cookie_consent_log.sql for full rationale.
CREATE TABLE IF NOT EXISTS cookie_consent_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  anonymous_id  TEXT NOT NULL,
  web_user_id   TEXT,
  categories    TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  source        TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_anon    ON cookie_consent_log(anonymous_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_user    ON cookie_consent_log(web_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_created ON cookie_consent_log(created_at);

-- ─── Error events (migrations 0056 + 0057) ───────────────────────────────
-- God Mode in-house error monitor. Worker `captureError()` writes here with
-- status-aware dedup on `fingerprint`; admin-app `/errors` page reads,
-- resolves, ignores, snoozes, and assigns rows.
--
-- Status lifecycle (0057): open / resolved / ignored / snoozed. A new fire
-- on a `resolved` issue flips status back to `open` (regression signal).
-- Ignored issues never auto-reopen; snoozed reopen once `snooze_until`
-- passes.
CREATE TABLE IF NOT EXISTS error_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint     TEXT NOT NULL,
  source          TEXT NOT NULL,
  severity        TEXT NOT NULL,
  message         TEXT NOT NULL,
  stack           TEXT,
  path            TEXT,
  tenant_id       TEXT,
  user_id         TEXT,
  context         TEXT,
  count           INTEGER NOT NULL DEFAULT 1,
  first_seen      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  resolved_at     INTEGER,
  created_at      INTEGER NOT NULL,
  -- 0057 additions ------------------------------------------------------
  status          TEXT NOT NULL DEFAULT 'open',
  snooze_until    INTEGER,
  assignee_id     TEXT,
  resolved_by     TEXT,
  tags_json       TEXT,
  environment     TEXT NOT NULL DEFAULT 'production',
  release         TEXT,
  error_type      TEXT,
  url             TEXT,
  method          TEXT,
  request_id      TEXT,
  sample_json     TEXT,
  users_affected  INTEGER NOT NULL DEFAULT 1,
  title           TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_events_severity_seen ON error_events(severity, last_seen);
CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint   ON error_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_events_tenant        ON error_events(tenant_id, last_seen);
CREATE INDEX IF NOT EXISTS idx_error_events_unresolved    ON error_events(resolved_at, last_seen);
CREATE INDEX IF NOT EXISTS idx_error_events_status_last   ON error_events(status, last_seen);
CREATE INDEX IF NOT EXISTS idx_error_events_assignee      ON error_events(assignee_id, status, last_seen);

-- ─── Marketing content plan (migration 0058) ─────────────────────────────
-- Scheduled posts for the @manicbot_com IG autopilot (and future
-- tenant-scoped autopilot when graduated into a plugin). Replaces the
-- markdown content_plan_30days.md, which had no machine-parseable status.
--
-- tenant_id is nullable on purpose: @manicbot_com posts as system_admin.
-- Status lifecycle: pending → generating → ready → publishing → posted
-- (or failed / paused at any step).
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
CREATE INDEX IF NOT EXISTS idx_mcp_status_sched ON marketing_content_plan(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_mcp_tenant_sched ON marketing_content_plan(tenant_id, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_unique_slot
  ON marketing_content_plan(IFNULL(tenant_id,''), scheduled_at);

-- ─── Marketing publish queue (migration 0059) ────────────────────────────
-- Outbox for the two-step IG Feed publish flow:
--   1) POST /{page_id}/media         → returns container_id
--   2) POST /{page_id}/media_publish → moves container live
-- Container processing on Meta side can take 5-30s; persist between
-- steps and let the next cron tick complete the publish.
CREATE TABLE IF NOT EXISTS marketing_publish_queue (
  id                 TEXT PRIMARY KEY,
  content_plan_id    TEXT NOT NULL,
  tenant_id          TEXT,
  channel_type       TEXT NOT NULL DEFAULT 'instagram',
  page_id            TEXT NOT NULL,
  meta_container_id  TEXT,
  meta_post_id       TEXT,
  status             TEXT NOT NULL DEFAULT 'queued',
  error_msg          TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mpq_status_attempt ON marketing_publish_queue(status, last_attempt_at);
CREATE INDEX IF NOT EXISTS idx_mpq_content_plan   ON marketing_publish_queue(content_plan_id);

-- ─── Appointment blocks (migration 0061) ─────────────────────────────────
-- Master-owned non-client occupancy: short reservations and time-off
-- bands. Backs the two FAB scenarios that previously showed СКОРО.
-- See migrations/0061_appointment_blocks.sql for the full rationale.
CREATE TABLE IF NOT EXISTS appointment_blocks (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  master_id     INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('reservation','time_off')),
  date          TEXT NOT NULL,
  time          TEXT NOT NULL,
  duration_min  INTEGER NOT NULL,
  end_date      TEXT,
  reason        TEXT,
  created_at    INTEGER NOT NULL,
  created_by    TEXT,
  cancelled     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_apt_blocks_master_date
  ON appointment_blocks(tenant_id, master_id, date)
  WHERE cancelled = 0;
CREATE INDEX IF NOT EXISTS idx_apt_blocks_tenant_date
  ON appointment_blocks(tenant_id, date)
  WHERE cancelled = 0;

-- ─── Referral Program (migration 0064) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS referral_codes (
  code              TEXT    PRIMARY KEY,
  owner_web_user_id TEXT    NOT NULL,
  owner_tenant_id   TEXT    NOT NULL,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  rotated_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_owner
  ON referral_codes (owner_web_user_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_codes_active_one
  ON referral_codes (owner_web_user_id) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS referrals (
  id                          TEXT    PRIMARY KEY,
  referrer_web_user_id        TEXT    NOT NULL,
  referrer_tenant_id          TEXT    NOT NULL,
  invitee_web_user_id         TEXT    NOT NULL,
  invitee_tenant_id           TEXT    NOT NULL,
  code                        TEXT    NOT NULL,
  status                      TEXT    NOT NULL,
  invitee_discount_kind       TEXT,
  invitee_discount_applied_at INTEGER,
  first_invoice_paid_at       INTEGER,
  reward_id                   TEXT,
  invitee_payment_method_fp   TEXT,
  fraud_flags                 TEXT,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ref_invitee_one_active
  ON referrals (invitee_web_user_id) WHERE status != 'invalidated';
CREATE INDEX IF NOT EXISTS idx_ref_referrer
  ON referrals (referrer_web_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ref_fingerprint
  ON referrals (invitee_payment_method_fp) WHERE invitee_payment_method_fp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ref_status
  ON referrals (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ref_code
  ON referrals (code);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id                          TEXT    PRIMARY KEY,
  referrer_web_user_id        TEXT    NOT NULL,
  referrer_tenant_id          TEXT    NOT NULL,
  referral_id                 TEXT,
  kind                        TEXT    NOT NULL,
  amount_grosz                INTEGER NOT NULL,
  stripe_customer_id          TEXT    NOT NULL,
  stripe_balance_transaction  TEXT,
  applied_at                  INTEGER,
  expires_at                  INTEGER NOT NULL,
  status                      TEXT    NOT NULL,
  created_at                  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rewards_referrer
  ON referral_rewards (referrer_web_user_id, status);
CREATE INDEX IF NOT EXISTS idx_rewards_expiry
  ON referral_rewards (status, expires_at);

CREATE TABLE IF NOT EXISTS referral_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_id TEXT,
  reward_id   TEXT,
  event       TEXT    NOT NULL,
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_events_referral
  ON referral_events (referral_id, created_at);
