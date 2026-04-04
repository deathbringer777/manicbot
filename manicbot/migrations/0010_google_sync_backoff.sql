-- Google Calendar sync exponential backoff columns
ALTER TABLE appointments ADD COLUMN sync_retries INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN sync_retry_after INTEGER DEFAULT NULL;
ALTER TABLE appointments ADD COLUMN sync_last_error TEXT DEFAULT NULL;
