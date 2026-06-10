'use strict';
/**
 * lib/d1.js — Cloudflare D1 HTTP query helper (shared by nightly + blog).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createD1 } = require('../lib/d1');

const CFG = { accountId: 'acc', apiToken: 'tok', databaseId: 'db' };

test('query posts SQL+params and unwraps the first result set', async () => {
  const calls = [];
  const transport = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, data: { success: true, result: [{ results: [{ n: 1 }], meta: { changes: 1 } }] } };
  };
  const d1 = createD1({ ...CFG, transport });
  const rows = await d1.query('SELECT ?1', [5]);
  assert.deepEqual(rows, [{ n: 1 }]);
  assert.ok(calls[0].url.includes('/accounts/acc/d1/database/db/query'));
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { sql: 'SELECT ?1', params: [5] });
});

test('exec returns meta (for INSERT change counts)', async () => {
  const transport = async () => ({ status: 200, data: { success: true, result: [{ results: [], meta: { changes: 0 } }] } });
  const d1 = createD1({ ...CFG, transport });
  const meta = await d1.exec('INSERT ...', []);
  assert.equal(meta.changes, 0);
});

test('query throws on API error payload', async () => {
  const transport = async () => ({ status: 200, data: { success: false, errors: [{ code: 7500, message: 'no perm' }] } });
  const d1 = createD1({ ...CFG, transport });
  await assert.rejects(() => d1.query('SELECT 1'), /no perm/);
});

test('unconfigured d1 reports isConfigured=false and refuses to query', async () => {
  const d1 = createD1({ accountId: '', apiToken: '', databaseId: '', transport: async () => ({}) });
  assert.equal(d1.isConfigured, false);
  await assert.rejects(() => d1.query('SELECT 1'), /not configured/i);
});
