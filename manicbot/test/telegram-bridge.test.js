/**
 * Tests for the channel-aware bridge in src/telegram.js
 *
 * Verifies that:
 *  - Telegram channel: delegates to Telegram API (fetch)
 *  - WhatsApp/Instagram channels: delegates to ctx.channel.*
 *  - api() is a no-op for non-Telegram channels
 *  - send() handles request_contact and remove_keyboard
 *  - Button truncation is applied for WA/IG
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fetch so no real HTTP calls are made ─────────────────────────────────
const mockFetch = vi.fn().mockResolvedValue({
  status: 200,
  text: async () => JSON.stringify({ ok: true, result: { message_id: 1 } }),
  headers: { get: () => null },
});
vi.stubGlobal('fetch', mockFetch);

// Import AFTER stubbing fetch
const { send, edit, answerCb, sendPhoto, editPhoto, sendIcs, api } = await import('../src/telegram.js');

// ── Channel mock factory ──────────────────────────────────────────────────────

function makeCtxTelegram(overrides = {}) {
  return {
    TG: 'https://api.telegram.org/bot123',
    channel: { type: 'telegram' },
    ...overrides,
  };
}

function makeChannelMock() {
  return {
    type: 'whatsapp',
    send: vi.fn().mockResolvedValue({ ok: true }),
    edit: vi.fn().mockResolvedValue({ ok: true }),
    answerCallback: vi.fn().mockResolvedValue(null),
    sendPhoto: vi.fn().mockResolvedValue({ ok: true }),
    sendDocument: vi.fn().mockResolvedValue({ ok: true }),
    renderButtons: vi.fn(rows => rows),
  };
}

function makeCtxMeta(channelType = 'whatsapp') {
  const channel = makeChannelMock();
  channel.type = channelType;
  return { TG: null, channel };
}

// ── api() ─────────────────────────────────────────────────────────────────────

describe('api()', () => {
  beforeEach(() => { mockFetch.mockClear(); });

  it('calls Telegram API for telegram channel', async () => {
    const ctx = makeCtxTelegram();
    await api(ctx, 'sendMessage', { chat_id: 1, text: 'hi' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('sendMessage');
  });

  it('returns no-op for whatsapp channel', async () => {
    const ctx = makeCtxMeta('whatsapp');
    const res = await api(ctx, 'sendMessage', { chat_id: 1, text: 'hi' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, result: {} });
  });

  it('returns no-op for instagram channel', async () => {
    const ctx = makeCtxMeta('instagram');
    const res = await api(ctx, 'deleteMessage', { chat_id: 1, message_id: 99 });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, result: {} });
  });

  it('calls Telegram API when ctx.channel is undefined', async () => {
    const ctx = { TG: 'https://api.telegram.org/bot123' };
    await api(ctx, 'getMe', {});
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ── send() ────────────────────────────────────────────────────────────────────

describe('send() — Telegram', () => {
  beforeEach(() => { mockFetch.mockClear(); });

  it('calls sendMessage on Telegram API', async () => {
    const ctx = makeCtxTelegram();
    await send(ctx, 123, 'Hello');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe(123);
    expect(body.text).toBe('Hello');
    expect(body.parse_mode).toBe('HTML');
  });

  it('passes extra (inline_keyboard) to Telegram unchanged', async () => {
    const ctx = makeCtxTelegram();
    const extra = { reply_markup: { inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] } };
    await send(ctx, 123, 'Pick', extra);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reply_markup.inline_keyboard).toBeDefined();
  });
});

describe('send() — WhatsApp/Instagram', () => {
  it('calls ctx.channel.send for whatsapp', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await send(ctx, '48123456789', 'Hello');
    expect(ctx.channel.send).toHaveBeenCalledTimes(1);
    const [userId, outbound] = ctx.channel.send.mock.calls[0];
    expect(userId).toBe('48123456789');
    expect(outbound.text).toBe('Hello');
    expect(outbound.parseMode).toBe('HTML');
  });

  it('calls ctx.channel.send for instagram', async () => {
    const ctx = makeCtxMeta('instagram');
    await send(ctx, 'ig_user_123', 'Hello');
    expect(ctx.channel.send).toHaveBeenCalledTimes(1);
  });

  it('converts inline_keyboard to buttons array', async () => {
    const ctx = makeCtxMeta('whatsapp');
    const extra = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Book', callback_data: 'book' }],
          [{ text: 'Prices', callback_data: 'prices' }],
        ],
      },
    };
    await send(ctx, '48123', 'Menu', extra);
    const [, outbound] = ctx.channel.send.mock.calls[0];
    expect(outbound.buttons).toHaveLength(2);
    expect(outbound.buttons[0][0].text).toBe('Book');
    expect(outbound.buttons[0][0].callbackData).toBe('book');
  });

  it('truncates button text to 20 chars for whatsapp', async () => {
    const ctx = makeCtxMeta('whatsapp');
    const longText = '💅 Classic Manicure — 80 PLN';
    const extra = {
      reply_markup: {
        inline_keyboard: [[{ text: longText, callback_data: 'sv:1' }]],
      },
    };
    await send(ctx, '48123', 'Pick', extra);
    const [, outbound] = ctx.channel.send.mock.calls[0];
    expect(outbound.buttons[0][0].text.length).toBeLessThanOrEqual(20);
  });

  it('handles remove_keyboard by sending text without buttons', async () => {
    const ctx = makeCtxMeta('whatsapp');
    const extra = { reply_markup: { remove_keyboard: true } };
    await send(ctx, '48123', 'Welcome!', extra);
    const [, outbound] = ctx.channel.send.mock.calls[0];
    expect(outbound.buttons).toBeUndefined();
    expect(outbound.text).toBe('Welcome!');
  });

  it('handles request_contact keyboard by appending phone prompt', async () => {
    const ctx = makeCtxMeta('whatsapp');
    const extra = {
      reply_markup: {
        keyboard: [[{ text: 'Share Phone', request_contact: true }]],
        resize_keyboard: true,
      },
    };
    await send(ctx, '48123', 'Please share your number', extra);
    const [, outbound] = ctx.channel.send.mock.calls[0];
    expect(outbound.text).toContain('phone number');
    expect(outbound.buttons).toBeUndefined();
  });

  it('sends null buttons when no keyboard provided', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await send(ctx, '48123', 'Just a message');
    const [, outbound] = ctx.channel.send.mock.calls[0];
    expect(outbound.buttons).toBeNull();
  });
});

// ── edit() ────────────────────────────────────────────────────────────────────

describe('edit()', () => {
  beforeEach(() => { mockFetch.mockClear(); });

  it('calls editMessageText for telegram', async () => {
    const ctx = makeCtxTelegram();
    await edit(ctx, 123, 99, 'Updated');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.message_id).toBe(99);
    expect(body.text).toBe('Updated');
  });

  it('calls ctx.channel.edit for whatsapp', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await edit(ctx, '48123', 'msg_99', 'Updated', {
      reply_markup: { inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] },
    });
    expect(ctx.channel.edit).toHaveBeenCalledTimes(1);
    const [userId, msgId, outbound] = ctx.channel.edit.mock.calls[0];
    expect(userId).toBe('48123');
    expect(msgId).toBe('msg_99');
    expect(outbound.text).toBe('Updated');
    expect(outbound.buttons).toBeDefined();
  });
});

// ── answerCb() ────────────────────────────────────────────────────────────────

describe('answerCb()', () => {
  beforeEach(() => { mockFetch.mockClear(); });

  it('calls answerCallbackQuery for telegram', async () => {
    const ctx = makeCtxTelegram();
    await answerCb(ctx, 'cbq_id', 'toast');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.callback_query_id).toBe('cbq_id');
    expect(body.text).toBe('toast');
  });

  it('calls ctx.channel.answerCallback for whatsapp', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await answerCb(ctx, 'cbq_id', 'toast');
    expect(ctx.channel.answerCallback).toHaveBeenCalledWith('cbq_id', 'toast');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('defaults text to empty string', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await answerCb(ctx, 'cbq_id');
    expect(ctx.channel.answerCallback).toHaveBeenCalledWith('cbq_id', '');
  });
});

// ── sendPhoto() ───────────────────────────────────────────────────────────────

describe('sendPhoto()', () => {
  beforeEach(() => { mockFetch.mockClear(); });

  it('calls sendPhoto API for telegram', async () => {
    const ctx = makeCtxTelegram();
    await sendPhoto(ctx, 123, 'http://img.example.com/x.jpg', 'Caption');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.photo).toBe('http://img.example.com/x.jpg');
  });

  it('calls ctx.channel.sendPhoto for whatsapp', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await sendPhoto(ctx, '48123', 'http://img.example.com/x.jpg', 'Caption');
    expect(ctx.channel.sendPhoto).toHaveBeenCalledWith('48123', 'http://img.example.com/x.jpg', 'Caption', {});
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── editPhoto() ───────────────────────────────────────────────────────────────

describe('editPhoto()', () => {
  beforeEach(() => { mockFetch.mockClear(); });

  it('calls editMessageMedia for telegram', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ ok: true, result: {} }),
      headers: { get: () => null },
    });
    const ctx = makeCtxTelegram();
    const res = await editPhoto(ctx, 123, 99, 'http://img.example.com/x.jpg', 'Cap');
    expect(mockFetch).toHaveBeenCalled();
    expect(res).toBeTruthy();
  });

  it('calls ctx.channel.sendPhoto for whatsapp (no edit support)', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await editPhoto(ctx, '48123', 'msg_99', 'http://img.example.com/x.jpg', 'Cap');
    expect(ctx.channel.sendPhoto).toHaveBeenCalledWith('48123', 'http://img.example.com/x.jpg', 'Cap', {});
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── sendIcs() ─────────────────────────────────────────────────────────────────

describe('sendIcs()', () => {
  beforeEach(() => { mockFetch.mockClear(); });

  it('uses FormData to upload ICS for telegram', async () => {
    const ctx = makeCtxTelegram();
    await sendIcs(ctx, 123, 'BEGIN:VCALENDAR...', 'booking.ics', 'Your booking');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // FormData upload — not JSON
    const call = mockFetch.mock.calls[0];
    expect(call[1].body).toBeInstanceOf(FormData);
  });

  it('calls ctx.channel.sendDocument for whatsapp', async () => {
    const ctx = makeCtxMeta('whatsapp');
    await sendIcs(ctx, '48123', 'BEGIN:VCALENDAR...', 'booking.ics', 'Your booking');
    expect(ctx.channel.sendDocument).toHaveBeenCalledWith(
      '48123', 'BEGIN:VCALENDAR...', 'booking.ics', 'Your booking'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
