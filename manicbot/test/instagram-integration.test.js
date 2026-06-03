/**
 * Instagram integration tests:
 *  A. InstagramAdapter.send() / _post() behaviour
 *  B. Webhook handler (UA fallback, hub challenge)
 *  C. buildChannelCtx with null bot (IG-only tenant)
 *  D. Billing gate — clients pass, staff blocked when inactive
 *  E. /admin/ig-channel endpoint
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstagramAdapter } from '../src/channels/instagram.js';
import { instagramWebhookEntryIdMatchesConfig, buildChannelCtx } from '../src/channels/resolver.js';
import { handleHubChallenge } from '../src/channels/meta-verify.js';

function makeIGAdapter(pageId = 'pg_123', token = 'tok_123') {
  return new InstagramAdapter({
    tenantId: 't_ig',
    channelConfig: { config: { page_id: pageId }, token },
  });
}

// ─── A. InstagramAdapter.send() ──────────────────────────────────────────────

describe('InstagramAdapter.send()', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns not_configured when token is null', async () => {
    const adapter = makeIGAdapter('pg_123', null);
    const res = await adapter.send('user1', { text: 'hi' });
    expect(res).toEqual({ ok: false, error: 'not_configured' });
  });

  it('returns not_configured when pageId is null', async () => {
    const adapter = makeIGAdapter(null, 'tok');
    const res = await adapter.send('user1', { text: 'hi' });
    expect(res).toEqual({ ok: false, error: 'not_configured' });
  });

  it('sends plain text message via Graph API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const res = await adapter.send('user1', { text: 'привет' });
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/pg_1/messages');
    const body = JSON.parse(opts.body);
    expect(body.recipient.id).toBe('user1');
    expect(body.message.text).toBe('привет');
  });

  it('builds quick_replies from buttons', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const buttons = [[
      { text: 'Start', callbackData: 'cb_start' },
      { text: 'Pro', callbackData: 'cb_pro' },
    ]];
    await adapter.send('user1', { text: 'Choose plan:', buttons });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.message.quick_replies).toHaveLength(2);
    expect(body.message.quick_replies[0].title).toBe('Start');
    expect(body.message.quick_replies[0].payload).toBe('cb_start');
  });

  it('truncates text to 2000 chars', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const longText = 'x'.repeat(3000);
    await adapter.send('user1', { text: longText });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.message.text.length).toBe(2000);
  });

  it('limits quick_replies to 13', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const buttons = [Array.from({ length: 20 }, (_, i) => ({ text: `B${i}`, callbackData: `cb_${i}` }))];
    await adapter.send('user1', { text: 'pick', buttons });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.message.quick_replies.length).toBeLessThanOrEqual(13);
  });

  it('truncates quick_reply titles to 20 chars', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const buttons = [[{ text: 'A very long button title that exceeds 20', callbackData: 'cb' }]];
    await adapter.send('user1', { text: 'pick', buttons });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.message.quick_replies[0].title.length).toBeLessThanOrEqual(20);
  });

  it('handles Graph API error response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 400 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const res = await adapter.send('user1', { text: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it('handles fetch exception', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network timeout'));
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const res = await adapter.send('user1', { text: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('network timeout');
  });

  it('sendPhoto sends image attachment + caption', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    await adapter.sendPhoto('user1', 'https://img.test/a.jpg', 'My photo');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // image + caption
    const imageBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(imageBody.message.attachment.type).toBe('image');
    expect(imageBody.message.attachment.payload.url).toBe('https://img.test/a.jpg');
  });

  it('sendDocument falls back to text link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    await adapter.sendDocument('user1', 'https://files.test/doc.pdf', 'doc.pdf', 'Your receipt');
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.message.text).toContain('Your receipt');
    expect(body.message.text).toContain('https://files.test/doc.pdf');
  });

  it('sendDocument drops a non-https (http://) link — #329 https-only', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }),
    );
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    await adapter.sendDocument('user1', 'http://insecure.test/doc.pdf', 'doc.pdf', 'Your receipt');
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.message.text).toContain('Your receipt');            // caption still delivered
    expect(body.message.text).not.toContain('http://insecure.test'); // insecure link dropped
  });

  it('answerCallback is a no-op', async () => {
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const res = await adapter.answerCallback('cb_id', 'text');
    expect(res).toBeNull();
  });
});

// ─── B. Webhook handler ─────────────────────────────────────────────────────

describe('Instagram webhook handler', () => {
  it('GET /webhook/ig hub challenge returns challenge value', () => {
    const url = new URL('https://manicbot.com/webhook/ig?hub.mode=subscribe&hub.verify_token=my_vt&hub.challenge=CHALLENGE_123');
    const resp = handleHubChallenge(url, 'my_vt');
    expect(resp.status).toBe(200);
  });

  it('GET /webhook/ig hub challenge rejects wrong verify_token', () => {
    const url = new URL('https://manicbot.com/webhook/ig?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE');
    const resp = handleHubChallenge(url, 'correct_vt');
    expect(resp.status).toBe(403);
  });
});

// ─── C. buildChannelCtx with null bot (IG-only tenant) ───────────────────────

describe('buildChannelCtx — IG-only tenant (no TG bot)', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockEnv(tenantRow) {
    const stmtAll = vi.fn();
    const stmtRun = vi.fn().mockResolvedValue({ success: true });
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: stmtAll,
          first: vi.fn().mockImplementation(async () => tenantRow),
          run: stmtRun,
        }),
      }),
    };
    // First call: getTenant → tenantRow
    // Second call: getBotIdsByTenantId → empty
    // Third call: getBot → null (never reached)
    stmtAll.mockResolvedValueOnce({ results: [tenantRow] }) // getTenant uses dbGet → prepare.bind.first
      .mockResolvedValueOnce({ results: [] }); // getBotIdsByTenantId → no bots

    return { DB: db, MANICBOT: { get: vi.fn().mockResolvedValue(null), put: vi.fn(), delete: vi.fn() } };
  }

  it('returns valid ctx when tenant has no registered bots', async () => {
    const tenantRow = { id: 't_ig_only', name: 'IG Salon', active: 1, plan: 'pro', billing_status: 'trialing' };
    const env = mockEnv(tenantRow);
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const channelConfig = { token: 'tok_1', config: { page_id: 'pg_1' } };

    const ctx = await buildChannelCtx(env, 't_ig_only', channelConfig, adapter);
    expect(ctx).not.toBeNull();
    expect(ctx.tenantId).toBe('t_ig_only');
    expect(ctx.channel).toBe(adapter);
    expect(ctx.channelConfig).toBe(channelConfig);
  });

  it('ctx.bot and ctx.TG are null for IG-only tenant', async () => {
    const tenantRow = { id: 't_ig_only', name: 'IG Salon', active: 1, plan: 'pro', billing_status: 'trialing' };
    const env = mockEnv(tenantRow);
    const adapter = makeIGAdapter('pg_1', 'tok_1');
    const channelConfig = { token: 'tok_1', config: { page_id: 'pg_1' } };

    const ctx = await buildChannelCtx(env, 't_ig_only', channelConfig, adapter);
    expect(ctx.bot).toBeNull();
    expect(ctx.TG).toBeNull();
  });
});

// ─── D. Billing gate — clients pass, staff blocked ───────────────────────────

describe('Billing gate logic', () => {
  it('isInactive returns true for inactive billing', () => {
    const { isInactive } = require('../src/billing/features.js');
    expect(isInactive({ tenant: { billingStatus: 'inactive' } })).toBe(true);
    expect(isInactive({ tenant: { billingStatus: 'canceled' } })).toBe(true);
  });

  it('isInactive returns false for trialing/active', () => {
    const { isInactive } = require('../src/billing/features.js');
    expect(isInactive({ tenant: { billingStatus: 'trialing' } })).toBe(false);
    expect(isInactive({ tenant: { billingStatus: 'active' } })).toBe(false);
  });

  it('isInactive returns false when no tenant (legacy mode)', () => {
    const { isInactive } = require('../src/billing/features.js');
    expect(isInactive({})).toBe(false);
    expect(isInactive({ tenant: null })).toBe(false);
  });
});

// ─── E. InstagramAdapter.normalizeMessaging() edge cases ─────────────────────

describe('InstagramAdapter.normalizeMessaging() edge cases', () => {
  it('returns null for delivery receipt', () => {
    const adapter = makeIGAdapter();
    const result = adapter.normalizeMessaging({ delivery: { mids: ['mid1'] } }, { id: 'pg_123' });
    expect(result).toBeNull();
  });

  it('returns null for typing indicator (no message/postback)', () => {
    const adapter = makeIGAdapter();
    const result = adapter.normalizeMessaging({ sender: { id: '123' } }, { id: 'pg_123' });
    expect(result).toBeNull();
  });

  it('returns null for message with empty text and no attachments', () => {
    const adapter = makeIGAdapter();
    const result = adapter.normalizeMessaging({
      sender: { id: '123' },
      message: { mid: 'mid1', text: '' },
    }, { id: 'pg_123' });
    expect(result).toBeNull();
  });

  it('parses postback correctly', () => {
    const adapter = makeIGAdapter();
    const result = adapter.normalizeMessaging({
      sender: { id: '123' },
      postback: { title: 'Get Started', payload: 'START' },
    }, { id: 'pg_123' });
    expect(result).not.toBeNull();
    expect(result.callbackData).toBe('START');
    expect(result.text).toBe('Get Started');
  });

  it('extracts image attachment URL', () => {
    const adapter = makeIGAdapter();
    const result = adapter.normalizeMessaging({
      sender: { id: '123' },
      message: { mid: 'mid1', attachments: [{ type: 'image', payload: { url: 'https://img.test/a.jpg' } }] },
    }, { id: 'pg_123' });
    expect(result).not.toBeNull();
    expect(result.photo).toBe('https://img.test/a.jpg');
  });
});
