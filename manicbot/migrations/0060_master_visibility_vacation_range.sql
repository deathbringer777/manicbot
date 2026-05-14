-- 0060_master_visibility_vacation_range.sql — 2026-05-14
--
-- Booksy-style master visibility + vacation date range.
--
-- 1) `public_hidden` (0|1, default 0)
--    Per-master "hide on the public salon page" toggle owned by the
--    `tenant_owner`. Sits next to `active`: an `active=1, public_hidden=1`
--    master still works for the salon internally (assigned to bookings,
--    sees their schedule) but is filtered out of the public directory
--    profile, search cards, and salon page master list. `active=0` already
--    means "removed entirely"; the new flag is a softer hide for staff
--    who are temporarily off the roster (long leave, parental, hiring
--    pipeline) without losing assignment history.
--
-- 2) `vacation_from` / `vacation_until` (UNIX seconds, nullable)
--    Replaces the binary `on_vacation` toggle with an open-ended date
--    range. `on_vacation` is kept as a compat shim — anyone reading it
--    today should treat the master as on vacation if EITHER:
--      * the legacy boolean is set, OR
--      * NOW() falls inside [vacation_from, vacation_until]
--    Booking & notification paths in the Worker (booking.js,
--    notifications.js, callback.js) currently key off `onVacation` only;
--    we keep the column populated by the master.setVacation mutation
--    until the booking flow learns to read the range. That keeps the
--    rollout safe even though it duplicates a tiny bit of state.
--
-- Backfill: existing `on_vacation=1` rows have no end date — they stay
-- vacationing until the master clears the flag explicitly. Nothing to
-- write here.

ALTER TABLE masters ADD COLUMN public_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE masters ADD COLUMN vacation_from INTEGER;
ALTER TABLE masters ADD COLUMN vacation_until INTEGER;

-- Index so the cron "auto-clear expired vacations" sweep (added in the
-- master.setVacation handler) and the public profile query can both
-- range-scan instead of full-scanning the masters table.
CREATE INDEX IF NOT EXISTS idx_masters_vacation_until ON masters(vacation_until)
  WHERE vacation_until IS NOT NULL;
