-- 0020_reset_email_verification.sql
-- Reset email verification for ALL web users — force re-verification.
-- Run this once after the Resend runtime-env fix is deployed so every
-- web-panel user (including system_admin) goes through the email flow again.
UPDATE web_users
   SET email_verified = 0,
       verification_token = NULL,
       verification_token_expires_at = NULL,
       updated_at = CAST(strftime('%s', 'now') AS INTEGER);
