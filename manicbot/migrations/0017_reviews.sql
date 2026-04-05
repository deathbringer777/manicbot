-- Review & rating system.
-- reviews: stores client ratings + comments + photos after appointment completion.
-- appointments.review_requested: prevents duplicate review request messages from cron.

CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  appointment_id  TEXT,
  master_id       TEXT,
  chat_id         INTEGER NOT NULL,
  channel         TEXT DEFAULT 'telegram',
  rating          INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  text            TEXT,
  photos          TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  reply_text      TEXT,
  reply_at        INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_master ON reviews(tenant_id, master_id);
CREATE INDEX IF NOT EXISTS idx_reviews_apt ON reviews(appointment_id);

ALTER TABLE appointments ADD COLUMN review_requested INTEGER DEFAULT 0;
