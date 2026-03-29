import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  tableColumnsFromSql,
  tableColumnsFromDrizzle,
} from '../scripts/schema-compare-utils.mjs';

describe('schema column parity', () => {
  const sql = readFileSync(resolve(import.meta.dirname, '../src/db/schema.sql'), 'utf8');
  const drizzle = readFileSync(resolve(import.meta.dirname, '../admin-app/src/server/db/schema.ts'), 'utf8');

  it('keeps every shared table aligned between schema.sql and Drizzle', () => {
    const sqlColumns = tableColumnsFromSql(sql);
    const drizzleColumns = tableColumnsFromDrizzle(drizzle);

    const mismatches = {};
    for (const [table, sqlCols] of sqlColumns.entries()) {
      if (!drizzleColumns.has(table)) continue;
      const drizzleCols = drizzleColumns.get(table) || [];
      const onlySql = sqlCols.filter((col) => !drizzleCols.includes(col));
      const onlyDrizzle = drizzleCols.filter((col) => !sqlCols.includes(col));
      if (onlySql.length || onlyDrizzle.length) {
        mismatches[table] = { onlySql, onlyDrizzle };
      }
    }

    expect(mismatches).toEqual({});
  });

  it('covers the masters and Google Calendar tables explicitly', () => {
    const sqlColumns = tableColumnsFromSql(sql);
    const drizzleColumns = tableColumnsFromDrizzle(drizzle);

    for (const table of ['masters', 'google_integrations', 'google_busy_blocks']) {
      expect([...sqlColumns.get(table)].sort()).toEqual([...drizzleColumns.get(table)].sort());
    }
  });
});
