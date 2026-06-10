'use strict';
/**
 * crons/lead-scout/rotation.js — pure rotation/retry state machine extracted
 * from index.js. Success semantics must stay byte-identical to the legacy
 * inline logic; the new part is the bounded failure-retry (a permanently
 * broken slot must not block the rotation forever).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const rotation = require('../crons/lead-scout/rotation');

const CORPUS = { districts: 14, queries: 5, sources: 3 };

function state(overrides = {}) {
  return {
    districtIndex: 0, queryIndex: 0, sourceIndex: 0,
    totalLeads: 0, runsCompleted: 0, failStreak: 0,
    ...overrides,
  };
}

test('advanceOnSuccess: source → query → district roll-over (legacy semantics)', () => {
  let s = state({ sourceIndex: 2, queryIndex: 4, districtIndex: 0 });
  s = rotation.advanceOnSuccess(s, CORPUS);
  // sourceIndex hits 3 (mod 3 == 0) → query advances; query was last → district advances
  assert.equal(s.sourceIndex, 3);
  assert.equal(s.queryIndex, 0);
  assert.equal(s.districtIndex, 1);
  assert.equal(s.failStreak, 0);
});

test('advanceOnSuccess: mid-cycle advance only bumps sourceIndex', () => {
  let s = state({ sourceIndex: 0, queryIndex: 2, districtIndex: 5 });
  s = rotation.advanceOnSuccess(s, CORPUS);
  assert.equal(s.sourceIndex, 1);
  assert.equal(s.queryIndex, 2);
  assert.equal(s.districtIndex, 5);
});

test('district index wraps around', () => {
  let s = state({ sourceIndex: 2, queryIndex: 4, districtIndex: 13 });
  s = rotation.advanceOnSuccess(s, CORPUS);
  assert.equal(s.districtIndex, 0);
});

test('onFailure: keeps the slot for the first MAX_FAILS-1 failures', () => {
  let s = state({ sourceIndex: 7, queryIndex: 1, districtIndex: 3 });
  const r1 = rotation.onFailure(s, CORPUS);
  assert.equal(r1.forced, false);
  assert.equal(r1.state.failStreak, 1);
  assert.equal(r1.state.sourceIndex, 7, 'slot unchanged — retry next hour');
});

test('onFailure: forces advance after MAX_FAILS consecutive failures', () => {
  let s = state({ sourceIndex: 7, queryIndex: 1, districtIndex: 3, failStreak: rotation.MAX_FAILS - 1 });
  const { state: next, forced } = rotation.onFailure(s, CORPUS);
  assert.equal(forced, true);
  assert.equal(next.failStreak, 0, 'streak resets after forced advance');
  assert.equal(next.sourceIndex, 8, 'slot advanced to unblock rotation');
});

test('currentSlot: clamps out-of-range indices defensively', () => {
  const slot = rotation.currentSlot(state({ districtIndex: 99, queryIndex: 99, sourceIndex: 4 }), CORPUS);
  assert.equal(slot.districtIndex, 13);
  assert.equal(slot.queryIndex, 4);
  assert.equal(slot.sourceOrdinal, 1, 'sourceIndex 4 mod 3 sources = 1');
});
