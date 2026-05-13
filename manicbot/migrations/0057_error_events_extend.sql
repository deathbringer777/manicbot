-- Migration 0057 — extend error_events with status lifecycle, regression
-- detection, ignore/snooze, ownership, environment/release tagging, richer
-- request context, and bounded recent sample.
--
-- Why: 0056 shipped a thin tracker (resolved_at-only). Ops needs:
--   • Status lifecycle: open / resolved / ignored / snoozed. A NEW fire on
--     a `resolved` issue flips status back to `open` — that's the
--     regression signal the dashboard surfaces.
--   • snooze_until: mute noisy issues for N hours/days without losing
--     them forever (ignored = mute forever).
--   • assignee_id: route ownership to a specific operator.
--   • environment / release / error_type / url / method / request_id /
--     sample_json / users_affected / title: production-grade context the
--     dashboard already has columns for in the richer design.
--
-- All additions are nullable or have safe defaults so the table can be
-- extended in place via ALTER TABLE ADD COLUMN (D1/SQLite supports this).
-- Existing rows backfilled in the same migration: rows with
-- resolved_at IS NOT NULL get status='resolved'; everyone gets a title
-- derived from message.
--
-- Indexes added: (status, last_seen) for the new default list view and
-- (assignee_id, status, last_seen) for "my queue".
--
-- A UNIQUE constraint on (fingerprint, IFNULL(tenant_id,'')) is intentionally
-- NOT added here — historical rows from 0056's 1h-window dedup may have
-- duplicates per fingerprint. The new write path enforces 1-row-per-
-- fingerprint-per-tenant via SELECT-then-UPDATE/INSERT; a follow-up
-- migration can add the UNIQUE index after historical dedup.

ALTER TABLE error_events ADD COLUMN status         TEXT NOT NULL DEFAULT 'open';
ALTER TABLE error_events ADD COLUMN snooze_until   INTEGER;
ALTER TABLE error_events ADD COLUMN assignee_id    TEXT;
ALTER TABLE error_events ADD COLUMN resolved_by    TEXT;
ALTER TABLE error_events ADD COLUMN tags_json      TEXT;
ALTER TABLE error_events ADD COLUMN environment    TEXT NOT NULL DEFAULT 'production';
ALTER TABLE error_events ADD COLUMN release        TEXT;
ALTER TABLE error_events ADD COLUMN error_type     TEXT;
ALTER TABLE error_events ADD COLUMN url            TEXT;
ALTER TABLE error_events ADD COLUMN method         TEXT;
ALTER TABLE error_events ADD COLUMN request_id     TEXT;
ALTER TABLE error_events ADD COLUMN sample_json    TEXT;
ALTER TABLE error_events ADD COLUMN users_affected INTEGER NOT NULL DEFAULT 1;
ALTER TABLE error_events ADD COLUMN title          TEXT;

-- Backfill status from the legacy resolved_at column.
UPDATE error_events
   SET status = 'resolved'
 WHERE resolved_at IS NOT NULL
   AND status = 'open';

-- Backfill title from the first 200 chars of message.
UPDATE error_events
   SET title = substr(message, 1, 200)
 WHERE title IS NULL;

-- New query patterns for the dashboard.
CREATE INDEX IF NOT EXISTS idx_error_events_status_last
  ON error_events(status, last_seen);

CREATE INDEX IF NOT EXISTS idx_error_events_assignee
  ON error_events(assignee_id, status, last_seen);
