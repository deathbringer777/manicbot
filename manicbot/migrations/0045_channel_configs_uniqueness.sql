-- 0045: prevent two tenants registering the same Meta page/phone (P1-4)
--
-- The previous schema enforced UNIQUE(tenant_id, channel_type) — i.e. each
-- tenant can have one IG and one WA — but it did NOT prevent two distinct
-- tenants from claiming the SAME page_id/phone_number_id.
-- Resolver does LIMIT 1 across active configs and would silently route a
-- webhook to whichever tenant the SQLite scan saw first.
--
-- Fix: denormalize the JSON config into typed columns and add partial UNIQUE
-- indexes scoped to active rows. Backfill from json_extract on existing rows.
-- Workers writing channel_configs MUST populate these columns going forward
-- (see manicbot/src/channels/storage.js). The resolver continues to fall
-- back to the JSON path for any pre-0045 rows that haven't been re-saved.

ALTER TABLE channel_configs ADD COLUMN page_id TEXT;
ALTER TABLE channel_configs ADD COLUMN phone_number_id TEXT;
ALTER TABLE channel_configs ADD COLUMN ig_business_id TEXT;

UPDATE channel_configs
SET page_id = json_extract(config, '$.page_id')
WHERE config IS NOT NULL AND json_extract(config, '$.page_id') IS NOT NULL;

UPDATE channel_configs
SET phone_number_id = json_extract(config, '$.phone_number_id')
WHERE config IS NOT NULL AND json_extract(config, '$.phone_number_id') IS NOT NULL;

UPDATE channel_configs
SET ig_business_id = json_extract(config, '$.instagram_business_id')
WHERE config IS NOT NULL AND json_extract(config, '$.instagram_business_id') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_page_id        ON channel_configs(channel_type, page_id);
CREATE INDEX IF NOT EXISTS idx_cc_phone          ON channel_configs(channel_type, phone_number_id);
CREATE INDEX IF NOT EXISTS idx_cc_ig_biz         ON channel_configs(channel_type, ig_business_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_unique_page_id
  ON channel_configs(channel_type, page_id)
  WHERE page_id IS NOT NULL AND active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_unique_phone
  ON channel_configs(channel_type, phone_number_id)
  WHERE phone_number_id IS NOT NULL AND active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_unique_ig_biz
  ON channel_configs(channel_type, ig_business_id)
  WHERE ig_business_id IS NOT NULL AND active = 1;
