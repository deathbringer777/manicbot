-- Migration 0063: Reminders plugin + platform notification surface.
--
-- Introduces:
--   * plugin_reminders          — per-tenant reminder/routine definitions
--                                 (recurrence DSL in JSON column).
--   * plugin_reminder_fires     — append-only fire log + idempotency guard
--                                 keyed by (reminder_id, fires_at_epoch).
--   * user_notifications        — platform-wide in-app notification feed
--                                 consumed by the header bell. Not specific
--                                 to plugins — any subsystem can write.
--
-- Together these tables power the reminders plugin runtime (cron expands
-- recurrence → INSERT OR IGNORE into fires → notifyWebUser fans out to
-- in-app + Telegram) AND the foundation for future plugins
-- (checklists, marketing scripts) that need the same surfaces.

-- ─── plugin_reminders ──────────────────────────────────────────────────────
-- One row per reminder/routine the user creates. Recurrence is stored as
-- JSON validated at the tRPC boundary by zod; the DB only enforces shape.
-- starts_on + time are the anchor — recurrence_json is interpreted relative
-- to them in the tenant's local TZ (defaults to Europe/Warsaw via the
-- tenants.timezone column).
CREATE TABLE IF NOT EXISTS plugin_reminders (
  id                       TEXT PRIMARY KEY,                       -- ULID
  tenant_id                TEXT NOT NULL,
  created_by_web_user_id   TEXT NOT NULL,                          -- web_users.id (TEXT, matches schema)
  target_master_id         INTEGER,                                -- masters.chat_id (nullable = owner/unassigned)
  kind                     TEXT NOT NULL DEFAULT 'reminder'        -- UI-only label
                           CHECK (kind IN ('reminder','routine')),
  title                    TEXT NOT NULL,
  note                     TEXT,
  starts_on                TEXT NOT NULL,                          -- YYYY-MM-DD, anchor date
  time                     TEXT NOT NULL,                          -- HH:MM 24h, local time
  recurrence_json          TEXT NOT NULL,                          -- Recurrence DSL JSON
  channels_json            TEXT NOT NULL DEFAULT '["inapp"]',      -- subset of: inapp, telegram
  archived_at              INTEGER,                                -- soft delete (unix seconds)
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Active reminders per tenant (calendar query) — partial index skips archived.
CREATE INDEX IF NOT EXISTS idx_reminders_tenant_active
  ON plugin_reminders(tenant_id, starts_on)
  WHERE archived_at IS NULL;

-- Per-master active reminders — feeds the master-column chip rendering.
CREATE INDEX IF NOT EXISTS idx_reminders_target
  ON plugin_reminders(tenant_id, target_master_id, starts_on)
  WHERE archived_at IS NULL;

-- ─── plugin_reminder_fires ─────────────────────────────────────────────────
-- Append-only log of each occurrence the cron decided to fire. The UNIQUE
-- index on (reminder_id, fires_at_epoch) IS the idempotency guarantee:
-- INSERT OR IGNORE in the cron loop returns changes=0 if this occurrence
-- was already fired in an earlier cron tick.
CREATE TABLE IF NOT EXISTS plugin_reminder_fires (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id     TEXT NOT NULL REFERENCES plugin_reminders(id) ON DELETE CASCADE,
  fires_at_epoch  INTEGER NOT NULL,                                -- the specific occurrence in unix seconds
  fired_at_epoch  INTEGER,                                         -- when cron actually delivered (NULL = pending)
  delivery_state  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (delivery_state IN ('pending','sent','failed')),
  delivery_error  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_fires_occurrence
  ON plugin_reminder_fires(reminder_id, fires_at_epoch);

-- ─── user_notifications ────────────────────────────────────────────────────
-- Platform-wide in-app notification feed. The reminders plugin is the first
-- caller (kind='reminder.fired') but the table is intentionally generic so
-- any future feature (checklists, marketing automations, billing alerts)
-- can write into the same feed and surface through the bell in Shell.tsx.
--
-- tenant_id is nullable for platform-scope notifications targeted at
-- system_admin / support roles.
CREATE TABLE IF NOT EXISTS user_notifications (
  id            TEXT PRIMARY KEY,                                  -- ULID
  tenant_id     TEXT,
  web_user_id   TEXT NOT NULL,                                     -- web_users.id
  kind          TEXT NOT NULL,                                     -- e.g. 'reminder.fired'
  title         TEXT NOT NULL,
  body          TEXT,
  link          TEXT,                                              -- e.g. '/plugin/reminders?id=...'
  source_slug   TEXT,                                              -- plugin slug that emitted it
  source_id     TEXT,                                              -- e.g. reminder_id or fire_id
  read_at       INTEGER,                                           -- unix seconds; NULL = unread
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Unread feed by user (bell dropdown query path).
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON user_notifications(web_user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Full feed by user (history view, capped via LIMIT in router).
CREATE INDEX IF NOT EXISTS idx_user_notifications_recent
  ON user_notifications(web_user_id, created_at DESC);

-- Dedup index — used by INSERT OR IGNORE in userNotify when source_slug +
-- source_id + kind are populated. Lets the cron retry safely without
-- creating duplicate bell entries when delivery state changes after the
-- in-app row is already in.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notifications_source
  ON user_notifications(web_user_id, source_slug, source_id, kind)
  WHERE source_slug IS NOT NULL AND source_id IS NOT NULL;
