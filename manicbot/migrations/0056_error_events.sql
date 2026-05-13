-- 0056_error_events — God Mode error monitoring.
--
-- Worker (`src/utils/errorCapture.js`) writes deduplicated error rows here;
-- the admin-app God Mode `/errors` page reads/resolves them via tRPC
-- `errorEvents` router. Dedup key = `fingerprint` (caller-computed hash of
-- error_name + message + path). Within a 1h window the worker increments
-- `count` and bumps `last_seen` instead of inserting a new row.
--
-- All columns mirror the Drizzle definition in
-- `admin-app/src/server/db/schema.ts` (`errorEvents`).

CREATE TABLE IF NOT EXISTS error_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,
  tenant_id TEXT,
  user_id TEXT,
  context TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_events_severity_seen
  ON error_events(severity, last_seen);
CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint
  ON error_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_events_tenant
  ON error_events(tenant_id, last_seen);
CREATE INDEX IF NOT EXISTS idx_error_events_unresolved
  ON error_events(resolved_at, last_seen);
