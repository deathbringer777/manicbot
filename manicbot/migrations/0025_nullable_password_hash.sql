-- Google OAuth users register without a password.
-- Instead of making password_hash nullable (requires table recreation in SQLite),
-- we use empty string '' as the sentinel for "no password set".
-- The ORM schema uses .default('') and the app checks passwordHash !== ''.
-- This migration is a marker — no DDL change needed (NOT NULL + DEFAULT '' already compatible).
SELECT 1;
