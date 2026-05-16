-- 0062_clients_overhaul.sql — 2026-05-16
--
-- Clients tab overhaul: production-grade CRM for the Salon dashboard.
--
-- Why: the existing Clients tab was a phone-only list capped at 200 rows
-- with no search, no filters, no card view, no import/export, and no link
-- to the marketing module. Salon owners couldn't manage clients without
-- creating an appointment first; masters had no way to refuse a specific
-- client. This migration lays the data foundation for the full overhaul:
--
--   1. Multi-channel contacts on `users` (email, ig_username, notes, tags,
--      lifetime stats, soft-delete, per-tenant global block).
--   2. FTS5 virtual table `users_fts` + triggers — keystroke search across
--      name / phone / tg / email / ig / tags, locale-aware via the
--      `unicode61 remove_diacritics 1` tokenizer that already serves
--      `tenant_fts` (migration 0054).
--   3. New `master_client_blocks` table for per-master client blacklists
--      (master hides specific clients from their slot picker; enforced
--      in Worker `services/appointments.js` slot eligibility).
--   4. Backlink `users.marketing_contact_id` <-> `marketing_contacts.linked_user_chat_id`
--      so the new Clients router auto-syncs every create/update with the
--      marketing module (deduped lead directory, unified ID).
--   5. Per-tenant UNIQUE on `marketing_contacts(tenant_id, email)` instead
--      of the broken platform-wide UNIQUE that caused cross-tenant email
--      collisions. Also makes `email` nullable — booking-flow clients
--      arrive phone-first, the platform-wide UNIQUE forced synthetic
--      emails which broke marketing send filters.
--
-- Safety:
--   * Every new column on `users` is additive (no rewrite).
--   * `marketing_contacts` is rebuilt via the SQLite copy-drop-rename dance
--     because SQLite cannot DROP NOT NULL in place. IDs are preserved by
--     copying the AUTOINCREMENT column directly, so `marketing_sends.contact_id`
--     and `marketing_consent_log.contact_id` foreign references stay valid.
--   * FTS5 backfill is idempotent: triggers fire on subsequent writes; the
--     initial INSERT seeds the table from the current `users` snapshot.
--
-- Pre-flight check (caller MUST run before applying):
--   SELECT tenant_id, email, COUNT(*) c FROM marketing_contacts
--   WHERE email IS NOT NULL GROUP BY tenant_id, email HAVING c > 1;
--   -- Must return 0 rows. If not, dedup first.

-- ─── 1. Extend users with multi-channel contacts ───────────────────────────────
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN ig_username TEXT;
ALTER TABLE users ADD COLUMN notes TEXT;
ALTER TABLE users ADD COLUMN tags TEXT;
ALTER TABLE users ADD COLUMN marketing_contact_id INTEGER;
ALTER TABLE users ADD COLUMN is_blocked_global INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN blocked_global_reason TEXT;
ALTER TABLE users ADD COLUMN blocked_global_at INTEGER;
ALTER TABLE users ADD COLUMN updated_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE users ADD COLUMN lifetime_visits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_visit_at INTEGER;

