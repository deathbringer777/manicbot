-- SEO audit 2026-05-20 — platform-level config store.
--
-- This table holds platform-wide settings that don't belong to any single
-- tenant. The original driver is the /about page (founder name, year
-- founded, jurisdiction, support email) which needs to be editable from
-- the God Mode panel without a code deploy.
--
-- Future uses: marketing-banner toggles, feature-flag defaults, support
-- response-time promises, anything else that's "one row for the platform"
-- and historically would have lived in env vars or a settings constant.
--
-- Access pattern: system_admin only. The tRPC `platformConfig` router
-- reads/writes here; no salon-scoped procedures touch it.

CREATE TABLE IF NOT EXISTS platform_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  updated_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_config_updated
  ON platform_config(updated_at DESC);
