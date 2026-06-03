-- 0106_appointments_duration.sql — 2026-06-02
--
-- Calendar overhaul (Phase 3): per-appointment duration override in MINUTES,
-- decoupled from the service's nominal duration, so Google-Calendar-style
-- drag-the-bottom-edge resize can persist a custom length for one booking.
--
-- Nullable on purpose: NULL means "fall back to the service duration" (the
-- existing behaviour), so this is a safe additive change with no backfill and
-- no Worker impact (the Worker ignores the unknown nullable column).
ALTER TABLE appointments ADD COLUMN duration INTEGER;
