-- Migration 0076 — platform messenger: ManicBot ↔ tenant_owner DM channel
-- + broadcast/announcement fan-out.
--
-- Why:
--   • The 0067 messenger is strictly tenant-scoped (threads.tenant_id NOT
--     NULL). It powers staff-DM / staff-group / client-conv flows INSIDE a
--     single salon. There is no surface for the platform operator
--     (system_admin) to start a conversation with a tenant_owner, and no way
--     to broadcast product announcements (new features, billing changes,
--     planned downtime) to the salon-owner audience.
--   • Today the only platform → tenant_owner channel is the reactive
--     `platform_tickets` flow (owner opens a support ticket, staff replies).
--     We need a proactive channel for both 1:1 DMs and N:M broadcasts.
--
-- Why three separate tables (not extending `threads`):
--   • Platform threads are NOT tenant-scoped. Reusing the existing `threads`
--     table would require `tenant_id NOT NULL` to become nullable, which
--     would weaken the tenant-isolation invariant that every tenant-scoped
--     query relies on. Better to keep the boundary explicit: tenant-scoped
--     code never touches `platform_threads*`, period.
--   • Broadcast accounting (audience filter, recipients_count, read/reply
--     aggregates) doesn't fit the existing message schema and would clutter
--     `thread_messages` with mostly-null columns.
--
-- Tables:
--   1. platform_threads — one row PER recipient web_user (singleton DM
--      channel ManicBot ↔ owner). UNIQUE(recipient_web_user_id) enforces
--      this. Sender side is "platform" (any system_admin); recipient side
--      is one specific web_user (the salon owner / tenant_manager / master
--      account with a web login).
--   2. platform_thread_messages — append-only message log. ULID PK so
--      lexicographic order = chronological order, same trick as the 0067
--      thread_messages. `broadcast_id` groups all messages produced by a
--      single broadcast() call; NULL for direct 1:1 messages.
--   3. platform_broadcasts — audit row for each broadcast: who sent it,
--      what audience filter was used, how many recipients matched. The
--      individual message rows in platform_thread_messages reference this
--      via `broadcast_id`. Read/reply aggregates are computed on-the-fly
--      from the message table to avoid drift.
--
-- Read state:
--   • `recipient_last_read_at` — unix-seconds timestamp through which the
--     recipient has read messages from the platform. Unread badge for the
--     owner = count(messages) WHERE sender_kind='platform'
--     AND created_at > recipient_last_read_at.
--   • `platform_last_read_at` — same idea but for the system_admin side:
--     count(messages) WHERE sender_kind='owner'
--     AND created_at > platform_last_read_at.
--   • One read pointer per side is cheaper and simpler than per-message
--     read_at, and we don't need read-receipt granularity in MVP.
--
-- Indexes:
--   • UNIQUE(recipient_web_user_id) — singleton thread per owner.
--   • (last_message_at) — inbox list ordering.
--   • (archived, last_message_at) — filtered "active threads" view.
--   • platform_thread_messages: (thread_id, id) for cursor pagination
--     (ULID descending = newest first); (thread_id, created_at) for
--     unread-count queries; partial (broadcast_id) WHERE NOT NULL for
--     broadcast read-stats aggregation.
--   • platform_broadcasts: (created_at) for history list.
--
-- This migration is additive only. No existing tables touched.

CREATE TABLE IF NOT EXISTS platform_threads (
  id                       TEXT PRIMARY KEY,
  recipient_web_user_id    TEXT NOT NULL,
  recipient_tenant_id      TEXT,
  last_message_at          INTEGER,
  last_message_preview     TEXT,
  last_sender_kind         TEXT,
  recipient_last_read_at   INTEGER,
  platform_last_read_at    INTEGER,
  archived                 INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_threads_recipient
  ON platform_threads(recipient_web_user_id);

CREATE INDEX IF NOT EXISTS idx_platform_threads_last
  ON platform_threads(last_message_at);

CREATE INDEX IF NOT EXISTS idx_platform_threads_archived
  ON platform_threads(archived, last_message_at);

CREATE TABLE IF NOT EXISTS platform_thread_messages (
  id                       TEXT PRIMARY KEY,
  thread_id                TEXT NOT NULL,
  sender_kind              TEXT NOT NULL,
  sender_web_user_id       TEXT NOT NULL,
  body                     TEXT NOT NULL,
  attachments_json         TEXT,
  broadcast_id             TEXT,
  created_at               INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES platform_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ptm_thread_id
  ON platform_thread_messages(thread_id, id);

CREATE INDEX IF NOT EXISTS idx_ptm_thread_created
  ON platform_thread_messages(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ptm_broadcast
  ON platform_thread_messages(broadcast_id)
  WHERE broadcast_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform_broadcasts (
  id                       TEXT PRIMARY KEY,
  sender_web_user_id       TEXT NOT NULL,
  title                    TEXT,
  body                     TEXT NOT NULL,
  audience_filter_json     TEXT NOT NULL,
  recipients_count         INTEGER NOT NULL,
  created_at               INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_broadcasts_created
  ON platform_broadcasts(created_at);
