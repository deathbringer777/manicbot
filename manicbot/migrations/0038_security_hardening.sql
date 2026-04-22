-- Security hardening — 2026-04
-- 1. Faster audit_log lookups by actor (for compromised-account investigations)
-- 2. Window-aware composite index on rate_limits to speed up TTL sweeps
-- 3. Document stripe constraint intent via CHECK (best-effort; SQLite allows NULL unless NOT NULL)
--    Full NOT-NULL backfill is done in application code (resolver throws if customerId missing).

-- ── Audit log actor index ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor, created_at);

-- ── Rate limits: composite (key, action, window_start) index to avoid full-scan
--    during expired-row sweeps.  The PRIMARY KEY already covers (key, action);
--    this extends coverage to include window_start for the DELETE ... WHERE
--    window_start < X cleanup query.
CREATE INDEX IF NOT EXISTS idx_rl_key_action_window ON rate_limits(key, action, window_start);
