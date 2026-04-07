-- 0021_branding_v2.sql
-- Salon branding v2: display-name override + R2 object keys + brand palette.
-- Applies additively — every new column is nullable, safe to run on existing DBs.
--
-- Apply: wrangler d1 execute manicbot-db --remote --file migrations/0021_branding_v2.sql
ALTER TABLE tenants ADD COLUMN display_name TEXT;
ALTER TABLE tenants ADD COLUMN logo_r2_key TEXT;
ALTER TABLE tenants ADD COLUMN cover_r2_key TEXT;
ALTER TABLE tenants ADD COLUMN brand_palette TEXT;  -- JSON: {"primary":"#EC4899","bg":"#FFF","text":"#111"}
