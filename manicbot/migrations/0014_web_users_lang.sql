-- Store user preferred language for emails and UI.
ALTER TABLE web_users ADD COLUMN lang TEXT DEFAULT 'en';
