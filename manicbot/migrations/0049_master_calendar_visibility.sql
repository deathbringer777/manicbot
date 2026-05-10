-- 0049_master_calendar_visibility.sql — 2026-05-10
--
-- Add `calendar_visibility` column to `masters` so each master can choose
-- who sees their schedule beyond the salon owner.
--
-- Rationale (from §12.2 of the Booksy comparison plan):
--   * Salon owner ALWAYS sees all masters' calendars (non-negotiable for
--     booking management — enforced in tRPC, not in this column).
--   * The master ALWAYS sees their own calendar.
--   * Whether *peers* (other masters in the same tenant) see this master's
--     schedule is the master's choice.
--
-- Values:
--   'salon_only'      — default for salon-created and Telegram-bound masters.
--                       Salon owner sees, other masters do NOT.
--   'salon_and_peers' — opt-in. All other masters of the same tenant can
--                       view this master's schedule.
--   'private'         — only the master themselves. Used by personal-tenant
--                       masters (`tenants.is_personal=1`) where there are
--                       no peers and the salon owner is the master.
--
-- Salon-owner visibility is enforced by tRPC guards (assertTenantOwner /
-- assertMaster) and is independent of this column. Migration is additive
-- and backwards compatible.

ALTER TABLE masters ADD COLUMN calendar_visibility TEXT NOT NULL DEFAULT 'salon_only';

CREATE INDEX IF NOT EXISTS idx_masters_calendar_visibility
  ON masters(tenant_id, calendar_visibility);
