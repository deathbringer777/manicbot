-- ── Marketing contacts: deduplicated directory for email/SMS marketing ──
-- Populated from every successful /api/leads insert. Unique by email (lower).
-- Keeps first_seen_at so you can segment by cohort; last_seen_at updates on
-- every re-submission. `phone` is kept as latest value; `sources` is a CSV of
-- origins (landing, booking, etc.) for audience builders.

CREATE TABLE IF NOT EXISTS marketing_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  source TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  lead_count INTEGER NOT NULL DEFAULT 1,
  unsubscribed INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_contacts_email ON marketing_contacts(email);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_phone ON marketing_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_last_seen ON marketing_contacts(last_seen_at);
