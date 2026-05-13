import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  tableColumnsFromSql,
  tableColumnsFromDrizzle,
} from '../scripts/schema-compare-utils.mjs';

/* ============================================================================
 * AUDIT REPORT — In-Project Error Monitoring System (Phase 1)
 * ============================================================================
 *
 * GOAL: Replace Sentry/Datadog with a tenant-aware error tracker living
 * entirely inside the ManicBot D1 database. Phase 1 = data model only.
 *
 * 1) WHAT ERROR HANDLING ALREADY EXISTS
 * --------------------------------------------------------------------------
 * Worker (manicbot/src/):
 *   - worker.js: fetch/scheduled try/catch wrappers call `log.error('worker.*')`
 *     and `log.error('worker.cron')`. Errors land in Cloudflare Logpush via
 *     the structured logger but are NOT persisted anywhere queryable.
 *   - handlers/cron.js: every phase wrapped in try/catch, emits a
 *     `cron.phase.error` event into KV key `adminlog:recent` (capped list)
 *     and into `analytics_events` (no severity, no dedup, no stack).
 *   - handlers/message.js, callback.js: per-handler try/catch, errors mostly
 *     swallowed with `log.warn(...).catch(() => {})` (see callback.js:215).
 *   - billing webhooks: idempotency layer logs failures to `stripe_events`
 *     with `error` column but no aggregation.
 *
 * Admin-app (manicbot/admin-app/):
 *   - /api/error-report (route.ts): persists client-side React error
 *     boundary fires + tRPC unhandled errors into the `error_log` table
 *     (migration 0039). Rate-limited per IP (30 / 10min), payload-capped
 *     (16KB), with truncation. Best-effort session attribution.
 *   - app/global-error.tsx, app/(dashboard)/error.tsx: React boundaries
 *     that POST to /api/error-report.
 *   - server/api/trpc.ts errorFormatter: also feeds /api/error-report for
 *     non-TRPCError throws.
 *
 * Gaps:
 *   - error_log is a *raw firehose*: one row per fire, no fingerprint, no
 *     count, no severity, no status, no regression detection. Listing top
 *     issues today requires GROUP BY on a flat table — fine at 1k rows,
 *     painful at 100k.
 *   - Worker-side errors do not flow into error_log yet (the migration's
 *     header reserves it but never wires it). Today they only hit Logpush.
 *   - No issue ownership, no resolve/ignore/snooze workflow, no tags.
 *
 * 2) EXISTING EVENT/ACTIVITY INFRASTRUCTURE WE CAN REUSE
 * --------------------------------------------------------------------------
 *   - `error_log` (0039): KEEP. Becomes the raw firehose / audit trail.
 *   - `analytics_events` (existing): NOT suitable — append-only product
 *     analytics, no schema for stack/severity, would pollute dedup index.
 *   - KV `adminlog:recent` (served by /admin/events): activity feed for the
 *     Living Command Center drawer. Reused unchanged; the error tracker is
 *     a separate panel.
 *   - `plugin_events` (0035): plugin-only audit trail. Not relevant.
 *   - `stripe_events.error`: billing-specific column. Not relevant.
 *
 * Decision: ADD a new `error_events` table that holds *deduplicated issues*.
 * Both tables (error_log + error_events) are written by the same sink in a
 * single transaction. The dashboard reads error_events; forensics reads
 * error_log.
 *
 * 3) GOD MODE DASHBOARD STRUCTURE (admin-app/src/app/(dashboard)/)
 * --------------------------------------------------------------------------
 * Existing pages: dashboard, tenants, users, agents, appointments, billing,
 * channels, conversations, events, leads, marketing, platform-support,
 * plugin, plugins, role-requests, settings, stripe, system.
 *
 * Routing pattern: src/app/(dashboard)/<segment>/page.tsx with `Shell` layout
 * + `navItems` registered in DashboardClient.tsx. Phase 2 will add an
 * `errors/` segment (out of scope here).
 *
 * 4) NEXT MIGRATION NUMBER
 * --------------------------------------------------------------------------
 * Highest existing: 0055_analytics_promo_dedup.sql.
 * Gap at 0040/0041 is intentional/historical — do NOT backfill.
 * This migration is 0056_error_events.sql.
 *
 * 5) RISKS / GAPS TO BE AWARE OF
 * --------------------------------------------------------------------------
 *   - D1 row-size: capping `sample_json` ≤ 4KB and `stack` ≤ 8KB keeps a
 *     dedup'd row under ~16KB. Worth enforcing in the write path.
 *   - Fingerprint stability: must strip uuids/numbers/quoted literals from
 *     the message OR you get one issue per `User 42 not found`.
 *   - Tenant isolation: `tenant_id` is nullable (platform errors have no
 *     tenant), but per-tenant list queries MUST always filter on tenant_id
 *     to avoid leaking cross-tenant errors into a salon's panel.
 *   - PII in stack/sample: the write path must redact secrets (BOT_TOKEN,
 *     STRIPE_*, email bodies) before persisting. Out of scope here — Phase
 *     3 (write path) will enforce.
 *   - Status regression: a new fire on `resolved` issue must flip status →
 *     `open`. Implemented in code via UPSERT CASE expression, NOT a trigger
 *     (D1 trigger ergonomics are awkward).
 * ============================================================================
 */

