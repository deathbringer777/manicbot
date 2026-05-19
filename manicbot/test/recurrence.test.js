/**
 * Recurrence DSL parity tests — Worker side.
 *
 * Phase 2 cleanup: cases loaded from the SAME JSON fixture as the
 * admin-app mirror (`admin-app/src/__tests__/helpers/parity-fixtures/
 * recurrence-cases.json`) so the two packages cannot drift. Drift is
 * structurally impossible with a single fixture source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validateRecurrence,
  expandOccurrences,
  nextOccurrenceAfter,
} from '../src/lib/recurrence.js';

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  '../admin-app/src/__tests__/helpers/parity-fixtures/recurrence-cases.json',
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

function normalizeUntil(obj) {
  if (obj && typeof obj === 'object' && 'until' in obj) {
    if (obj.until === undefined) obj.until = null;
  }
  return obj;
}

describe('validateRecurrence (Worker, fixture-driven)', () => {
  for (const tc of fixture.validateRecurrence) {
    it(tc.name, () => {
      if ('throws' in tc) {
        if (typeof tc.throws === 'string') {
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

describe('expandOccurrences (Worker, fixture-driven)', () => {
  const defaultFrom = new Date(fixture.expandOccurrences.windowFromIso);
  const defaultTo = new Date(fixture.expandOccurrences.windowToIso);

  for (const tc of fixture.expandOccurrences.cases) {
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

  for (const tc of fixture.expandOccurrences.throws) {
    it(tc.name, () => {
      const from = tc.fromIso ? new Date(tc.fromIso) : defaultFrom;
      const to = tc.toIso ? new Date(tc.toIso) : defaultTo;
      expect(() => expandOccurrences(tc.rule, tc.anchor, from, to)).toThrow();
    });
  }
});

describe('nextOccurrenceAfter (Worker, fixture-driven)', () => {
  for (const tc of fixture.nextOccurrenceAfter) {
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
