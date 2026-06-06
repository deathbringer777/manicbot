/**
 * Tests for POST /admin/ig-set-direct-token — installs a new-API
 * Instagram-direct token (prefix IGAA…) into D1.
 *
 * Background: Meta migrated Instagram Messaging to a separate
 * Instagram Login product in early 2026. The old Page Access Token
 * (graph.facebook.com) stopped receiving DM webhooks. The new path
 * issues an IGAA-prefixed token validated against graph.instagram.com.
 *
 * Endpoint contract:
 *   - 400 on missing tenantId/token
 *   - 404 when tenant has no active IG channel
 *   - 400 when token rejected by graph.instagram.com
 *   - 403 when token's IG user id doesn't match the row's stored
 *     ig_business_id (binds caller to existing operator authority)
 *   - 200 + ok=true on success; row updated with `api: instagram_direct`,
 *     ig_user_id + ig_username added to config blob
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

vi.mock('../src/utils/security.js', async () => {
  const actual = await vi.importActual('../src/utils/security.js');
  return {
    ...actual,
    encryptToken: vi.fn(async (plain) => `v1$enc:${plain.slice(0, 12)}`),
  };
});

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'test-admin-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const ENC_KEY = 'k'.repeat(32);
const IG_BUSINESS_ID = '25881183448226493';

function makeRequest(body, opts = {}) {
  return new Request('https://manicbot.com/admin/ig-set-direct-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify(body),
    ...opts,
  });
}

function call(env, body) {
  const req = makeRequest(body);
  return tryAdminKeyRoutes(req, env, new URL(req.url));
}

function makeEnv({ row = null, updates = [] } = {}) {
  return {
    ADMIN_KEY,
    BOT_ENCRYPTION_KEY: ENC_KEY,
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async first() {
                if (sql.includes('SELECT id, page_id, ig_business_id, config FROM channel_configs')) {
                  return row;
                }
                return null;
              },
              async run() { updates.push({ sql, params }); return { success: true }; },
              async all() { return { results: row ? [row] : [] }; },
            };
          },
        };
      },
    },
    _updates: updates,
  };
}

describe('POST /admin/ig-set-direct-token', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  it('400 without tenantId/token', async () => {
    const res = await call(makeEnv(), {});
    expect(res?.status).toBe(400);
  });

  it('503 when BOT_ENCRYPTION_KEY missing', async () => {
    const env = makeEnv();
    delete env.BOT_ENCRYPTION_KEY;
    const res = await call(env, { tenantId: 't_1', token: 'IGAA_x' });
    expect(res?.status).toBe(503);
  });

  it('404 when tenant has no active IG channel', async () => {
    const res = await call(makeEnv({ row: null }), {
      tenantId: 't_nope', token: 'IGAA_x',
    });
    expect(res?.status).toBe(404);
  });

  it('400 when graph.instagram.com rejects the token', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { message: 'Invalid OAuth Access Token' } }),
      { status: 400 },
    ));
    const env = makeEnv({
      row: { id: 7, page_id: '1008301152373103', ig_business_id: IG_BUSINESS_ID, config: '{}' },
    });
    const res = await call(env, { tenantId: 't_1c305v2g5011', token: 'IGAA_bad' });
    expect(res?.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/graph\.instagram\.com/);
    expect(body.graphError).toMatch(/Invalid OAuth/);
  });

  it('hits graph.instagram.com (not graph.facebook.com) for validation', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: IG_BUSINESS_ID, username: 'manicbot_com' }),
      { status: 200 },
    ));
    const env = makeEnv({
      row: { id: 7, page_id: '1008301152373103', ig_business_id: IG_BUSINESS_ID, config: '{}' },
    });
    await call(env, { tenantId: 't_1c305v2g5011', token: 'IGAA_good' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('graph.instagram.com');
    expect(calledUrl).not.toContain('graph.facebook.com');
    expect(calledUrl).toContain('access_token=IGAA_good');
  });

  it('403 when token belongs to a DIFFERENT IG user than stored', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: '99999999999', username: 'someone_else' }),
      { status: 200 },
    ));
    const env = makeEnv({
      row: { id: 7, page_id: '1008301152373103', ig_business_id: IG_BUSINESS_ID, config: '{}' },
    });
    const res = await call(env, { tenantId: 't_1c305v2g5011', token: 'IGAA_wrong_owner' });
    expect(res?.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/99999999999/);
    expect(body.error).toMatch(/25881183448226493/);
    // Must NOT have written anything.
    expect(env._updates.filter(u => u.sql.includes('UPDATE channel_configs'))).toHaveLength(0);
  });

  it('happy path: encrypts, updates row, tags config.api=instagram_direct', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: IG_BUSINESS_ID, username: 'manicbot_com' }),
      { status: 200 },
    ));
    const env = makeEnv({
      row: {
        id: 7,
        page_id: '1008301152373103',
        ig_business_id: IG_BUSINESS_ID,
        config: JSON.stringify({ page_id: '1008301152373103', username: 'manicbot_com' }),
      },
    });
    const res = await call(env, { tenantId: 't_1c305v2g5011', token: 'IGAA_good_token' });
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.igUserId).toBe(IG_BUSINESS_ID);
    expect(body.igUsername).toBe('manicbot_com');
    expect(body.configApi).toBe('instagram_direct');

    const upd = env._updates.find(u => u.sql.includes('UPDATE channel_configs'));
    expect(upd).toBeTruthy();
    // [encrypted, configJSON, token_expires_at, updated_at, id]
    expect(upd.params[0]).toMatch(/^v1\$enc:/);  // encrypted
    const cfg = JSON.parse(upd.params[1]);
    expect(cfg.api).toBe('instagram_direct');
    expect(cfg.ig_user_id).toBe(IG_BUSINESS_ID);
    expect(cfg.ig_username).toBe('manicbot_com');
    // Pre-existing config keys preserved.
    expect(cfg.page_id).toBe('1008301152373103');
    // Bug #4 — IGAA tokens are 60d; a manual set must stamp an expiry too, or
    // the cron refresh stays dead (isTokenExpiring needs a non-null value).
    expect(upd.sql).toMatch(/token_expires_at\s*=\s*\?/);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(upd.params[2]).toBeGreaterThan(nowSec + 5184000 - 180);
    expect(upd.params[2]).toBeLessThanOrEqual(nowSec + 5184000 + 5);
    expect(upd.params[4]).toBe(7);
  });

  it('also matches ig_business_id stored in config JSON when column is empty', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: IG_BUSINESS_ID, username: 'manicbot_com' }),
      { status: 200 },
    ));
    const env = makeEnv({
      row: {
        id: 7,
        page_id: '1008301152373103',
        ig_business_id: null,  // not denormalized
        config: JSON.stringify({ instagram_business_id: IG_BUSINESS_ID }),
      },
    });
    const res = await call(env, { tenantId: 't_1c305v2g5011', token: 'IGAA_ok' });
    expect(res?.status).toBe(200);
  });

  // ── #6 — backfill the denormalized ig_business_id column on first install ──
  //
  // First install: ig_business_id column is NULL (and no id anywhere in
  // config). The /me response carries the IG id; we must BACKFILL the column
  // so a SECOND install with a mismatched token hits the existing
  // `expectedIg && mismatch → 403` branch. Pre-fix, the column was never
  // written, so any IGAA token (even one belonging to a different IG user)
  // could overwrite the tenant's token on every subsequent call.
  it('first install backfills ig_business_id when the column + config are empty', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: IG_BUSINESS_ID, username: 'manicbot_com' }),
      { status: 200 },
    ));
    const env = makeEnv({
      row: {
        id: 7,
        page_id: '1008301152373103',
        ig_business_id: null,            // never denormalized
        config: JSON.stringify({ page_id: '1008301152373103' }), // no IG id anywhere
      },
    });
    const res = await call(env, { tenantId: 't_first', token: 'IGAA_first_install' });
    expect(res?.status).toBe(200);

    const upd = env._updates.find(u => u.sql.includes('UPDATE channel_configs'));
    expect(upd).toBeTruthy();
    // The UPDATE must persist the returned IG id into the ig_business_id column.
    expect(upd.sql).toMatch(/ig_business_id\s*=\s*\?/);
    expect(upd.params).toContain(IG_BUSINESS_ID);
  });

  it('does NOT rewrite ig_business_id when the column is already set (happy path keeps param order)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: IG_BUSINESS_ID, username: 'manicbot_com' }),
      { status: 200 },
    ));
    const env = makeEnv({
      row: {
        id: 7,
        page_id: '1008301152373103',
        ig_business_id: IG_BUSINESS_ID,  // already denormalized
        config: JSON.stringify({ page_id: '1008301152373103' }),
      },
    });
    const res = await call(env, { tenantId: 't_set', token: 'IGAA_match' });
    expect(res?.status).toBe(200);
    const upd = env._updates.find(u => u.sql.includes('UPDATE channel_configs'));
    // No ig_business_id in the SET clause — the column was already correct.
    expect(upd.sql).not.toMatch(/ig_business_id\s*=\s*\?/);
  });

  it('second install with a MISMATCHED token is rejected 403 once ig_business_id is backfilled', async () => {
    // Simulates the post-backfill state: ig_business_id column now holds the
    // first installer's IG id. A different IGAA token (different IG user) must
    // be refused — this is the security property the backfill unlocks.
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ id: '88888888888', username: 'attacker' }),
      { status: 200 },
    ));
    const env = makeEnv({
      row: {
        id: 7,
        page_id: '1008301152373103',
        ig_business_id: IG_BUSINESS_ID,  // backfilled by the first install
        config: JSON.stringify({ page_id: '1008301152373103', ig_user_id: IG_BUSINESS_ID }),
      },
    });
    const res = await call(env, { tenantId: 't_first', token: 'IGAA_attacker' });
    expect(res?.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/88888888888/);
    expect(body.error).toMatch(/25881183448226493/);
    // Nothing written on the rejected path.
    expect(env._updates.filter(u => u.sql.includes('UPDATE channel_configs'))).toHaveLength(0);
  });
});
