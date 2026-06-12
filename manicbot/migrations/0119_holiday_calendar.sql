-- 0119_holiday_calendar.sql — 2026-06-12
--
-- System & Seasonal Messaging service, part 2/3. The Polish recurring-occasions
-- database that the ThinkPad content-plan builder reads to schedule seasonal
-- greetings/offers. Populated by the holidays-sync cron (date-holidays npm for
-- PL public holidays + a curated commercial-dates.json for beauty-industry
-- dates) through the Worker /admin/messaging/holidays-upsert seam.
--
-- Scope: PLATFORM-level, no tenant_id (it describes the calendar, not tenant
-- data) — same rationale as platform_campaigns. tenant-scan-ignore: platform
-- occasion catalogue, not tenant-owned.
--
-- Names carried in all four product locales (PL/RU/UK/EN) so a seasonal campaign
-- can render in the tenant's locale with an EN fallback. `type` separates legal
-- public holidays from observances and commercially-relevant dates so the
-- planner can weight them. UNIQUE(occasion_key, date) makes the sync idempotent
-- (re-running a year never duplicates a row); a recurring occasion gets one row
-- per concrete calendar date as the sync rolls the year forward.

CREATE TABLE IF NOT EXISTS holiday_calendar (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,              -- 'YYYY-MM-DD' (concrete date for the year)
  country           TEXT NOT NULL DEFAULT 'PL',
  occasion_key      TEXT NOT NULL,              -- stable slug, e.g. 'womens_day', 'valentines'
  name_pl           TEXT,
  name_ru           TEXT,
  name_uk           TEXT,
  name_en           TEXT,
  type              TEXT NOT NULL DEFAULT 'observance', -- 'public' | 'observance' | 'commercial'
  recurrence_json   TEXT,                       -- advisory {freq:'yearly', month, day} for the planner
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_holiday_occasion_date
  ON holiday_calendar(occasion_key, date);
CREATE INDEX IF NOT EXISTS idx_holiday_date
  ON holiday_calendar(date);
