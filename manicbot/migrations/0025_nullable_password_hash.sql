-- Allow NULL password_hash for Google OAuth registrations.
-- SQLite doesn't support ALTER COLUMN directly; we recreate via a pragma workaround.
-- However, since SQLite TEXT columns already accept NULL by default,
-- the NOT NULL constraint was only enforced by the ORM (Drizzle).
-- We keep this migration as a documentation marker.
-- The actual enforcement change happens in Drizzle schema.ts and schema.sql.

-- Note: D1 doesn't support ALTER TABLE ... ALTER COLUMN.
-- SQLite approach: create new table, copy data, swap.
-- But since we have many indexes and the table is critical, we use a simpler approach:
-- just update the reference DDL. The existing D1 table already stores NULLs fine
-- when the ORM allows it.

-- This is a no-op migration for D1 since SQLite TEXT already allows NULL.
-- The constraint was only in the application layer (Drizzle .notNull()).
SELECT 1;
