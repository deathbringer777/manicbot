/**
 * Tests for the IG-direct outbound migration (Mar-2026 Meta API change).
 *
 * Legacy path (config.api absent or != 'instagram_direct'):
 *   POST https://graph.facebook.com/v21.0/{pageId}/messages
 *   Auth: Bearer <Page Access Token (EAA…)>
 *
 * New IG-direct path (config.api === 'instagram_direct'):
 *   POST https://graph.instagram.com/v21.0/me/messages
 *   Auth: Bearer <Instagram User Token (IGAA…)>
 *
 * The adapter must pick the right host + path based on config.api at
 * construction time; the rest of the body / quick_replies / 24h window
 * logic stays identical.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstagramAdapter } from '../src/channels/instagram.js';

function buildCtx({ api, igUserId, pageId, token, withinWindow = true } = {}) {
  return {
    db: {
      prepare() {
        return {
          bind() { return this; },
          async first() {
            return withinWindow
              ? { last_user_message_at: Math.floor(Date.now() / 1000) - 10 }
              : null;
          },
          async all() {
            return withinWindow
              ? { results: [{ last_user_message_at: Math.floor(Date.now() / 1000) - 10 }] }
              : { results: [] };
          },
          async run() { return { success: true }; },
        };
      },
    },
    tenantId: 't_1c305v2g5011',
    channelConfig: {
      token,
      config: {
        page_id: pageId,
        ...(api ? { api } : {}),
        ...(igUserId ? { ig_user_id: igUserId } : {}),
      },
    },
  };
}

describe('InstagramAdapter outbound host routing', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message_id: 'm_xyz' }), { status: 200 }),
    );
  });

  it('LEGACY: posts to graph.facebook.com/{pageId}/messages with EAA-style token', async () => {
    const adapter = new InstagramAdapter(buildCtx({
      pageId: '1008301152373103',
      token: 'EAA_legacy_page_token',
    }));
    const res = await adapter.send('1441501754119698', { text: 'hi' });
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('graph.facebook.com');
    expect(url).not.toContain('graph.instagram.com');
    expect(url).toContain('/1008301152373103/messages');
    const opts = fetchSpy.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe('Bearer EAA_legacy_page_token');
  });

  it('IG-DIRECT: posts to graph.instagram.com/me/messages with IGAA token', async () => {
    const adapter = new InstagramAdapter(buildCtx({
      api: 'instagram_direct',
      igUserId: '25881183448226493',
      pageId: '1008301152373103',  // still present but unused for path
      token: 'IGAA1Y9V3ZBhz...',
    }));
    const res = await adapter.send('1441501754119698', { text: 'привет' });
    expect(res.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('graph.instagram.com');
    expect(url).not.toContain('graph.facebook.com');
    expect(url).toContain('/me/messages');
    expect(url).not.toContain('/1008301152373103/');
    const opts = fetchSpy.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe('Bearer IGAA1Y9V3ZBhz...');
    const body = JSON.parse(opts.body);
    expect(body.recipient.id).toBe('1441501754119698');
    expect(body.message.text).toBe('привет');
  });

  it('IG-DIRECT with quick replies: same /me/messages path, quick_replies preserved', async () => {
    const adapter = new InstagramAdapter(buildCtx({
      api: 'instagram_direct',
      igUserId: '25881183448226493',
      pageId: '1008301152373103',
      token: 'IGAA_x',
    }));
    await adapter.send('user1', {
      text: 'Choose',
      buttons: [[{ text: 'Yes', callbackData: 'y' }, { text: 'No', callbackData: 'n' }]],
    });
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('graph.instagram.com/v21.0/me/messages');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message.quick_replies).toHaveLength(2);
    expect(body.message.quick_replies[0].title).toBe('Yes');
    expect(body.message.quick_replies[0].payload).toBe('y');
  });

  it('IG-DIRECT: refuses send outside 24h window same as legacy', async () => {
    const adapter = new InstagramAdapter(buildCtx({
      api: 'instagram_direct',
      igUserId: '25881183448226493',
      pageId: '1008301152373103',
      token: 'IGAA_x',
      withinWindow: false,
    }));
    const res = await adapter.send('user1', { text: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('outside_message_window');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to legacy host when config.api has unknown value (forward compat)', async () => {
    const adapter = new InstagramAdapter(buildCtx({
      api: 'some_future_api',
      pageId: '1008301152373103',
      token: 'EAA_x',
    }));
    await adapter.send('user1', { text: 'hi' });
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('graph.facebook.com');
  });

  // Regression: sendPhoto hardcoded the legacy /{pageId}/messages path even on
  // instagram_direct, so a prod IGAA channel (which DOES carry a page_id) posted
  // images to graph.instagram.com/v21.0/{pageId}/messages → Meta 400. Must mirror
  // send()'s path selection.
  it('IG-DIRECT: sendPhoto posts to /me/messages, not /{pageId}/messages', async () => {
    const adapter = new InstagramAdapter(buildCtx({
      api: 'instagram_direct',
      igUserId: '25881183448226493',
      pageId: '1008301152373103', // present but must NOT leak into the path
      token: 'IGAA_x',
    }));
    await adapter.sendPhoto('1441501754119698', 'https://img.test/a.jpg', ''); // empty caption → single call
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('graph.instagram.com');
    expect(url).toContain('/me/messages');
    expect(url).not.toContain('/1008301152373103/');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message.attachment.type).toBe('image');
    expect(body.message.attachment.payload.url).toBe('https://img.test/a.jpg');
  });

  it('LEGACY: sendPhoto keeps the /{pageId}/messages path on graph.facebook.com', async () => {
    const adapter = new InstagramAdapter(buildCtx({
      pageId: '1008301152373103',
      token: 'EAA_x',
    }));
    await adapter.sendPhoto('1441501754119698', 'https://img.test/a.jpg', '');
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('graph.facebook.com');
    expect(url).toContain('/1008301152373103/messages');
  });
});
