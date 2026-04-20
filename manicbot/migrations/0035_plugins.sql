-- 0035_plugins.sql — Plugin Marketplace.
--
-- Internal (1st-party) plugin installations + lifecycle audit trail.
--
-- Scope:
--   tenant_id IS NULL  → platform-wide install (system_admin). Visible/active
--                         for every tenant that also passes role+plan gate.
--   tenant_id = 't_xxx' → tenant-local install (tenant_owner or tenant_manager).
--
-- Resolution order at runtime: platform install wins if present, else tenant install.
--
-- billing_state:
--   not_applicable | included | paid | trialing | past_due | canceled
-- Set by lifecycle + Stripe webhooks (invoice.paid carries line.price.metadata.plugin_slug).
--
-- Permissions a plugin will touch are described in its in-code manifest
-- (not in DB — keeps them type-checked and versioned with source).

CREATE TABLE IF NOT EXISTS plugin_installations (
  id                          TEXT    PRIMARY KEY,         -- uuid
  tenant_id                   TEXT,                         -- NULL = platform-wide
  plugin_slug                 TEXT    NOT NULL,             -- manifest.slug
  enabled                     INTEGER NOT NULL DEFAULT 1,
  version                     TEXT    NOT NULL,             -- snapshot of manifest.version
  installed_by                TEXT    NOT NULL,             -- web_user id
  installed_at                INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  settings_json               TEXT,                         -- per-install JSON config
  billing_state               TEXT    NOT NULL DEFAULT 'not_applicable',
  stripe_subscription_item_id TEXT,                         -- paid_addon_monthly
  stripe_payment_intent_id    TEXT                          -- paid_addon_onetime
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_inst_scope_slug
  ON plugin_installations (COALESCE(tenant_id, '__platform__'), plugin_slug);
CREATE INDEX IF NOT EXISTS idx_plugin_inst_tenant ON plugin_installations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_plugin_inst_slug   ON plugin_installations (plugin_slug);
CREATE INDEX IF NOT EXISTS idx_plugin_inst_billing ON plugin_installations (billing_state);

CREATE TABLE IF NOT EXISTS plugin_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id    TEXT    NOT NULL,
  event              TEXT    NOT NULL,                 -- installed|uninstalled|enabled|disabled|settings_updated|billing_state_changed|error
  actor_web_user_id  TEXT,
  detail_json        TEXT,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plugin_events_inst    ON plugin_events (installation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_events_created ON plugin_events (created_at);
