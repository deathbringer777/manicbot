-- Atomic webhook idempotency via D1 UNIQUE constraint.
--
-- Replaces the KV GET-then-PUT pattern in src/utils/dedup.js. KV has no
-- compare-and-swap, so under truly concurrent claims (e.g. two retries
-- of the same Meta webhook arriving milliseconds apart on different edge
-- isolates) both racers could read NULL, both PUT, both return true,
-- and the bot processes the same message twice — duplicate AI replies,
-- duplicate bookings, duplicate analytics rows.
--
-- D1 is strongly-consistent SQLite. `INSERT INTO webhook_dedup ... ON
-- CONFLICT(key) DO NOTHING` is a single atomic statement at the SQLite
-- engine level: exactly one row creation wins; the other N-1 racers
-- get `meta.changes = 0` and recognize themselves as duplicates.
--
-- Why no Durable Object: Workers Paid + a DO class would be the
-- alternative, but the Worker is already on Paid (MessengerHub exists);
-- D1 is simpler (no class boundary, no per-id stub lookups), auditable
-- (row visible in queries), and naturally cleaned up by the existing
-- retention cron.
--
-- Retention: the `expires_at` column drives a 15-min cleanup phase
-- (phaseWebhookDedupCleanup) that DELETE-s rows past their TTL. With
-- ~hundreds of webhooks/minute peak post-launch this table never grows
-- beyond a few thousand live rows.

CREATE TABLE IF NOT EXISTS webhook_dedup (
  key         TEXT PRIMARY KEY,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Cleanup-phase scan filter.
CREATE INDEX IF NOT EXISTS idx_webhook_dedup_expires
  ON webhook_dedup(expires_at);
