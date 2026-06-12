-- 0118_messaging_templates_extend.sql — 2026-06-12
--
-- System & Seasonal Messaging service, part 1/3. Extends the existing
-- platform_message_templates (migration 0100/0116) into a keyed, per-locale,
-- approval-gated library so the new reactive engine + the ThinkPad preset
-- generator can address templates by a stable key and resolve a tenant's locale
-- with an EN fallback.
--
-- Why extend, not a new table: the dispatch engine, the delivery ledger, and the
-- Рассылки hub already read/write platform_message_templates. A parallel table
-- would fork the idempotency + UI surface. This is one ecosystem.
--
-- New columns (all additive, nullable or defaulted — no backfill of existing
-- author rows needed beyond the builtin status bump):
--   * template_key  — stable identity shared across the 4 locale rows of one
--                     preset (e.g. 'sys_payment_failed'); NULL for legacy
--                     author-created rows that have no key.
--   * status        — 'draft' | 'approved' | 'archived'. New presets land as
--                     'draft' (nothing is deliverable until an operator approves
--                     via the hub or the tg-bot /approve). The 7 builtin starters
--                     (is_builtin=1) are trusted → backfilled to 'approved'.
--   * variables_json — declared {token} contract for the body, so the reactive
--                     resolver can hard-fail in tests when a required var is
--                     missing instead of silently shipping a '{token}' literal.
--
-- Partial UNIQUE(template_key, locale): at most one row per (key, locale). NULL
-- template_key rows (legacy) are exempt (SQLite UNIQUE allows multiple NULLs),
-- matching the newsletter confirm-token partial-index pattern.

ALTER TABLE platform_message_templates ADD COLUMN template_key TEXT;
ALTER TABLE platform_message_templates ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE platform_message_templates ADD COLUMN variables_json TEXT;

-- Builtins are trusted, read-only starters → immediately deliverable.
UPDATE platform_message_templates SET status = 'approved' WHERE is_builtin = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pmt_template_key_locale
  ON platform_message_templates(template_key, locale)
  WHERE template_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pmt_status
  ON platform_message_templates(status);
