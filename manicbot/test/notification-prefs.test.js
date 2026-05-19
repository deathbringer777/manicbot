/**
 * services/notificationPrefs.js — Worker mirror, fixture-driven parity.
 *
 * Phase 2 cleanup: cases shared with the admin-app side at
 *   admin-app/src/__tests__/notification-prefs.test.ts
 * via the JSON fixture at
 *   admin-app/src/__tests__/helpers/parity-fixtures/notification-prefs-cases.json
 * Drift is structurally impossible — each runner loads the same file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_PREFS,
  NOTIFICATION_CATEGORIES,
  categoryForKind,
  parsePrefs,
  shouldDeliver,
} from '../src/services/notificationPrefs.js';

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  '../admin-app/src/__tests__/helpers/parity-fixtures/notification-prefs-cases.json',
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('notificationCategories — shared contract', () => {
  it('matches the parity-fixture list exactly (Worker side)', () => {
    expect(NOTIFICATION_CATEGORIES).toEqual(fixture.notificationCategories);
  });

  it('default prefs match the fixture for representative categories', () => {
    for (const [cat, expected] of Object.entries(fixture.defaultPrefs)) {
      expect(DEFAULT_PREFS.categories[cat]).toEqual(expected);
    }
  });
});

describe('categoryForKind (Worker, fixture-driven)', () => {
  for (const tc of fixture.categoryForKind) {
    it(`maps "${tc.kind}" → ${tc.expect ?? 'null'}`, () => {
      expect(categoryForKind(tc.kind)).toBe(tc.expect);
    });
  }
});

describe('parsePrefs — malformed input (Worker)', () => {
  for (const tc of fixture.parsePrefsMalformed) {
    it(`returns DEFAULT_PREFS for ${tc.name}`, () => {
      expect(parsePrefs(tc.input)).toEqual(DEFAULT_PREFS);
    });
  }
});

describe('parsePrefs — partial input merging (Worker)', () => {
  for (const tc of fixture.parsePrefsPartial) {
    it(tc.name, () => {
      const parsed = parsePrefs(JSON.stringify(tc.input));
      for (const check of tc.checks) {
        const cat = parsed.categories[check.category];
        if ('channel' in check && check.channel !== undefined) {
          expect(cat[check.channel]).toBe(check.expect);
        } else {
          expect(cat).toEqual(check.expect);
        }
      }
    });
  }
});

describe('shouldDeliver (Worker, fixture-driven)', () => {
  for (const tc of fixture.shouldDeliver) {
    it(tc.name, () => {
      const prefs = tc.prefsInput
        ? parsePrefs(JSON.stringify(tc.prefsInput))
        : DEFAULT_PREFS;
      expect(shouldDeliver(tc.kind, prefs, tc.channel)).toBe(tc.expect);
    });
  }
});
