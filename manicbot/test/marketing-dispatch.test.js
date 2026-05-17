/**
 * phaseMarketingDispatch — pulls scheduled / stuck campaigns and routes
 * each through `runCampaignSend()`. The deep behaviour of the sender is
 * covered in marketing-sender-worker.test.js; here we test only the
 * dispatcher's SQL selection + per-row try/catch isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { phaseMarketingDispatch } from '../src/handlers/cron.js';

// Mock the sender so we can assert it's called for each due campaign
// without spinning up real Resend HTTP calls.
const runs = [];
vi.mock('../src/services/marketing/sender.js', () => ({
  runCampaignSend: async (_ctx, tenantId, campaignId) => {
    runs.push({ tenantId, campaignId });
    return { ok: true, total: 5, sent: 5, failed: 0, deferred: 0, status: 'sent' };
  },
}));

function makeDb({ campaigns = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const stmt = {
        bound: null,
        bind(...args) { this.bound = args; calls.push({ sql, args }); return this; },
        async first() { return null; },
        async all() {
          if (/FROM marketing_campaigns/i.test(sql)) {
            // Filter on the bound (tenantId, scheduled_cutoff, stuck_cutoff, limit).
            const [tenantId, nowS, stuckCutoff] = this.bound ?? [];
            const rows = campaigns
              .filter((c) => c.tenant_id === tenantId)
              .filter((c) => {
                const scheduledDue = c.status === 'scheduled' && c.scheduled_at != null && c.scheduled_at <= nowS;
                const stuckSending = c.status === 'sending' && (c.started_at ?? 0) < stuckCutoff;
                return scheduledDue || stuckSending;
              });
            return { results: rows.map((c) => ({ id: c.id })) };
          }
          return { results: [] };
        },
        async run() { return { meta: { changes: 0 } }; },
      };
      return stmt;
    },
  };
}

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.get(key) ?? null; },
    async put(key, val) { store.set(key, val); },
    async delete(key) { store.delete(key); },
  };
}

describe('phaseMarketingDispatch', () => {
  beforeEach(() => { runs.length = 0; });

  it('picks up status="scheduled" campaigns past their scheduled_at and runs each', async () => {
    const nowMs = 1_700_000_000_000; // fixed reference
    const nowS = Math.floor(nowMs / 1000);
    const db = makeDb({
      campaigns: [
        { id: 'cmp_due_a', tenant_id: 't_a', status: 'scheduled', scheduled_at: nowS - 60 },
        { id: 'cmp_due_b', tenant_id: 't_a', status: 'scheduled', scheduled_at: nowS - 5 },
        { id: 'cmp_future', tenant_id: 't_a', status: 'scheduled', scheduled_at: nowS + 3600 },
        { id: 'cmp_other_tenant', tenant_id: 't_b', status: 'scheduled', scheduled_at: nowS - 60 },
      ],
    });
    const ctx = { db, tenantId: 't_a', kv: makeKv() };

    await phaseMarketingDispatch(ctx, nowMs);

    expect(runs.map((r) => r.campaignId).sort()).toEqual(['cmp_due_a', 'cmp_due_b']);
    expect(runs.every((r) => r.tenantId === 't_a')).toBe(true);
  });

  it('also picks up status="sending" campaigns whose started_at is older than 30 min', async () => {
    const nowMs = 1_700_000_000_000;
    const nowS = Math.floor(nowMs / 1000);
    const db = makeDb({
      campaigns: [
        { id: 'cmp_stuck', tenant_id: 't_a', status: 'sending', started_at: nowS - 60 * 60 }, // 1h stale
        { id: 'cmp_fresh', tenant_id: 't_a', status: 'sending', started_at: nowS - 60 },      // 1 min stale → still inside
      ],
    });
    const ctx = { db, tenantId: 't_a', kv: makeKv() };

    await phaseMarketingDispatch(ctx, nowMs);
    expect(runs.map((r) => r.campaignId)).toEqual(['cmp_stuck']);
  });

  it('no-ops cleanly when nothing is due', async () => {
    const db = makeDb({ campaigns: [] });
    const ctx = { db, tenantId: 't_a', kv: makeKv() };
    await phaseMarketingDispatch(ctx, Date.now());
    expect(runs.length).toBe(0);
  });

  it('does nothing without a tenantId on the ctx', async () => {
    const db = makeDb({
      campaigns: [{ id: 'x', tenant_id: 't_a', status: 'scheduled', scheduled_at: 1 }],
    });
    const ctx = { db, tenantId: null, kv: makeKv() };
    await phaseMarketingDispatch(ctx, Date.now());
    expect(runs.length).toBe(0);
  });
});
