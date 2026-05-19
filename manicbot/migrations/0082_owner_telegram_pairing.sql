-- 0082_owner_telegram_pairing.sql
--
-- Unlocks "salon owner (web-registered) uses the salon's Telegram bot
-- in tenant_owner role". Symmetric to 0074 (master pairing).
--
-- Today every web-registered owner gets a `web_users` row but never
-- gets a `tenant_roles` row, because `tenant_roles` is keyed by the
-- real Telegram `chat_id` which a web-only registration does not
-- carry. As a result `resolveRole(ctx, chatId)` returns CLIENT for the
-- owner when they `/start` their own bot — the bot greets them as if
-- they were a customer.
--
-- This migration adds:
--   1. `web_users.telegram_chat_id INTEGER` (nullable) — the bridge
--      from the web user identity to the real Telegram chat_id. Set
--      atomically when the owner consumes a pairing code via
--      `/start own_<token>`.
--   2. `owner_pairing_codes` — single-use, 7-day-TTL deep-link tokens
--      minted by the owner from the admin-app. Redeemed via
--      `/start own_<raw_token>` on the salon's TG bot. Stored hashed
--      (SHA-256 hex) so a DB compromise doesn't leak active tokens.
--      Same pattern as `master_pairing_codes` (0074).
--
-- On successful consume the Worker also inserts a `tenant_roles` row
-- `(tenant_id, chat_id=<real_tg>, role='tenant_owner')` so the
-- existing `resolveRole` resolves the owner without any code change
-- in the role lookup path.

ALTER TABLE web_users ADD COLUMN telegram_chat_id INTEGER;

-- Partial UNIQUE so the same Telegram chat_id cannot be bound to two
-- web_users rows simultaneously. Cross-account collisions across the
-- same Telegram identity are impossible by design (one TG user → one
-- web account on this platform).
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_users_tg_chat
  ON web_users(telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS owner_pairing_codes (
  token_hash TEXT PRIMARY KEY,              -- SHA-256 hex of the raw token (24 bytes random → 64 hex chars)
  tenant_id TEXT NOT NULL,
  web_user_id TEXT NOT NULL,                -- references web_users(id); the owner being paired
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,              -- created_at + 7 days
  consumed_at INTEGER,                      -- set when /start own_<token> succeeds
  consumed_chat_id INTEGER                  -- the real Telegram chat_id that consumed the token
);

CREATE INDEX IF NOT EXISTS idx_opc_tenant_user
  ON owner_pairing_codes(tenant_id, web_user_id);

-- Used by the dashboard "you already have a pending code, copy this
-- link" surface and any future cleanup sweep.
CREATE INDEX IF NOT EXISTS idx_opc_unconsumed_exp
  ON owner_pairing_codes(expires_at)
  WHERE consumed_at IS NULL;
