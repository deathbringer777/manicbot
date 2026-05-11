-- 0052_masters_is_synthetic.sql — 2026-05-11
--
-- Explicit flag for masters whose `chat_id` is synthetic (i.e. no real
-- Telegram chat behind it). These rows are created by the web register
-- flow when a user registers as `role = "master"`: a personal tenant is
-- created and a master record is inserted with a synthetic chatId in the
-- 10B+ range so it cannot collide with a real Telegram user id.
--
-- Why we need a column instead of a chat_id-range check:
--   * Telegram user IDs are currently ~7B (8B reserved for channels). The
--     10B threshold gives only ~3B headroom — a numeric range is a brittle
--     proxy for "this is a synthetic master".
--   * cron.js post-visit phase sends Telegram messages to `master_id`
--     assuming it is a real chat. Synthetic masters would otherwise receive
--     messages to non-existent chats; sendMessage would 400/403 silently.
--   * `is_synthetic` is the source of truth so we can stop relying on the
--     `master_id > 0` heuristic.
--
-- Backfill rule: any existing row with chat_id >= 10B is a synthetic
-- master created by the web register flow. Production currently has a
-- small number of these (independent / personal masters).

ALTER TABLE masters ADD COLUMN is_synthetic INTEGER NOT NULL DEFAULT 0;

UPDATE masters SET is_synthetic = 1 WHERE chat_id >= 10000000000;
-- expected backfill: rows where chat_id >= 10B (personal masters from web register flow)
