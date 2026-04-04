-- Add name and referral_source columns to web_users for registration form
ALTER TABLE web_users ADD COLUMN name TEXT;
ALTER TABLE web_users ADD COLUMN referral_source TEXT;
