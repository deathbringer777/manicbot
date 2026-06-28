'use strict';
/**
 * crons/comment-responder.js — pulls comments, classifies+drafts via claude -p,
 * pushes the decision to the comment-reply seam. decide() unit-tested; main()
 * driven with injected claude + http (no CLI, no network).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { main, decide } = require('../crons/comment-responder');

function silentLogger() { const lines = []; return { log: (m) => lines.push(m), lines }; }

test('decide routes classes correctly', () => {
  assert.deepEqual(decide({ classification: 'complaint', reply: 'x' }), { action: 'escalate', classification: 'complaint' });
  assert.deepEqual(decide({ classification: 'legal' }), { action: 'escalate', classification: 'legal' });
  assert.deepEqual(decide({ classification: 'spam' }), { action: 'skip', classification: 'spam' });
  assert.deepEqual(decide({ classification: 'benign', reply: 'Dzięki!' }), { action: 'draft', classification: 'benign', reply_text: 'Dzięki!' });
  assert.deepEqual(decide({ classification: 'benign', reply: '' }), { action: 'skip', classification: 'benign' });
  assert.deepEqual(decide({}), { action: 'skip', classification: 'unknown' });
});

test('main skips cleanly without a token', async () => {
  const r = await main(silentLogger(), { token: '', http: async () => { throw new Error('no'); } });
  assert.deepEqual(r, { skipped: true });
});

test('main drafts safe comments and escalates risky ones', async () => {
  const posted = [];
  const comments = [
    { comment_id: 'C1', text: 'ile kosztuje?', from_username: 'a' },
    { comment_id: 'C2', text: 'to oszustwo!', from_username: 'b' },
    { comment_id: 'C3', text: 'buy followers', from_username: 'c' },
  ];
  const verdicts = {
    'ile kosztuje': { classification: 'lead', reply: 'Napisz w DM 😊' },
    'oszustwo': { classification: 'complaint', reply: '' },
    'followers': { classification: 'spam', reply: '' },
  };
  const r = await main(silentLogger(), {
    baseUrl: 'http://w', token: 't', limit: 25,
    http: async (url, o) => {
      if (url.includes('/comments-pending')) return { status: 200, data: { comments } };
      posted.push(o.body);
      return { status: 200, data: { ok: true } };
    },
    claude: async (prompt) => {
      const key = Object.keys(verdicts).find((k) => prompt.includes(k));
      return { json: verdicts[key] };
    },
  });
  assert.equal(r.drafted, 1);
  assert.equal(r.escalated, 1);
  assert.equal(r.skipped, 1);
  const c1 = posted.find((p) => p.comment_id === 'C1');
  assert.equal(c1.action, 'draft');
  assert.equal(c1.reply_text, 'Napisz w DM 😊');
  assert.equal(posted.find((p) => p.comment_id === 'C2').action, 'escalate');
  assert.equal(posted.find((p) => p.comment_id === 'C3').action, 'skip');
});

test('main throws on a failed comments-pending pull (runCron alerts + exit 1)', async () => {
  await assert.rejects(main(silentLogger(), {
    baseUrl: 'http://w', token: 't',
    http: async () => ({ status: 500, data: { error: 'boom' } }),
    claude: async () => ({ json: {} }),
  }), /comments-pending HTTP 500/);
});
