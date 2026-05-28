-- Migration 0092 — Newsletter double-opt-in (confirm_token).
--
-- Migration 0090 (`0090_newsletter_unsubscribe_token.sql`) already added
-- the `unsubscribe_token` column, the partial-UNIQUE index on it, and
-- backfilled tokens for legacy rows so the one-click unsubscribe link in
-- the welcome email lands on a real handler.
--
-- This migration layers the CONFIRM side of double-opt-in on top of that:
-- a subscriber confirms their email via a single-use CSPRNG token before
-- being added to the broadcast audience. The token has a 7-day TTL after
-- which the row is treated as an unconfirmed re-subscribe candidate.
--
--   * `confirm_token`             — single-use CSPRNG token emailed to
--                                   the subscriber on first POST; clicking
--                                   the link in the confirm email stamps
--                                   `confirmed_at` and triggers the real
--                                   welcome email (which carries the
--                                   `unsubscribe_token` from 0090).
--   * `confirm_token_expires_at`  — UNIX seconds. 7-day TTL; expired
--                                   tokens are rejected with a
--                                   "please re-subscribe" landing page.
--
-- The partial-UNIQUE index on `confirm_token` mirrors 0090's pattern —
-- `WHERE confirm_token IS NOT NULL` so multiple NULLs (confirmed or
-- expired rows) never collide.
--
-- No backfill: legacy single-opt-in rows from migration 0086 are treated
-- as already-confirmed (their `confirmed_at` is set by the pre-DOI
-- subscribe handler) and never go through the new confirm flow.

ALTER TABLE newsletter_subscribers ADD COLUMN confirm_token TEXT;
ALTER TABLE newsletter_subscribers ADD COLUMN confirm_token_expires_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_confirm_token
  ON newsletter_subscribers(confirm_token)
  WHERE confirm_token IS NOT NULL;
