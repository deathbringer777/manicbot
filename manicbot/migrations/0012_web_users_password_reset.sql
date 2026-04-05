-- Password reset tokens for web_users (Resend email flow)
ALTER TABLE web_users ADD COLUMN password_reset_token TEXT;
ALTER TABLE web_users ADD COLUMN password_reset_expires_at INTEGER;
