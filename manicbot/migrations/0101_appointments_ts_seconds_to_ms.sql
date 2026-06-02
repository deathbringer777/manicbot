-- 0101_appointments_ts_seconds_to_ms.sql — 2026-06-02
--
-- BUG-05 / BUG-01 repair. Before the admin-app fix, createManual /
-- rescheduleAppointment / update wrote appointments.ts in SECONDS + raw UTC
-- instead of the canonical epoch MILLISECONDS (Warsaw->UTC) used by the Worker
-- bot, cron reminders, Google Calendar sync, monthly stats and phase-cleanup.
-- Any appointment persisted from the admin UI in that window holds a seconds
-- value (~1.7e9) where the rest of the system expects ms (~1.7e12): it gets no
-- reminders, is skipped by GCal sync, is undercounted in stats, and is eligible
-- for premature cleanup.
--
-- This one-shot repair rescales any seconds-scale ts up to ms. The threshold
-- 10000000000 (1e10) cleanly separates the two regimes: a real second-epoch
-- value (now ~1.7e9) is < 1e10, while a real ms-epoch value (now ~1.7e12) is
-- >> 1e10 — so a correctly-stored ms row is NEVER touched. Idempotent: a second
-- apply finds nothing below 1e10 (all rows are already ms). Safe no-op on a
-- clean pre-launch DB. The ts > 0 guard skips any zero/sentinel rows.
UPDATE appointments
SET ts = ts * 1000
WHERE ts > 0 AND ts < 10000000000;
