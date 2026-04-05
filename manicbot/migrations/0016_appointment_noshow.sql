-- Track who cancelled and when, plus no-show marking
ALTER TABLE appointments ADD COLUMN cancelled_by TEXT;
ALTER TABLE appointments ADD COLUMN cancelled_at INTEGER;
ALTER TABLE appointments ADD COLUMN no_show INTEGER DEFAULT 0;
ALTER TABLE appointments ADD COLUMN no_show_by TEXT;
