-- Migration 0090 — newsletter subscribers: real unsubscribe token.
--
-- Closes the explicit follow-up from 0086. Pre-fix the welcome email
-- carried a hardcoded `?token=placeholder` URL — clicking it landed on a
-- 404 in the admin-app. The Worker already serves `GET /u/<token>` for
-- the per-tenant marketing module; this migration gives newsletter rows
-- the same shape of token so the existing handler can serve them via a
-- fallthrough (no parallel `/n/<token>` endpoint).
--
-- Design:
--   * Token shape matches `marketing_contacts.unsubscribe_token` —
--     32 lowercase hex chars (16 random bytes). 128-bit entropy, partial
--     UNIQUE index, single-purpose (only flips `unsubscribed_at`).
--   * Stored RAW, not hashed. The token is the lookup key on every visit
--     and there is no escalation path; hashing would add load without
--     security benefit (an attacker with DB read already has the email).
--   * Backfill via SQLite `randomblob(16)` + `hex()` so existing rows get
--     a valid token without a Worker round-trip. Backfill runs BEFORE the
--     UNIQUE index is created so the (negligible) collision probability
--     can't break the apply.
--   * Tokens are STABLE across resubscribe — once minted, never rotated.
--     This keeps any out-in-the-wild copy of the welcome email usable
--     even after the user resubscribes / re-receives the welcome.
--
-- Worker / admin-app wiring:
--   * Worker `subscribeHttp.js` mints a token on every new INSERT and
--     forwards it to admin-app `/api/internal/newsletter-welcome` in the
--     dispatch body.
--   * Worker resub-after-unsub path clears `unsubscribed_at` (+ welcome
--     stamps), re-fires the welcome with the SAME token, returns 202.
--   * Worker `unsubscribeHttp.js` extends `GET /u/<token>` with a
--     newsletter fallthrough; adds POST for RFC 8058 one-click → 204.
--   * Admin-app `sendNewsletterWelcomeEmail` builds the real URL
--     `${WORKER_PUBLIC_URL}/u/<token>` and ships List-Unsubscribe +
--     List-Unsubscribe-Post headers in the Resend payload.
--
-- The migration is zero-downtime: ADD COLUMN is non-blocking, backfill
-- runs row-by-row, and the UNIQUE index is partial so it does not break
-- any in-flight INSERT that races the apply.

ALTER TABLE newsletter_subscribers ADD COLUMN unsubscribe_token TEXT;

UPDATE newsletter_subscribers
   SET unsubscribe_token = lower(hex(randomblob(16)))
 WHERE unsubscribe_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_unsub_tok
  ON newsletter_subscribers(unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;
