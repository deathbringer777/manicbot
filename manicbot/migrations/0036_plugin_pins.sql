-- 0036_plugin_pins.sql — Per-user plugin pins (Shopify-style sidebar shortcuts).
--
-- Each (web_user_id, plugin_slug) row represents a pinned plugin for one user.
-- Independent of plugin_installations — a user can pin a platform-wide plugin
-- without owning the install row.
--
-- sort_order allows future drag-reorder (v1 inserts all with 0, ordered by pinned_at).

CREATE TABLE IF NOT EXISTS plugin_pins (
  web_user_id  TEXT    NOT NULL,
  plugin_slug  TEXT    NOT NULL,
  pinned_at    INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (web_user_id, plugin_slug)
);
CREATE INDEX IF NOT EXISTS idx_plugin_pins_user    ON plugin_pins (web_user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_plugin_pins_user_at ON plugin_pins (web_user_id, pinned_at);
