-- 0037_plugin_pins_fk_cascade.sql
--
-- #S12 — add FK (web_user_id) → web_users(id) ON DELETE CASCADE to plugin_pins.
--
-- The original 0036 migration created plugin_pins without a foreign key, so
-- deleting a web_user left orphaned pin rows behind forever. SQLite (D1) does
-- not support `ALTER TABLE ... ADD CONSTRAINT`, so we copy → drop → rename.
-- D1 enforces `PRAGMA foreign_keys = ON` by default, so CASCADE takes effect
-- automatically for future deletions.
--
-- The INSERT filters out any existing orphans by joining web_users — those
-- rows would violate the new FK and are by definition garbage.

CREATE TABLE plugin_pins_new (
  web_user_id  TEXT    NOT NULL,
  plugin_slug  TEXT    NOT NULL,
  pinned_at    INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (web_user_id, plugin_slug),
  FOREIGN KEY (web_user_id) REFERENCES web_users(id) ON DELETE CASCADE
);

INSERT INTO plugin_pins_new (web_user_id, plugin_slug, pinned_at, sort_order)
SELECT p.web_user_id, p.plugin_slug, p.pinned_at, p.sort_order
  FROM plugin_pins p
  JOIN web_users  w ON w.id = p.web_user_id;

DROP TABLE plugin_pins;
ALTER TABLE plugin_pins_new RENAME TO plugin_pins;

CREATE INDEX IF NOT EXISTS idx_plugin_pins_user    ON plugin_pins (web_user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_plugin_pins_user_at ON plugin_pins (web_user_id, pinned_at);
