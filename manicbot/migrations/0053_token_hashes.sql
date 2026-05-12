-- 0053: hash password-reset / email-verification / email-change tokens at rest (P1-9)
--
-- Today these three columns store SHA-256 hex digests already (see
-- webUsers.requestPasswordReset / verifyEmail / requestEmailChange — they all
-- call hashToken before writing). But the *column names* still match the
-- pre-#P1-9 era plaintext-token nomenclature, which is misleading and blocks
-- the planned "rolling-window" deprecation of the legacy plaintext path.
--
-- Migration 0047 introduced login_token_hash with the explicit suffix to
-- document "this column is a hash, not the bare token". This migration
-- mirrors that convention for the three remaining auth-token columns.
--
-- Rolling-window contract:
--   * For ONE release the writer populates BOTH the legacy column AND the
--     new *_hash column. Readers prefer the *_hash column and fall back to
--     the legacy column for any in-flight tokens minted before the deploy.
--   * After one release window (≈ 1 week of production traffic, > 24h max
--     TTL of any token), a follow-up migration will null the legacy
--     columns and drop the fallback read path.
--
-- Indexes are NOT added — the reset/verify/email-change paths always look up
-- the user by `email` (UNIQUE indexed) or by `id` (PK), then compare the
-- stored hash against a freshly-computed hash via constant-time compare.

ALTER TABLE web_users ADD COLUMN password_reset_token_hash TEXT;
ALTER TABLE web_users ADD COLUMN verification_token_hash TEXT;
ALTER TABLE web_users ADD COLUMN email_change_token_hash TEXT;
