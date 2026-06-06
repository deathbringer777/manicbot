-- 0109_subscription_self_service.sql — 2026-06-05
--
-- In-app subscription self-service (plan change + pause), so salon owners can
-- upgrade / downgrade / pause without bouncing to the Stripe customer portal.
--
--   pending_plan / pending_price_id / pending_plan_effective_at — a scheduled
--     DOWNGRADE (no refund): the subscription keeps its current price until the
--     period boundary, then a Stripe Subscription Schedule swaps to the cheaper
--     price (proration_behavior=none). Denormalized here so the dashboard can
--     render "downgrades to <plan> on <date>" without a live Stripe call; the
--     Stripe schedule itself stays authoritative for execution.
--   pending_schedule_id — the Stripe subscription_schedule id, so a pending
--     downgrade can be released (undo) without re-deriving it from the sub.
--   pause_resumes_at — optional auto-resume timestamp for a paused subscription
--     (NULL = indefinite, or not paused). The paused state itself is reflected
--     in billing_status='paused', driven by Stripe pause_collection via webhook.
--
-- All additive + nullable → safe, no backfill, ignored by older code paths.
ALTER TABLE tenants ADD COLUMN pending_plan TEXT;
ALTER TABLE tenants ADD COLUMN pending_price_id TEXT;
ALTER TABLE tenants ADD COLUMN pending_plan_effective_at INTEGER;
ALTER TABLE tenants ADD COLUMN pending_schedule_id TEXT;
ALTER TABLE tenants ADD COLUMN pause_resumes_at INTEGER;
