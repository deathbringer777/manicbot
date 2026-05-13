/**
 * WhatsApp outbound 24h-window guard.
 *
 * Meta's policy: outside the 24h window after the last user message a
 * business may only send pre-approved template messages. Free-form
 * sends will be rejected by the Cloud API (HTTP 400 / error 131047).
 * Without an in-process check, every ad-hoc send from a master, the
 * AI, or support burns a Graph API call AND a template quota slot
 * with nothing to show for it.
 *
 * Instagram already has this guard (instagram.js:160-165). WhatsApp
 * did not — this test locks in the equivalent behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const isWithinSpy = vi.fn();
vi.mock('../src/handlers/inbound.js', () => ({
  isWithinMessageWindow: (...args) => isWithinSpy(...args),
}));

const graphPostSpy = vi.fn();
vi.mock('../src/channels/graph-api.js', () => ({
  graphPost: (...args) => graphPostSpy(...args),
}));

vi.mock('../src/utils/logger.js', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { WhatsAppAdapter } = await import('../src/channels/whatsapp.js');

function makeAdapter({ db = {}, tenantId = 't_wa' } = {}) {
  const adapter = new WhatsAppAdapter({
    tenantId,
    channelConfig: {
      config: { phone_number_id: '15551111111' },
      token: 'EAA_test_token',
    },
  });
  // Mirror the metaWebhooksHttp pattern: adapter._ctx is attached after
  // construction so the adapter can read db for the 24h-window check.
  adapter._ctx = { db, tenantId };
  return adapter;
}

describe('WhatsAppAdapter.send — 24h-window guard', () => {
  beforeEach(() => {
    isWithinSpy.mockReset();
    graphPostSpy.mockReset();
    graphPostSpy.mockResolvedValue({ ok: true, data: { messages: [{ id: 'wamid.OK' }] } });
  });

  it('sends when user is within the 24h message window', async () => {
    isWithinSpy.mockResolvedValue(true);
    const adapter = makeAdapter();
    const res = await adapter.send('48123456789', { text: 'Hello!' });
    expect(res.ok).toBe(true);
    expect(graphPostSpy).toHaveBeenCalledOnce();
    expect(isWithinSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't_wa' }),
      'whatsapp',
      '48123456789',
    );
  });

  it('refuses to send outside the 24h window (no Graph call, no quota burn)', async () => {
    isWithinSpy.mockResolvedValue(false);
    const adapter = makeAdapter();
    const res = await adapter.send('48123456789', { text: 'Hello!' });
    expect(res).toEqual({ ok: false, error: 'outside_message_window' });
    expect(graphPostSpy).not.toHaveBeenCalled();
  });

  it('skips the window check (and sends) when ctx.db is unavailable (legacy/no-D1 path)', async () => {
    const adapter = makeAdapter({ db: null });
    const res = await adapter.send('48123456789', { text: 'Hi' });
    expect(res.ok).toBe(true);
    expect(isWithinSpy).not.toHaveBeenCalled();
    expect(graphPostSpy).toHaveBeenCalledOnce();
  });

  it('skips the window check when ctx.tenantId is unavailable', async () => {
    const adapter = makeAdapter({ tenantId: null });
    const res = await adapter.send('48123456789', { text: 'Hi' });
    expect(res.ok).toBe(true);
    expect(isWithinSpy).not.toHaveBeenCalled();
    expect(graphPostSpy).toHaveBeenCalledOnce();
  });

  it('also gates interactive (button) sends behind the window check', async () => {
    isWithinSpy.mockResolvedValue(false);
    const adapter = makeAdapter();
    const buttons = [[{ text: 'Yes', callbackData: 'y' }, { text: 'No', callbackData: 'n' }]];
    const res = await adapter.send('48123456789', { text: 'Confirm?', buttons });
    expect(res).toEqual({ ok: false, error: 'outside_message_window' });
    expect(graphPostSpy).not.toHaveBeenCalled();
  });
});
