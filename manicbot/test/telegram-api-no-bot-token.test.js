import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../src/telegram.js';

// Post-audit #9 — tgApi() built the request URL as `${ctx.TG}/${method}` with
// no guard. For a Telegram-shaped ctx whose token never resolved (ctx.TG null —
// e.g. a botless tenant context), this issued fetch("null/sendMessage"), which
// throws and is swallowed, wasting a request and logging noise. Guard it so the
// missing-token case fails closed cleanly without touching the network.
describe('telegram api() — guard against missing bot token (#audit-9)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns ok:false and does NOT fetch when ctx.TG is missing on a telegram ctx', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('fetch should not be called without a bot token'); });
    vi.stubGlobal('fetch', fetchSpy);
    const res = await api({}, 'sendMessage', { chat_id: 1, text: 'hi' });
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('non-telegram channel ctx stays a safe no-op (unchanged)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await api({ channel: { type: 'whatsapp' } }, 'sendMessage', {});
    expect(res.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
