-- Migration 0056 — error_events: deduplicated issue tracker for the in-project
-- error monitoring system (replaces the need for Sentry/Datadog).
--
-- RELATIONSHIP TO error_log (migration 0039):
--   • error_log is the raw firehose (one row per fire, 30-day TTL via cron).
--     It is append-only, sampled by client/edge code, and useful for forensics.
--   • error_events is the deduplicated *issue* tracker. One row per unique
--     fingerprint regardless of occurrence count. Driven by ON CONFLICT
--     UPSERT that bumps `count` and `last_seen` instead of inserting dupes.
--     This is what the God Mode dashboard reads.
--
-- Both tables are populated by the same write path (the error sink). The sink
-- INSERTs into error_log (audit trail) AND UPSERTs into error_events (issue
-- tracker) in a single transaction.
--
-- WHO WRITES:
--   • Worker: src/worker.js fetch try/catch, src/handlers/cron.js per-phase
--     try/catch, telegram/webhook handlers, billing webhook idempotency.
--   • Admin-app: /api/error-report (React error boundaries), trpc.ts
--     errorFormatter (unhandled non-TRPCError throws).
--
-- DEDUPLICATION FINGERPRINT (computed in code, NOT in SQL):
--   sha256(source + '|' + normalizedMessage + '|' + topStackFrame).slice(0,32)
--   normalizedMessage strips numbers, uuids, hex hashes, quoted literals so
--   that `User 42 not found` and `User 9001 not found` collapse to one issue.
--
-- STATUS LIFECYCLE:
--   open → resolved (by operator) | ignored (mute forever) | snoozed (mute
--   until snooze_until). If a new fire arrives on a `resolved` issue, the
--   upsert flips status back to `open` automatically — that is the regression
--   signal ops cares about.
--
-- RETENTION: pruned by cron phaseCleanup. Resolved/ignored issues older than
-- 90 days are deleted; open issues are kept indefinitely (an open bug is an
-- open bug).
CREATE TABLE IF NOT EXISTS error_events (
  id              TEXT PRIMARY KEY,
  fingerprint     TEXT NOT NULL,
  tenant_id       TEXT,
  source          TEXT NOT NULL,
  environment     TEXT NOT NULL DEFAULT 'production',
  release         TEXT,
  severity        TEXT NOT NULL DEFAULT 'error',
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  error_type      TEXT,
  stack           TEXT,
  url             TEXT,
  method          TEXT,
  user_id         TEXT,
  request_id      TEXT,
  count           INTEGER NOT NULL DEFAULT 1,
  users_affected  INTEGER NOT NULL DEFAULT 1,
  first_seen      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  resolved_at     INTEGER,
  resolved_by     TEXT,
  snooze_until    INTEGER,
  assignee_id     TEXT,
  tags_json       TEXT,
  sample_json     TEXT,
  created_at      INTEGER NOT NULL
);

-- Dedup invariant: one row per fingerprint. Upserts on this conflict.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_error_events_fingerprint
  ON error_events(fingerprint);

-- Main list view: "open issues, most recent first".
CREATE INDEX IF NOT EXISTS idx_error_events_status_last
  ON error_events(status, last_seen);

-- Tenant-scoped list (per-tenant error feed inside a salon's Settings → Health).
CREATE INDEX IF NOT EXISTS idx_error_events_tenant_status_last
  ON error_events(tenant_id, status, last_seen);

-- Severity filter ("show me only fatals").
CREATE INDEX IF NOT EXISTS idx_error_events_severity_last
  ON error_events(severity, last_seen);

-- Source filter ("only cron failures").
CREATE INDEX IF NOT EXISTS idx_error_events_source_last
  ON error_events(source, last_seen);

-- Cleanup cron scan: prune resolved/ignored issues older than N days.
CREATE INDEX IF NOT EXISTS idx_error_events_last_seen
  ON error_events(last_seen);
