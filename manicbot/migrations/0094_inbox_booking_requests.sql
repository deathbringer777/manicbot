-- Migration 0094: booking-request cards in the staff inbox
--
-- The staff "Messages" inbox becomes a booking-requests board: every new
-- appointment (from any channel) posts a request card into a per-tenant
-- "Заявки" thread (kind='requests'), and assigned bookings additionally ping
-- the assigned master. Whoever confirms an unassigned request first claims it.
--
-- This migration only adds the storage primitives; the write path lives in
-- src/services/messengerRequests.js and src/notifications.js.
--
-- 1. ref_kind / ref_id let a thread_messages row reference a domain object
--    (e.g. ref_kind='booking_request', ref_id=<appointments.id>) so the UI can
--    render it as an actionable card instead of a plain text bubble.
-- 2. meta_json carries a denormalized snapshot (service, datetime, client,
--    channel, autoConfirmed, status-at-post) so the card renders without a join
--    and survives even if the appointment row later changes.
ALTER TABLE thread_messages ADD COLUMN ref_kind TEXT;
ALTER TABLE thread_messages ADD COLUMN ref_id TEXT;
ALTER TABLE thread_messages ADD COLUMN meta_json TEXT;

-- Fast lookup of the card(s) for a given appointment (idempotent re-posts).
CREATE INDEX IF NOT EXISTS idx_thread_messages_ref
  ON thread_messages(tenant_id, ref_kind, ref_id);

-- At most one "Заявки" requests thread per tenant. The thread id is
-- deterministic ('rq_' || tenant_id) so find-or-create is race-safe; this
-- partial unique index is the backstop.
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_requests_per_tenant
  ON threads(tenant_id) WHERE kind = 'requests';
