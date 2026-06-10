'use strict';
/**
 * Pure rotation/retry state machine for lead-scout.
 *
 * Success-path semantics are byte-identical to the legacy inline logic in
 * index.js (source → query → district roll-over). New: bounded failure
 * retry — the same slot is retried up to MAX_FAILS consecutive hours, then
 * the rotation force-advances so one permanently broken (district, query,
 * source) combination can't stall lead collection forever.
 */
const MAX_FAILS = 3;

function clone(state) {
  return { ...state };
}

function advanceOnSuccess(state, corpus) {
  const s = clone(state);
  s.sourceIndex = (s.sourceIndex || 0) + 1;
  if (s.sourceIndex % corpus.sources === 0) {
    s.queryIndex = (s.queryIndex || 0) + 1;
  }
  if (s.queryIndex >= corpus.queries) {
    s.queryIndex = 0;
    s.districtIndex = ((s.districtIndex || 0) + 1) % corpus.districts;
  }
  s.failStreak = 0;
  return s;
}

function onFailure(state, corpus) {
  const s = clone(state);
  s.failStreak = (s.failStreak || 0) + 1;
  if (s.failStreak >= MAX_FAILS) {
    const advanced = advanceOnSuccess(s, corpus);
    advanced.failStreak = 0;
    return { state: advanced, forced: true };
  }
  return { state: s, forced: false };
}

function currentSlot(state, corpus) {
  return {
    districtIndex: Math.min(state.districtIndex || 0, corpus.districts - 1),
    queryIndex: Math.min(state.queryIndex || 0, corpus.queries - 1),
    sourceOrdinal: (state.sourceIndex || 0) % corpus.sources,
  };
}

module.exports = { advanceOnSuccess, onFailure, currentSlot, MAX_FAILS };
