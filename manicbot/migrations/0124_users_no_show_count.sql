-- 0124_users_no_show_count.sql — 2026-06-16
--
-- Per-client no-show reliability counter. Incremented only when a CLIENT
-- no-show is recorded (`appointment.no_show_client`) — never for a master
-- no-show, which is the salon's fault, not the client's. Powers the
-- "unreliable client" yellow-dot flag (profile / calendar popover / clients
-- list), the rebooking warning, and the per-tenant no-show policy engine
-- (`tenant_config` key `no_show_policy`). Defaults to 0; bumped via UPDATE in
-- dispatchAppointmentAutomation, mirroring the existing lifetime_visits bump.

ALTER TABLE users ADD COLUMN no_show_count INTEGER NOT NULL DEFAULT 0;
