/**
 * Tests for phaseChannelHealth — the cron probe that catches a dying IG
 * channel before clients notice. Background: from 2026-03-30 to 2026-05-14
 * @manicbot_com IG was silently broken (key rotation invalidated stored
 * token + Page subscription drifted). No alert ever fired because there
 * was no active health check. This phase fixes that: a fatal
 * `error_events` row is captured the moment Graph rejects the token or
 * the Page's subscribed_apps loses required fields.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));

// Stub getChannelConfig so we don't exercise D1 / decryption here — we
// only care about phaseChannelHealth's branching on igConfig shape.
const getChannelConfigMock = vi.fn();
vi.mock('../src/channels/resolver.js', () => ({
  getChannelConfig: (...args) => getChannelConfigMock(...args),
}));

// Capture errorCapture invocations.
const captureErrorMock = vi.fn(async () => {});
vi.mock('../src/utils/errorCapture.js', () => ({
  captureError: (...args) => captureErrorMock(...args),
}));

import { phaseChannelHealth } from '../src/handlers/cron.js';

function makeCtx({ lastRun = 0 } = {}) {
  return {
    tenantId: 't_test',
    META_APP_ID: '1568224577592551',
    db: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async first() {
                if (sql.includes('SELECT value FROM tenant_config')) {
                  return lastRun ? { value: String(lastRun) } : null;
                }
                return null;
              },
              async run() { return { success: true }; },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    },
  };
}

describe('phaseChannelHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getChannelConfigMock.mockReset();
    captureErrorMock.mockReset();
  });

  it('skips when within 6h window', async () => {
    const ctx = makeCtx({ lastRun: Math.floor(Date.now() / 1000) - 60 });
    await phaseChannelHealth(ctx, Date.now());
    expect(getChannelConfigMock).not.toHaveBeenCalled();
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it('no-op when tenant has no IG channel', async () => {
    getChannelConfigMock.mockResolvedValueOnce(null);
    const ctx = makeCtx();
    await phaseChannelHealth(ctx, Date.now());
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it('captures FATAL when token failed to decrypt (key rotated)', async () => {
    getChannelConfigMock.mockResolvedValueOnce({
      page_id: '1008301152373103',
      token: null,
    });
    const ctx = makeCtx();
    await phaseChannelHealth(ctx, Date.now());
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const args = captureErrorMock.mock.calls[0];
    expect(args[1].message).toMatch(/decrypt failed/);
    expect(args[2].severity).toBe('fatal');
    expect(args[2].pageId).toBe('1008301152373103');
  });

  it('captures FATAL when Graph rejects the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { message: 'Invalid OAuth Access Token', code: 190 },
      }), { status: 400 }),
    );
    getChannelConfigMock.mockResolvedValueOnce({
      page_id: '12345',
      token: 'EAA_dead_token',
    });
    const ctx = makeCtx();
    await phaseChannelHealth(ctx, Date.now());
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock.mock.calls[0][2].severity).toBe('fatal');
    expect(captureErrorMock.mock.calls[0][1].message).toMatch(/Invalid OAuth/);
  });

  it('captures ERROR when subscribed_apps is missing required fields', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345' }), { status: 200 })) // /me OK
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: '1568224577592551', subscribed_fields: ['messages'] }], // missing 2
      }), { status: 200 }));
    getChannelConfigMock.mockResolvedValueOnce({
      page_id: '12345',
      token: 'EAA_x',
    });
    const ctx = makeCtx();
    await phaseChannelHealth(ctx, Date.now());
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock.mock.calls[0][2].severity).toBe('error');
    expect(captureErrorMock.mock.calls[0][2].missingFields).toContain('messaging_postbacks');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('healthy channel: /me OK + all fields subscribed → no captures', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: '1568224577592551',
          subscribed_fields: ['messages', 'messaging_postbacks', 'message_reads'],
        }],
      }), { status: 200 }));
    getChannelConfigMock.mockResolvedValueOnce({
      page_id: '12345',
      token: 'EAA_x',
    });
    const ctx = makeCtx();
    await phaseChannelHealth(ctx, Date.now());
    expect(captureErrorMock).not.toHaveBeenCalled();
  });
});
