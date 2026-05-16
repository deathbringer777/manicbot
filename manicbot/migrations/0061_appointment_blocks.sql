-- 0061_appointment_blocks.sql — 2026-05-16
--
-- Calendar overhaul: introduce a separate `appointment_blocks` table so
-- masters/owners can mark slots as occupied without booking a real client.
-- Two block types are supported:
--
--   * `reservation` — single short slot the master holds for themselves
--     ("прогрев лампы", "доделать дизайн", "образец"). Renders as a hatched
--     grey block in the day/week grid; behaves like a busy slot for the
--     conflict check used by `appointments.createManual`.
--
--   * `time_off`   — break / day off / vacation. May span a single time
--     window (`reason='Обед'`, 60 min) OR a multi-day range
--     (`end_date != date`). Used by the new "Перерыв / выходной" FAB
--     scenario that previously read СКОРО / disabled in QuickAddFab.
--
-- Why a new table instead of overloading `appointments`:
--   * `appointments.chat_id` and `svc_id` are NOT NULL today. Loosening
--     them would touch ~30 callers and risk silent NULL-handling bugs in
--     the booking, notification and Google sync flows.
--   * Blocks have no client, no service, and don't notify Telegram.
--   * Keeping the schema separate lets us deny client-self-booking
--     against blocks via a single helper (`slotsBusy()`) rather than
--     teaching every reader to skip rows where `chat_id IS NULL`.
--
-- Conflict semantics (enforced in code, not by SQL): both
-- `appointments.createManual` and `appointmentBlocks.create` must call
-- the shared `slotsBusy()` helper that unions appointments + blocks for
-- the (tenant, master, date, time, duration) tuple.

CREATE TABLE IF NOT EXISTS appointment_blocks (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  master_id     INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('reservation','time_off')),
  date          TEXT NOT NULL,                   -- YYYY-MM-DD (start day)
  time          TEXT NOT NULL,                   -- HH:MM (start, 24h)
  duration_min  INTEGER NOT NULL,                -- minutes; for multi-day time_off this covers day 1
  end_date      TEXT,                            -- YYYY-MM-DD when type='time_off' spans >1 day; NULL otherwise
  reason        TEXT,                            -- free text shown on the block; <= 200 chars enforced in tRPC
  created_at    INTEGER NOT NULL,
  created_by    TEXT,                            -- web_user.id of the salon owner / master who placed the block
  cancelled     INTEGER NOT NULL DEFAULT 0
);

-- Range scan by master+date for the per-master day/week views and the
-- shared `slotsBusy()` conflict helper.
CREATE INDEX IF NOT EXISTS idx_apt_blocks_master_date
  ON appointment_blocks(tenant_id, master_id, date)
  WHERE cancelled = 0;

-- Range scan by tenant+date for the cross-master week view + month view.
CREATE INDEX IF NOT EXISTS idx_apt_blocks_tenant_date
  ON appointment_blocks(tenant_id, date)
  WHERE cancelled = 0;
