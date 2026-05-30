-- 0098_thread_messages_delivery_state.sql — 2026-05-30
-- (renumbered from 0095 on merge — main shipped 0095-0097 in parallel)
--
-- Persisted outbound delivery state for staff → client messages.
--
-- Context: thread_messages had no delivery status. A staff reply that failed
-- to reach the client (outside the WA/IG 24h window, a dead channel token, or a
-- channel error) surfaced the error once in the composer and then looked
-- delivered on reload — silent data loss. This adds a nullable lifecycle so the
-- UI can show pending / sent / delivered / failed and offer a retry.
--
-- NULL = untracked: all historical rows, staff DMs, groups, system rows, and
-- inbound client messages stay NULL. Only client_conv OUTBOUND web_user rows
-- carry a non-null state:
--   pending → sent → delivered   (delivered set later by a WA/IG status webhook)
--   pending → failed             (channel rejected / transport error)
--
-- Mirrors the plugin_reminder_fires.delivery_state convention (schema.sql).
-- ALTER TABLE ADD COLUMN is additive and runs once in migration sequence.

ALTER TABLE thread_messages ADD COLUMN delivery_state TEXT;
ALTER TABLE thread_messages ADD COLUMN delivery_error TEXT;

-- Partial index for the retry/observability path: find failed outbound rows
-- without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_thread_messages_delivery
  ON thread_messages(tenant_id, delivery_state)
  WHERE delivery_state IS NOT NULL;
