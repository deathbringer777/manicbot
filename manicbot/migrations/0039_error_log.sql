-- Capture client-side React error boundary fires + tRPC unhandled errors
-- so ops can see crashes that today only show up in browser consoles.
--
-- Inserted by:
--   • Admin-app /api/error-report (called from app/global-error.tsx and
--     app/(dashboard)/error.tsx via navigator.sendBeacon)
--   • Worker stripe webhook idempotency layer (not yet wired here, but
--     reserved for future structured-error sink expansion)
--
-- Retention: pruned by the cron's existing cleanup phase (TBD); for now
-- expect manual TTL via DELETE FROM error_log WHERE created_at < ?.
CREATE TABLE IF NOT EXISTS error_log (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,        -- 'global-error' | 'dashboard-error' | 'trpc' | 'worker'
  message TEXT NOT NULL,
  digest TEXT,                  -- React error boundary digest, if present
  url TEXT,
  user_agent TEXT,
  user_id TEXT,                 -- web_users.id (nullable — anonymous fires too)
  tenant_id TEXT,
  detail_json TEXT              -- free-form additional context as JSON
);

CREATE INDEX IF NOT EXISTS idx_error_log_created_at ON error_log(created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_source ON error_log(source, created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_user ON error_log(user_id, created_at);
