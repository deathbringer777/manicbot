/**
 * Regression test for the 2026-05-14 self-inflicted outage.
 *
 * Bug: on the very first outbound attempt after migrating to the
 * Instagram-direct API, a host/path mismatch (mid-deploy or stale state)
 * returns code 190 / OAuthException from Meta. The legacy
 * `if (result.tokenDead) channel.active = 0` branch then took the IG
 * channel offline IRREVERSIBLY — `getChannelConfig` requires active=1,
 * so cron stopped processing it, `/admin/ig-diag` returned "no IG
 * channel", and the operator had no obvious signal short of a direct
 * D1 query.
 *
 * Policy (post-fix):
 *   • IG-direct (`config.api === 'instagram_direct'`): NEVER auto-set
 *     active=0. We still emit `integration.needs_reauth` for visibility,
 *     and `phaseChannelHealth` will fire a `fatal` row in the God Mode
 *     `/errors` dashboard every 6h if the token really is dead. But the
 *     channel stays active=1 — operator must intervene explicitly.
 *   • Legacy IG (Page Messenger): keep historical behavior — code 190
 *     means the Page Access Token is dead, deactivate so admin UI
 *     surfaces "needs reauth".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstagramAdapter } from '../src/channels/instagram.js';

function buildCtx({ api, igUserId, pageId, token, dbRunCalls = [] } = {}) {
  return {
    db: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async first() {
                // Pretend within 24h window — irrelevant for this test, just
                // needs to be truthy so we reach the outbound POST.
                return { last_user_message_at: Math.floor(Date.now() / 1000) - 10 };
              },
              async all() {
                return { results: [{ last_user_message_at: Math.floor(Date.now() / 1000) - 10 }] };
              },
              async run() {
                dbRunCalls.push({ sql, params });
                return { success: true };
              },
            };
          },
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
    _dbRunCalls: dbRunCalls,
  };
}

describe('InstagramAdapter tokenDead policy (regression: 2026-05-14)', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    // Meta returns the textbook "dead token" payload on every send.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          message: 'Invalid OAuth Access Token',
          type: 'OAuthException',
          code: 190,
        },
      }), { status: 401 }),
    );
  });

  it('LEGACY IG: tokenDead → channel.active flipped to 0 (preserved behavior)', async () => {
    const dbRunCalls = [];
    const ctx = buildCtx({
      pageId: '1008301152373103',
      token: 'EAA_dead_page_token',
      dbRunCalls,
    });
    const adapter = new InstagramAdapter(ctx);
    const res = await adapter.send('1441501754119698', { text: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.tokenDead).toBe(true);
    // Look for the UPDATE that sets active=0.
    const deactivate = dbRunCalls.find(c =>
      c.sql.includes('UPDATE channel_configs') && c.sql.includes('active = 0')
    );
    expect(deactivate).toBeTruthy();
  });

  it('IG-DIRECT: tokenDead → channel STAYS active=1 (no auto-deactivate)', async () => {
    const dbRunCalls = [];
    const ctx = buildCtx({
      api: 'instagram_direct',
      igUserId: '25881183448226493',
      pageId: '1008301152373103',
      token: 'IGAA_first_attempt_failed',
      dbRunCalls,
    });
    const adapter = new InstagramAdapter(ctx);
    const res = await adapter.send('1441501754119698', { text: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.tokenDead).toBe(true);
    // The exact regression: no SQL that flips active=0.
    const deactivate = dbRunCalls.find(c =>
      c.sql.includes('UPDATE channel_configs') && c.sql.includes('active = 0')
    );
    expect(deactivate).toBeUndefined();
  });
});
