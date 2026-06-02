import { describe, it, expect, beforeEach } from 'vitest';
import {
  WebAdapter,
  chatIdFromSession,
  generateSessionId,
  readOutbox,
} from '../src/channels/web.js';

function makeCtx(overrides = {}) {
  const kvStore = new Map();
  return {
    kv: {
      async get(key, type) {
        const v = kvStore.get(key);
        if (!v) return null;
        if (type === 'json') return JSON.parse(v);
        return v;
      },
      async put(key, value) {
        kvStore.set(key, value);
      },
      async delete(key) {
        kvStore.delete(key);
      },
    },
    _kvStore: kvStore,
    tenantId: 't_demo',
    ...overrides,
  };
}

describe('generateSessionId', () => {
  it('produces a 64-char hex string', () => {
    const sid = generateSessionId();
    expect(sid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique across calls', () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toBe(b);
  });
});

describe('chatIdFromSession', () => {
  it('is deterministic', async () => {
    const sid = '0123456789abcdef'.repeat(4);
    const a = await chatIdFromSession(sid);
    const b = await chatIdFromSession(sid);
    expect(a).toBe(b);
  });

  it('produces a negative integer in safe range', async () => {
    const sid = generateSessionId();
    const chatId = await chatIdFromSession(sid);
    expect(Number.isInteger(chatId)).toBe(true);
    expect(chatId).toBeLessThan(0);
    expect(chatId).toBeGreaterThanOrEqual(-(2 ** 48));
  });

  it('produces different ids for different sessions', async () => {
    const a = await chatIdFromSession('a'.repeat(64));
    const b = await chatIdFromSession('b'.repeat(64));
    expect(a).not.toBe(b);
  });

  it('throws on empty input', async () => {
    await expect(chatIdFromSession('')).rejects.toThrow(/required/);
  });
});

describe('WebAdapter.normalize', () => {
  let adapter;
  beforeEach(() => {
    adapter = new WebAdapter(makeCtx());
  });

  it('normalizes a text message', () => {
    const inbound = adapter.normalize({
      sessionId: 'sess-1',
      chatId: -12345,
      text: 'Hello',
      userName: 'Alice',
    });
    expect(inbound).toMatchObject({
      channel: 'web',
      channelUserId: '-12345',
      tenantId: 't_demo',
      text: 'Hello',
      userName: 'Alice',
      callbackData: null,
    });
    expect(inbound.timestamp).toBeTypeOf('number');
  });

  it('normalizes a callback_data tap', () => {
    const inbound = adapter.normalize({
      sessionId: 'sess-1',
      chatId: -12345,
      callbackData: 'book:svc_gel',
    });
    expect(inbound.callbackData).toBe('book:svc_gel');
    expect(inbound.text).toBeNull();
  });

  it('rejects payload without a numeric chatId', () => {
    expect(adapter.normalize({ sessionId: 'sess-1', text: 'hi' })).toBeNull();
    expect(adapter.normalize({ sessionId: 'sess-1', chatId: 'not-a-number', text: 'hi' })).toBeNull();
  });

  it('rejects null / non-object payloads', () => {
    expect(adapter.normalize(null)).toBeNull();
    expect(adapter.normalize('string')).toBeNull();
  });

  it('caps userName and userLang to bounded lengths', () => {
    const inbound = adapter.normalize({
      sessionId: 'sess-1',
      chatId: -1,
      text: 'hi',
      userName: 'x'.repeat(500),
      userLang: 'ru-RU-extended',
    });
    expect(inbound.userName.length).toBe(64);
    expect(inbound.userLang.length).toBe(8);
  });
});

describe('WebAdapter.send', () => {
  let adapter;
  let ctx;
  const ACTIVE = -12345;
  beforeEach(() => {
    ctx = makeCtx();
    adapter = new WebAdapter(ctx);
    adapter.setActiveChat(ACTIVE);
  });

  it('appends a message to the in-memory outbox', async () => {
    await adapter.send(ACTIVE, { text: 'Hello from bot' });
    expect(adapter._outbox).toHaveLength(1);
    expect(adapter._outbox[0].text).toBe('Hello from bot');
    expect(adapter._outbox[0].id).toBeTypeOf('string');
    expect(adapter._outbox[0].ts).toBeTypeOf('number');
  });

  it('flattens telegram-style button rows', async () => {
    await adapter.send(ACTIVE, {
      text: 'pick',
      buttons: [
        [{ text: 'A', callback_data: 'a' }, { text: 'B', callback_data: 'b' }],
        [{ text: 'Link', url: 'https://example.com' }],
      ],
    });
    const msg = adapter._outbox[0];
    expect(msg.buttons).toEqual([
      [
        { text: 'A', callback_data: 'a', url: null },
        { text: 'B', callback_data: 'b', url: null },
      ],
      [
        { text: 'Link', callback_data: null, url: 'https://example.com' },
      ],
    ]);
  });

  it('unwraps the renderButtons metadata shape', async () => {
    const wrapped = adapter.renderButtons([[{ text: 'X', callback_data: 'x' }]]);
    await adapter.send(ACTIVE, { text: 'hey', buttons: wrapped });
    expect(adapter._outbox[0].buttons).toEqual([
      [{ text: 'X', callback_data: 'x', url: null }],
    ]);
  });

  it('also writes to KV outbox for out-of-band polling', async () => {
    await adapter.send(ACTIVE, { text: 'persist me' });
    const key = `web:outbox:t_demo:${ACTIVE}`;
    const raw = await ctx.kv.get(key, 'json');
    expect(Array.isArray(raw)).toBe(true);
    expect(raw).toHaveLength(1);
    expect(raw[0].text).toBe('persist me');
  });

  it('caps KV outbox at 100 entries', async () => {
    adapter.setActiveChat(-42);
    for (let i = 0; i < 150; i++) {
      await adapter.send(-42, { text: `msg-${i}` });
    }
    const raw = await ctx.kv.get('web:outbox:t_demo:-42', 'json');
    expect(raw.length).toBe(100);
    expect(raw[0].text).toBe('msg-50');
    expect(raw[99].text).toBe('msg-149');
  });

  // ─── SECURITY ────────────────────────────────────────────────────────────
  it('SECURITY: refuses send to a non-active recipient (staff leak guard)', async () => {
    const STAFF_TG_CHAT = 998877665544; // a real Telegram positive chat id
    const result = await adapter.send(STAFF_TG_CHAT, { text: '🆕 Новая заявка!' });
    expect(result).toEqual({ ok: false, error: 'not_active_recipient' });
    expect(adapter._outbox).toHaveLength(0);
    // KV outbox for the staff chat must NOT have been written either
    const raw = await ctx.kv.get(`web:outbox:t_demo:${STAFF_TG_CHAT}`, 'json');
    expect(raw).toBeNull();
  });

  it('SECURITY: refuses send when no active chat is set', async () => {
    const fresh = new WebAdapter(makeCtx());
    const result = await fresh.send(-12345, { text: 'should be dropped' });
    expect(result.ok).toBe(false);
    expect(fresh._outbox).toHaveLength(0);
  });

  it('SECURITY: isActiveRecipient correctly distinguishes session vs staff', () => {
    expect(adapter.isActiveRecipient(ACTIVE)).toBe(true);
    expect(adapter.isActiveRecipient(String(ACTIVE))).toBe(true);
    expect(adapter.isActiveRecipient(998877665544)).toBe(false);
    expect(adapter.isActiveRecipient(0)).toBe(false);
    expect(adapter.isActiveRecipient(null)).toBe(false);
  });
});

describe('WebAdapter.edit', () => {
  it('emits a message with editMessageId set', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.edit(-1, 'prev-id', { text: 'updated text' });
    expect(adapter._outbox[0].editMessageId).toBe('prev-id');
    expect(adapter._outbox[0].text).toBe('updated text');
  });

  it('SECURITY: refuses edit to non-active recipient', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    const result = await adapter.edit(998877665544, 'some-id', { text: 'staff only' });
    expect(result.ok).toBe(false);
    expect(adapter._outbox).toHaveLength(0);
  });
});

