-- Migration 0077 — service_categories table (PR-1: salon-owner "lists of services")
--
-- Why:
--   • Migration 0029 added `services.category TEXT` as a denormalized free-text
--     column. The admin-app `salon.listServiceCategories` proc derives the
--     category list from DISTINCT non-null values used across rows.
--   • In practice nobody used it — the free-text input gave no list to pick
--     from, typos fragmented groups, and there was no UI to manage the set of
--     categories as an entity. Result: every salon's services tab shipped as
--     a flat list (see screenshot 2026-05-18).
--   • This migration introduces `service_categories` as the first-class list
--     entity (one row per named category per tenant). `services.category TEXT`
--     stays as the assignment column (denormalized name), so:
--       (a) Worker reads stay simple — one column on `services`, no JOIN in
--           the hot booking-keyboard path.
--       (b) Rename = atomic D1 batch: UPDATE the row in `service_categories`
--           + UPDATE all `services` rows where category = oldName.
--       (c) Delete = atomic D1 batch: UPDATE `services` to NULL or reassign
--           + DELETE the `service_categories` row.
--   • `sort_order` enables drag-to-reorder in the admin UI and stable
--     grouping in the Telegram bot's `svcKb` keyboard (where the previous
--     code grouped alphabetically by category name as a tiebreaker).
--
-- Why TEXT id (not INTEGER autoincrement):
--   • Matches the rest of the schema (svc_id, master_chat_id, plugin slugs,
--     thread ids — all TEXT). Drizzle parity is cleaner. The admin-app mints
--     an ID server-side (random hex, prefix `sc_`).
--
-- Backfill:
--   • For every tenant, every distinct non-null `services.category` value
--     becomes a `service_categories` row. sort_order = alphabetical rank
--     (matches the current admin-app rendering — no visual change at deploy).
--   • Existing `services.category` values are untouched (still the
--     denormalized name).
--
-- Backward compat:
--   • The legacy `salon.listServiceCategories` proc (returns string[] from
--     DISTINCT) keeps working — it now coexists with `serviceCategoriesList`
--     which returns the structured rows.
--   • Worker `services.js` previously ignored `category` entirely (PR also
--     fixes that data-loss bug — `saveServices` did DELETE + re-INSERT
--     without persisting `category`, so any Telegram-side service edit
--     nuked all categories the admin set on the web).

CREATE TABLE IF NOT EXISTS service_categories (
  tenant_id  TEXT NOT NULL,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Stop two categories with the same name within a tenant from sneaking in.
-- Cross-tenant duplicates are fine (different salons can each have their
-- own "Маникюр").
CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_cat_tenant_name
  ON service_categories(tenant_id, name);

-- Drives the grouped-render ORDER BY in admin + public + Telegram.
CREATE INDEX IF NOT EXISTS idx_svc_cat_tenant_order
  ON service_categories(tenant_id, sort_order);

-- Backfill: lift every distinct existing category string into a row.
-- ROW_NUMBER() over alphabetical name gives a deterministic initial order
-- per tenant that matches the current admin-app sort.
INSERT INTO service_categories (tenant_id, id, name, sort_order, created_at)
SELECT
  tenant_id,
  'sc_' || lower(hex(randomblob(8))) AS id,
  category AS name,
  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY category) - 1 AS sort_order,
  strftime('%s', 'now') AS created_at
FROM (
  SELECT DISTINCT tenant_id, category
  FROM services
  WHERE category IS NOT NULL AND category != ''
);
