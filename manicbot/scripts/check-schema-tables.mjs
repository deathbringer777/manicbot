#!/usr/bin/env node
/**
 * Ensures CREATE TABLE names in schema.sql match sqliteTable("...") in admin-app Drizzle schema.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sqlPath = join(root, 'src/db/schema.sql');
const drizzlePath = join(root, 'admin-app/src/server/db/schema.ts');

function tablesFromSql(src) {
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

function tablesFromDrizzle(src) {
  const re = /sqliteTable\s*\(\s*["']([^"']+)["']/g;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

const sql = readFileSync(sqlPath, 'utf8');
const ts = readFileSync(drizzlePath, 'utf8');
const sqlTables = tablesFromSql(sql);
const drizzleTables = tablesFromDrizzle(ts);

const onlySql = [...sqlTables].filter((t) => !drizzleTables.has(t)).sort();
const onlyDrizzle = [...drizzleTables].filter((t) => !sqlTables.has(t)).sort();

if (onlySql.length || onlyDrizzle.length) {
  console.error('Schema table name mismatch.');
  if (onlySql.length) console.error('  In schema.sql but not Drizzle:', onlySql.join(', '));
  if (onlyDrizzle.length) console.error('  In Drizzle but not schema.sql:', onlyDrizzle.join(', '));
  process.exit(1);
}

console.log(`OK: ${sqlTables.size} tables match between schema.sql and Drizzle schema.ts`);
