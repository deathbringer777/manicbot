-- Salon logo, cover photo, and master portfolio album support.
ALTER TABLE tenants ADD COLUMN logo TEXT;
ALTER TABLE tenants ADD COLUMN cover_photo TEXT;
ALTER TABLE masters ADD COLUMN portfolio TEXT;  -- JSON array of photo URLs, like tenants.photos
