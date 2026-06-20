-- 0125_marketing_sends_unique_contact.sql — 2026-06-20
--
-- HELD — race-safety hardening for the >INLINE_CAP campaign re-send fix.
-- DO NOT APPLY with the code-only PR; it is mirrored into schema.sql + the
-- Drizzle schema so `npm run check-schema` passes, and is documented as a
-- follow-up so it can ship on its own once reviewed.
--
-- The correctness fix is code-only: `resolveAudience` now excludes contacts
-- already recorded in `marketing_sends` for the campaign (correlated
-- NOT EXISTS), so each cron tick advances to the next un-sent batch instead of
-- re-sending the first 500 rows forever. That guard is a read-then-write,
-- which two concurrent cron ticks racing the SAME batch could both pass.
--
-- This UNIQUE index closes that residual race: with it, the per-contact
-- INSERT (Worker `INSERT OR IGNORE`, admin-app `.onConflictDoNothing()`)
-- becomes a no-op for the losing tick, so a contact can be claimed at most
-- once per campaign even under concurrency. Verified safe to add: production
-- `marketing_sends` has 0 rows and 0 duplicate (campaign_id, contact_id) pairs
-- as of 2026-06-20, so the index builds without conflict.

CREATE UNIQUE INDEX IF NOT EXISTS idx_mkt_sends_campaign_contact
  ON marketing_sends(campaign_id, contact_id);
