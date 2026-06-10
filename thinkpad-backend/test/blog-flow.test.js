'use strict';
/**
 * Pure flow helpers of the blog autopilot: topic rotation with recently-used
 * avoidance (ported from v1 with identical state shape) and the weekly topic
 * cache refresh decision.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../crons/blog/core');

const POOL = [
  { slug: 'a', queryRu: 'а', queryEn: 'a' },
  { slug: 'b', queryRu: 'б', queryEn: 'b' },
  { slug: 'c', queryRu: 'в', queryEn: 'c' },
];

test('pickTopicFromPool rotates and tracks usedSlugs (max 5 kept)', () => {
  let state = { topicIndex: 0, usedSlugs: [], source: 'discovered' };
  const r1 = core.pickTopicFromPool(state, POOL, 'discovered');
  assert.equal(r1.topic.slug, 'a');
  const r2 = core.pickTopicFromPool(r1.state, POOL, 'discovered');
  assert.equal(r2.topic.slug, 'b');
  assert.deepEqual(r2.state.usedSlugs, ['a', 'b']);
});

test('pickTopicFromPool skips recently used slugs', () => {
  const state = { topicIndex: 0, usedSlugs: ['a'], source: 'discovered' };
  const { topic } = core.pickTopicFromPool(state, POOL, 'discovered');
  assert.equal(topic.slug, 'b', 'slug "a" was just used — skip it');
});

test('pickTopicFromPool resets rotation when the source changes', () => {
  const state = { topicIndex: 2, usedSlugs: ['a', 'b'], source: 'fallback' };
  const { topic, state: next } = core.pickTopicFromPool(state, POOL, 'discovered');
  assert.equal(topic.slug, 'a', 'index reset to 0 on source switch');
  assert.equal(next.source, 'discovered');
});

test('shouldRefreshTopics: refresh when empty or older than 7 days', () => {
  const now = Date.now();
  assert.equal(core.shouldRefreshTopics([], now - 1000, now), true, 'empty list');
  assert.equal(core.shouldRefreshTopics([{ slug: 'x' }], now - 8 * 86400000, now), true, 'stale cache');
  assert.equal(core.shouldRefreshTopics([{ slug: 'x' }], now - 86400000, now), false, 'fresh cache');
  assert.equal(core.shouldRefreshTopics([{ noslug: 1 }], now - 1000, now), true, 'no valid slugs');
});
