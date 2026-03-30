-- ManicBot public profiles migration
-- Adds public salon directory and search support

-- Public profile fields on tenants
ALTER TABLE tenants ADD COLUMN slug TEXT;
ALTER TABLE tenants ADD COLUMN description TEXT;
ALTER TABLE tenants ADD COLUMN lat REAL;
ALTER TABLE tenants ADD COLUMN lng REAL;
ALTER TABLE tenants ADD COLUMN city TEXT;
ALTER TABLE tenants ADD COLUMN public_active INTEGER NOT NULL DEFAULT 0;

-- Unique index for slug lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_slug ON tenants(slug);
-- Index for city search
CREATE INDEX IF NOT EXISTS idx_tenant_city ON tenants(city);
-- Index for geo search (lat/lng bounding box)
CREATE INDEX IF NOT EXISTS idx_tenant_location ON tenants(lat, lng);
-- Index for public listing
CREATE INDEX IF NOT EXISTS idx_tenant_public ON tenants(public_active, city);
