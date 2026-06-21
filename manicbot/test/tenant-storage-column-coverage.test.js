/**
 * putTenant column-coverage guard — the schema-driven half of the
 * "column-landmine" regression (see tenant-storage-roundtrip.test.js for the
 * behavioral half).
 *
 * putTenant persists a tenant with `INSERT OR REPLACE INTO tenants (...)`. With
 * INSERT OR REPLACE, ANY tenants column missing from that column list is reset
 * to its DEFAULT on every save — exactly how storage.js once silently wiped 9
 * of the table's columns (branding + is_personal / industry / is_test) on every
 * billing-webhook or settings save. The is_test reset is the dangerous one: a
 * demo/test tenant silently becomes a "real" indexed tenant.
 *
 * The roundtrip test pins the 9 historically-wiped columns with concrete
 * assertions. This guard is schema-driven and total: it parses the live
 * `tenants` CREATE TABLE from schema.sql and the live INSERT column list from
 * storage.js, and fails the moment a NEW column is added to the schema but not
 * threaded into putTenant — naming the column, so the landmine can't regrow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function read(rel) {
  return readFileSync(resolve(import.meta.dirname, rel), 'utf8');
}

/** Column names of the `tenants` table, parsed from schema.sql. */
function tenantSchemaColumns() {
  const sql = read('../src/db/schema.sql');
  const m = sql.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+tenants\s*\(([\s\S]*?)\n\);/i);
  if (!m) throw new Error('tenants CREATE TABLE not found in schema.sql');
  const cols = [];
  for (const raw of m[1].split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue; // blank / comment line
    // Column definition lines start with `<name> <TYPE> ...`. Table-level
    // constraint clauses (none in tenants today) are skipped defensively.
    const name = line.match(/^"?([a-z_][a-z0-9_]*)"?\s/i)?.[1];
    if (!name) continue;
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(name)) continue;
    cols.push(name);
  }
  return cols;
}

/** Column names listed in putTenant's `INSERT OR REPLACE INTO tenants (...)`. */
function putTenantInsertColumns() {
  const src = read('../src/tenant/storage.js');
  const m = src.match(/INSERT OR REPLACE INTO tenants\s*\(([^)]*)\)/i);
  if (!m) throw new Error('putTenant INSERT OR REPLACE not found in storage.js');
  return m[1].split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

describe('putTenant column coverage (column-landmine guard)', () => {
  it('parses a plausible column set from both sources', () => {
    expect(tenantSchemaColumns().length).toBeGreaterThanOrEqual(40);
    expect(putTenantInsertColumns().length).toBeGreaterThanOrEqual(40);
  });

  it('INSERT OR REPLACE lists EVERY tenants column (a new column must be threaded)', () => {
    const insertCols = new Set(putTenantInsertColumns());
    const missing = tenantSchemaColumns().filter((c) => !insertCols.has(c));
    // If this fails, `missing` names the column(s) added to schema.sql but NOT to
    // the INSERT in src/tenant/storage.js. INSERT OR REPLACE resets any unlisted
    // column to its DEFAULT on every save — thread the column through the INSERT,
    // docToTenantParams, AND getTenant (see #472 / the column-landmine memo).
    expect(missing).toEqual([]);
  });

  it('INSERT lists no phantom column absent from the tenants schema', () => {
    const schemaCols = new Set(tenantSchemaColumns());
    const phantom = putTenantInsertColumns().filter((c) => !schemaCols.has(c));
    // A phantom column would throw at runtime ("no column named …"); catch typos here.
    expect(phantom).toEqual([]);
  });

  it('schema and INSERT agree on column count (defense in depth)', () => {
    expect(putTenantInsertColumns().length).toBe(tenantSchemaColumns().length);
  });
});
