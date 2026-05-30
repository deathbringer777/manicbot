-- 0096_thread_messages_fts.sql — 2026-05-30
--
-- Full-text search over messenger message bodies. Before this, the inbox could
-- only filter by thread title/preview — never by message text. Adds an FTS5
-- index + sync triggers, modeled on users_fts (migration 0062).
--
-- Access control is enforced at QUERY time (tenant + caller thread membership),
-- NOT at index time — so the index holds every non-deleted message and the
-- searchMessages procedure constrains visibility.
--
-- The AFTER UPDATE trigger doubles as the soft-delete de-index: a soft delete is
-- an UPDATE that sets deleted_at, which drops the FTS row (deleted messages
-- never surface in search). Edits re-index automatically.

CREATE VIRTUAL TABLE IF NOT EXISTS thread_messages_fts USING fts5(
  message_id UNINDEXED,
  thread_id  UNINDEXED,
  tenant_id  UNINDEXED,
  body,
  tokenize='unicode61 remove_diacritics 1'
);

-- Backfill (idempotent): index all live (non-deleted) messages.
DELETE FROM thread_messages_fts;
INSERT INTO thread_messages_fts(message_id, thread_id, tenant_id, body)
  SELECT id, thread_id, tenant_id, lower(body)
  FROM thread_messages
  WHERE deleted_at IS NULL;

CREATE TRIGGER IF NOT EXISTS thread_messages_fts_ai
AFTER INSERT ON thread_messages
WHEN NEW.deleted_at IS NULL BEGIN
  INSERT INTO thread_messages_fts(message_id, thread_id, tenant_id, body)
  VALUES (NEW.id, NEW.thread_id, NEW.tenant_id, lower(NEW.body));
END;

-- Re-index on any update; also drops the row when a soft-delete sets deleted_at.
CREATE TRIGGER IF NOT EXISTS thread_messages_fts_au
AFTER UPDATE ON thread_messages BEGIN
  DELETE FROM thread_messages_fts WHERE message_id = OLD.id;
  INSERT INTO thread_messages_fts(message_id, thread_id, tenant_id, body)
  SELECT NEW.id, NEW.thread_id, NEW.tenant_id, lower(NEW.body)
  WHERE NEW.deleted_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS thread_messages_fts_ad
AFTER DELETE ON thread_messages BEGIN
  DELETE FROM thread_messages_fts WHERE message_id = OLD.id;
END;
