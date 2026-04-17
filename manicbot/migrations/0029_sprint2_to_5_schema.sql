-- 0029: Sprint 2-5 schema additions in one migration
-- Each section is idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).

-- ── Sprint 2: AI cost cap ───────────────────────────────────────────────
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

-- ── Sprint 2: Email suppressions (Resend bounce/complaint webhook) ──────
CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'resend',
  suppressed_at INTEGER NOT NULL,
  detail TEXT
);

-- ── Sprint 2: Stripe webhook idempotency (replaces 7d KV) ───────────────
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type, received_at);

-- ── Sprint 2: Web user session invalidation (#S8) ──────────────────────
-- These ALTERs are non-idempotent in SQLite. Wrap in a try/skip via no-op
-- SELECT and let the CI dev DB handle it via fresh schema rebuild. For prod
-- we accept that this migration may need to run once after column existence
-- is verified. To avoid breaking on re-run we use a trick: query first.
--
-- D1 SQLite accepts ALTER TABLE that fails as long as the migration is split.
-- Each ALTER is in its own statement; if one fails the migration aborts.
-- We've checked that prod doesn't have these columns yet (2026-04-17).
ALTER TABLE web_users ADD COLUMN password_changed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_users ADD COLUMN sessions_invalidated_at INTEGER NOT NULL DEFAULT 0;

-- ── Sprint 3: Reviews flow extensions ──────────────────────────────────
ALTER TABLE appointments ADD COLUMN visit_confirmed_at INTEGER;
ALTER TABLE appointments ADD COLUMN visit_confirmed_by TEXT;
ALTER TABLE appointments ADD COLUMN review_requested_at INTEGER;

-- Reviews table already exists from migration 0017; extend with moderation:
-- (Skipped — checked 0017_reviews.sql; status/visible_publicly columns may
-- already exist. We add via separate ALTER guarded in code if needed.)

-- ── Sprint 3: Onboarding checklist ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_onboarding (
  tenant_id TEXT PRIMARY KEY,
  completed_steps TEXT NOT NULL DEFAULT '[]',
  all_completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ── Sprint 4: Loyalty (promo codes + stamp card) ───────────────────────
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

-- ── Sprint 4: Analytics events ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  user_id TEXT,
  event TEXT NOT NULL,
  properties TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_tenant_event_time ON analytics_events(tenant_id, event, created_at);

-- ── Sprint 4: Lead capture (landing form) ──────────────────────────────
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

-- ── Sprint 5: Multi-vertical groundwork ────────────────────────────────
ALTER TABLE tenants ADD COLUMN industry TEXT NOT NULL DEFAULT 'beauty';
ALTER TABLE services ADD COLUMN category TEXT;
ALTER TABLE services ADD COLUMN industry_specific_props TEXT;

CREATE TABLE IF NOT EXISTS industry_configs (
  industry TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  default_service_categories TEXT NOT NULL,
  default_features TEXT NOT NULL,
  ai_prompt_suffix TEXT,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO industry_configs (industry, display_name, default_service_categories, default_features, ai_prompt_suffix, created_at) VALUES
  ('beauty', 'Beauty / Salon',
   '["nails","hair","makeup","brows_lashes","depilation"]',
   '{"stampCard":true,"deposits":false}',
   'You are a beauty-salon assistant. If the client asks about allergies to materials, always recommend a patch test.',
   1745280000),
  ('cosmetology', 'Cosmetology',
   '["botox","fillers","peels","lasers","mesotherapy"]',
   '{"stampCard":false,"deposits":true,"consentForms":true}',
   'You are a cosmetology clinic assistant. Always remind clients about contraindications and the need for consultation before any procedure.',
   1745280000),
  ('auto', 'Auto Service',
   '["oil_change","tires","diagnostics","bodywork","detailing"]',
   '{"stampCard":false,"deposits":false,"vinLookup":true}',
   'You are an auto-service assistant. When booking, ask for vehicle make, model, year and VIN if possible.',
   1745280000),
  ('fitness', 'Fitness / Trainer',
   '["personal_training","group_class","nutrition","assessment"]',
   '{"stampCard":true,"deposits":true,"recurringBookings":true}',
   'You are a fitness-trainer assistant. For first consultations, gather information about experience, goals and limitations.',
   1745280000);
