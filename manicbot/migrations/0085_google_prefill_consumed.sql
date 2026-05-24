-- Security audit P0 — Google prefill token replay protection.
--
-- The Google-OAuth-prefill flow signs a short-lived HMAC blob containing
-- {email, name, sub, exp, jti} and hands it to the client (15-min TTL).
-- The client posts it back to webUsers.register.
--
-- Previously the token had no server-side single-use marker — within the
-- 15-min TTL the same token could be used N times (real exploit window:
-- if a token leaks during the handoff, attacker could pre-register the
-- email before the legitimate user, locking them out).
--
-- This table tracks consumed jti values. Atomic claim via INSERT OR IGNORE
-- in webUsers.register — second consume returns changes=0 and is rejected.
-- Rows live until `exp` and get purged by phaseCleanup.

CREATE TABLE IF NOT EXISTS google_prefill_consumed (
  jti          TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  consumed_at  INTEGER NOT NULL,
  exp          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_exp ON google_prefill_consumed(exp);
