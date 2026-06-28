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

// SEC-006: bound attacker-influenced inputs at the trust boundary.
const MAX_PROMPT_CHARS = 20_000;
const MAX_SYSTEM_CHARS = 4_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 120_000;

const HANDLERS = {
  // Liveness probe — proves the enqueue → claim → run → write-back pipe.
  async ping(payload) {
    return { pong: true, echo: payload ?? null, at: nowSec() };
  },

  // Generic Claude-on-Max generation. payload: { prompt, json?, system?, timeoutMs? }
  //
  // SECURITY: payload is attacker-influenceable. The prompt drives an autonomous
  // agent, so the guard is CAPABILITY, not text filtering:
  //   - tools:'' disables ALL tools (no file/bash) → pure text generation (SEC-001);
  //   - permissionMode:'default' refuses to inherit a host bypassPermissions posture;
  //   - prompt/system are length-capped and timeoutMs is clamped so one job can't
  //     pin the single-flight runner or blow up cost (SEC-006).
  async 'claude.generate'(payload, { askClaude }) {
    const prompt = String(payload?.prompt || '').trim();
    if (!prompt) throw new Error('claude.generate: payload.prompt is required');
    if (prompt.length > MAX_PROMPT_CHARS) throw new Error('claude.generate: prompt too long');
    const system = payload.system ? String(payload.system).slice(0, MAX_SYSTEM_CHARS) : null;
    const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
    const out = await askClaude(prompt, {
      json: !!payload.json,
      tools: '',                 // SEC-001: no tools
      permissionMode: 'default', // SEC-001: never inherit host bypassPermissions
      timeoutMs,
      ...(system ? { system } : {}),
    });
    return payload.json ? { json: out.json } : { text: out.text };
  },
};

module.exports = { HANDLERS };