describe('WebAdapter.drainOutbox', () => {
  it('returns and clears the outbox atomically', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.send(-1, { text: 'a' });
    await adapter.send(-1, { text: 'b' });
    const drained = adapter.drainOutbox();
    expect(drained).toHaveLength(2);
    expect(adapter._outbox).toHaveLength(0);
    // Second drain is empty
    expect(adapter.drainOutbox()).toHaveLength(0);
  });
});

describe('WebAdapter.sendPhoto / sendDocument', () => {
  it('sendPhoto includes photo field', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.sendPhoto(-1, 'https://example.com/a.png', 'caption');
    expect(adapter._outbox[0].photo).toBe('https://example.com/a.png');
    expect(adapter._outbox[0].text).toBe('caption');
  });

  it('sendPhoto forwards reply_markup buttons (catalog ◀️ 1/3 ▶️ navigation)', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.sendPhoto(-1, 'https://example.com/a.png', 'caption', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '◀️', callback_data: 'cat:svc1:0' },
            { text: '2 / 3', callback_data: 'noop' },
            { text: '▶️', callback_data: 'cat:svc1:2' },
          ],
          [{ text: 'Book', callback_data: 'svc:svc1' }],
        ],
      },
    });
    const msg = adapter._outbox[0];
    expect(msg.photo).toBe('https://example.com/a.png');
    expect(msg.buttons).toEqual([
      [
        { text: '◀️', callback_data: 'cat:svc1:0', url: null },
        { text: '2 / 3', callback_data: 'noop', url: null },
        { text: '▶️', callback_data: 'cat:svc1:2', url: null },
      ],
      [{ text: 'Book', callback_data: 'svc:svc1', url: null }],
    ]);
  });

  it('sendPhoto forwards the full photos[] array for the web carousel', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.sendPhoto(-1, 'https://example.com/a.png', 'caption', {
      reply_markup: { inline_keyboard: [[{ text: 'Book', callback_data: 'sv:gel' }]] },
      photos: ['https://example.com/a.png', 'https://example.com/b.png', 'https://example.com/c.png'],
    });
    const msg = adapter._outbox[0];
    expect(msg.photo).toBe('https://example.com/a.png');
    expect(msg.photos).toEqual([
      'https://example.com/a.png',
      'https://example.com/b.png',
      'https://example.com/c.png',
    ]);
  });

  it('sendPhoto leaves photos null when none provided (single-photo back-compat)', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.sendPhoto(-1, 'https://example.com/a.png', 'caption');
    expect(adapter._outbox[0].photos).toBeNull();
  });

  it('sendDocument with URL content renders an anchor', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.sendDocument(-1, 'https://example.com/file.pdf', 'file.pdf', 'Download');
    expect(adapter._outbox[0].text).toContain('<a');
    expect(adapter._outbox[0].text).toContain('https://example.com/file.pdf');
  });

  it('SECURITY: sendPhoto refuses non-active recipient', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    const result = await adapter.sendPhoto(998877665544, 'https://example.com/a.png', 'caption');
    expect(result.ok).toBe(false);
    expect(adapter._outbox).toHaveLength(0);
  });
});