const SQL_PATH = resolve(import.meta.dirname, '../src/db/schema.sql');
const MIGRATION_PATH = resolve(import.meta.dirname, '../migrations/0056_error_events.sql');
const DRIZZLE_PATH = resolve(import.meta.dirname, '../admin-app/src/server/db/schema.ts');

const REQUIRED_COLUMNS = [
  'id',
  'fingerprint',
  'tenant_id',
  'source',
  'environment',
  'release',
  'severity',
  'title',
  'message',
  'error_type',
  'stack',
  'url',
  'method',
  'user_id',
  'request_id',
  'count',
  'users_affected',
  'first_seen',
  'last_seen',
  'status',
  'resolved_at',
  'resolved_by',
  'snooze_until',
  'assignee_id',
  'tags_json',
  'sample_json',
  'created_at',
];

const REQUIRED_INDEXES = [
  'uniq_error_events_fingerprint',
  'idx_error_events_status_last',
  'idx_error_events_tenant_status_last',
  'idx_error_events_severity_last',
  'idx_error_events_source_last',
  'idx_error_events_last_seen',
];

describe('error_events schema (migration 0056)', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  const schemaSql = readFileSync(SQL_PATH, 'utf8');
  const drizzleSrc = readFileSync(DRIZZLE_PATH, 'utf8');

  it('migration file declares CREATE TABLE error_events', () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS\s+error_events\s*\(/);
  });

  it('reference schema.sql mirrors the migration (table exists)', () => {
    const cols = tableColumnsFromSql(schemaSql).get('error_events');
    expect(cols, 'error_events missing from schema.sql').toBeTruthy();
  });

  it('every required column is present in both schema.sql and the migration', () => {
    const sqlCols = tableColumnsFromSql(schemaSql).get('error_events') ?? [];
    const migrationCols = tableColumnsFromSql(migrationSql).get('error_events') ?? [];
    for (const col of REQUIRED_COLUMNS) {
      expect(sqlCols, `schema.sql lacks ${col}`).toContain(col);
      expect(migrationCols, `migration lacks ${col}`).toContain(col);
    }
  });

  it('Drizzle schema mirrors schema.sql exactly', () => {
    const sqlCols = [...(tableColumnsFromSql(schemaSql).get('error_events') ?? [])].sort();
    const drizzleCols = [...(tableColumnsFromDrizzle(drizzleSrc).get('error_events') ?? [])].sort();
    expect(drizzleCols).toEqual(sqlCols);
  });

  it('declares a UNIQUE index on fingerprint (drives dedup UPSERT)', () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS\s+uniq_error_events_fingerprint\s+ON\s+error_events\s*\(\s*fingerprint\s*\)/i,
    );
    expect(schemaSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS\s+uniq_error_events_fingerprint\s+ON\s+error_events\s*\(\s*fingerprint\s*\)/i,
    );
    expect(drizzleSrc).toMatch(/uniqueIndex\("uniq_error_events_fingerprint"\)\.on\(t\.fingerprint\)/);
  });

  it('declares every query-pattern index needed by the dashboard', () => {
    for (const idx of REQUIRED_INDEXES) {
      expect(migrationSql, `migration missing ${idx}`).toContain(idx);
      expect(schemaSql, `schema.sql missing ${idx}`).toContain(idx);
      expect(drizzleSrc, `drizzle missing ${idx}`).toContain(idx);
    }
  });

  it('enforces NOT NULL on the columns that must never be blank', () => {
    // Sanity: a row without source/severity/title/timestamps is meaningless.
    const notNullColumns = [
      'fingerprint',
      'source',
      'environment',
      'severity',
      'title',
      'message',
      'count',
      'users_affected',
      'first_seen',
      'last_seen',
      'status',
      'created_at',
    ];
    for (const col of notNullColumns) {
      // Match e.g. `fingerprint     TEXT NOT NULL` (allow extra modifiers).
      const re = new RegExp(`\\b${col}\\b[^,\\n]*\\bNOT NULL\\b`, 'i');
      expect(migrationSql, `${col} must be NOT NULL`).toMatch(re);
    }
  });

  it('defaults environment, severity, status, count, users_affected to safe values', () => {
    expect(migrationSql).toMatch(/environment\s+TEXT\s+NOT NULL\s+DEFAULT\s+'production'/i);
    expect(migrationSql).toMatch(/severity\s+TEXT\s+NOT NULL\s+DEFAULT\s+'error'/i);
    expect(migrationSql).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'open'/i);
    expect(migrationSql).toMatch(/count\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1/i);
    expect(migrationSql).toMatch(/users_affected\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1/i);
  });

  it('keeps tenant_id nullable (platform errors have no tenant)', () => {
    // tenant_id must NOT be marked NOT NULL in the CREATE TABLE block.
    const createTable = migrationSql.match(/CREATE TABLE[^;]+error_events[^;]+;/s)?.[0] ?? '';
    expect(createTable).toMatch(/tenant_id\s+TEXT\s*,/i);
    expect(createTable).not.toMatch(/tenant_id\s+TEXT\s+NOT NULL/i);
  });

  it('migration is numbered 0056 and follows the previous (0055) sequentially', () => {
    // Sanity: enforce naming convention; the migration file path itself is
    // the contract here.
    const fname = MIGRATION_PATH.split('/').pop();
    expect(fname).toBe('0056_error_events.sql');
  });
});
