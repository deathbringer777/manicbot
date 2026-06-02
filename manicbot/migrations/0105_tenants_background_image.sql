-- 0105_tenants_background_image.sql — 2026-06-02
-- (renumbered 0103→0105: main landed 0103_subscription_grant_codes concurrently)
--
-- Public salon page: a STATIC background image, distinct from the existing
-- hero/cover photo (cover_photo/cover_r2_key). The owner sets it in salon
-- settings → Appearance; the public /salon/{slug} page renders it as a fixed
-- background layer behind the content (with a readability scrim).
--
-- Mirrors the cover_photo/cover_r2_key pair: bg_image holds the served https
-- URL (validated https-only at the tRPC boundary), bg_r2_key the R2 object key
-- used by the Worker to serve/replace the asset. Additive, nullable — legacy
-- tenants simply have no background. ADD COLUMN appends physically; schema.sql
-- keeps them grouped with the other branding columns for readability.
ALTER TABLE tenants ADD COLUMN bg_image TEXT;
ALTER TABLE tenants ADD COLUMN bg_r2_key TEXT;
