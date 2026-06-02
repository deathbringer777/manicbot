-- 0103_subscription_grant_codes.sql — Admin-issued one-time subscription grant codes.
--
-- Lets a system_admin generate a code (in admin-app God Mode) that grants a
-- tenant a free period of a plan — the launch use case is one free year of
-- `max` for a QA tester. The code is typed into the existing registration
-- referral field and routed by the reserved `SVC-` prefix.
--
-- Security model:
--   * Only the SHA-256 hash of the normalized code is stored (`code_hash`);
--     the plaintext is shown to the admin once at generation, never persisted.
--   * A never-generated / random string is rejected (lookup misses the hash).
--   * One-time redemption is enforced by a single atomic statement —
--     `UPDATE ... SET status='redeemed' WHERE id=? AND status='active'
--      AND (expires_at IS NULL OR expires_at > ?) RETURNING id` — so exactly
--     one redeemer wins under concurrency (mirrors the webhook_dedup /
--     upload_token_used / google_prefill_consumed atomic-claim patterns).
--   * Generation is guarded by systemAdminProcedure; redemption applies the
--     grant only to the just-created tenant.

CREATE TABLE IF NOT EXISTS subscription_grant_codes (
  id                       TEXT    PRIMARY KEY,
  code_hash                TEXT    NOT NULL,
  code_prefix              TEXT    NOT NULL,
  plan                     TEXT    NOT NULL,
  duration_days            INTEGER NOT NULL,
  status                   TEXT    NOT NULL DEFAULT 'active',  -- active | redeemed | revoked
  expires_at               INTEGER,                            -- optional code lifetime (unix sec)
  note                     TEXT,                               -- admin label, e.g. "QA tester Anna"
  created_by               TEXT,                               -- admin email/id
  created_at               INTEGER NOT NULL,
  redeemed_by_tenant_id    TEXT,
  redeemed_by_web_user_id  TEXT,
  redeemed_at              INTEGER
);

-- Redemption looks codes up by hash — unique so a hash maps to one code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sgc_code_hash
  ON subscription_grant_codes(code_hash);

-- Admin list view filters/sorts by status + recency.
CREATE INDEX IF NOT EXISTS idx_sgc_status_created
  ON subscription_grant_codes(status, created_at);
