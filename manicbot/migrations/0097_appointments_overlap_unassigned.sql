-- 0097_appointments_overlap_unassigned.sql — 2026-05-31
--
-- Allow overlapping bookings on a shared (no-master) calendar.
--
-- Context: migration 0044 created idx_apt_unique_active_slot keyed on
-- COALESCE(master_id, -1), which collapses every UNASSIGNED booking
-- (master_id IS NULL) to the same -1 bucket. Two manual bookings at the same
-- date/time on a salon that doesn't use masters therefore collided with a
-- UNIQUE constraint failure ("slot_conflict"), even though the owner runs one
-- shared calendar and explicitly wants Google-Calendar-style overlap.
--
-- Fix: rebuild the index so uniqueness applies ONLY to rows that HAVE a master
-- (master_id IS NOT NULL). A real master still can't be double-booked on the
-- same active slot; unassigned bookings are unconstrained and may overlap.
-- Per-master app-level conflict checks (slotsBusy) are unchanged.
--
-- IF EXISTS / IF NOT EXISTS make this safe to re-apply.

DROP INDEX IF EXISTS idx_apt_unique_active_slot;

CREATE UNIQUE INDEX IF NOT EXISTS idx_apt_unique_active_slot
  ON appointments(tenant_id, master_id, date, time)
  WHERE cancelled = 0 AND master_id IS NOT NULL;
