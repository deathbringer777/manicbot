-- 0072: client avatar (emoji + photo).
--
-- Adds three columns to `users` so the salon-dashboard Clients tab can
-- show a real avatar instead of the first-letter chip:
--
--   avatar_emoji   — short Unicode emoji ("👩" / "👸" / "🦋" …). When NULL
--                    the UI falls back to the default '👩' for display.
--   avatar_url     — public R2 URL when the operator uploaded a photo.
--                    When non-NULL it takes precedence over `avatar_emoji`.
--   avatar_r2_key  — R2 object key for future cleanup jobs. Mirrors the
--                    `tenants.logo_r2_key` pattern already in use for
--                    salon branding assets.
--
-- All three are optional / nullable. No backfill needed — the UI tolerates
-- NULL on every field and degrades gracefully (name initial → default
-- emoji → uploaded photo).
ALTER TABLE users ADD COLUMN avatar_emoji TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN avatar_r2_key TEXT;
