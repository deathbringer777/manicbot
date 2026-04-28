-- Add tenant_id to plugin_pins so pins are per-tenant, not per-user globally.
-- Drops and recreates the table (SQLite doesn't support ADD COLUMN to a PK).

PRAGMA foreign_keys = OFF;

CREATE TABLE plugin_pins_new (
  web_user_id   TEXT    NOT NULL REFERENCES web_users(id) ON DELETE CASCADE,
  tenant_id     TEXT    NOT NULL DEFAULT '',
  plugin_slug   TEXT    NOT NULL,
  pinned_at     INTEGER NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (web_user_id, tenant_id, plugin_slug)
);

-- Migrate existing rows: assign empty-string tenant so they remain visible
-- (owner will re-pin in their tenant; old cross-tenant data is intentionally cleared)
INSERT INTO plugin_pins_new (web_user_id, tenant_id, plugin_slug, pinned_at, sort_order)
SELECT web_user_id, '', plugin_slug, pinned_at, sort_order FROM plugin_pins;

DROP TABLE plugin_pins;
ALTER TABLE plugin_pins_new RENAME TO plugin_pins;

CREATE INDEX idx_plugin_pins_user ON plugin_pins (web_user_id, tenant_id, sort_order);
CREATE INDEX idx_plugin_pins_user_at ON plugin_pins (web_user_id, tenant_id, pinned_at);

PRAGMA foreign_keys = ON;