describe('WebAdapter.editPhoto', () => {
  it('emits a photo message with editMessageId set (in-place navigation)', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.editPhoto(-1, 'prev-bubble-id', 'https://example.com/b.png', 'caption 2', {
      reply_markup: {
        inline_keyboard: [[{ text: '▶️', callback_data: 'cat:svc1:3' }]],
      },
    });
    const msg = adapter._outbox[0];
    expect(msg.editMessageId).toBe('prev-bubble-id');
    expect(msg.photo).toBe('https://example.com/b.png');
    expect(msg.text).toBe('caption 2');
    expect(msg.buttons).toEqual([
      [{ text: '▶️', callback_data: 'cat:svc1:3', url: null }],
    ]);
  });

  it('editPhoto forwards the full photos[] array', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    await adapter.editPhoto(-1, 'mid', 'https://example.com/b.png', 'cap', {
      reply_markup: { inline_keyboard: [[{ text: '▶️', callback_data: 'cc:gel:1' }]] },
      photos: ['https://example.com/a.png', 'https://example.com/b.png'],
    });
    expect(adapter._outbox[0].photos).toEqual([
      'https://example.com/a.png',
      'https://example.com/b.png',
    ]);
  });

  it('SECURITY: editPhoto refuses non-active recipient', async () => {
    const adapter = new WebAdapter(makeCtx());
    adapter.setActiveChat(-1);
    const result = await adapter.editPhoto(998877665544, 'mid', 'https://x.png', 'cap');
    expect(result.ok).toBe(false);
    expect(adapter._outbox).toHaveLength(0);
  });
});

