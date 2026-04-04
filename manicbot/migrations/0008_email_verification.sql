-- Add email verification support to web_users
ALTER TABLE web_users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_users ADD COLUMN verification_token TEXT;
ALTER TABLE web_users ADD COLUMN verification_token_expires_at INTEGER;
