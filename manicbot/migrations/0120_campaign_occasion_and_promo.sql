-- 0120_campaign_occasion_and_promo.sql — 2026-06-12
--
-- System & Seasonal Messaging service, part 3/3.
--
-- (a) Link a platform_campaign to a holiday occasion + a template key so the
--     content-plan builder can create one draft campaign per (occasion, year)
--     and the reactive engine can resolve its per-locale body from a keyed
--     template. Both additive + nullable — legacy announcements are unaffected.
--
-- (b) subscription_promo_codes — owner-facing SUBSCRIPTION discount codes for
--     seasonal offers. This is DISTINCT from the existing tenant-level
--     `promo_codes` (migration 0029), which is a salon→client loyalty discount
--     (the "kurze łapki" mechanic). Here the audience is the salon OWNER and the
--     discount is on THEIR ManicBot subscription, minted as a Stripe coupon +
--     promotion_code (src/billing/promoCodes.js, reusing ensureCoupon) and
--     redeemable at checkout (allow_promotion_codes is already true). Persisted
--     so a seasonal template can render {promoCode}/{expiresAt} and so we never
--     re-mint the same campaign's code.
--
--     livemode records whether the Stripe objects are test or live — the service
--     mints TEST-mode codes until the operator flips to go-live. UNIQUE(code)
--     mirrors Stripe's promotion-code uniqueness.

ALTER TABLE platform_campaigns ADD COLUMN occasion_key TEXT;
ALTER TABLE platform_campaigns ADD COLUMN template_key TEXT;

CREATE INDEX IF NOT EXISTS idx_platform_campaigns_occasion
  ON platform_campaigns(occasion_key);

CREATE TABLE IF NOT EXISTS subscription_promo_codes (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL,              -- customer-facing promotion code, e.g. 'WIOSNA20'
  coupon_code       TEXT NOT NULL,              -- underlying Stripe coupon id
  campaign_id       TEXT,                       -- optional platform_campaigns(id) link
  percent_off       INTEGER NOT NULL,
  duration          TEXT NOT NULL DEFAULT 'once', -- 'once' | 'repeating' | 'forever'
  duration_months   INTEGER,                    -- when duration='repeating'
  expires_at        INTEGER,                    -- unix seconds; Stripe promo expires_at
  max_redemptions   INTEGER,
  stripe_promo_id   TEXT,                       -- Stripe promotion_code id (promo_...)
  livemode          INTEGER NOT NULL DEFAULT 0, -- 0 = test-mode Stripe, 1 = live
  created_by        TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE(code)
);

CREATE INDEX IF NOT EXISTS idx_sub_promo_campaign
  ON subscription_promo_codes(campaign_id);
