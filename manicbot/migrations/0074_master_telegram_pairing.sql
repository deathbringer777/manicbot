-- 0074_master_telegram_pairing.sql
--
-- Unlocks "salon-employed master uses the salon's Telegram bot in master role".
--
-- Today every web-created master gets a SYNTHETIC chat_id in the 10B+ range
-- (see 0023_personal_tenants, 0052_masters_is_synthetic). The bot already
-- supports master-mode (isMaster() + showMasterPanel + CB.MST_* callbacks)
-- but only when the chat_id of the inbound TG user matches the master row's
-- chat_id directly — which never happens for synthetic masters.
--
-- This migration adds a separate `telegram_chat_id` column on `masters` that
-- bridges the salon-issued synthetic identity to the master's real Telegram
-- account, without disturbing the (tenant_id, chat_id) primary key or the
-- foreign-key fields on appointments / master_client_blocks / google_integrations
-- / conversations that all reference master_chat_id.
--
-- It also adds `master_pairing_codes` — single-use, 7-day-TTL deep-link
-- tokens minted by the salon owner OR by the master themselves. Redeemed
-- via `/start mst_<raw_token>` on the salon's TG bot. Stored hashed
-- (SHA-256 hex of the raw token) so a DB compromise doesn't leak active
-- tokens — same pattern as `master_invitations` (0064).
--
-- Worker `isMaster(ctx, chat_id)` becomes
--   SELECT 1 FROM masters
--     WHERE tenant_id = ? AND (chat_id = ? OR telegram_chat_id = ?)
--           AND archived_at IS NULL
-- and `getMaster(ctx, chat_id)` is symmetric. Real-TG-chat-id masters
-- (origin='invited_telegram' or pre-0023 legacy rows) keep working via the
-- `chat_id = ?` branch; web-created synthetic masters use the new
-- `telegram_chat_id = ?` branch once paired.

ALTER TABLE masters ADD COLUMN telegram_chat_id INTEGER;

-- Partial UNIQUE so the same Telegram chat can't be bound to two different
-- masters within a tenant (defense against accidental double-paste). Cross-
-- tenant collisions are fine — the same person can be a master in multiple
-- salons under the same Telegram identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_masters_tenant_tg_chat
  ON masters(tenant_id, telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS master_pairing_codes (
  token_hash TEXT PRIMARY KEY,              -- SHA-256 hex of the raw token (32 bytes random → 64 hex chars)
  tenant_id TEXT NOT NULL,
  master_chat_id INTEGER NOT NULL,          -- references masters(chat_id) within tenant_id
  created_by_web_user_id TEXT,              -- nullable for owner-initiated where we still want to attribute
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,              -- created_at + 7 days
  consumed_at INTEGER,                      -- set when /start mst_<token> succeeds
  consumed_chat_id INTEGER                  -- the real Telegram chat_id that consumed the token
);

CREATE INDEX IF NOT EXISTS idx_mpc_tenant_master
  ON master_pairing_codes(tenant_id, master_chat_id);

-- Used by cleanup-style sweeps (e.g. show user only their active pending code).
CREATE INDEX IF NOT EXISTS idx_mpc_unconsumed_exp
  ON master_pairing_codes(expires_at)
  WHERE consumed_at IS NULL;
