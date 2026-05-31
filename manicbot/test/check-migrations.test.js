import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import {
  migrationNumber,
  findDuplicateMigrationNumbers,
  ALLOWED_DUPLICATE_MIGRATION_NUMBERS,
} from '../scripts/migration-check-utils.mjs';

describe('migrationNumber', () => {
  it('takes the token before the first underscore', () => {
    expect(migrationNumber('0097_web_users_active_tenant.sql')).toBe('0097');
    expect(migrationNumber('0100_platform_campaigns.sql')).toBe('0100');
  });

  it('treats the historical a-suffix slot-in as a DISTINCT number', () => {
    // 0012 and 0012a must NOT be conflated — wrangler orders them correctly.
    expect(migrationNumber('0012_web_users_password_reset.sql')).toBe('0012');
    expect(migrationNumber('0012a_login_attempts.sql')).toBe('0012a');
  });

  it('strips a leading path and returns null when there is no underscore', () => {
    expect(migrationNumber('migrations/0091_chat_enabled.sql')).toBe('0091');
    expect(migrationNumber('README.md')).toBe(null);
    expect(migrationNumber('0091.sql')).toBe(null);
  });
});

describe('findDuplicateMigrationNumbers', () => {
  it('returns nothing for a clean set', () => {
    expect(
      findDuplicateMigrationNumbers(['0001_a.sql', '0002_b.sql', '0003_c.sql']),
    ).toEqual([]);
  });

  it('flags two files sharing a number', () => {
    const dupes = findDuplicateMigrationNumbers(['0097_a.sql', '0097_b.sql', '0098_c.sql']);
    expect(dupes).toEqual([{ number: '0097', files: ['0097_a.sql', '0097_b.sql'] }]);
  });

  it('does NOT flag 0012 vs 0012a (distinct tokens)', () => {
    expect(
      findDuplicateMigrationNumbers(['0012_pw.sql', '0012a_login.sql']),
    ).toEqual([]);
  });

  it('suppresses an allowlisted collision but still flags a non-allowlisted one', () => {
    const dupes = findDuplicateMigrationNumbers(
      ['0097_a.sql', '0097_b.sql', '0050_x.sql', '0050_y.sql'],
      new Set(['0097']),
    );
    expect(dupes).toEqual([{ number: '0050', files: ['0050_x.sql', '0050_y.sql'] }]);
  });

  it('ignores non-.sql entries', () => {
    expect(
      findDuplicateMigrationNumbers(['0001_a.sql', '0001_notes.md', '.DS_Store']),
    ).toEqual([]);
  });

  it('accepts an array allowlist as well as a Set', () => {
    expect(
      findDuplicateMigrationNumbers(['0097_a.sql', '0097_b.sql'], ['0097']),
    ).toEqual([]);
  });
});

describe('the real migrations/ directory', () => {
  const files = readdirSync(resolve(import.meta.dirname, '../migrations')).filter((f) =>
    f.endsWith('.sql'),
  );

  it('has no number collisions beyond the documented allowlist', () => {
    expect(findDuplicateMigrationNumbers(files, ALLOWED_DUPLICATE_MIGRATION_NUMBERS)).toEqual([]);
  });

  it('keeps the allowlist minimal — every entry still actually collides', () => {
    // Guard against a stale allowlist: an allowlisted number that no longer has
    // two files should be removed. Compute raw collisions with NO allowlist.
    const rawDupeNumbers = new Set(
      findDuplicateMigrationNumbers(files, new Set()).map((d) => d.number),
    );
    for (const allowed of ALLOWED_DUPLICATE_MIGRATION_NUMBERS) {
      expect(rawDupeNumbers.has(allowed)).toBe(true);
    }
  });
});
