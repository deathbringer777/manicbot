-- Add ToS consent timestamp to track when users accepted Terms of Use.
ALTER TABLE web_users ADD COLUMN tos_accepted_at INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN tos_accepted_at INTEGER DEFAULT NULL;
