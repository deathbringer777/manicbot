/**
 * Recurrence DSL parity tests — admin-app side.
 *
 * Phase 2 cleanup: cases now loaded from
 *   src/__tests__/helpers/parity-fixtures/recurrence-cases.json
 * The Worker mirror at manicbot/test/recurrence.test.js loads the SAME
 * file (via relative path) so the two packages cannot drift. Drift is
 * structurally impossible with a single fixture source.
 */
import { describe, it, expect } from "vitest";
import {
  validateRecurrence,
  expandOccurrences,
  nextOccurrenceAfter,
  type Recurrence,
} from "~/lib/recurrence";
import fixture from "./helpers/parity-fixtures/recurrence-cases.json";

type ExpandCase = {
  name: string;
  rule: Recurrence;
  anchor: string;
  fromIso?: string;
  toIso?: string;
  expectIso?: string[];
  expectIsoDateOnly?: string[];
};

type NextCase = {
  name: string;
  rule: Recurrence;
  anchor: string;
  afterIso: string;
  expectIso: string | null;
};

function normalizeUntil(obj: unknown) {
  if (obj && typeof obj === "object" && "until" in obj) {
    const u = (obj as { until: unknown }).until;
    if (u === undefined) (obj as { until: unknown }).until = null;
  }
  return obj;
}

describe("validateRecurrence (admin-app, fixture-driven)", () => {
  for (const tc of fixture.validateRecurrence) {
    it(tc.name, () => {
      if ("throws" in tc) {
        if (typeof tc.throws === "string") {
          expect(() => validateRecurrence(tc.input)).toThrow(new RegExp(tc.throws));
        } else {
          expect(() => validateRecurrence(tc.input)).toThrow();
        }
      } else {
        const result = validateRecurrence(tc.input);
        expect(normalizeUntil(result)).toEqual(tc.expect);
      }
    });
  }
});

describe("expandOccurrences (admin-app, fixture-driven)", () => {
  const defaultFrom = new Date(fixture.expandOccurrences.windowFromIso);
  const defaultTo = new Date(fixture.expandOccurrences.windowToIso);

  for (const tc of fixture.expandOccurrences.cases as ExpandCase[]) {
    it(tc.name, () => {
      const from = tc.fromIso ? new Date(tc.fromIso) : defaultFrom;
      const to = tc.toIso ? new Date(tc.toIso) : defaultTo;
      const occs = expandOccurrences(tc.rule, tc.anchor, from, to);
      if (tc.expectIsoDateOnly) {
        expect(occs.map((d) => d.toISOString().slice(0, 10))).toEqual(tc.expectIsoDateOnly);
      } else {
        expect(occs.map((d) => d.toISOString())).toEqual(tc.expectIso ?? []);
      }
    });
  }

  for (const tc of fixture.expandOccurrences.throws as ExpandCase[]) {
    it(tc.name, () => {
      const from = tc.fromIso ? new Date(tc.fromIso) : defaultFrom;
      const to = tc.toIso ? new Date(tc.toIso) : defaultTo;
      expect(() => expandOccurrences(tc.rule, tc.anchor, from, to)).toThrow();
    });
  }
});

describe("nextOccurrenceAfter (admin-app, fixture-driven)", () => {
  for (const tc of fixture.nextOccurrenceAfter as NextCase[]) {
    it(tc.name, () => {
      const next = nextOccurrenceAfter(tc.rule, tc.anchor, new Date(tc.afterIso));
      if (tc.expectIso === null) {
        expect(next).toBeNull();
      } else {
        expect(next?.toISOString()).toBe(tc.expectIso);
      }
    });
  }
});
