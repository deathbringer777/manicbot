-- Migration 0093 — default per-tenant "Команда" staff group.
--
-- Why:
--   Today a salon owner has to manually create a staff group via the
--   "+ Новый чат" modal in /messages, and the picker silently hides any
--   master without a web_users row ("4 мастеров с Telegram-привязкой пока
--   не доступны для группы — подключите веб-аккаунт"). Result: salons
--   never have a single "everyone is here" team chat — only ad-hoc small
--   DMs. New masters land in the team with zero visibility.
--
-- This migration seeds one `staff_group` thread per tenant with
-- `is_default_group = 1`, pre-populated with:
--   • the tenant_owner (role='owner'),
--   • every active master (`active=1 AND archived_at IS NULL`):
--       - member_kind='web_user' + member_ref=web_users.id when the
--         master has a linked web account (origin=salon_created or
--         a paired invite acceptance),
--       - member_kind='master' + member_ref=String(masters.chat_id)
--         for Telegram-only / pending-invite masters. This mirrors
--         the existing DM-placeholder pattern already used by
--         `messenger.createStaffDm` and `linkMasterPlaceholderToWebUser`.
--
-- Going forward the admin-app calls `addMasterToDefaultGroup` from the
-- three master-insertion paths (`salon.createMasterAccount`,
-- `salon.addMaster`, `webUsers.acceptInvitation*`), so a new master
-- joins the team chat the instant they're added — without the owner
-- doing anything.
--
-- The owner may remove a member from the default group via the new
-- `messenger.removeStaffMember` mutation (owner-only). Removing the
-- owner themselves is refused. A "removed by owner" system message is
-- posted in the thread for auditability.
--
-- Indexes:
--   • partial UNIQUE (tenant_id) WHERE is_default_group = 1 — exactly
--     one default group per tenant. Lets the helper SELECT-then-INSERT
--     pattern collapse cleanly under concurrent calls (a race surfaces
--     as a UNIQUE conflict, recovered by re-SELECT).

ALTER TABLE threads
  ADD COLUMN is_default_group INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_default_group_per_tenant
  ON threads(tenant_id) WHERE is_default_group = 1;

-- ── Backfill: one default group per existing tenant, seeded with owner
-- ── + every active master.
--
-- Thread id format: `th_${ulid()}` in app code. Backfill uses a
-- deterministic synthetic prefix `th_def_<tenant_id>` so the migration
-- stays idempotent under retry without needing access to ULID. The app
-- code never depends on the prefix — it always SELECTs by
-- (tenant_id, is_default_group=1).

INSERT OR IGNORE INTO threads (
  id, tenant_id, kind, title, client_conversation_id, dm_key,
  created_by_web_user_id, created_at, last_message_at,
  last_message_preview, archived, is_default_group
)
SELECT
  'th_def_' || t.id,
  t.id,
  'staff_group',
  'Команда',
  NULL,
  NULL,
  (SELECT wu.id FROM web_users wu
     WHERE wu.tenant_id = t.id AND wu.role = 'tenant_owner'
     LIMIT 1),
  CAST(strftime('%s','now') AS INTEGER),
  CAST(strftime('%s','now') AS INTEGER),
  NULL,
  0,
  1
FROM tenants t;

-- Seed the tenant_owner as the only initial owner-role member.
INSERT OR IGNORE INTO thread_members (
  thread_id, member_kind, member_ref, role, joined_at,
  muted_until, last_read_message_id, last_read_at
)
SELECT
  'th_def_' || t.id,
  'web_user',
  wu.id,
  'owner',
  CAST(strftime('%s','now') AS INTEGER),
  NULL,
  NULL,
  NULL
FROM tenants t
JOIN web_users wu
  ON wu.tenant_id = t.id AND wu.role = 'tenant_owner';

-- Seed every active master that already has a web_users row.
INSERT OR IGNORE INTO thread_members (
  thread_id, member_kind, member_ref, role, joined_at,
  muted_until, last_read_message_id, last_read_at
)
SELECT
  'th_def_' || m.tenant_id,
  'web_user',
  m.web_user_id,
  'member',
  CAST(strftime('%s','now') AS INTEGER),
  NULL,
  NULL,
  NULL
FROM masters m
WHERE m.web_user_id IS NOT NULL
  AND m.active = 1
  AND m.archived_at IS NULL;

-- Seed Telegram-only masters (no web_users row) as 'master' placeholders.
-- `linkMasterPlaceholderToWebUser` already knows how to promote these to
-- web_user rows when the master joins web.
INSERT OR IGNORE INTO thread_members (
  thread_id, member_kind, member_ref, role, joined_at,
  muted_until, last_read_message_id, last_read_at
)
SELECT
  'th_def_' || m.tenant_id,
  'master',
  CAST(m.chat_id AS TEXT),
  'member',
  CAST(strftime('%s','now') AS INTEGER),
  NULL,
  NULL,
  NULL
FROM masters m
WHERE m.web_user_id IS NULL
  AND m.active = 1
  AND m.archived_at IS NULL;
