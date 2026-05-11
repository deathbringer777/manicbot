-- 0051_composite_indexes.sql — 2026-05-11
--
-- Close cron + analytics query gaps identified in the 2026-05-09 DB audit
-- (relax.md §7, finding "Index coverage"). All indexes are additive and
-- IF NOT EXISTS — safe to re-apply.
--
--   idx_apt_unsynced
--     Partial index for the Google Calendar sync cron path. The cron
--     scans confirmed, uncancelled, unsynced appointments per tenant
--     ordered by ts. Without this partial index the planner uses
--     idx_apt_tenant_ts and post-filters on google_event_id IS NULL +
--     status='confirmed' + cancelled=0.
--
--   idx_apt_master_date
--     MasterDashboard filters appointments by (tenant_id, master_id, date).
--     Today the planner uses idx_apt_tenant_date and post-filters in memory.
--
--   idx_apt_created
--     Recent activity queries (God Mode dashboard, marketing automations)
--     order by created_at DESC per tenant — pay a sort cost without this.
--
--   idx_conv_user
--     Unified inbox "show me this user's history" lookups; today only
--     idx_conv_tenant_msg exists (tenant_id, last_message_at) which
--     doesn't help when filtering by channel_user_id.
--
--   idx_msend_campaign_status
--     Campaign progress page reads (campaign_id, status). The existing
--     single-column indexes idx_mkt_sends_campaign and idx_mkt_sends_status
--     each only help part of the predicate.

CREATE INDEX IF NOT EXISTS idx_apt_unsynced
  ON appointments(tenant_id, ts)
  WHERE google_event_id IS NULL AND status='confirmed' AND cancelled=0;

CREATE INDEX IF NOT EXISTS idx_apt_master_date
  ON appointments(tenant_id, master_id, date);

CREATE INDEX IF NOT EXISTS idx_apt_created
  ON appointments(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_conv_user
  ON conversations(tenant_id, channel_user_id);

CREATE INDEX IF NOT EXISTS idx_msend_campaign_status
  ON marketing_sends(campaign_id, status);
