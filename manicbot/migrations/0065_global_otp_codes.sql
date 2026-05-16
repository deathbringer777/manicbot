-- Migration 0064 — global_otp_codes: generic OTP store for destructive /
-- role-escalation tRPC mutations.
--
-- Why:
--   • 0034 added permission_elevation_codes, narrowly scoped to "owner grants
--     a sensitive permission to a tenant_manager". Several other operations
--     need the same guarantee — fresh email-confirmed code, payload-bound,
--     timing-safe, single-use — but cannot reuse permission_elevation_codes
--     without bending its schema.
--   • Generic table keyed by (web_user_id, action). Each row binds the code
--     to a SHA-256 hash of the canonicalized action payload so that a code
--     issued for "archive master X" cannot be replayed to archive master Y.
--   • Current PR 1 callers: archive_master, unarchive_master,
--     peek_master_password, reset_master_password. Future callers (PR 6):
--     transfer_ownership, delete_tenant, update_tenant_primary_email, etc.
--
-- Lifecycle:
--   1. Mutation request fires → auth.requestActionOtp({ action, payload })
--      generates a 6-digit CSPRNG code, hashes it, stores the row, emails
--      the plain code to the actor's own email (ctx.webUser.email). 15-min TTL.
--      Returns the otpId so the UI can poll if it wants progress feedback.
--   2. UI shows a 6-digit input; user enters the code; calls the gated
--      mutation with { ..., otpCode }.
--   3. The gated mutation calls requireOtpConfirmation(ctx, action, payload, code)
--      which hashes the payload, looks up the matching unconsumed row,
--      timing-safe-compares code_hash, marks consumed_at=now, and proceeds.
--      Wrong code increments attempts; >=5 attempts invalidates the row.
--
-- Schema notes:
--   • code_hash + payload_hash are both SHA-256 hex (64 chars) — fast equality
--     check via timingSafeEqualStr; never store plain code or plain payload.
--   • consumed_at: NULL while valid; set to unix ts on successful consume so
--     replay is impossible. Expired rows are NOT auto-deleted; a future cron
--     can clean expires_at < now()-30d if growth becomes a concern.
--
-- Indexes:
--   • (web_user_id, action, expires_at) — supports the "is there a valid,
--     unconsumed code for me + this action?" lookup. The (web_user_id, action,
--     consumed_at IS NULL) filter is applied in the query body.

CREATE TABLE IF NOT EXISTS global_otp_codes (
  id            TEXT PRIMARY KEY,
  web_user_id   TEXT NOT NULL,
  action        TEXT NOT NULL,
  payload_hash  TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_global_otp_user_action
  ON global_otp_codes(web_user_id, action, expires_at);
