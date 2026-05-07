-- 0047: short-lived one-time post-verify login tokens (P1-6)
--
-- Replaces sessionStorage password storage in the verify-email flow.
-- Server issues a 32-byte random token after successful email verification;
-- client stores only the token (not the password) and exchanges it once via
-- NextAuth credentials. Token is hashed at rest (SHA-256) and consumed on use.
--
-- Lifetime: 5 minutes (config.LOGIN_TOKEN_TTL_SEC). Single-use: cleared on
-- successful exchange OR on next issue (one outstanding token per user).

ALTER TABLE web_users ADD COLUMN login_token_hash TEXT;
ALTER TABLE web_users ADD COLUMN login_token_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_web_users_login_token
  ON web_users(login_token_hash);
