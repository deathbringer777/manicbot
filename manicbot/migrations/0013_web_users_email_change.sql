-- Email change flow + login tracking
ALTER TABLE web_users ADD COLUMN new_email TEXT;
ALTER TABLE web_users ADD COLUMN email_change_token TEXT;
ALTER TABLE web_users ADD COLUMN email_change_token_expires_at INTEGER;
ALTER TABLE web_users ADD COLUMN last_login_ip TEXT;
ALTER TABLE web_users ADD COLUMN last_login_at INTEGER;
