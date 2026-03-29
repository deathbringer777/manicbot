#!/usr/bin/env node
/**
 * Ensures CREATE TABLE names in schema.sql match sqliteTable("...") in admin-app Drizzle schema.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  tablesFromSql,
  tablesFromDrizzle,
  tableColumnsFromSql,
  tableColumnsFromDrizzle,
} from './schema-compare-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sqlPath = join(root, 'src/db/schema.sql');
const drizzlePath = join(root, 'admin-app/src/server/db/schema.ts');

const sql = readFileSync(sqlPath, 'utf8');
const ts = readFileSync(drizzlePath, 'utf8');
const sqlTables = tablesFromSql(sql);
const drizzleTables = tablesFromDrizzle(ts);
const sqlColumns = tableColumnsFromSql(sql);
const drizzleColumns = tableColumnsFromDrizzle(ts);

const onlySql = [...sqlTables].filter((t) => !drizzleTables.has(t)).sort();
const onlyDrizzle = [...drizzleTables].filter((t) => !sqlTables.has(t)).sort();

if (onlySql.length || onlyDrizzle.length) {
  console.error('Schema table name mismatch.');
  if (onlySql.length) console.error('  In schema.sql but not Drizzle:', onlySql.join(', '));
  if (onlyDrizzle.length) console.error('  In Drizzle but not schema.sql:', onlyDrizzle.join(', '));
  process.exit(1);
}

const mismatchedTables = [...sqlTables]
  .filter((table) => drizzleTables.has(table))
  .map((table) => {
    const sqlCols = sqlColumns.get(table) || [];
    const drizzleCols = drizzleColumns.get(table) || [];
    const onlySqlCols = sqlCols.filter((c) => !drizzleCols.includes(c));
    const onlyDrizzleCols = drizzleCols.filter((c) => !sqlCols.includes(c));
    return { table, onlySqlCols, onlyDrizzleCols };
  })
  .filter((entry) => entry.onlySqlCols.length || entry.onlyDrizzleCols.length);

if (mismatchedTables.length) {
  console.error('Schema column mismatch.');
  for (const { table, onlySqlCols, onlyDrizzleCols } of mismatchedTables) {
    console.error(`  Table ${table}:`);
    if (onlySqlCols.length) console.error(`    In schema.sql only: ${onlySqlCols.join(', ')}`);
    if (onlyDrizzleCols.length) console.error(`    In Drizzle only: ${onlyDrizzleCols.join(', ')}`);
  }
  process.exit(1);
}

console.log(`OK: ${sqlTables.size} tables and their columns match between schema.sql and Drizzle schema.ts`);
