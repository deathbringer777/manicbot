import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Real-D1 integration project (`npm run test:d1`).
 *
 * Runs the `*.d1.test.js` specs inside the real workerd runtime against a real
 * miniflare D1 binding — the SAME SQLite engine as production D1. This is what
 * the bespoke regex mock (test/helpers/mock-db.js) cannot be: it evaluates real
 * ON CONFLICT / partial-index semantics natively. Regression guard for C1 (the
 * audit found saveApt's ON CONFLICT target had drifted from the migration-0097
 * partial index — a mismatch the mock could not surface, but real D1 rejects at
 * prepare time).
 *
 * We apply only the DDL the booking chokepoint touches, extracted from the
 * authoritative `src/db/schema.sql` at config time (Node context), so the test
 * exercises the REAL 0097 index — not a hand-copied one. schema.sql is 2k+ lines
 * with FTS5 virtual tables + triggers, so applying it wholesale is both
 * unnecessary and fragile; the focused slice keeps the fixture deterministic.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(dir, 'src/db/schema.sql'), 'utf8');

// Strip `-- …` line comments FIRST: schema.sql has comments containing ';'
// (e.g. "duration override in minutes; NULL = …") that would otherwise split a
// statement mid-body. With comments gone, statements are ';'-terminated with no
// inner ';' (column lists use ','), so a naive split yields whole statements.
// Keep only the objects saveApt's D1 path reads/writes, in source order (table
// before its index).
const WANTED = [
  'CREATE TABLE IF NOT EXISTS appointments (',
  'CREATE TABLE IF NOT EXISTS users (',
  'CREATE TABLE IF NOT EXISTS master_client_blocks (',
  'CREATE TABLE IF NOT EXISTS tenant_config (',
  'idx_apt_unique_active_slot',
];
const bookingDdl = schema
  .replace(/--[^\n]*/g, '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => WANTED.some((w) => s.includes(w)))
  .map((s) => `${s};`);

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './test/fixtures/d1TestWorker.js',
      miniflare: {
        compatibilityDate: '2025-01-01',
        d1Databases: { DB: 'test-d1' },
      },
    }),
  ],
  define: {
    // Injected into the workerd test as a JSON array of DDL statements.
    __BOOKING_DDL__: JSON.stringify(bookingDdl),
  },
  test: {
    include: ['test/**/*.d1.test.js'],
  },
});
