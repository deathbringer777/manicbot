-- 0127_social_comments_and_approval.sql — 2026-06-28
--
-- @manicbot_com social automation, phase 2: Facebook posting + autonomous
-- comment replies + a Telegram approval gate on outgoing posts.
--
-- 1) social_comment_inbox — one row per inbound IG/FB comment received on the
--    Meta webhook (entry[].changes[] field 'comments'/'feed'). The Worker owns
--    the webhook + tokens; the ThinkPad `comment-responder` cron pulls 'new'
--    rows, classifies + drafts a reply via `claude -p`, and pushes it back. The
--    Worker then posts the reply via the Graph API. comment_id is globally
--    unique (Meta ids) → doubles as the replay/dedup guard.
--
-- 2) marketing_content_plan additions:
--    * approved_at  — set when the owner approves the post in Telegram (or
--      immediately when the approval gate is disabled). processReady refuses to
--      publish until this is set. Pairs with the new status 'awaiting_approval'.
--    * fb_post_id / fb_permalink — Facebook Page post id + permalink, parallel
--      to the existing IG meta_post_id / permalink, so one content slot can fan
--      out to both networks and record each result.
--
-- Behaviour: additive only. No existing column/row is changed. Everything new
-- is inert until the per-feature kill-switches are flipped on.

CREATE TABLE IF NOT EXISTS social_comment_inbox (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT,                         -- NULL for the @manicbot_com platform account
  channel_type      TEXT NOT NULL,                -- 'instagram' | 'facebook'
  media_id          TEXT,                         -- the post/media the comment is on
  comment_id        TEXT NOT NULL,                -- Meta comment id (globally unique)
  parent_id         TEXT,                         -- parent comment id when this is a reply
  from_user_id      TEXT,
  from_username     TEXT,
  text              TEXT,
  status            TEXT NOT NULL DEFAULT 'new',  -- new | drafted | replied | skipped | escalated
  classification    TEXT,                         -- ThinkPad classifier tag (benign | praise | lead | complaint | legal | spam)
  reply_text        TEXT,
  reply_comment_id  TEXT,                          -- Meta id of the posted reply
  error             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sci_comment_id ON social_comment_inbox(comment_id);
CREATE INDEX IF NOT EXISTS idx_sci_status_created ON social_comment_inbox(status, created_at);

ALTER TABLE marketing_content_plan ADD COLUMN approved_at INTEGER;
ALTER TABLE marketing_content_plan ADD COLUMN fb_post_id TEXT;
ALTER TABLE marketing_content_plan ADD COLUMN fb_permalink TEXT;
