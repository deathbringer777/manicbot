-- 0104_photo_albums.sql — 2026-06-02
--
-- Photo albums / folders for the public salon gallery. Lets an owner group
-- gallery photos into named albums (e.g. per service type) instead of one flat
-- strip. The public /salon/{slug} page renders albums as tabs.
--
-- Additive and backward-compatible: the existing flat tenants.photos array is
-- left untouched and acts as the implicit "All / Все" default album. A salon
-- that never creates an album sees zero behavioural change. No backfill.
--
-- Two tables mirror the service_categories precedent (composite PK on
-- tenant_id; tenant_id on every row for isolation):
--   * photo_albums   — album metadata (name, optional explicit cover, order).
--   * album_photos   — ordered photos within an album; photo_r2_key retained so
--                      the asset can later be replaced/cleaned in R2.
CREATE TABLE IF NOT EXISTS photo_albums (
  tenant_id   TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  cover_url   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_photo_albums_tenant_order
  ON photo_albums(tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS album_photos (
  tenant_id    TEXT NOT NULL,
  album_id     TEXT NOT NULL,
  id           TEXT NOT NULL,
  photo_url    TEXT NOT NULL,
  photo_r2_key TEXT,
  caption      TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_album_photos_tenant_album
  ON album_photos(tenant_id, album_id, sort_order);
