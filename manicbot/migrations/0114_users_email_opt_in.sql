-- 0114_users_email_opt_in.sql — 2026-06-06
--
-- Durable per-client state for the chat email-capture prompt. The bot asks
-- clients for an email ("стань постоянным — получай скидки и новости"); to
-- avoid re-nagging someone who already gave (or declined) an email, we need
-- to remember the outcome. The conversation state KV is TTL'd and far too
-- short-lived for a 14–45 day cooldown, so the flags live on the canonical
-- users row instead.
--
--   email_opt_in         NULL = never asked, 1 = opted in, 0 = declined/unsubscribed
--   email_prompt_last_at  unix-seconds of the last prompt (cooldown anchor)
--   email_prompt_count    total prompts shown (hard cap so we never nag forever)
--
-- These are UX anti-nag flags, NOT the consent record itself — marketing
-- consent stays authoritative in marketing_consent_log (MKT-01). email_opt_in
-- mirrors the contact's marketing state for fast in-chat gating without a join.
--
-- Additive + nullable (count defaults to 0) → safe, no backfill. The Worker
-- reads these via getUser and writes them via captureChatEmail /
-- setChatEmailOptOut; saveUser never touches them.
ALTER TABLE users ADD COLUMN email_opt_in INTEGER;
ALTER TABLE users ADD COLUMN email_prompt_last_at INTEGER;
ALTER TABLE users ADD COLUMN email_prompt_count INTEGER NOT NULL DEFAULT 0;
