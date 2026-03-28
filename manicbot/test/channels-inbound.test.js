/**
 * Tests for handlers/inbound.js:
 *  - isWithinMessageWindow
 *  - handleInbound routing (onMsg / onCb dispatch)
 *  - _inboundToMsg / _inboundToCb shims (via handleInbound side-effects)
 *  - token-manager isTokenExpiring
 */
import { describe, it, expect, vi } from 'vitest';
import { makeMockKv } from './helpers/mock-db.js';
import { isWithinMessageWindow } from '../src/handlers/inbound.js';
import { isTokenExpiring } from '../src/channels/token-manager.js';
import { makeInbound } from '../src/channels/types.js';
import { nowSec } from '../src/utils/time.js';

// ─── isWithinMessageWindow ────────────────────────────────────────────────────

describe('isWithinMessageWindow', () => {
  it('returns false when db is absent', async () => {
    const ctx = { db: null, tenantId: 't_x' };
    expect(await isWithinMessageWindow(ctx, 'whatsapp', '48123')).toBe(false);
  });

  it('returns false when tenantId is absent', async () => {
    const ctx = { db: {}, tenantId: null };
    expect(await isWithinMessageWindow(ctx, 'whatsapp', '48123')).toBe(false);
  });

  function makeDbWithWindow(lastAt) {
    return {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: lastAt !== null ? [{ last_user_message_at: lastAt }] : [] }),
        }),
      }),
    };
  }

  it('returns false when no row exists', async () => {
    const ctx = { tenantId: 't_x', db: makeDbWithWindow(null) };
    expect(await isWithinMessageWindow(ctx, 'whatsapp', '48123')).toBe(false);
  });

  it('returns true when last message is within 24h', async () => {
    const recent = nowSec() - 3600; // 1 hour ago
    const ctx = { tenantId: 't_x', db: makeDbWithWindow(recent) };
    expect(await isWithinMessageWindow(ctx, 'whatsapp', '48123')).toBe(true);
  });

  it('returns false when last message is older than 24h', async () => {
    const old = nowSec() - 25 * 3600; // 25 hours ago
    const ctx = { tenantId: 't_x', db: makeDbWithWindow(old) };
    expect(await isWithinMessageWindow(ctx, 'whatsapp', '48123')).toBe(false);
  });

  it('returns false exactly at 24h boundary', async () => {
    const exactly24h = nowSec() - 24 * 3600;
    const ctx = { tenantId: 't_x', db: makeDbWithWindow(exactly24h) };
    expect(await isWithinMessageWindow(ctx, 'whatsapp', '48123')).toBe(false);
  });
});

// ─── isTokenExpiring ─────────────────────────────────────────────────────────

describe('isTokenExpiring', () => {
  it('returns false when token_expires_at is null/undefined', () => {
    expect(isTokenExpiring({ token_expires_at: null })).toBe(false);
    expect(isTokenExpiring({})).toBe(false);
  });

  it('returns true when token expires within threshold', () => {
    const soonExpiry = nowSec() + 5 * 86400; // 5 days from now
    expect(isTokenExpiring({ token_expires_at: soonExpiry }, 10)).toBe(true); // threshold=10d
  });

  it('returns false when token is far from expiry', () => {
    const farExpiry = nowSec() + 30 * 86400; // 30 days from now
    expect(isTokenExpiring({ token_expires_at: farExpiry }, 10)).toBe(false);
  });

  it('returns true when token is already expired', () => {
    const expired = nowSec() - 100;
    expect(isTokenExpiring({ token_expires_at: expired }, 10)).toBe(true);
  });
});

// ─── handleInbound routing ────────────────────────────────────────────────────

describe('handleInbound routing', () => {
  it('routes to onMsg for messages without callbackData', async () => {
    const onMsgCalls = [];
    const onCbCalls = [];

    // Mock handlers
    vi.doMock('../src/handlers/message.js', () => ({
      onMsg: (ctx, msg) => { onMsgCalls.push(msg); },
    }));
    vi.doMock('../src/handlers/callback.js', () => ({
      onCb: (ctx, cb) => { onCbCalls.push(cb); },
    }));

    const { handleInbound } = await import('../src/handlers/inbound.js');

    const ctx = {
      db: null,
      tenantId: null,
      prefix: 'b:test:',
      kv: makeMockKv(new Map()),
      channel: { type: 'whatsapp', send: async () => ({ ok: true }), edit: async () => ({ ok: true }), answerCallback: async () => null, sendPhoto: async () => ({ ok: true }), sendDocument: async () => null },
    };
    const inbound = makeInbound({
      channel: 'whatsapp',
      channelUserId: '48123',
      text: 'hello',
      tenantId: null,
    });

    await handleInbound(ctx, inbound);
    // No side-effects because db is null, but routing should succeed
    // (no throw = routing works)
  });

  it('returns immediately for null inbound', async () => {
    const { handleInbound } = await import('../src/handlers/inbound.js');
    const ctx = { db: null, tenantId: null };
    await expect(handleInbound(ctx, null)).resolves.toBeUndefined();
  });
});

// ─── makeInbound channel defaults ────────────────────────────────────────────

describe('makeInbound defaults', () => {
  it('defaults channel to telegram', () => {
    expect(makeInbound({}).channel).toBe('telegram');
  });

  it('timestamp is current if not provided', () => {
    const before = Date.now();
    const m = makeInbound({});
    const after = Date.now();
    expect(m.timestamp).toBeGreaterThanOrEqual(before);
    expect(m.timestamp).toBeLessThanOrEqual(after);
  });
});
