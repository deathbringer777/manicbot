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
  -- 0072: client avatar (emoji + photo). UI shows photo when avatar_url
  -- is set, otherwise the saved emoji, otherwise a default '👩'.
  avatar_emoji TEXT,
  avatar_url TEXT,
  avatar_r2_key TEXT,
  -- 0074: manual pin for "favorite master". NULL falls back to the
  -- derived favorite computed from appointments history.
  favorite_master_id INTEGER,
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
CREATE INDEX IF NOT EXISTS idx_users_tenant_favorite_master ON users(tenant_id, favorite_master_id);

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
  -- 0062: account-origin model + soft-delete via archived_at.
  origin TEXT NOT NULL DEFAULT 'salon_created',
  archived_at INTEGER,
  -- 0074: real Telegram chat_id for masters whose primary `chat_id` is a
  -- synthetic 10B+ identity. Bot's isMaster()/getMaster() match either column.
  telegram_chat_id INTEGER,
  -- 0075: master avatar (emoji + photo). Mirrors the 0072 client avatar
  -- pattern. Photo wins when avatar_url is set; else avatar_emoji; else '💅'.
  avatar_emoji TEXT,
  avatar_url TEXT,
  avatar_r2_key TEXT,
  PRIMARY KEY (tenant_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_master_web_user_id ON masters(web_user_id);
CREATE INDEX IF NOT EXISTS idx_master_tenant_web_user ON masters(tenant_id, web_user_id);
CREATE INDEX IF NOT EXISTS idx_masters_vacation_until ON masters(vacation_until) WHERE vacation_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_masters_calendar_visibility ON masters(tenant_id, calendar_visibility);
CREATE INDEX IF NOT EXISTS idx_masters_active ON masters(tenant_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_masters_tenant_origin ON masters(tenant_id, origin);
CREATE UNIQUE INDEX IF NOT EXISTS idx_masters_tenant_tg_chat
  ON masters(tenant_id, telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS service_categories (
  tenant_id  TEXT NOT NULL,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_cat_tenant_name
  ON service_categories(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_svc_cat_tenant_order
  ON service_categories(tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS tenant_config (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key)
);

-- Platform-level key/value config (migration 0083). One row per setting,
-- no tenant scope. Currently powers the /about page (editable from God
-- Mode); future uses include marketing banners + feature-flag defaults.
CREATE TABLE IF NOT EXISTS platform_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_config_updated
  ON platform_config(updated_at DESC);

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
  chat_enabled INTEGER NOT NULL DEFAULT 1,
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
  -- 0065: reversibly-encrypted plaintext password for salon-owned master
  -- accounts (origin='salon_created' on the linked masters row). AES-GCM
  -- ciphertext (BOT_ENCRYPTION_KEY + HKDF label 'master-password-v1').
  -- NULL for accounts the master owns themselves.
  password_encrypted TEXT,
  -- 0077: per-user notification preferences (JSON blob). NULL = defaults.
  -- See lib/notifications/prefs.ts for shape + writer integration.
  notification_prefs TEXT,
  -- 0082: bridge from web identity to real Telegram chat_id. Populated
  -- when the owner consumes a pairing code via `/start own_<token>`.
  -- See `owner_pairing_codes` below + `src/services/ownerPairing.js`.
  telegram_chat_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_user_email ON web_users(email);
CREATE INDEX IF NOT EXISTS idx_web_user_tenant ON web_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_web_users_login_token ON web_users(login_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_users_tg_chat
  ON web_users(telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

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

-- Ownership-transfer tokens (single-use, 24h TTL). See migration 0062.
CREATE TABLE IF NOT EXISTS ownership_transfer_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_ott_tenant_created ON ownership_transfer_tokens(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ott_token_hash ON ownership_transfer_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_ott_user ON ownership_transfer_tokens(from_user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ott_one_pending
  ON ownership_transfer_tokens(tenant_id)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

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
  -- 0072: 'filter' (existing — evaluates filter_json) or 'manual' (members
  -- live in marketing_segment_members). Brevo-style explicit lists.
  kind TEXT NOT NULL DEFAULT 'filter',
  contact_count INTEGER NOT NULL DEFAULT 0,
  last_computed_at INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_segments_tenant ON marketing_segments(tenant_id);

-- 0072: explicit list membership for kind='manual' segments.
CREATE TABLE IF NOT EXISTS marketing_segment_members (
  segment_id TEXT NOT NULL,
  contact_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  added_by TEXT,
  PRIMARY KEY (segment_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_msm_segment ON marketing_segment_members(segment_id);
CREATE INDEX IF NOT EXISTS idx_msm_contact ON marketing_segment_members(contact_id);

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
  bounced_at INTEGER,
  -- 0075: spam complaint timestamp (Resend email.complained, Brevo spam).
  complained_at INTEGER
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

-- ─── Master invitations (migration 0064) ─────────────────────────────────
-- Pending invitations sent by salon owners to add a master by email.
-- See migrations/0064_master_invitations.sql for the rationale.
CREATE TABLE IF NOT EXISTS master_invitations (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  email              TEXT NOT NULL,
  inviter_user_id    TEXT NOT NULL,
  invited_name       TEXT,
  token_hash         TEXT NOT NULL,
  token_expires_at   INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  scenario           TEXT NOT NULL,
  accepted_at        INTEGER,
  accepted_master_id INTEGER,
  revoked_at         INTEGER,
  created_at         INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_invitations_unique_pending
  ON master_invitations(tenant_id, email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_master_invitations_token
  ON master_invitations(token_hash) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_master_invitations_tenant_status
  ON master_invitations(tenant_id, status, created_at);

-- ─── Global OTP codes (migration 0065) ───────────────────────────────────
-- Generic OTP store for destructive / role-escalation mutations.
-- See migrations/0065_global_otp_codes.sql for the full design.
CREATE TABLE IF NOT EXISTS global_otp_codes (
  id            TEXT PRIMARY KEY,
  web_user_id   TEXT NOT NULL,
  action        TEXT NOT NULL,
  payload_hash  TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_global_otp_user_action
  ON global_otp_codes(web_user_id, action, expires_at);

-- ─── Internal messenger (migration 0067) ─────────────────────────────────
-- Unified inbox: staff DMs + groups + mirrored client channel conversations.
-- See migrations/0067_messenger.sql for the design and join-to-conversations.
CREATE TABLE IF NOT EXISTS threads (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  kind                     TEXT NOT NULL,
  title                    TEXT,
  client_conversation_id   TEXT,
  dm_key                   TEXT,
  created_by_web_user_id   TEXT,
  created_at               INTEGER NOT NULL,
  last_message_at          INTEGER,
  last_message_preview     TEXT,
  archived                 INTEGER NOT NULL DEFAULT 0,
  -- migration 0093: marks the auto-seeded "Команда" group per tenant.
  is_default_group         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_threads_tenant_last
  ON threads(tenant_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_threads_tenant_kind_archived
  ON threads(tenant_id, kind, archived, last_message_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_dm_unique
  ON threads(tenant_id, dm_key) WHERE kind = 'staff_dm';
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_client_conv_unique
  ON threads(tenant_id, client_conversation_id)
  WHERE client_conversation_id IS NOT NULL;
-- migration 0093: exactly one "Команда" group per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_default_group_per_tenant
  ON threads(tenant_id) WHERE is_default_group = 1;

CREATE TABLE IF NOT EXISTS thread_members (
  thread_id              TEXT NOT NULL,
  member_kind            TEXT NOT NULL,
  member_ref             TEXT NOT NULL,
  role                   TEXT NOT NULL DEFAULT 'member',
  joined_at              INTEGER NOT NULL,
  muted_until            INTEGER,
  last_read_message_id   TEXT,
  last_read_at           INTEGER,
  PRIMARY KEY (thread_id, member_kind, member_ref)
);
CREATE INDEX IF NOT EXISTS idx_thread_members_ref
  ON thread_members(member_kind, member_ref, last_read_at);

CREATE TABLE IF NOT EXISTS thread_messages (
  id                     TEXT PRIMARY KEY,
  thread_id              TEXT NOT NULL,
  tenant_id              TEXT NOT NULL,
  sender_kind            TEXT NOT NULL,
  sender_ref             TEXT NOT NULL,
  body                   TEXT NOT NULL,
  attachments_json       TEXT,
  is_internal_note       INTEGER NOT NULL DEFAULT 0,
  external_msg_id        TEXT,
  reply_to_message_id    TEXT,
  created_at             INTEGER NOT NULL,
  edited_at              INTEGER,
  deleted_at             INTEGER,
  -- migration 0094: booking-request cards reference a domain object + snapshot.
  ref_kind               TEXT,
  ref_id                 TEXT,
  meta_json              TEXT
);
CREATE INDEX IF NOT EXISTS idx_thread_messages_thread
  ON thread_messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_thread_messages_tenant_created
  ON thread_messages(tenant_id, created_at);
-- migration 0094: look up the card(s) for a given appointment.
CREATE INDEX IF NOT EXISTS idx_thread_messages_ref
  ON thread_messages(tenant_id, ref_kind, ref_id);
-- migration 0094: at most one "Заявки" requests thread per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_requests_per_tenant
  ON threads(tenant_id) WHERE kind = 'requests';

-- ─── Referral Program (migration 0069) ──────────────────────────────────

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

-- ─── Reminders plugin (migration 0070) ───────────────────────────────────
-- One row per reminder/routine definition. Recurrence is stored as JSON;
-- validation lives at the tRPC boundary. starts_on + time are the anchor.
CREATE TABLE IF NOT EXISTS plugin_reminders (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  created_by_web_user_id   TEXT NOT NULL,
  target_master_id         INTEGER,
  kind                     TEXT NOT NULL DEFAULT 'reminder'
                           CHECK (kind IN ('reminder','routine')),
  title                    TEXT NOT NULL,
  note                     TEXT,
  starts_on                TEXT NOT NULL,
  time                     TEXT NOT NULL,
  recurrence_json          TEXT NOT NULL,
  channels_json            TEXT NOT NULL DEFAULT '["inapp"]',
  archived_at              INTEGER,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_reminders_tenant_active
  ON plugin_reminders(tenant_id, starts_on) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reminders_target
  ON plugin_reminders(tenant_id, target_master_id, starts_on) WHERE archived_at IS NULL;

-- Idempotency claim + fire log. The (reminder_id, fires_at_epoch) UNIQUE
-- index IS the contract — INSERT OR IGNORE in the cron loop returns
-- changes=0 on duplicate, which is how the second cron tick at the same
-- minute knows not to re-fire.
CREATE TABLE IF NOT EXISTS plugin_reminder_fires (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id     TEXT NOT NULL REFERENCES plugin_reminders(id) ON DELETE CASCADE,
  fires_at_epoch  INTEGER NOT NULL,
  fired_at_epoch  INTEGER,
  delivery_state  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (delivery_state IN ('pending','sent','failed')),
  delivery_error  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_fires_occurrence
  ON plugin_reminder_fires(reminder_id, fires_at_epoch);

-- ─── User notifications (migration 0070) ─────────────────────────────────
-- Platform-wide in-app feed consumed by the header bell. Generic by design
-- — reminders is the first writer but any future feature (checklists,
-- billing alerts) shares the same surface. The partial UNIQUE on
-- (web_user_id, source_slug, source_id, kind) dedups bell entries on
-- repeated cron-handler invocations.
CREATE TABLE IF NOT EXISTS user_notifications (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT,
  web_user_id   TEXT NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  link          TEXT,
  source_slug   TEXT,
  source_id     TEXT,
  read_at       INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON user_notifications(web_user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifications_recent
  ON user_notifications(web_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notifications_source
  ON user_notifications(web_user_id, source_slug, source_id, kind)
  WHERE source_slug IS NOT NULL AND source_id IS NOT NULL;

-- Web Push (browser push notifications) — migration 0073. Companion to
-- user_notifications; one row per (web_user_id, endpoint) browser pair.
-- Worker fan-out reads p256dh + auth and encrypts the payload per RFC 8291.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            TEXT PRIMARY KEY,
  web_user_id   TEXT NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
  tenant_id     TEXT,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at  INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_sub_user_endpoint
  ON push_subscriptions(web_user_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_push_sub_user
  ON push_subscriptions(web_user_id);

-- ─── Master Telegram pairing codes (migration 0074) ──────────────────────
-- Single-use, 7-day-TTL deep-link tokens that bind a salon-employed
-- master's `masters.telegram_chat_id` to their real Telegram account.
-- Redeemed via `/start mst_<raw_token>` on the salon's TG bot. Tokens are
-- stored as SHA-256 hex of the raw value — raw token leaves the server
-- exactly once in the deep-link URL response.
CREATE TABLE IF NOT EXISTS master_pairing_codes (
  token_hash             TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  master_chat_id         INTEGER NOT NULL,
  created_by_web_user_id TEXT,
  created_at             INTEGER NOT NULL,
  expires_at             INTEGER NOT NULL,
  consumed_at            INTEGER,
  consumed_chat_id       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mpc_tenant_master
  ON master_pairing_codes(tenant_id, master_chat_id);
CREATE INDEX IF NOT EXISTS idx_mpc_unconsumed_exp
  ON master_pairing_codes(expires_at) WHERE consumed_at IS NULL;

-- ─── Owner Telegram pairing (migration 0082) ────────────────────────────
-- Symmetric to master_pairing_codes (0074) but for the tenant_owner role.
-- Single-use, 7-day-TTL deep-link tokens minted by the owner from the
-- admin-app; redeemed via `/start own_<raw_token>` on the salon's TG
-- bot. On consume the Worker sets `web_users.telegram_chat_id` AND
-- inserts a `tenant_roles(tenant_id, chat_id, role='tenant_owner')`
-- row so the existing `resolveRole` lookup resolves the owner without
-- any change to the role-resolution path.
CREATE TABLE IF NOT EXISTS owner_pairing_codes (
  token_hash       TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  web_user_id      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  consumed_at      INTEGER,
  consumed_chat_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_opc_tenant_user
  ON owner_pairing_codes(tenant_id, web_user_id);
CREATE INDEX IF NOT EXISTS idx_opc_unconsumed_exp
  ON owner_pairing_codes(expires_at) WHERE consumed_at IS NULL;

-- ─── Platform messenger (migration 0076) ────────────────────────────────
-- Cross-tenant DM channel: ManicBot (any system_admin) ↔ one web_user
-- (typically tenant_owner). Intentionally NOT a row in `threads` — that
-- family is tenant-scoped (tenant_id NOT NULL) and reusing it would
-- weaken tenant-isolation. `platform_broadcasts` records each broadcast
-- once; emitted messages carry `broadcast_id` for aggregation.
CREATE TABLE IF NOT EXISTS platform_threads (
  id                       TEXT PRIMARY KEY,
  recipient_web_user_id    TEXT NOT NULL,
  recipient_tenant_id      TEXT,
  last_message_at          INTEGER,
  last_message_preview     TEXT,
  last_sender_kind         TEXT,
  recipient_last_read_at   INTEGER,
  platform_last_read_at    INTEGER,
  archived                 INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_threads_recipient
  ON platform_threads(recipient_web_user_id);
CREATE INDEX IF NOT EXISTS idx_platform_threads_last
  ON platform_threads(last_message_at);
CREATE INDEX IF NOT EXISTS idx_platform_threads_archived
  ON platform_threads(archived, last_message_at);

CREATE TABLE IF NOT EXISTS platform_thread_messages (
  id                       TEXT PRIMARY KEY,
  thread_id                TEXT NOT NULL,
  sender_kind              TEXT NOT NULL,
  sender_web_user_id       TEXT NOT NULL,
  body                     TEXT NOT NULL,
  attachments_json         TEXT,
  broadcast_id             TEXT,
  created_at               INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES platform_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ptm_thread_id
  ON platform_thread_messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_ptm_thread_created
  ON platform_thread_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ptm_broadcast
  ON platform_thread_messages(broadcast_id) WHERE broadcast_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform_broadcasts (
  id                       TEXT PRIMARY KEY,
  sender_web_user_id       TEXT NOT NULL,
  title                    TEXT,
  body                     TEXT NOT NULL,
  audience_filter_json     TEXT NOT NULL,
  recipients_count         INTEGER NOT NULL,
  created_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_broadcasts_created
  ON platform_broadcasts(created_at);

-- 0083: blog_posts — self-hosted marketing blog CMS (system_admin only).
-- See migrations/0083_blog_posts.sql for column rationale.
CREATE TABLE IF NOT EXISTS blog_posts (
  id                       TEXT PRIMARY KEY,
  slug                     TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'draft',
  category                 TEXT NOT NULL DEFAULT 'tips',
  cover_url                TEXT,
  cover_alt_json           TEXT,
  cover_credit             TEXT,
  titles_json              TEXT NOT NULL DEFAULT '{}',
  excerpts_json            TEXT NOT NULL DEFAULT '{}',
  bodies_json              TEXT NOT NULL DEFAULT '{}',
  keywords_json            TEXT,
  related_slugs_json       TEXT,
  published_date           TEXT,
  updated_date             TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  published_at             INTEGER,
  archived_at              INTEGER,
  created_by_web_user_id   TEXT,
  updated_by_web_user_id   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_slug
  ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_pubdate
  ON blog_posts(status, published_date DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_created
  ON blog_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category_status
  ON blog_posts(category, status);

-- Migration 0085 — Google prefill token replay protection (single-use jti).
CREATE TABLE IF NOT EXISTS google_prefill_consumed (
  jti          TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  consumed_at  INTEGER NOT NULL,
  exp          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gpc_exp ON google_prefill_consumed(exp);

-- Migration 0086 — newsletter subscribers (landing form ingest).
-- Migration 0090 — one-click unsubscribe token (`unsubscribe_token`).
-- Migration 0092 — double-opt-in: confirm_token + confirm_token_expires_at.
-- See migrations/0086_newsletter_subscribers.sql, 0090_newsletter_unsubscribe_token.sql,
-- and 0092_newsletter_doi.sql for the full rationale.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  email                    TEXT NOT NULL,
  source                   TEXT NOT NULL DEFAULT 'landing',
  lang                     TEXT,
  anonymous_id             TEXT,
  ip                       TEXT,
  user_agent               TEXT,
  created_at               INTEGER NOT NULL,
  confirmed_at             INTEGER,
  unsubscribed_at          INTEGER,
  welcome_sent_at          INTEGER,
  welcome_send_error       TEXT,
  -- 0092: single-use CSPRNG confirm token + 7-day TTL (UNIX seconds).
  confirm_token            TEXT,
  confirm_token_expires_at INTEGER,
  -- 0090: 32-hex one-click unsub token. Stable across resub, partial UNIQUE.
  unsubscribe_token        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_email
  ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_created
  ON newsletter_subscribers(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_confirm_token
  ON newsletter_subscribers(confirm_token)
  WHERE confirm_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_unsub_tok
  ON newsletter_subscribers(unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;

-- Migration 0087 — Cancellation retention flow audit trail.
-- One row per cancel attempt: collects churn reason, optional photo, and
-- whether the counter-offer was shown / accepted. Drives offer-acceptance
-- metrics + 12-month cooldown enforcement.
CREATE TABLE IF NOT EXISTS subscription_cancellations (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                   TEXT NOT NULL,
  web_user_id                 TEXT NOT NULL,
  plan_at_cancel              TEXT,
  interval_at_cancel          TEXT,
  reason_tags                 TEXT NOT NULL DEFAULT '[]',
  free_text                   TEXT,
  photo_url                   TEXT,
  retention_offer_shown       INTEGER NOT NULL DEFAULT 0,
  retention_offer_accepted    INTEGER NOT NULL DEFAULT 0,
  retention_coupon_code       TEXT,
  created_at                  INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_tenant
  ON subscription_cancellations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_created
  ON subscription_cancellations(created_at DESC);

-- ─── D1 BACKUP LOG (Migration 0088) ─────────────────────────────────────────
-- Audit trail of D1 → R2 backup runs. Written by `src/services/d1Backup.js`
-- `runBackup()` once per 6h cron tick (orchestrated from `worker.scheduled`).
-- Used by `maybeRunD1Backup` to decide whether the 6h idempotency window
-- has elapsed and by `scripts/restore-d1.mjs --list` to enumerate snapshots.
CREATE TABLE IF NOT EXISTS d1_backup_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER NOT NULL,
  bucket_key      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  table_count     INTEGER NOT NULL,
  row_count       INTEGER NOT NULL,
  byte_size       INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_d1_backup_log_finished
  ON d1_backup_log(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_d1_backup_log_kind_status
  ON d1_backup_log(kind, status, finished_at DESC);

-- ─── WEBHOOK DEDUP (Migration 0089) ─────────────────────────────────────────
-- Atomic claim store replacing the KV GET-then-PUT race in
-- `src/utils/dedup.js`. `INSERT INTO webhook_dedup ... ON CONFLICT(key) DO
-- NOTHING` is a single SQLite statement — exactly one claim wins under
-- truly concurrent calls. Pruned by `pruneExpiredDedupRows()` from
-- worker.scheduled.
CREATE TABLE IF NOT EXISTS webhook_dedup (
  key         TEXT PRIMARY KEY,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_dedup_expires
  ON webhook_dedup(expires_at);