-- Indexes on the new columns
CREATE INDEX IF NOT EXISTS idx_users_tenant_email     ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_ig        ON users(tenant_id, ig_username);
CREATE INDEX IF NOT EXISTS idx_users_marketing_id     ON users(marketing_contact_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant_blocked   ON users(tenant_id, is_blocked_global);
CREATE INDEX IF NOT EXISTS idx_users_tenant_deleted   ON users(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant_last_visit ON users(tenant_id, last_visit_at);

-- ─── 2. FTS5 search index for clients ──────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(
  tenant_id UNINDEXED,
  chat_id   UNINDEXED,
  search_text,
  tokenize='unicode61 remove_diacritics 1'
);

-- Backfill: seed from the current users snapshot (idempotent — safe to re-run).
DELETE FROM users_fts;
INSERT INTO users_fts(tenant_id, chat_id, search_text)
SELECT tenant_id, chat_id,
  lower(
    coalesce(name,'') || ' ' ||
    coalesce(phone,'') || ' ' ||
    coalesce(tg_username,'') || ' ' ||
    coalesce(email,'') || ' ' ||
    coalesce(ig_username,'') || ' ' ||
    coalesce(tags,'')
  )
FROM users
WHERE deleted_at IS NULL;

-- INSERT trigger: index every new client.
CREATE TRIGGER IF NOT EXISTS users_fts_ai
AFTER INSERT ON users
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO users_fts(tenant_id, chat_id, search_text)
  VALUES (NEW.tenant_id, NEW.chat_id,
    lower(
      coalesce(NEW.name,'') || ' ' ||
      coalesce(NEW.phone,'') || ' ' ||
      coalesce(NEW.tg_username,'') || ' ' ||
      coalesce(NEW.email,'') || ' ' ||
      coalesce(NEW.ig_username,'') || ' ' ||
      coalesce(NEW.tags,'')
    )
  );
END;

-- UPDATE trigger: re-index on any column change (canonical FTS5 pattern —
-- delete-then-insert keyed on the UNINDEXED `tenant_id`+`chat_id` pair).
-- Skips re-insertion for soft-deleted rows so search ignores them.
CREATE TRIGGER IF NOT EXISTS users_fts_au
AFTER UPDATE ON users
BEGIN
  DELETE FROM users_fts WHERE tenant_id = OLD.tenant_id AND chat_id = OLD.chat_id;
  INSERT INTO users_fts(tenant_id, chat_id, search_text)
  SELECT NEW.tenant_id, NEW.chat_id,
    lower(
      coalesce(NEW.name,'') || ' ' ||
      coalesce(NEW.phone,'') || ' ' ||
      coalesce(NEW.tg_username,'') || ' ' ||
      coalesce(NEW.email,'') || ' ' ||
      coalesce(NEW.ig_username,'') || ' ' ||
      coalesce(NEW.tags,'')
    )
  WHERE NEW.deleted_at IS NULL;
END;

-- DELETE trigger: drop the FTS row when a user is hard-deleted.
CREATE TRIGGER IF NOT EXISTS users_fts_ad
AFTER DELETE ON users
BEGIN
  DELETE FROM users_fts WHERE tenant_id = OLD.tenant_id AND chat_id = OLD.chat_id;
END;

-- ─── 3. Master-client blocks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_client_blocks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  master_chat_id  INTEGER NOT NULL,
  client_chat_id  INTEGER NOT NULL,
  reason          TEXT,
  blocked_by      INTEGER NOT NULL,
  blocked_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcb_uniq    ON master_client_blocks(tenant_id, master_chat_id, client_chat_id);
CREATE INDEX        IF NOT EXISTS idx_mcb_client  ON master_client_blocks(tenant_id, client_chat_id);
CREATE INDEX        IF NOT EXISTS idx_mcb_master  ON master_client_blocks(tenant_id, master_chat_id);

-- ─── 4. Rebuild marketing_contacts: email nullable, per-tenant UNIQUE, +linked_user_chat_id ──
-- SQLite can't DROP NOT NULL in place; copy-drop-rename dance.
-- IDs are preserved (AUTOINCREMENT id copied 1:1) so existing
-- marketing_sends.contact_id and marketing_consent_log.contact_id references stay valid.

CREATE TABLE marketing_contacts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,                                    -- now nullable
  name TEXT,
  phone TEXT,
  source TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  lead_count INTEGER NOT NULL DEFAULT 1,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT,
  tags TEXT,
  custom_fields TEXT,
  consent_email INTEGER NOT NULL DEFAULT 1,
  consent_sms INTEGER NOT NULL DEFAULT 0,
  brevo_contact_id TEXT,
  unsubscribe_token TEXT,
  locale TEXT,
  lifecycle_stage TEXT,
  linked_user_chat_id INTEGER
);

-- Column order matches the original table; new column appended at the end with NULL.
INSERT INTO marketing_contacts_new
  (id, email, name, phone, source, first_seen_at, last_seen_at, lead_count,
   unsubscribed, tenant_id, tags, custom_fields, consent_email, consent_sms,
   brevo_contact_id, unsubscribe_token, locale, lifecycle_stage, linked_user_chat_id)
SELECT
  id, email, name, phone, source, first_seen_at, last_seen_at, lead_count,
  unsubscribed, tenant_id, tags, custom_fields, consent_email, consent_sms,
  brevo_contact_id, unsubscribe_token, locale, lifecycle_stage, NULL
FROM marketing_contacts;

DROP TABLE marketing_contacts;
ALTER TABLE marketing_contacts_new RENAME TO marketing_contacts;

-- Recreate the indexes (they were dropped with the old table).
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_tenant_email
  ON marketing_contacts(tenant_id, email)
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_tenant_phone
  ON marketing_contacts(tenant_id, phone)
  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_phone      ON marketing_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_last_seen  ON marketing_contacts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_tenant     ON marketing_contacts(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_unsub_tok
  ON marketing_contacts(unsubscribe_token)
  WHERE unsubscribe_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_linked_user
  ON marketing_contacts(tenant_id, linked_user_chat_id);
