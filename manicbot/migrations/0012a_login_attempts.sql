-- Brute-force protection for web_users email/password login.
-- login_attempts: incremented on each failed credential check, reset on success.
-- locked_until:   unix epoch (seconds) after which login is allowed again.
-- Columns already exist (applied via direct SQL before migration tracking).
SELECT 1;
