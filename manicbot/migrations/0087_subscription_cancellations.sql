-- Cancellation retention flow — churn reason collection + offer acceptance audit.
--
-- Every time a salon owner attempts to cancel their subscription, we write
-- exactly one row to this table — whether they accepted the counter-offer
-- (retention_offer_accepted=1, no Stripe cancel) or went through with the
-- cancel (retention_offer_accepted=0, Stripe cancel_at_period_end=true).
--
-- The row exists in BOTH cases so we can:
--   1. Measure offer acceptance rate (% of attempts that took the discount).
--   2. Aggregate churn reasons (which problem clusters drive cancels).
--   3. Enforce a one-offer-per-tenant-per-12-months cooldown (so the discount
--      isn't abused by serial threat-to-cancel users).
--
-- `reason_tags` is a JSON array of enum slugs validated at the tRPC boundary:
--   too_expensive | no_clients | confusing_ui | bad_support |
--   switched_competitor | temporary_break | other
--
-- `photo_url` is optional (e.g. screenshot of confusing UI); validated against
-- the R2 hostname on write.
--
-- Tenant-scoped: every read/write filters by tenant_id. The FK to tenants
-- propagates the deletion through CASCADE so deactivated salons clean up.

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
