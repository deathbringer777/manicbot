-- 0075: master avatar (emoji + uploaded photo).
--
-- Mirrors the 0072 client avatar pattern: the salon owner can attach
-- a branded avatar to each master that appears on the public profile
-- and in the salon dashboard Masters tab.
--
-- Three new columns on `masters`:
--   avatar_emoji   — single Unicode emoji. NULL = not set, falls back to
--                    DEFAULT_MASTER_EMOJI ('💅') in the UI.
--   avatar_url     — public R2 CDN URL when the owner uploaded a photo.
--                    When non-NULL it takes precedence over avatar_emoji.
--   avatar_r2_key  — R2 object key for future cleanup jobs.
--
-- No origin gating: the avatar is the salon's visual presentation of the
-- master (like public_hidden), not the master's personal profile data.
-- The new `salon.updateMasterAvatar` tRPC procedure enforces only
-- assertTenantOwner (no delegation check).

ALTER TABLE masters ADD COLUMN avatar_emoji TEXT;
ALTER TABLE masters ADD COLUMN avatar_url TEXT;
ALTER TABLE masters ADD COLUMN avatar_r2_key TEXT;
