-- 0049_cookie_consent_log.sql — 2026-05-10
--
-- Cookie / web consent audit trail. Distinct from `marketing_consent_log`
-- (which is keyed by `contact_id` and tracks email/SMS opt-ins for marketing
-- contacts). This table records every consent decision a web visitor makes via
-- the cookie banner: which categories they accepted, the policy version in
-- effect, and where the decision came from.
--
-- Why a separate table:
--   * GDPR Art. 7(1): controller must demonstrate that consent was given,
--     including the version of policy text the user saw at decision time.
--   * ePrivacy Art. 5(3) (Polish "Prawo telekomunikacyjne" art. 173):
--     storing/reading non-essential cookies requires informed prior consent —
--     the audit log is the proof.
--   * marketing_consent_log requires `contact_id NOT NULL`, which we don't
--     have for an anonymous landing visitor.
--
-- Treat this table as APPEND-ONLY. The application must never UPDATE or DELETE
-- rows; forensic value depends on the immutable history.
--
-- Schema:
--   anonymous_id   — random UUID stored in localStorage; survives page reloads
--                    so we can correlate a visitor's events to their consent
--                    without a tracking cookie.
--   web_user_id    — populated when the visitor is logged in (NextAuth
--                    web_users.id). Joined to user-facing decisions later.
--   categories     — JSON: {necessary:true, analytics:bool, marketing:bool, ux:bool}
--   policy_version — string ID of the policy text in effect at decision time
--                    (e.g. "2026-05-10-v1"). Bump to force re-consent.
--   source         — banner | settings | api | accept_all | reject_all
--   ip / user_agent — captured at decision time for audit.

CREATE TABLE IF NOT EXISTS cookie_consent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anonymous_id TEXT NOT NULL,
  web_user_id TEXT,
  categories TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  source TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_anon ON cookie_consent_log(anonymous_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_user ON cookie_consent_log(web_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cookie_consent_created ON cookie_consent_log(created_at);
