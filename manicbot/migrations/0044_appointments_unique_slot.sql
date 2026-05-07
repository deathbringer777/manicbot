-- 0044: lock active booking slots against double-booking (P0-1)
--
-- The previous code path was:
--   getSlots() → KV-lock → getSlots() → saveApt(INSERT)
-- Two D1 reads with no atomic check-then-insert: under concurrent load the
-- same (tenant, master, date, time) could be written twice.
--
-- Strategy: a partial UNIQUE index over only non-cancelled rows. Cancelled
-- appointments do not occupy the slot, so they are excluded from the
-- constraint — clients can re-book a cancelled time.
--
-- Pre-cleanup is required: any pre-existing duplicates would block index
-- creation. We auto-cancel duplicates beyond the first (by created_at), tag
-- them with cancel_reason='auto_dedup_0044' for audit, and only then build
-- the index.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, COALESCE(master_id, -1), date, time
      ORDER BY (cancelled = 0) DESC, created_at ASC, id ASC
    ) AS rn
  FROM appointments
  WHERE cancelled = 0
)
UPDATE appointments
SET
  cancelled = 1,
  status = 'cancelled',
  cancelled_by = 'system',
  cancelled_at = strftime('%s','now'),
  cancel_reason = 'auto_dedup_0044'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  AND cancelled = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_apt_unique_active_slot
  ON appointments(tenant_id, COALESCE(master_id, -1), date, time)
  WHERE cancelled = 0;
