/**
 * Tests for cron's daily IG webhook re-subscribe. Background:
 * 2026-05-14 — @manicbot_com IG silently stopped delivering DMs. Worker
 * tail showed zero POSTs over a 2-min window after a real user message.
 * App↔Page link was intact, but the Page had been de-subscribed from
 * `messages` / `messaging_postbacks` / `message_reads`. Re-issuing
 * `POST /{page_id}/subscribed_apps` once a day keeps the link warm.
 *
 * Idempotency window: 24h, stored in `tenant_config` under
 * `cron:phase:ig_resubscribe:last`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maybeResubscribeIgWebhook } from '../src/handlers/cron.js';

function makeCtx({ last = 0 } = {}) {
  const writes = [];
  return {
    tenantId: 't_test',
    db: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async first() {
                if (sql.includes('SELECT value FROM tenant_config')) {
                  return last ? { value: String(last) } : null;
                }
                return null;
              },
              async run() { writes.push({ sql, params }); return { success: true }; },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    },
    BOT_ENCRYPTION_KEY: 'k'.repeat(32),
    _writes: writes,
  };
}

describe('maybeResubscribeIgWebhook', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
  });

  it('no-ops without ctx.db', async () => {
    const res = await maybeResubscribeIgWebhook({}, { token: 'T', page_id: 'P' }, Date.now());
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no-ops without token or page_id', async () => {
    const ctx = makeCtx();
    expect((await maybeResubscribeIgWebhook(ctx, { token: 'T' }, Date.now())).ok).toBe(false);
    expect((await maybeResubscribeIgWebhook(ctx, { page_id: 'P' }, Date.now())).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips when within 24h window', async () => {
    const ctx = makeCtx({ last: Math.floor(Date.now() / 1000) - 60 });
    const res = await maybeResubscribeIgWebhook(
      ctx, { token: 'EAA_x', page_id: '12345' }, Date.now(),
    );
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe('window');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('subscribes to messages,messaging_postbacks,message_reads when stale', async () => {
    const ctx = makeCtx({ last: 0 });
    const res = await maybeResubscribeIgWebhook(
      ctx, { token: 'EAA_x', page_id: '12345' }, Date.now(),
    );
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('/12345/subscribed_apps');
    expect(url).toContain('access_token=EAA_x');
    expect(url).toContain('messages');
    expect(url).toContain('messaging_postbacks');
    expect(url).toContain('message_reads');
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST');
    // Wrote the new last-run epoch.
    const phaseWrites = ctx._writes.filter(w => w.sql.includes('tenant_config'));
    expect(phaseWrites.length).toBeGreaterThan(0);
    expect(phaseWrites[0].params).toEqual(
      expect.arrayContaining(['t_test', 'cron:phase:ig_resubscribe:last']),
    );
  });

  it('returns error and does NOT bump last-run on Graph failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth token' } }), { status: 400 }),
    );
    const ctx = makeCtx({ last: 0 });
    const res = await maybeResubscribeIgWebhook(
      ctx, { token: 'EAA_bad', page_id: '12345' }, Date.now(),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe('Invalid OAuth token');
    // No tenant_config write on failure.
    const phaseWrites = ctx._writes.filter(w => w.sql.includes('tenant_config'));
    expect(phaseWrites.length).toBe(0);
  });
});
