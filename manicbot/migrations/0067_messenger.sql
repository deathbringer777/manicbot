-- Migration 0066 — internal messenger: threads / thread_members /
-- thread_messages tables for the unified inbox (staff DMs + groups + client
-- conversations).
--
-- Why:
--   • Today's `conversations` table (omni-channel: TG/IG/WA/web) is metadata-
--     only and read-only via tRPC. Salon-side has a manual-refresh inbox at
--     /conversations; masters have ZERO messaging UI; there is no way for
--     staff to DM each other or to add an internal note to a client thread.
--   • This migration introduces a unified `threads` table that holds BOTH
--     internal staff communication (DMs, group chats) AND mirrors of client
--     channel conversations. The unified table lets the UI render one inbox
--     ordered by last_message_at across all kinds, without a UNION at query
--     time. The bridge to the existing `conversations` table is the
--     `client_conversation_id` FK column (NULL for staff_dm / staff_group /
--     system threads).
--   • Per-user read state lives in thread_members.last_read_message_id —
--     unread badges are computed via a single comparison against the
--     thread's last message id (ULID = lexicographic ordering).
--
-- Thread kinds (text enum):
--   • staff_dm     — 1:1 between two web_users (salon owner / masters).
--                    Deduped by dm_key (sorted "min:max" of the two web_user
--                    ids) via a partial UNIQUE index.
--   • staff_group  — N web_users; created with a title.
--   • client_conv  — auto-created by bot-service inbound handler when a new
--                    external client message arrives. Bridges to conversations
--                    table via client_conversation_id. Mirror only — the
--                    original `conversations` row remains the source of
--                    channel-level truth.
--   • system       — system notifications (welcome, invite accepted, etc.)
--
-- Member kinds:
--   • web_user        — internal user (salon owner / master). member_ref =
--                       web_users.id.
--   • external_client — external channel client. member_ref = "<channelType>:
--                       <channelUserId>" (e.g. "tg:12345", "ig:17841...").
--                       External clients are passive — they don't write to
--                       thread_members directly; the bot-service upserts on
--                       inbound. They're modeled as members for symmetry and
--                       so the UI can render their display name from this
--                       row.
--
-- thread_messages.id: ULID (Crockford base32, 26 chars). Lexicographic sort
-- = chronological order; lets pagination use (thread_id, id < cursor) without
-- a created_at index. ULIDs are generated server-side in admin-app (via
-- a small util) and in bot-service (same util reused).
--
-- tenant_id denormalization on thread_messages is intentional: every query
-- against the messenger is tenant-scoped, and putting tenant_id directly on
-- the largest table eliminates a JOIN for the "show me my tenant's last 20
-- messages across threads" query patterns. Cost: ~16 bytes/row. Worth it.
--
-- Indexes:
--   • threads:
--       - (tenant_id, last_message_at DESC) — inbox list ordering
--       - (tenant_id, kind, archived, last_message_at DESC) — filtered views
--       - partial UNIQUE (tenant_id, dm_key) WHERE kind='staff_dm' — DM dedup
--       - partial UNIQUE (tenant_id, client_conversation_id)
--         WHERE client_conversation_id IS NOT NULL — one thread per client conv
--   • thread_members:
--       - PK (thread_id, member_kind, member_ref)
--       - (member_kind, member_ref, last_read_at) — "my threads + unread"
--   • thread_messages:
--       - (thread_id, id) — pagination cursor (id descending for newest first)
--       - (tenant_id, created_at) — analytics / cross-thread search

CREATE TABLE IF NOT EXISTS threads (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  kind                     TEXT NOT NULL,
  title                    TEXT,
  client_conversation_id   TEXT,
  dm_key                   TEXT,
  created_by_web_user_id   TEXT,
  created_at               INTEGER NOT NULL,
  last_message_at          INTEGER,
  last_message_preview     TEXT,
  archived                 INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_threads_tenant_last
  ON threads(tenant_id, last_message_at);

CREATE INDEX IF NOT EXISTS idx_threads_tenant_kind_archived
  ON threads(tenant_id, kind, archived, last_message_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_dm_unique
  ON threads(tenant_id, dm_key) WHERE kind = 'staff_dm';

CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_client_conv_unique
  ON threads(tenant_id, client_conversation_id)
  WHERE client_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS thread_members (
  thread_id              TEXT NOT NULL,
  member_kind            TEXT NOT NULL,
  member_ref             TEXT NOT NULL,
  role                   TEXT NOT NULL DEFAULT 'member',
  joined_at              INTEGER NOT NULL,
  muted_until            INTEGER,
  last_read_message_id   TEXT,
  last_read_at           INTEGER,
  PRIMARY KEY (thread_id, member_kind, member_ref)
);

CREATE INDEX IF NOT EXISTS idx_thread_members_ref
  ON thread_members(member_kind, member_ref, last_read_at);

CREATE TABLE IF NOT EXISTS thread_messages (
  id                     TEXT PRIMARY KEY,
  thread_id              TEXT NOT NULL,
  tenant_id              TEXT NOT NULL,
  sender_kind            TEXT NOT NULL,
  sender_ref             TEXT NOT NULL,
  body                   TEXT NOT NULL,
  attachments_json       TEXT,
  is_internal_note       INTEGER NOT NULL DEFAULT 0,
  external_msg_id        TEXT,
  reply_to_message_id    TEXT,
  created_at             INTEGER NOT NULL,
  edited_at              INTEGER,
  deleted_at             INTEGER
);

CREATE INDEX IF NOT EXISTS idx_thread_messages_thread
  ON thread_messages(thread_id, id);

CREATE INDEX IF NOT EXISTS idx_thread_messages_tenant_created
  ON thread_messages(tenant_id, created_at);
