-- Allow a master to grant management permission to the salon owner.
ALTER TABLE masters ADD COLUMN allow_delegation INTEGER NOT NULL DEFAULT 0;
