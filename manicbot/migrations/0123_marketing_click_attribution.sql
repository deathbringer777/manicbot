-- 0123_marketing_click_attribution.sql — 2026-06-16
--
-- First-party click tracking + conversion attribution for email campaigns.
--
-- (a) marketing_link_clicks — one row per click on a tracked campaign link.
--     Campaign emails rewrite their http(s) links through a signed Worker
--     redirect (/r/<token>); the redirect verifies the HMAC token, logs the
--     click here (tenant_id / campaign_id / send_id / contact_id / url, with a
--     salted ip_hash — never the raw IP), then 302s to the real destination.
--     This is independent of Resend's own click webhook (which only sets
--     marketing_sends.clicked_at): this table is per-link granular and is the
--     attribution source for conversions below.
--
-- (b) marketing_conversions — an appointment booked by a contact who clicked a
--     campaign, created after the click and within CONVERSION_WINDOW_DAYS.
--     Written by the phaseMarketingConversions cron (decoupled from the booking
--     hot path). Attribution is precise via users.marketing_contact_id (the
--     appointment's client → marketing_contacts row), not fuzzy phone/email.
--     UNIQUE(campaign_id, appointment_id) makes the cron idempotent so a re-run
--     can INSERT OR IGNORE without double-counting. value_cents is nullable and
--     reserved for a later revenue-weighting pass.
--
-- Both tables carry tenant_id for the tenant-isolation scanner.

CREATE TABLE IF NOT EXISTS marketing_link_clicks (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  campaign_id  TEXT NOT NULL,
  send_id      TEXT,
  contact_id   INTEGER,
  url          TEXT NOT NULL,
  clicked_at   INTEGER NOT NULL,
  ip_hash      TEXT
);
CREATE INDEX IF NOT EXISTS idx_mlc_campaign ON marketing_link_clicks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mlc_contact ON marketing_link_clicks(tenant_id, contact_id, clicked_at);

CREATE TABLE IF NOT EXISTS marketing_conversions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  campaign_id    TEXT NOT NULL,
  send_id        TEXT,
  contact_id     INTEGER,
  appointment_id TEXT,
  value_cents    INTEGER,
  converted_at   INTEGER NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mconv_appt ON marketing_conversions(campaign_id, appointment_id);
CREATE INDEX IF NOT EXISTS idx_mconv_campaign ON marketing_conversions(campaign_id);
