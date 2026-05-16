-- Migration 0062 — masters.origin (account-origin model) and masters.archived_at
-- (soft-delete that preserves stats/appointments).
--
-- Why:
--   • 0052 added masters.is_synthetic to mark chatId >= 10B rows. That binary
--     flag answers "is the chat_id real" but NOT "how did this master get
--     onto the tenant" — which matters for the new salon→master permission
--     model. A web_user who self-registered, a master invited by email, and
--     a master added by Telegram chatId all behave differently with respect
--     to who owns the credential and who is allowed to edit the profile.
--   • Today's only delete path is salon.removeMaster which hard-deletes the
--     row (and synthetic web_user). Hard delete loses every stat the master
--     ever generated — appointments retained by FK, but the master name /
--     bio / portfolio is gone. The salon wants a reversible Archive instead.
--
-- Origin values (text enum, default 'salon_created' for backfill safety):
--   • salon_created      — created via salon.createMasterAccount; web_user is
--                          owned by the salon (password is salon's property,
--                          managed via mig 0065 encrypted vault).
--   • invited_email      — created via salon.sendMasterInvitation; the master
--                          owns the web_user account; salon needs delegation
--                          via mig 0067 (PR 2) to edit profile/schedule.
--   • invited_telegram   — created via salon.addMaster (chatId flow); master
--                          owns the Telegram identity; salon needs delegation.
--   • self_registered    — registered via webUsers.register with role='master'
--                          and a personal tenant (tenants.is_personal=1).
--
-- Backfill logic (preserves current behavior):
--   • is_synthetic = 1                    → salon_created
--   • chat_id  <  10_000_000_000          → invited_telegram (legacy chatId add)
--   • chat_id >= 10_000_000_000 AND is_synthetic = 0 → self_registered
--
-- archived_at: nullable INTEGER unix ts. NULL = active. Set by salon.archiveMaster
-- (OTP-gated). UI filters this out of active master lists; appointments and
-- reviews remain intact for historical reporting.
--
-- Indexes:
--   idx_masters_active — partial index supporting the common "active masters
--   for tenant" query. Smaller than a full table index because archived rows
--   are excluded.

ALTER TABLE masters ADD COLUMN origin TEXT NOT NULL DEFAULT 'salon_created';
ALTER TABLE masters ADD COLUMN archived_at INTEGER;

UPDATE masters
   SET origin = CASE
     WHEN is_synthetic = 1                                       THEN 'salon_created'
     WHEN chat_id < 10000000000                                  THEN 'invited_telegram'
     ELSE                                                              'self_registered'
   END;

CREATE INDEX IF NOT EXISTS idx_masters_active
  ON masters(tenant_id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_masters_tenant_origin
  ON masters(tenant_id, origin);
