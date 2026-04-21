/**
 * #S12 — plugin_pins(web_user_id) → web_users(id) ON DELETE CASCADE.
 *
 * The Vitest worker runtime is plain Node 20 in CI (no node:sqlite, no
 * better-sqlite3 dependency), so we cannot exercise FK enforcement at
 * runtime here. Instead we lock the wire-level invariants the production D1
 * engine will enforce:
 *
 *   1. The 0037 migration SQL contains a CASCADE clause and a copy step that
 *      filters orphans via JOIN web_users.
 *   2. The reference DDL (src/db/schema.sql) declares the same FK clause —
 *      this is what `npm run check-schema` and any fresh `wrangler d1` would
 *      use to bootstrap a brand-new database.
 *   3. The Drizzle schema (admin-app/src/server/db/schema.ts) marks the
 *      column as `references(...).onDelete: "cascade"` so generated SQL and
 *      type inference stay in sync.
 *   4. The migration is well-formed: rename / drop / index reordering happens
 *      in the right order so a partial apply leaves a consistent table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATION = readFileSync(resolve(HERE, '../migrations/0037_plugin_pins_fk_cascade.sql'), 'utf8');
const SCHEMA    = readFileSync(resolve(HERE, '../src/db/schema.sql'), 'utf8');
const DRIZZLE   = readFileSync(resolve(HERE, '../admin-app/src/server/db/schema.ts'), 'utf8');

describe('#S12 — 0037_plugin_pins_fk_cascade', () => {
  it('migration declares ON DELETE CASCADE on (web_user_id)', () => {
    expect(MIGRATION).toMatch(/FOREIGN KEY \(web_user_id\) REFERENCES web_users\(id\) ON DELETE CASCADE/);
  });

  it('migration drops orphan pins by JOIN web_users during copy', () => {
    // INSERT ... SELECT ... JOIN web_users ON w.id = p.web_user_id
    expect(MIGRATION).toMatch(/INSERT INTO plugin_pins_new[\s\S]+?JOIN\s+web_users/i);
  });

  it('migration recreates indexes after the rename', () => {
    expect(MIGRATION).toMatch(/RENAME TO plugin_pins/);
    expect(MIGRATION).toMatch(/CREATE INDEX IF NOT EXISTS idx_plugin_pins_user\s+ON plugin_pins/);
    expect(MIGRATION).toMatch(/CREATE INDEX IF NOT EXISTS idx_plugin_pins_user_at\s+ON plugin_pins/);
  });

  it('migration ordering: copy → drop → rename (no partial-apply data loss)', () => {
    const insertIdx = MIGRATION.indexOf('INSERT INTO plugin_pins_new');
    const dropIdx   = MIGRATION.indexOf('DROP TABLE plugin_pins');
    const renameIdx = MIGRATION.indexOf('RENAME TO plugin_pins');
    expect(insertIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeGreaterThan(insertIdx);
    expect(renameIdx).toBeGreaterThan(dropIdx);
  });

  it('reference schema (src/db/schema.sql) carries the cascading FK', () => {
    const block = SCHEMA.match(/CREATE TABLE IF NOT EXISTS plugin_pins[\s\S]*?\);/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/FOREIGN KEY \(web_user_id\) REFERENCES web_users\(id\) ON DELETE CASCADE/);
  });

  it('Drizzle schema (admin-app) marks webUserId as cascading reference', () => {
    // pluginPins definition references webUsers.id with onDelete: "cascade"
    const block = DRIZZLE.match(/export const pluginPins[\s\S]*?\]\);/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/references\(\s*\(\)\s*=>\s*webUsers\.id,\s*\{\s*onDelete:\s*["']cascade["']/);
  });
});
