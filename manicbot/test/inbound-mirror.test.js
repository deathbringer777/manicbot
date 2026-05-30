/**
 * Tests for the unified-inbox mirror gate in handlers/inbound.js.
 *
 * The mirror (`upsertClientConvThreadForInbound`) copies inbound client
 * messages into the staff "Messages" inbox as `client_conv` threads. The web
 * channel is a bot-only surface, so its chatter (/start, /lang, greetings)
 * must NOT be mirrored — the inbox is for real human DMs + booking requests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { makeInbound } from '../src/channels/types.js';

// Mock the heavy collaborators so we can assert the mirror gate in isolation.
vi.mock('../src/handlers/message.js', () => ({ onMsg: vi.fn(async () => {}) }));
vi.mock('../src/handlers/callback.js', () => ({ onCb: vi.fn(async () => {}) }));
vi.mock('../src/services/messengerThreads.js', () => ({
  upsertClientConvThreadForInbound: vi.fn(async () => ({ threadId: 'th_x', messageId: 'm_x' })),
}));
vi.mock('../src/http/messengerWsHttp.js', () => ({
  publishToMessengerHub: vi.fn(async () => {}),
}));

import { handleInbound } from '../src/handlers/inbound.js';
import { upsertClientConvThreadForInbound } from '../src/services/messengerThreads.js';
import { onMsg } from '../src/handlers/message.js';
import { onCb } from '../src/handlers/callback.js';

function makeCtx(overrides = {}) {
  return {
    db: createMockD1(),
    kv: makeMockKv(new Map()),
    tenantId: 't1',
    previewMode: false,
    channel: { type: 'whatsapp' },
    ...overrides,
  };
}

describe('handleInbound inbox-mirror gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mirrors a real human message on a Meta channel (WhatsApp)', async () => {
    await handleInbound(makeCtx(), makeInbound({
      channel: 'whatsapp', channelUserId: '48123', text: 'cześć', tenantId: 't1',
    }));
    expect(upsertClientConvThreadForInbound).toHaveBeenCalledOnce();
    expect(onMsg).toHaveBeenCalledOnce();
  });

  it('still mirrors human messages on Telegram', async () => {
    await handleInbound(makeCtx({ channel: { type: 'telegram' } }), makeInbound({
      channel: 'telegram', channelUserId: '777', text: 'привет', tenantId: 't1',
    }));
    expect(upsertClientConvThreadForInbound).toHaveBeenCalledOnce();
  });

  it('does NOT mirror web-bot chatter into the inbox', async () => {
    await handleInbound(makeCtx({ channel: { type: 'web' } }), makeInbound({
      channel: 'web', channelUserId: 'sess-abc', text: '/start', tenantId: 't1',
    }));
    expect(upsertClientConvThreadForInbound).not.toHaveBeenCalled();
    // The bot still handles the message (greeting/menu) — only the inbox
    // mirror is suppressed for web.
    expect(onMsg).toHaveBeenCalledOnce();
  });

  it('does NOT mirror callback/button events on any channel', async () => {
    await handleInbound(makeCtx(), makeInbound({
      channel: 'whatsapp', channelUserId: '48123', callbackData: 'book', tenantId: 't1',
    }));
    expect(upsertClientConvThreadForInbound).not.toHaveBeenCalled();
    expect(onCb).toHaveBeenCalledOnce();
  });

  it('does NOT mirror in preview/demo mode', async () => {
    await handleInbound(makeCtx({ previewMode: true }), makeInbound({
      channel: 'whatsapp', channelUserId: '48123', text: 'hi', tenantId: 't1',
    }));
    expect(upsertClientConvThreadForInbound).not.toHaveBeenCalled();
  });
});
