-- P1-1 (relax.md §1) — dedup the `promo.returning_candidate` events that
-- `cron.js` emits every 15 min. The old code inserted unconditionally; with
-- a 30-day returning-client window every eligible client racked up ~2880
-- duplicate rows per month per tenant.
--
-- Fix: partial UNIQUE index on (tenant_id, user_id, event, calendar_day).
-- The `cron.js` writer now uses INSERT OR IGNORE and supplies user_id
-- (chat_id). The index is partial so it only applies to the cron-emitted
-- candidate rows — other event types (promo.redeemed, promo.birthday_issued,
-- post_visit.prompt_sent, …) keep their existing append-only behaviour.
--
-- date(created_at, 'unixepoch') is a SQLite expression — supported in
-- UNIQUE indexes since 3.9 (D1 runs 3.40+).

CREATE UNIQUE INDEX IF NOT EXISTS uniq_analytics_promo_returning
  ON analytics_events(tenant_id, user_id, event, date(created_at, 'unixepoch'))
  WHERE event = 'promo.returning_candidate';
