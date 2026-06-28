'use strict';
/**
 * Job handler registry — the marketing/compute jobs the sidecar runs.
 *
 * Each handler: async (payload, deps) => result (JSON-serialisable).
 * deps = { d1, askClaude, tg, logger } (injected by job-runner.js; injected as
 * mocks in tests). The Worker enqueues by `type` (services/jobs.js on main); the
 * runner dispatches by the same key.
 *
 * Extension point: add domain marketing jobs here (campaign.generate,
 * blog.generate, leads.scan, lead.enrich) — each its own TDD slice reusing the
 * existing crons' pure logic. `ping` + `claude.generate` are the platform MVP.
 */

const nowSec = () => Math.floor(Date.now() / 1000);

const HANDLERS = {
  // Liveness probe — proves the enqueue → claim → run → write-back pipe.
  async ping(payload) {
    return { pong: true, echo: payload ?? null, at: nowSec() };
  },

  // Generic Claude-on-Max generation. payload: { prompt, json?, system?, timeoutMs? }
  async 'claude.generate'(payload, { askClaude }) {
    const prompt = String(payload?.prompt || '').trim();
    if (!prompt) throw new Error('claude.generate: payload.prompt is required');
    const out = await askClaude(prompt, {
      json: !!payload.json,
      ...(payload.system ? { system: payload.system } : {}),
      ...(payload.timeoutMs ? { timeoutMs: payload.timeoutMs } : {}),
    });
    return payload.json ? { json: out.json } : { text: out.text };
  },
};

module.exports = { HANDLERS };
