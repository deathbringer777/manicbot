'use strict';
/**
 * Job-runner core logic — claim race-safety, attempts ceiling, stuck reaper,
 * dispatch, result write-back. Pure over an injected D1 transport.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimJob, runJob, processPending, reapStuck, MAX_ATTEMPTS } = require('../services/job-core');

// In-memory D1 honouring the conditional-claim guard, the attempts ceiling and
// the reaper UPDATEs. Real atomicity is SQLite's single-statement guarantee;
// this fake proves the code relies on guarded UPDATEs, not read-then-write.
function makeFakeD1(rows) {
  const table = rows.map((r) => ({ ...r }));
  const att = (r) => (r.attempts || 0);
  return {
    isConfigured: true,
    async query(sql, params = []) {
      if (/SELECT/i.test(sql) && /status='pending'/.test(sql)) {
        const maxAttempts = params[0] ?? Infinity; // WHERE attempts < ?1
        const limit = params[1] ?? table.length;   // LIMIT ?2
        return table
          .filter((r) => r.status === 'pending' && att(r) < maxAttempts)
          .sort((a, b) => a.created_at - b.created_at)
          .slice(0, limit)
          .map((r) => ({ id: r.id, type: r.type, payload: r.payload }));
      }
      return [];
    },
    async exec(sql, params = []) {
      if (/UPDATE jobs SET status='running'/.test(sql)) {
        const [now, id, maxAttempts] = params; // CLAIM
        const row = table.find((r) => r.id === id && r.status === 'pending' && att(r) < maxAttempts);
        if (!row) return { changes: 0 };
        row.status = 'running'; row.claimed_at = now; row.attempts = att(row) + 1;
        return { changes: 1 };
      }
      if (/SET status='error', error='stuck/.test(sql)) {
        const [now, cutoff] = params; // REAP_STUCK
        let changes = 0;
        for (const r of table) {
          if (r.status === 'running' && r.claimed_at < cutoff) { r.status = 'error'; r.error = 'stuck (reaped)'; r.finished_at = now; changes += 1; }
        }
        return { changes };
      }
      if (/SET status='dead'/.test(sql)) {
        const [now, maxAttempts] = params; // REAP_DEAD
        let changes = 0;
        for (const r of table) {
          if (r.status === 'pending' && att(r) >= maxAttempts) { r.status = 'dead'; r.finished_at = now; changes += 1; }
        }
        return { changes };
      }
      if (/UPDATE jobs SET status=\?1/.test(sql)) {
        const [status, result, error, now, id] = params; // FINISH
        const row = table.find((r) => r.id === id);
        if (!row) return { changes: 0 };
        row.status = status; row.result = result; row.error = error; row.finished_at = now;
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

test('claimJob: refuses a row at the attempts ceiling (SEC-005)', async () => {
  const d1 = makeFakeD1([{ id: 'j1', type: 'ping', payload: '{}', status: 'pending', attempts: MAX_ATTEMPTS, created_at: 1 }]);
  const won = await claimJob({ d1 }, 'j1', { now: () => 1 });
  assert.equal(won, false);
  assert.equal(d1._table[0].status, 'pending'); // untouched
});

test('reapStuck: terminal-states stuck running + over-attempt pending (SEC-005)', async () => {
  const d1 = makeFakeD1([
    { id: 'r1', type: 'ping', payload: '{}', status: 'running', claimed_at: 100 },          // stuck (old lease)
    { id: 'p1', type: 'ping', payload: '{}', status: 'pending', attempts: MAX_ATTEMPTS, created_at: 1 }, // poison
    { id: 'p2', type: 'ping', payload: '{}', status: 'pending', attempts: 0, created_at: 2 },            // healthy
  ]);
  const out = await reapStuck({ d1 }, { now: () => 1000, leaseMs: 60_000, maxAttempts: MAX_ATTEMPTS });
  assert.equal(out.stuck, 1);
  assert.equal(out.dead, 1);
  assert.equal(d1._table.find((r) => r.id === 'r1').status, 'error');
  assert.equal(d1._table.find((r) => r.id === 'p1').status, 'dead');
  assert.equal(d1._table.find((r) => r.id === 'p2').status, 'pending');
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

test('runJob: oversized result is stored as VALID json, not a corrupt slice (SEC-008)', async () => {
  const d1 = makeFakeD1([{ id: 'j1', type: 'big', payload: '{}', status: 'running', created_at: 1 }]);
  const handlers = { big: async () => ({ blob: 'x'.repeat(200_000) }) };
  const r = await runJob({ d1, handlers }, { id: 'j1', type: 'big', payload: '{}' }, { now: () => 1 });
  assert.equal(r.ok, true);
  const parsed = JSON.parse(d1._table[0].result); // must not throw
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.bytes > 100_000);
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

test('processPending: claims and runs every healthy pending row, returns counts', async () => {
  const d1 = makeFakeD1([
    { id: 'j1', type: 'ping', payload: '{}', status: 'pending', attempts: 0, created_at: 1 },
    { id: 'j2', type: 'ping', payload: '{}', status: 'pending', attempts: 0, created_at: 2 },
  ]);
  const handlers = { ping: async () => ({ ok: 1 }) };
  const out = await processPending({ d1, handlers }, { limit: 10, now: () => 5 });
  assert.equal(out.claimed, 2);
  assert.equal(out.done, 2);
  assert.equal(out.failed, 0);
  assert.ok(d1._table.every((r) => r.status === 'done'));
});
