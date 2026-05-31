/**
 * lib/notifications/prefs — admin-app side, fixture-driven parity.
 *
 * Phase 2 cleanup: cases shared with the Worker mirror at
 *   manicbot/test/notification-prefs.test.js
 * via the JSON fixture at
 *   src/__tests__/helpers/parity-fixtures/notification-prefs-cases.json
 * Drift across the two packages is structurally impossible because each
 * runner loads the same file.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFS,
  NOTIFICATION_CATEGORIES,
  categoryForKind,
  parsePrefs,
  serializePrefs,
  shouldDeliver,
} from "~/lib/notifications/prefs";
import fixture from "./helpers/parity-fixtures/notification-prefs-cases.json";

describe("notificationCategories — shared contract", () => {
  it("matches the parity-fixture list exactly (admin-app side)", () => {
    expect(NOTIFICATION_CATEGORIES).toEqual(fixture.notificationCategories);
  });

  it("default prefs match the fixture for representative categories", () => {
    for (const [cat, expected] of Object.entries(fixture.defaultPrefs)) {
      expect(DEFAULT_PREFS.categories[cat as keyof typeof DEFAULT_PREFS.categories])
        .toEqual(expected);
    }
  });
});

describe("categoryForKind (admin-app, fixture-driven)", () => {
  for (const tc of fixture.categoryForKind) {
    it(`maps "${tc.kind}" → ${tc.expect ?? "null"}`, () => {
      expect(categoryForKind(tc.kind)).toBe(tc.expect);
    });
  }
});

describe("parsePrefs — malformed input (admin-app)", () => {
  for (const tc of fixture.parsePrefsMalformed) {
    it(`returns DEFAULT_PREFS for ${tc.name}`, () => {
      expect(parsePrefs(tc.input)).toEqual(DEFAULT_PREFS);
    });
  }
});

describe("parsePrefs — partial input merging (admin-app)", () => {
  for (const tc of fixture.parsePrefsPartial) {
    it(tc.name, () => {
      const parsed = parsePrefs(JSON.stringify(tc.input));
      for (const check of tc.checks) {
        const cat = parsed.categories[check.category as keyof typeof parsed.categories];
        if ("channel" in check && check.channel !== undefined) {
          expect((cat as unknown as Record<string, boolean>)[check.channel]).toBe(check.expect);
        } else {
          expect(cat).toEqual(check.expect);
        }
      }
    });
  }
});

describe("shouldDeliver (admin-app, fixture-driven)", () => {
  for (const tc of fixture.shouldDeliver) {
    it(tc.name, () => {
      const prefs = tc.prefsInput
        ? parsePrefs(JSON.stringify(tc.prefsInput))
        : DEFAULT_PREFS;
      expect(
        shouldDeliver(tc.kind, prefs, tc.channel as "inapp" | "push" | "email"),
      ).toBe(tc.expect);
    });
  }
});

// ─── admin-app-only: serializePrefs (Worker has no equivalent) ──────────────

describe("serializePrefs — admin-app exclusive (no Worker mirror)", () => {
  it("emits categories in canonical (NOTIFICATION_CATEGORIES) order", () => {
    const json = serializePrefs(DEFAULT_PREFS);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed.categories)).toEqual([...NOTIFICATION_CATEGORIES]);
  });

  it("round-trips: parse(serialize(x)) === x", () => {
    const tweaked = parsePrefs(JSON.stringify({
      categories: { marketing: { inapp: false, push: false } },
    }));
    const rt = parsePrefs(serializePrefs(tweaked));
    expect(rt).toEqual(tweaked);
  });
});
