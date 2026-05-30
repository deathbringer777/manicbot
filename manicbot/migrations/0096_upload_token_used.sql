-- Single-use enforcement for upload tokens (A5).
--
-- Upload tokens (/upload/asset) are HMAC-signed with a 5-min TTL. The TTL alone
-- did NOT make them single-use: a leaked or replayed token could be redeemed
-- repeatedly inside its window (Referer leak, shared access logs, shoulder-surf
-- of the signed URL). Each token now carries a random `jti` nonce; on
-- redemption the Worker atomically claims it via
-- `INSERT INTO upload_token_used ... ON CONFLICT(jti) DO NOTHING`
-- (claimUploadNonce in src/services/upload.js), so exactly one redemption wins
-- and every replay gets 409.
--
-- Retention: `expires_at` (= the token's exp) drives a cleanup pass
-- (pruneExpiredUploadNonces) in worker.scheduled, alongside the webhook_dedup
-- prune. The live set is tiny — uploads are far rarer than webhooks.

CREATE TABLE IF NOT EXISTS upload_token_used (
  jti         TEXT PRIMARY KEY,
  expires_at  INTEGER NOT NULL
);

-- Cleanup-phase scan filter.
CREATE INDEX IF NOT EXISTS idx_upload_token_used_expires
  ON upload_token_used(expires_at);
