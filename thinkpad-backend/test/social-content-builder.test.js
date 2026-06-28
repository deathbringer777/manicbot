'use strict';
/**
 * crons/social-content-builder.js — generates captions via claude -p and pushes
 * them to the Worker social-draft seam. Pure helpers unit-tested; main() driven
 * with injected claude + http (no CLI, no network).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { main, buildPrompt, pickCaption, slotTimes } = require('../crons/social-content-builder');

function silentLogger() { const lines = []; return { log: (m) => lines.push(m), lines }; }

test('buildPrompt embeds theme + topic and asks for JSON', () => {
  const p = buildPrompt('product', 'AI 24/7');
  assert.ok(p.includes('product'));
  assert.ok(p.includes('AI 24/7'));
  assert.ok(p.includes('caption_pl'));
});

test('pickCaption normalizes and requires caption_pl', () => {
  const c = pickCaption({ headline_pl: 'H', caption_pl: 'C', hashtags: ['#a', 1], image_prompt_visual: 'v' });
  assert.deepEqual(c, { headline_pl: 'H', caption_pl: 'C', hashtags: ['#a', '1'], image_prompt_visual: 'v' });
  assert.throws(() => pickCaption({ headline_pl: 'x' }));
});

test('slotTimes builds days × post-times future slots', () => {
  const slots = slotTimes(Date.UTC(2026, 0, 1), 2, (t) => `topic-${t}`);
  assert.equal(slots.length, 6); // 2 days × 3 times
  for (const s of slots) {
    assert.ok(s.scheduledAt > Math.floor(Date.UTC(2026, 0, 1) / 1000));
    assert.ok(s.topic.startsWith('topic-'));
  }
});

test('main skips cleanly without a token', async () => {
  const r = await main(silentLogger(), { token: '', http: async () => { throw new Error('should not call'); } });
  assert.deepEqual(r, { skipped: true });
});

test('main generates + pushes each slot via the seam', async () => {
  const posts = [];
  const r = await main(silentLogger(), {
    baseUrl: 'http://w', token: 't', days: 1, now: Date.UTC(2026, 0, 1),
    topicFor: (t) => `topic-${t}`,
    claude: async (_prompt, opts) => {
      assert.equal(opts.json, true);
      return { json: { headline_pl: 'H', caption_pl: 'C', hashtags: ['#x'], image_prompt_visual: 'v' } };
    },
    http: async (url, o) => { posts.push({ url, body: o.body }); return { status: 200, data: { ok: true } }; },
  });
  assert.equal(r.pushed, 3);
  assert.equal(r.errors, 0);
  assert.equal(posts.length, 3);
  assert.ok(posts[0].url.endsWith('/admin/messaging/social-draft'));
  assert.equal(posts[0].body.caption_pl, 'C');
  assert.ok(posts[0].body.scheduled_at > 0);
});

test('main counts errors without throwing when a slot fails', async () => {
  const r = await main(silentLogger(), {
    baseUrl: 'http://w', token: 't', days: 1, now: Date.UTC(2026, 0, 1),
    claude: async () => { throw new Error('claude down'); },
    http: async () => ({ status: 200, data: {} }),
  });
  assert.equal(r.pushed, 0);
  assert.equal(r.errors, 3);
});
