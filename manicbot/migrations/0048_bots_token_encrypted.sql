-- 0048_bots_token_encrypted.sql — 2026-05-08
--
-- #S6: Add token_encrypted column to bots table for KV→D1 token migration.
--
-- Bot tokens are currently stored in KV under key `bottoken:{botId}`.
-- This migration adds the D1 column that the `/admin/migrate-bot-tokens`
-- endpoint writes to. Once the migration is run, getBotToken will be updated
-- to read from D1 first (with KV fallback), and eventually the KV binding
-- will be removed in a follow-up PR.
--
-- The value stored is AES-GCM encrypted using BOT_ENCRYPTION_KEY with label
-- `bot-token-v1` (same encryption used for KV storage).

ALTER TABLE bots ADD COLUMN token_encrypted TEXT;
