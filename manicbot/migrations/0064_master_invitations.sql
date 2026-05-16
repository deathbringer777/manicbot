-- Migration 0063 — master_invitations table for the email-invite flow.
--
-- Why:
--   • Salon owners can today add masters by Telegram chatId
--     (salon.addMaster) or by generating a salon-owned account
--     (salon.createMasterAccount). They CANNOT invite a master by email and
--     let the master own the resulting account. This row captures the
--     pending state between "salon clicks Invite" and "master accepts".
--   • Two scenarios are captured at send time so the UI / accept page can
--     route correctly without a second lookup:
--       - existing_user: an active web_users row matches the invited email
--         (case-insensitive). The accept page is the in-app /invitations/[id]
--         flow; future PR replaces this with a messenger thread drop.
--       - new_user: no matching web_user. A one-time CSPRNG token is hashed
--         and emailed as a magic-link to /register?invite=<token>. The link
--         pre-fills the locked email field and binds the new web_user to
--         this salon as a master upon registration.
--
-- Statuses (text enum, default 'pending'):
--   • pending  — created, not yet accepted, token still valid
--   • accepted — accepted_master_id is set, masters row exists
--   • revoked  — salon owner cancelled before accept
--   • expired  — token_expires_at < now; lazy-flipped by reads, not by cron
--
-- Indexes:
--   • Partial UNIQUE (tenant_id, email) WHERE status='pending' — prevents
--     duplicate live invites per tenant; the salon must revoke before
--     re-inviting. Caught at INSERT time and surfaced as a user-friendly
--     "already invited" message in the UI.
--   • Partial INDEX (token_hash) WHERE status='pending' — magic-link accept
--     does a single indexed read using the hashed token (raw token never
--     stored).
--   • INDEX (tenant_id, status, created_at) — drives the salon-side pending
--     invitations strip in MastersTab and the cleanup query for expired rows.

CREATE TABLE IF NOT EXISTS master_invitations (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  email              TEXT NOT NULL,
  inviter_user_id    TEXT NOT NULL,
  invited_name       TEXT,
  token_hash         TEXT NOT NULL,
  token_expires_at   INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  scenario           TEXT NOT NULL,
  accepted_at        INTEGER,
  accepted_master_id INTEGER,
  revoked_at         INTEGER,
  created_at         INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_invitations_unique_pending
  ON master_invitations(tenant_id, email) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_master_invitations_token
  ON master_invitations(token_hash) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_master_invitations_tenant_status
  ON master_invitations(tenant_id, status, created_at);
