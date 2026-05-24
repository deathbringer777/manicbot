-- Migration 0086 — newsletter subscribers (landing form ingest).
--
-- The landing page at manicbot.com hosts a "Stay in the loop" email
-- collector that previously posted to /api/email-subscribe — an endpoint
-- the Worker never implemented. The form showed "Subscribed. Check your
-- inbox", but nothing landed in D1 and no welcome email was ever sent.
--
-- This table captures one row per subscribed email. Platform-scoped (no
-- tenant_id) because subscribers belong to ManicBot the platform, not to
-- any single salon. Future broadcasts will read this table directly.
--
-- Idempotency: UNIQUE on email + INSERT OR IGNORE in the handler so the
-- second submit from the same address is a silent no-op (also collapses
-- the welcome-email side effect).
--
-- Welcome delivery: the Worker fires an authenticated POST to the
-- admin-app's /api/internal/newsletter-welcome route which calls Resend.
-- `welcome_sent_at` is stamped on success; `welcome_send_error` on
-- failure (admin-app down, Resend rejected, env unset). Both nullable.
--
-- Privacy/anonymity: `anonymous_id` is populated when the landing form
-- already wrote a cookie_consent_log row — lets us correlate the
-- consent decision to the email later without forcing the consent flow.
-- `ip` and `user_agent` are abuse-investigation breadcrumbs only; they
-- are not exposed to any UI surface.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'landing',
  lang                TEXT,
  anonymous_id        TEXT,
  ip                  TEXT,
  user_agent          TEXT,
  created_at          INTEGER NOT NULL,
  confirmed_at        INTEGER,
  unsubscribed_at     INTEGER,
  welcome_sent_at     INTEGER,
  welcome_send_error  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_email
  ON newsletter_subscribers(email);

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_created
  ON newsletter_subscribers(created_at DESC);
