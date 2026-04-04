-- Optional attachment URL (HTTPS or telegram:file_id:... for TG-hosted media)
ALTER TABLE platform_ticket_messages ADD COLUMN attachment_url TEXT;

-- Web dashboard agents claim without Telegram chat id
ALTER TABLE platform_tickets ADD COLUMN claimed_by_web_user_id TEXT;
