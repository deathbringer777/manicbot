-- Add referral_note column to store free-text source for "other" registrations
ALTER TABLE web_users ADD COLUMN referral_note TEXT;
