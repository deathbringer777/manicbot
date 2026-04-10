-- Role change requests (web users)
CREATE TABLE IF NOT EXISTS role_change_requests (
  id TEXT PRIMARY KEY,
  web_user_id TEXT NOT NULL,
  current_role TEXT NOT NULL,
  requested_role TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_rcr_user ON role_change_requests(web_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rcr_status ON role_change_requests(status, created_at);
