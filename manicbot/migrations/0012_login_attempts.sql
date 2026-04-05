-- Brute-force protection for web_users email/password login.
-- login_attempts: incremented on each failed credential check, reset on success.
-- locked_until:   unix epoch (seconds) after which login is allowed again.
ALTER TABLE web_users ADD COLUMN login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_users ADD COLUMN locked_until INTEGER DEFAULT NULL;
