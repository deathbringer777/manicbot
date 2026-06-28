'use strict';
/**
 * Job-runner core logic — claim race-safety, dispatch, result write-back.
 * Pure logic over an injected D1 transport (no network, no real DB), matching
 * the blog-core.test.js convention.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimJob, runJob, processPending } = require('../services/job-core');

// In-memory D1 that honours the conditional-claim guard (status='pending').
// Real atomicity is SQLite's single-statement guarantee; this fake proves the
// code relies on the guarded UPDATE (changes count), not a blind read-then-write.
function makeFakeD1(rows) {
  const table = rows.map((r) => ({ ...r }));
  return {
    isConfigured: true,
    async query(sql, params = []) {
      if (/SELECT/i.test(sql) && /status='pending'/.test(sql)) {
        const limit = params[0] ?? table.length;
        return table
          .filter((r) => r.status === 'pending')
          .sort((a, b) => a.created_at - b.created_at)
          .slice(0, limit)
          .map((r) => ({ id: r.id, type: r.type, payload: r.payload }));
      }
      return [];
    },
    async exec(sql, params = []) {
      if (/UPDATE jobs SET status='running'/.test(sql)) {
        const [now, id] = params;
        const row = table.find((r) => r.id === id && r.status === 'pending');
        if (!row) return { changes: 0 };
        row.status = 'running';
        row.claimed_at = now;
        row.attempts = (row.attempts || 0) + 1;
        return { changes: 1 };
      }
      if (/UPDATE jobs SET status=\?1/.test(sql)) {
        const [status, result, error, now, id] = params;
        const row = table.find((r) => r.id === id);
        if (!row) return { changes: 0 };
        row.status = status;
        row.result = result;
        row.error = error;
        row.finished_at = now;
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    _table: table,
  };
}

test('claimJob: wins when the row is pending (changes=1)', async () => {
  const d1 = makeFakeD1([{ id: 'j1', type: 'ping', payload: '{}', status: 'pending', created_at: 1 }]);
  const won = await claimJob({ d1 }, 'j1', { now: () => 100 });
  assert.equal(won, true);
  assert.equal(d1._table[0].status, 'running');
  assert.equal(d1._table[0].claimed_at, 100);
  assert.equal(d1._table[0].attempts, 1);
});

test('claimJob: race — two claims on the same pending row, exactly one wins', async () => {
  const d1 = makeFakeD1([{ id: 'j1', type: 'ping', payload: '{}', status: 'pending', created_at: 1 }]);
  const [a, b] = await Promise.all([
    claimJob({ d1 }, 'j1', { now: () => 100 }),
    claimJob({ d1 }, 'j1', { now: () => 100 }),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal(d1._table[0].attempts, 1);
});

test('runJob: success writes done + JSON result', async () => {
  const d1 = makeFakeD1([{ id: 'j1', type: 'ping', payload: '{"x":1}', status: 'running', created_at: 1 }]);
  const handlers = { ping: async (p) => ({ pong: true, echo: p }) };
  const r = await runJob({ d1, handlers }, { id: 'j1', type: 'ping', payload: '{"x":1}' }, { now: () => 200 });
  assert.equal(r.ok, true);
  const row = d1._table[0];
  assert.equal(row.status, 'done');
  assert.equal(row.finished_at, 200);
  assert.deepEqual(JSON.parse(row.result), { pong: true, echo: { x: 1 } });
});

test('runJob: handler throw writes error status + message', async () => {
  const d1 = makeFakeD1([{ id: 'j1', type: 'boom', payload: '{}', status: 'running', created_at: 1 }]);
  const handlers = { boom: async () => { throw new Error('kaboom'); } };
  const r = await runJob({ d1, handlers }, { id: 'j1', type: 'boom', payload: '{}' }, { now: () => 1 });
  assert.equal(r.ok, false);
  assert.equal(d1._table[0].status, 'error');
  assert.match(d1._table[0].error, /kaboom/);
});

test('runJob: unknown type → error status (never silently dropped)', async () => {
  const d1 = makeFakeD1([{ id: 'j1', type: 'nope', payload: '{}', status: 'running', created_at: 1 }]);
  const r = await runJob({ d1, handlers: {} }, { id: 'j1', type: 'nope', payload: '{}' }, { now: () => 1 });
  assert.equal(r.ok, false);
  assert.equal(d1._table[0].status, 'error');
  assert.match(d1._table[0].error, /unknown/);
});

test('processPending: claims and runs every pending row, returns counts', async () => {
  const d1 = makeFakeD1([
    { id: 'j1', type: 'ping', payload: '{}', status: 'pending', created_at: 1 },
    { id: 'j2', type: 'ping', payload: '{}', status: 'pending', created_at: 2 },
  ]);
  const handlers = { ping: async () => ({ ok: 1 }) };
  const out = await processPending({ d1, handlers }, { limit: 10, now: () => 5 });
  assert.equal(out.claimed, 2);
  assert.equal(out.done, 2);
  assert.equal(out.failed, 0);
  assert.ok(d1._table.every((r) => r.status === 'done'));
});
