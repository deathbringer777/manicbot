-- 0107_stripe_ledger.sql — Mirror of Stripe balance_transactions into D1.
--
-- The system_admin Billing dashboard renders multi-month real revenue / net /
-- fees from this table (fast, historical) instead of paging Stripe live on
-- every load. balance_transactions is the authoritative money object: it
-- carries fee and net natively (invoices do not) and covers every movement
-- — charge, refund, dispute, payout, adjustment, stripe_fee.
--
-- Populated by the 15-min cron (syncStripeLedger, src/billing/ledgerSync.js):
--   * high-water cursor in platform_config under 'stripe_ledger_cursor'
--   * first run with no cursor = full historical backfill
--   * rows upserted by id -> idempotent across overlapping windows
--   * a Stripe error leaves the cursor untouched so the next tick retries
--
-- All money fields are Stripe minor units (PLN grosze). created/available_on
-- are unix seconds. Platform-level — the platform's own Stripe account, no
-- tenant scope; surfaced only in God Mode.

CREATE TABLE IF NOT EXISTS stripe_ledger (
  id TEXT PRIMARY KEY,
  type TEXT,
  reporting_category TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  fee INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  source TEXT,
  created INTEGER NOT NULL DEFAULT 0,
  available_on INTEGER,
  description TEXT,
  synced_at INTEGER NOT NULL DEFAULT 0
);

-- Revenue chart + net/fee aggregation scan by time window.
CREATE INDEX IF NOT EXISTS idx_stripe_ledger_created ON stripe_ledger(created);
-- Filtering a window by movement type (e.g. only 'charge' rows for gross).
CREATE INDEX IF NOT EXISTS idx_stripe_ledger_type_created ON stripe_ledger(type, created);
