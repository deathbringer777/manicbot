'use strict';
/**
 * Job handler registry — the marketing/compute jobs the sidecar can run.
 * Handlers are pure functions of (payload, deps); deps (askClaude, d1, tg) are
 * injected so tests never spawn the CLI or hit the network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { HANDLERS } = require('../services/handlers');

test('ping: returns pong + echoes the payload', async () => {
  const r = await HANDLERS.ping({ a: 1 }, {});
  assert.equal(r.pong, true);
  assert.deepEqual(r.echo, { a: 1 });
});

test('claude.generate: requires a prompt', async () => {
  await assert.rejects(
    () => HANDLERS['claude.generate']({}, { askClaude: async () => ({ text: 'x' }) }),
    /prompt/,
  );
});

test('claude.generate: returns text from askClaude', async () => {
  const askClaude = async (prompt) => ({ text: `echo:${prompt}` });
  const r = await HANDLERS['claude.generate']({ prompt: 'hi' }, { askClaude });
  assert.equal(r.text, 'echo:hi');
});

test('claude.generate: json mode returns structured json', async () => {
  const askClaude = async (_prompt, opts) => {
    assert.equal(opts.json, true);
    return { json: { ok: 1 } };
  };
  const r = await HANDLERS['claude.generate']({ prompt: 'hi', json: true }, { askClaude });
  assert.deepEqual(r.json, { ok: 1 });
});
