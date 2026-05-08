-- #S6: Migrate bot tokens from KV to D1 bots table.
-- Adds token_encrypted column to bots table for HKDF-encrypted Telegram bot tokens.
-- Keeps backward compatibility with KV fallback during transition period.
-- Format: v1$<base64-ciphertext> for HKDF-derived keys, or legacy format for old tokens.

ALTER TABLE bots ADD COLUMN token_encrypted TEXT;
