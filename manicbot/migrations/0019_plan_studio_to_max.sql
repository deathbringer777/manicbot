-- Rename plan "studio" to "max" across all tenants
UPDATE tenants SET plan = 'max' WHERE plan = 'studio';
