-- Ownership-transfer tokens.
-- Owner initiates a transfer → row created here with a 24h TTL → owner confirms
-- via email link → tenant_roles is rewritten in a single transaction → row
-- marked consumed. The partial unique index enforces "at most one active
-- (unconsumed, unexpired) request per tenant" — that is the "single pending"
-- invariant the guard relies on.
CREATE TABLE IF NOT EXISTS ownership_transfer_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,           -- current tenant_owner (web_users.id)
  to_user_id TEXT NOT NULL,             -- target master / tenant_manager (web_users.id)
  token_hash TEXT NOT NULL,             -- SHA-256 of the secret in the email link
  expires_at INTEGER NOT NULL,          -- unix seconds; default 24h from created_at
  consumed_at INTEGER,                  -- non-null once the transfer is confirmed
  cancelled_at INTEGER,                 -- non-null if the originator cancels before confirm
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ip_address TEXT,                      -- IP that initiated the request (audit only)
  user_agent TEXT                       -- UA that initiated the request (audit only)
);

CREATE INDEX IF NOT EXISTS idx_ott_tenant_created ON ownership_transfer_tokens(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ott_token_hash ON ownership_transfer_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_ott_user ON ownership_transfer_tokens(from_user_id, created_at);

-- "At most one active pending request per tenant": partial unique index that
-- only counts rows still in flight (not consumed, not cancelled).
CREATE UNIQUE INDEX IF NOT EXISTS idx_ott_one_pending
  ON ownership_transfer_tokens(tenant_id)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;
