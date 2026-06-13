-- 0122_platform_settings.sql — 2026-06-13
--
-- Platform-global key/value settings, operator-controlled. PLATFORM-scoped: no
-- tenant_id by design (these are system-admin switches, not tenant data).
-- tenant-scan-ignore: platform operator settings, not tenant-owned.
--
-- First consumer: `messaging_send_paused` — a SECONDARY send gate the system_admin
-- can flip from the tg-bot (/settings) to pause seasonal-campaign egress without
-- touching the env master flag MESSAGING_SEND_ENABLED. Effective seasonal send =
-- MESSAGING_SEND_ENABLED (env, master) AND NOT messaging_send_paused. Default
-- (row absent) = not paused, so this never enables sending — it can only restrict.

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL
);
