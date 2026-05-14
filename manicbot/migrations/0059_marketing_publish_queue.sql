-- Migration 0059 — marketing_publish_queue: outbox for the two-step
-- Meta Graph API IG publishing flow.
--
-- Why: publishing an IG Feed post is TWO calls:
--   1) POST /{page_id}/media         → returns container_id
--   2) POST /{page_id}/media_publish → moves container live
--
-- Meta recommends waiting for the container to finish processing
-- (status_code = FINISHED) before step 2; large images can take 5-30s.
-- We can't park a Worker request for that long, so we persist the
-- intermediate container_id and let the next cron tick complete the
-- publish.
--
-- One queue row per (content_plan_id) attempt. On retry after failure,
-- attempts++ and last_attempt_at moves forward; we cap at 5 attempts
-- before marking content_plan as failed and stopping retries.

CREATE TABLE IF NOT EXISTS marketing_publish_queue (
  id                 TEXT PRIMARY KEY,
  content_plan_id    TEXT NOT NULL,
  tenant_id          TEXT,
  channel_type       TEXT NOT NULL DEFAULT 'instagram',
  page_id            TEXT NOT NULL,
  meta_container_id  TEXT,
  meta_post_id       TEXT,
  status             TEXT NOT NULL DEFAULT 'queued',
  error_msg          TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

-- Cron retry sweep: pick rows that are not terminal and ready for next
-- attempt (last_attempt_at <= now() - backoff).
CREATE INDEX IF NOT EXISTS idx_mpq_status_attempt
  ON marketing_publish_queue(status, last_attempt_at);

-- Lookup queue row by content plan id (join + status reconciliation).
CREATE INDEX IF NOT EXISTS idx_mpq_content_plan
  ON marketing_publish_queue(content_plan_id);
