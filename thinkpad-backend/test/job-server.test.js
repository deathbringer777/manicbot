'use strict';
/**
 * job-server.handleRequest — the /kick auth gate. SEC-002 (fail-closed) and
 * SEC-004 (body limit). Driven with plain req/res stubs, no real socket.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleRequest } = require('../services/job-server');

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(s) { this.status = s; return this; },
    end(b) { this.body = b; return this; },
  };
}
function makeReq({ method = 'POST', url = '/kick', headers = {} } = {}) {
  let resumed = false;
  return { method, url, headers, resume() { resumed = true; }, get resumed() { return resumed; } };
}
function spyDrain() {
  const calls = [];
  const fn = async (t) => { calls.push(t); };
  fn.calls = calls;
  return fn;
}
const logger = { log() {} };

test('/kick fails CLOSED when no verifier is configured → 503, no drain (SEC-002)', async () => {
  const drain = spyDrain();
  const res = makeRes();
  await handleRequest(makeReq(), res, { drain, verifyAccess: null, logger });
  assert.equal(res.status, 503);
  assert.equal(drain.calls.length, 0);
});

test('/kick rejects an invalid Access JWT → 403, no drain', async () => {
  const drain = spyDrain();
  const res = makeRes();
  const verifyAccess = async () => { throw new Error('access: bad signature'); };
  await handleRequest(makeReq({ headers: { 'cf-access-jwt-assertion': 'bad' } }), res, { drain, verifyAccess, logger });
  assert.equal(res.status, 403);
  assert.equal(drain.calls.length, 0);
});

test('/kick accepts a valid Access JWT → 202 + drains once', async () => {
  const drain = spyDrain();
  const res = makeRes();
  const verifyAccess = async () => ({ aud: ['x'] });
  const req = makeReq({ headers: { 'cf-access-jwt-assertion': 'good' } });
  await handleRequest(req, res, { drain, verifyAccess, logger });
  assert.equal(res.status, 202);
  assert.deepEqual(drain.calls, ['kick']);
  assert.equal(req.resumed, true); // body drained
});

test('/kick rejects an oversized body → 413, no drain (SEC-004)', async () => {
  const drain = spyDrain();
  const res = makeRes();
  const verifyAccess = async () => ({});
  await handleRequest(makeReq({ headers: { 'content-length': '99999' } }), res, { drain, verifyAccess, logger });
  assert.equal(res.status, 413);
  assert.equal(drain.calls.length, 0);
});

test('GET /health → 200 ok', async () => {
  const res = makeRes();
  await handleRequest(makeReq({ method: 'GET', url: '/health' }), res, { drain: spyDrain(), verifyAccess: null, logger });
  assert.equal(res.status, 200);
  assert.equal(res.body, 'ok');
});

test('unknown route → 404', async () => {
  const res = makeRes();
  await handleRequest(makeReq({ method: 'GET', url: '/nope' }), res, { drain: spyDrain(), verifyAccess: async () => ({}), logger });
  assert.equal(res.status, 404);
});
