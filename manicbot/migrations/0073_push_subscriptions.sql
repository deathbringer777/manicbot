-- 0073_push_subscriptions.sql — Web Push (browser push notifications)
--
-- Companion table to user_notifications (0070): user_notifications is the
-- in-app bell feed, push_subscriptions is the *transport* layer for the
-- same events to land as native OS notifications even when the dashboard
-- tab is closed. PR3 of the Notification Center upgrade.
--
-- One row per (web_user_id, endpoint) pair. Browsers issue a stable
-- endpoint per browser/profile, so a single user with Chrome at home +
-- Firefox at the salon = two rows.
--
-- Worker-side encryption uses the (p256dh, auth) ECDH keys per RFC 8291.
-- failure_count is bumped by the push sender on 410 Gone / 404 responses
-- — once it crosses a threshold the row is hard-deleted by a future
-- cleanup cron (out of scope here).
--
-- Required env vars (set on Pages + Worker before push will work):
--   VAPID_PUBLIC_KEY  — base64url-encoded uncompressed P-256 point (87 chars)
--   VAPID_PRIVATE_KEY — base64url-encoded P-256 scalar (43 chars, Worker secret only)
--   VAPID_SUBJECT     — mailto:<address> string for the Subject header
--
-- Generate with:
--   node manicbot/scripts/generate-vapid-keys.mjs

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            TEXT PRIMARY KEY,
  web_user_id   TEXT NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
  tenant_id     TEXT,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at  INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0
);

-- One subscription per (user, endpoint) — re-subscribing from the same
-- browser overwrites instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_sub_user_endpoint
  ON push_subscriptions(web_user_id, endpoint);

-- Lookup pattern: fan-out by web_user_id when sending a push for a
-- user_notifications row.
CREATE INDEX IF NOT EXISTS idx_push_sub_user
  ON push_subscriptions(web_user_id);
