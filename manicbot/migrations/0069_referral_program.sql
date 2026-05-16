-- 0069_referral_program.sql — Referral program tables (PR-B).
-- (Originally 0064 — renumbered to 0069 after merging main's 0064–0067.)
--
-- Four tables form the referral graph + reward lifecycle:
--   1. referral_codes  — one active shareable code per eligible web_user
--   2. referrals       — graph rows linking inviter ↔ invitee + reward state
--   3. referral_rewards — issued PLN credits posted to Stripe customer_balance
--   4. referral_events  — append-only audit
--
-- Eligibility (enforced in tRPC, not SQL) limits code generation to
-- self-registered accounts: tenant_owner OR personal-tenant master. Salon
-- staff (tenant_manager, salon-invited masters) cannot generate codes.

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
-- Partial unique: exactly one active code per owner. Rotating archives the
-- old row (is_active=0) and inserts a fresh active one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_codes_active_one
  ON referral_codes (owner_web_user_id) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS referrals (
  id                          TEXT    PRIMARY KEY,
  referrer_web_user_id        TEXT    NOT NULL,
  referrer_tenant_id          TEXT    NOT NULL,
  invitee_web_user_id         TEXT    NOT NULL,
  invitee_tenant_id           TEXT    NOT NULL,
  code                        TEXT    NOT NULL,
  status                      TEXT    NOT NULL,            -- pending | first_paid | rewarded | invalidated | clawback
  invitee_discount_kind       TEXT,                        -- "20pct_monthly" | "10pct_yearly"
  invitee_discount_applied_at INTEGER,
  first_invoice_paid_at       INTEGER,
  reward_id                   TEXT,                        -- FK referral_rewards.id
  invitee_payment_method_fp   TEXT,                        -- Stripe payment_method.card.fingerprint
  fraud_flags                 TEXT,                        -- JSON array if invalidated
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);
-- One active referral per invitee — they can't be invited again via a
-- different code once a row exists. Invalidated rows release the slot.
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
  referral_id                 TEXT,                        -- nullable for future bonus rewards
  kind                        TEXT    NOT NULL,            -- "free_month"
  amount_grosz                INTEGER NOT NULL,            -- PLN grosz (4500/6000/9000 for start/pro/max)
  stripe_customer_id          TEXT    NOT NULL,
  stripe_balance_transaction  TEXT,                        -- Stripe CustomerBalanceTransaction id
  applied_at                  INTEGER,
  expires_at                  INTEGER NOT NULL,            -- 12 months from issuance
  status                      TEXT    NOT NULL,            -- pending | applied | voided | expired | clawed_back
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
