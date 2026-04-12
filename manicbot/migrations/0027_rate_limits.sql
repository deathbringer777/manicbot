-- D1-based rate limiting table (replaces in-memory per-isolate Maps)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (key, action)
);
CREATE INDEX IF NOT EXISTS idx_rl_window ON rate_limits(window_start);
