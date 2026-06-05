-- D1 → R2 backup audit log. One row per successful backup run.
--
-- Read by the restore script (scripts/restore-d1.mjs), which picks the
-- latest healthy row to restore from when the operator runs it via
-- `node scripts/restore-d1.mjs --latest`.
--
-- The backup runs from the Worker cron entrypoint (src/worker.js scheduled()
-- → maybeRunD1Backup), roughly every 6h, idempotent via an internal 6h
-- window derived from the latest row in this table. The actual backup payload sits in R2 under
-- the binding ARCHIVE at key path "backups/daily/{iso}.ndjson.gz" plus a
-- "backups/weekly/{iso-week}.ndjson.gz" promoted snapshot once per ISO week.
--
-- Retention: 30 days for daily/, 365 days for weekly/. Pruned by the
-- pruneOldBackups() helper inside the same phase.
--
-- Platform-level table (no tenant_id) — there is one D1 database for the
-- whole platform, so backups are intrinsically platform-scoped.

CREATE TABLE IF NOT EXISTS d1_backup_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER NOT NULL,
  bucket_key      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  table_count     INTEGER NOT NULL,
  row_count       INTEGER NOT NULL,
  byte_size       INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_d1_backup_log_finished
  ON d1_backup_log(finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_d1_backup_log_kind_status
  ON d1_backup_log(kind, status, finished_at DESC);
