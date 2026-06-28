'use strict';
/**
 * Job handler registry — the marketing/compute jobs the sidecar runs.
 * Handlers are pure functions of (payload, deps); deps (askClaude, d1, tg) are
 * injected so tests never spawn the CLI or hit the network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { HANDLERS } = require('../services/handlers');

// Capture the opts askClaude is called with.
function spyClaude(ret = { text: 'ok' }) {
  const calls = [];
  const fn = async (prompt, opts) => { calls.push({ prompt, opts }); return ret; };
  fn.calls = calls;
  return fn;
}

test('ping: returns pong + echoes the payload', async () => {
  const r = await HANDLERS.ping({ a: 1 }, {});
  assert.equal(r.pong, true);
  assert.deepEqual(r.echo, { a: 1 });
});

test('claude.generate: requires a prompt', async () => {
  await assert.rejects(
    () => HANDLERS['claude.generate']({}, { askClaude: spyClaude() }),
    /prompt/,
  );
});

test('claude.generate: returns text from askClaude', async () => {
  const askClaude = spyClaude({ text: 'echo:hi' });
  const r = await HANDLERS['claude.generate']({ prompt: 'hi' }, { askClaude });
  assert.equal(r.text, 'echo:hi');
});

test('claude.generate: json mode returns structured json', async () => {
  const askClaude = spyClaude({ json: { ok: 1 } });
  const r = await HANDLERS['claude.generate']({ prompt: 'hi', json: true }, { askClaude });
  assert.deepEqual(r.json, { ok: 1 });
  assert.equal(askClaude.calls[0].opts.json, true);
});

test('claude.generate: disables ALL tools and forbids host permission inheritance (SEC-001)', async () => {
  const askClaude = spyClaude();
  await HANDLERS['claude.generate']({ prompt: 'do something' }, { askClaude });
  const { opts } = askClaude.calls[0];
  assert.equal(opts.tools, '', 'tools must be the empty allowlist (no tools)');
  assert.equal(opts.permissionMode, 'default', 'must not inherit host bypassPermissions');
});

test('claude.generate: rejects an over-long prompt (SEC-006)', async () => {
  const askClaude = spyClaude();
  await assert.rejects(
    () => HANDLERS['claude.generate']({ prompt: 'x'.repeat(20_001) }, { askClaude }),
    /too long/,
  );
  assert.equal(askClaude.calls.length, 0, 'must reject before calling the CLI');
});

test('claude.generate: clamps timeoutMs into [10s, 300s] (SEC-006)', async () => {
  const askClaude = spyClaude();
  await HANDLERS['claude.generate']({ prompt: 'hi', timeoutMs: 86_400_000 }, { askClaude });
  assert.equal(askClaude.calls[0].opts.timeoutMs, 300_000);
  askClaude.calls.length = 0;
  await HANDLERS['claude.generate']({ prompt: 'hi', timeoutMs: 1 }, { askClaude });
  assert.equal(askClaude.calls[0].opts.timeoutMs, 10_000);
});

test('claude.generate: caps the system prompt length (SEC-006)', async () => {
  const askClaude = spyClaude();
  await HANDLERS['claude.generate']({ prompt: 'hi', system: 'y'.repeat(10_000) }, { askClaude });
  assert.equal(askClaude.calls[0].opts.system.length, 4_000);
});
