-- 0080_favorite_master.sql
-- Manual favorite-master pin per client. Lets the salon owner (or the
-- client themselves, via future self-serve UI) lock a particular master
-- as the default for this client across all booking surfaces — Manual
-- Booking modal, Telegram bot, web widget.
--
-- When NULL the system falls back to a derived favorite (most-frequent
-- master from past appointments), computed on demand in
-- `clients.getFavoriteMasterSuggestion`. The behaviour itself is gated
-- by per-channel toggles stored in tenant_config (`fav_suggest_web`,
-- `fav_suggest_telegram`) — see admin-app `salon.setAutoSuggestFavorite`.
--
-- Cross-channel intent (from the PR ask): because identity collapses to
-- a single users row regardless of source (phone match, telegram chat
-- id, instagram handle, email), this single nullable pointer is enough
-- to carry the preference across phone-in, TG-in, IG-in.

ALTER TABLE users ADD COLUMN favorite_master_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_tenant_favorite_master
  ON users(tenant_id, favorite_master_id);
