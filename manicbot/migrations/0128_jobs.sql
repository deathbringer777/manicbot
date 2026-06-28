-- 0128_jobs.sql — 2026-06-28
--
-- Durable job queue for the ThinkPad sidecar (free always-on compute backend).
-- The Worker enqueues heavy / long-running / Claude-on-Max marketing work that
-- cannot run inside the Worker CPU+wall-clock budget; the sidecar claims rows
-- (conditional UPDATE ... WHERE status='pending') over the Cloudflare D1 REST
-- API and runs the handler, writing the result back here.
--
-- This is a PLATFORM-WIDE work queue, not tenant-isolated data: `tenant_id`
-- records which salon a marketing job targets (a payload attribute), it is not
-- an access boundary. The sidecar claims by status under systemAdmin trust.
--
-- All timestamps are epoch SECONDS (matches nowSec() on the Worker and the
-- blog/seo crons on the sidecar — avoids the ms/sec mismatch landmine).
--
-- Behaviour-neutral on existing tables: pure additive new table + index.
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,                 -- uuid
  type        TEXT NOT NULL,                    -- handler key, e.g. 'campaign.generate'
  payload     TEXT NOT NULL,                    -- JSON job input
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | error
  tenant_id   TEXT,                             -- target salon (NULL = platform-wide)
  result      TEXT,                             -- JSON result (NULL until done)
  error       TEXT,                             -- last error message (NULL unless failed)
  attempts    INTEGER NOT NULL DEFAULT 0,       -- claim count (bumped on each claim)
  created_at  INTEGER NOT NULL,                 -- epoch seconds
  claimed_at  INTEGER,                          -- epoch seconds when claimed
  finished_at INTEGER                           -- epoch seconds when done/error
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