describe('WebAdapter.normalize messageId forwarding', () => {
  it('forwards payload.messageId as callbackMessageId', () => {
    const adapter = new WebAdapter(makeCtx());
    const inbound = adapter.normalize({
      sessionId: 'sess-1',
      chatId: -12345,
      callbackData: 'cat:svc1:2',
      messageId: 'bubble-abc123',
    });
    expect(inbound.callbackMessageId).toBe('bubble-abc123');
    expect(inbound.callbackData).toBe('cat:svc1:2');
  });

  it('caps messageId to 64 chars', () => {
    const adapter = new WebAdapter(makeCtx());
    const inbound = adapter.normalize({
      sessionId: 'sess-1',
      chatId: -12345,
      callbackData: 'x',
      messageId: 'a'.repeat(200),
    });
    expect(inbound.callbackMessageId.length).toBe(64);
  });

  it('leaves callbackMessageId null when payload omits messageId', () => {
    const adapter = new WebAdapter(makeCtx());
    const inbound = adapter.normalize({
      sessionId: 'sess-1',
      chatId: -12345,
      callbackData: 'x',
    });
    expect(inbound.callbackMessageId).toBeNull();
  });
});

describe('readOutbox', () => {
  it('returns empty for a non-existent key', async () => {
    const ctx = makeCtx();
    expect(await readOutbox(ctx, -1)).toEqual([]);
  });

  it('reads and clears by default', async () => {
    const ctx = makeCtx();
    const adapter = new WebAdapter(ctx);
    adapter.setActiveChat(-42);
    await adapter.send(-42, { text: 'first' });
    await adapter.send(-42, { text: 'second' });
    const msgs = await readOutbox(ctx, -42);
    expect(msgs).toHaveLength(2);
    // After read, KV is cleared
    expect(await readOutbox(ctx, -42)).toEqual([]);
  });

  it('filters by sinceTs', async () => {
    const ctx = makeCtx();
    const adapter = new WebAdapter(ctx);
    adapter.setActiveChat(-42);
    await adapter.send(-42, { text: 'old' });
    // Wait a tick so ts differs
    await new Promise((r) => setTimeout(r, 1100));
    await adapter.send(-42, { text: 'new' });
    const raw = await ctx.kv.get('web:outbox:t_demo:-42', 'json');
    const sinceTs = raw[0].ts;
    const msgs = await readOutbox(ctx, -42, { sinceTs, clear: false });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('new');
  });

  it('respects clear: false', async () => {
    const ctx = makeCtx();
    const adapter = new WebAdapter(ctx);
    adapter.setActiveChat(-42);
    await adapter.send(-42, { text: 'keep' });
    await readOutbox(ctx, -42, { clear: false });
    const again = await readOutbox(ctx, -42);
    expect(again).toHaveLength(1);
  });
});
